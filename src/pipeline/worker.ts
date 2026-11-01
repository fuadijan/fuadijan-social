/**
 * The jobs worker: one stage per tick per job, resumable, parked while a question is open. A stage that throws
 * is retried with a growing delay; after three failures the owner is told once.
 */
import type pg from 'pg';
import type { AppContext } from '../context.js';
import type { ParsedCaption } from '../intake/caption.js';
import { parseCaption } from '../intake/caption.js';
import { putFile } from '../files.js';
import { STAGES, type Asset, type Job, type Stage, type StageContext } from './stages.js';

export interface IncomingAsset {
  kind: Asset['kind'];
  bytes?: Buffer;
  mime?: string | null;
  filename?: string | null;
  caption?: string | null;
  telegramFileId?: string | null;
  telegramMessageId?: number | null;
}

/** Stores the asset (bytes into `files`) and queues its job at `intake`. */
export async function receiveAsset(db: pg.Pool, input: IncomingAsset, note?: string | null): Promise<{ asset: Asset; job: Job; caption: ParsedCaption }> {
  const cap = parseCaption(input.caption);
  const fileId = input.bytes ? await putFile(db, input.bytes, input.mime ?? 'application/octet-stream') : null;
  const asset = (await db.query<Asset>(
    `insert into assets (telegram_file_id, telegram_message_id, kind, filename, mime, caption_raw, parsed_subject, parsed_tags, parsed_note, original_file_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [input.telegramFileId ?? null, input.telegramMessageId ?? null, input.kind, input.filename ?? null, input.mime ?? null, input.caption ?? null, cap.subject || null, cap.tags, cap.note, fileId])).rows[0]!;
  const job = (await db.query<Job>(
    "insert into jobs (asset_id, stage, status, state) values ($1, 'intake', 'queued', $2) returning *",
    [asset.id, JSON.stringify({ note: note ?? cap.note ?? null })])).rows[0]!;
  return { asset, job, caption: cap };
}

/** /redo N <note>: a fresh resolve → pack → notify for the row's latest photo, with the note. */
export async function redoRow(db: pg.Pool, rowId: number, note: string | null): Promise<Job | null> {
  const asset = (await db.query<Asset>('select * from assets where calendar_row_id = $1 and prepped is not null order by created_at desc limit 1', [rowId])).rows[0]
    ?? (await db.query<Asset>('select * from assets where calendar_row_id = $1 order by created_at desc limit 1', [rowId])).rows[0];
  // The upright JPEG the intake made for this photo, so the redo designs from the same picture, the same way up.
  const prior = asset ? (await db.query<{ jpeg: string | null }>("select state->>'jpegFileId' jpeg from jobs where asset_id = $1 and state ? 'jpegFileId' order by id desc limit 1", [asset.id])).rows[0] : undefined;
  const job = (await db.query<Job>(
    "insert into jobs (asset_id, calendar_row_id, stage, status, state) values ($1, $2, 'resolve', 'queued', $3) returning *",
    [asset?.id ?? null, rowId, JSON.stringify({ note, redo: true, jpegFileId: prior?.jpeg ?? undefined })])).rows[0]!;
  return job;
}

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly ctx: AppContext, private readonly intervalMs = 5_000) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.ctx.log.error('worker tick failed', { err: String(e) })), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs one stage of one due job. Returns false when nothing was due. */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const client = await this.ctx.pool.connect();
      let job: Job | undefined;
      try {
        await client.query('begin');
        job = (await client.query<Job>(
          "select * from jobs where status = 'queued' and run_after <= now() order by created_at limit 1 for update skip locked")).rows[0];
        if (job) await client.query("update jobs set status = 'running', attempts = attempts + 1, updated_at = now() where id = $1", [job.id]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      if (!job) return false;
      await this.run(job);
      return true;
    } finally {
      this.running = false;
    }
  }

  /** Runs every stage of every due job until the queue is quiet (tests, the dry run). */
  async drain(max = 50): Promise<void> {
    for (let i = 0; i < max; i++) {
      if (!(await this.tick())) return;
    }
  }

  private async run(job: Job): Promise<void> {
    const { pool } = this.ctx;
    const asset = job.asset_id ? (await pool.query<Asset>('select * from assets where id = $1', [job.asset_id])).rows[0] ?? null : null;
    const stageCtx: StageContext = { ...this.ctx, job: { ...job, attempts: job.attempts + 1 }, asset };
    const stage = job.stage as Exclude<Stage, 'done'>;
    const fn = STAGES[stage];
    try {
      if (!fn) throw new Error(`Unknown stage ${job.stage}`);
      const out = await fn(stageCtx);
      const state = JSON.stringify({ ...job.state, ...stageCtx.job.state, ...(('state' in out && out.state) || {}) });
      const rowId = ('rowId' in out && out.rowId) || stageCtx.job.calendar_row_id || job.calendar_row_id;
      switch (out.kind) {
        case 'advance':
          if (out.stage === 'done') await pool.query("update jobs set stage = 'done', status = 'done', state = $2, calendar_row_id = $3, attempts = 0, updated_at = now() where id = $1", [job.id, state, rowId]);
          else await pool.query("update jobs set stage = $2, status = 'queued', state = $3, calendar_row_id = $4, attempts = 0, last_error = null, updated_at = now() where id = $1", [job.id, out.stage, state, rowId]);
          break;
        case 'wait':
          await pool.query("update jobs set status = 'waiting', waiting_on_question_id = $2, state = $3, calendar_row_id = $4, attempts = 0, updated_at = now() where id = $1", [job.id, out.questionId, state, rowId]);
          break;
        case 'done':
          await pool.query("update jobs set stage = 'done', status = 'done', state = $2, calendar_row_id = $3, updated_at = now() where id = $1", [job.id, state, rowId]);
          break;
        case 'cancel':
          await pool.query("update jobs set status = 'failed', last_error = $2, updated_at = now() where id = $1", [job.id, out.reason]);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      this.ctx.log.warn(`job ${job.id} stage ${job.stage} failed (attempt ${attempts})`, { err: message });
      if (attempts >= 3) {
        await pool.query("update jobs set status = 'failed', last_error = $2, updated_at = now() where id = $1", [job.id, message]);
        await this.ctx.messenger.sendText(`I couldn't process ${asset?.kind ?? 'this job'}${asset?.caption_raw ? ` "${asset.caption_raw}"` : ''} (${job.stage}): ${message}`).catch(() => {});
      } else {
        await pool.query("update jobs set status = 'queued', last_error = $2, run_after = now() + ($3 || ' seconds')::interval, updated_at = now() where id = $1", [job.id, message, String(30 * attempts)]);
      }
    }
  }
}
