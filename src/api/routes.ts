/**
 * The JSON API the web app reads: week, month, day, questions, status, files, packs; and the few writes Cut 1
 * allows (answer a question, mark posted, skip, push). Cut 2 adds edit and upload.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppContext } from '../context.js';
import { EDITABLE_FIELDS, allRows, editField, markPosted, pushRow, rowByDay, rowTitle, rowsBetween, seriesLabel, skipRow, type CalendarRow, type EditableField } from '../calendar/rows.js';
import { receiveAsset } from '../pipeline/worker.js';
import { redoRow } from '../pipeline/worker.js';
import { getFile } from '../files.js';
import { applyAnswer, statusText } from '../messaging/commands.js';
import { shotList } from '../pipeline/packs.js';
import { openQuestions } from '../pipeline/questions.js';
import { rowViews, type RowView } from '../reminders/brief.js';
import { allSettings } from '../settings.js';
import { addDays, sydneyDate } from '../time.js';

function viewJson(v: RowView, extra: Record<string, unknown> = {}) {
  const r = v.row;
  return {
    id: r.id, dayNo: r.day_no, date: r.date, slot: r.slot, type: r.type, dish: r.dish, theme: r.theme, status: r.status,
    template: r.template, postTime: r.post_time, title: rowTitle(r), series: seriesLabel(r),
    needs: v.needs.words, needsPhoto: v.needs.photo, needsClips: v.needs.clips, needsDish: v.needs.dish, confirmations: v.needs.confirmations,
    received: v.received, openQuestions: v.openQuestions, suggestion: v.suggestion, placeholders: v.placeholders,
    shotList: shotList(r.creative_instructions),
    ...extra,
  };
}

const qJson = (q: Awaited<ReturnType<typeof openQuestions>>[number]) => ({ id: q.id, rowId: q.row_id, field: q.field, question: q.question, options: q.options, askedAt: q.asked_at });

export function registerApi(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/me', async (req) => ({ user: req.user, hub: config.hub.url, webUrl: config.webUrl }));

  app.get('/api/week', async () => {
    const today = sydneyDate(ctx.now());
    const rows = await rowsBetween(ctx.pool, today, addDays(today, 6));
    const views = await rowViews(ctx, rows);
    const qs = await openQuestions(ctx.pool);
    const upcoming = await rowViews(ctx, await rowsBetween(ctx.pool, today, addDays(today, 13)));
    const shoot = upcoming.filter((v) => v.needs.photo || v.needs.clips).map((v) => ({ dayNo: v.row.day_no, date: v.row.date, dish: v.row.dish ?? v.row.theme ?? v.row.type, slot: v.row.slot, within: v.row.date <= addDays(today, 6) ? 7 : 14 }));
    return { today, days: views.map((v) => viewJson(v, { questions: qs.filter((q) => q.row_id === v.row.id).map(qJson) })), shootList: shoot };
  });

  app.get('/api/month', async () => {
    const views = await rowViews(ctx, await allRows(ctx.pool));
    const settings = await allSettings(ctx.pool);
    return { today: sydneyDate(ctx.now()), days: views.map((v) => viewJson(v)), settings: { storeAddress: settings.store_address, openHours: settings.open_hours } };
  });

  app.get<{ Params: { dayNo: string } }>('/api/day/:dayNo', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const [v] = await rowViews(ctx, [row]);
    const qs = await openQuestions(ctx.pool, row.id);
    const assets = (await ctx.pool.query<{ id: number; kind: string; caption_raw: string | null; prepped: Record<string, string> | null; original_file_id: string | null; created_at: Date; quality: unknown }>(
      'select id, kind, caption_raw, prepped, original_file_id, created_at, quality from assets where calendar_row_id = $1 order by created_at', [row.id])).rows;
    const pack = (await ctx.pool.query<{ id: number; caption: string; cta: string | null; hashtags: string[]; alt_text: string | null; story_text: string | null; facebook_caption: string | null; reel_pack_txt: string | null; canva_brief: string; caption_txt: string; folder: string; sources: { crops?: Record<string, string> }; created_at: Date }>(
      'select id, caption, cta, hashtags, alt_text, story_text, facebook_caption, reel_pack_txt, canva_brief, caption_txt, folder, sources, created_at from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0] ?? null;
    const renders = (await ctx.pool.query<{ id: number; format: string; page: number | null; file_id: string }>('select id, format, page, file_id from renders where calendar_row_id = $1 order by format, page', [row.id])).rows;
    const edits = (await ctx.pool.query<{ field: string; old_value: string | null; new_value: string | null; source: string; created_at: Date }>('select field, old_value, new_value, source, created_at from calendar_edits where row_id = $1 and source <> \'seed\' order by created_at desc limit 30', [row.id])).rows;
    const settings = await allSettings(ctx.pool);
    return {
      ...viewJson(v!),
      row: { ...row, post_time: row.post_time },
      questions: qs.map(qJson),
      assets: assets.map((a) => ({ id: a.id, kind: a.kind, caption: a.caption_raw, thumb: a.prepped?.thumb ?? a.prepped?.['1x1'] ?? a.original_file_id, crops: a.prepped, createdAt: a.created_at, quality: a.quality })),
      pack: pack && { ...pack, crops: pack.sources.crops ?? {} },
      renders,
      edits,
      settings: { storeAddress: settings.store_address, openHours: settings.open_hours, websiteUrl: settings.website_url, postTimeDefault: settings.post_time_default },
    };
  });

  app.get('/api/questions', async () => ({ questions: (await openQuestions(ctx.pool)).map(qJson) }));

  app.post<{ Params: { id: string }; Body: { answer?: string } }>('/api/questions/:id/answer', async (req, reply) => {
    const answer = String(req.body?.answer ?? '').trim();
    if (!answer) return reply.code(400).send({ ok: false, error: 'answer required' });
    const result = await applyAnswer(ctx, Number(req.params.id), answer, 'web');
    return { ok: true, message: result };
  });

  app.post<{ Params: { dayNo: string }; Body: { status?: string } }>('/api/rows/:dayNo/status', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    if (req.body?.status !== 'posted') return reply.code(400).send({ ok: false, error: 'Only "posted" can be set here.' });
    await markPosted(ctx.pool, row, 'owner-web', ctx.now());
    return { ok: true };
  });

  app.post<{ Params: { dayNo: string }; Body: { mode?: 'push-all' | 'just-this' } }>('/api/rows/:dayNo/skip', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const mode = req.body?.mode === 'push-all' ? 'push-all' : 'just-this';
    const next = await skipRow(ctx.pool, row, mode, 'owner-web');
    return { ok: true, date: next };
  });

  app.post<{ Params: { dayNo: string }; Body: { days?: number } }>('/api/rows/:dayNo/push', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const days = Number(req.body?.days ?? 1);
    if (!Number.isInteger(days) || !days || Math.abs(days) > 30) return reply.code(400).send({ ok: false, error: 'days must be a whole number' });
    const next = await pushRow(ctx.pool, row, days, 'owner-web');
    return { ok: true, date: next };
  });

  // Cut 2: edit any text field (history kept in calendar_edits) and upload photos from the phone.
  app.patch<{ Params: { dayNo: string }; Body: { field?: string; value?: string | null; redo?: boolean } }>('/api/rows/:dayNo', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const field = String(req.body?.field ?? '') as EditableField;
    if (!EDITABLE_FIELDS.includes(field)) return reply.code(400).send({ ok: false, error: `field must be one of ${EDITABLE_FIELDS.join(', ')}` });
    const raw = req.body?.value;
    const value = raw === null || raw === undefined || String(raw).trim() === '' ? null : String(raw).trim();
    try {
      await editField(ctx.pool, row, field, value, 'owner-web');
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    if (req.body?.redo) await redoRow(ctx.pool, row.id, null);
    return { ok: true };
  });

  app.post<{ Params: { dayNo: string } }>('/api/rows/:dayNo/upload', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    if (!req.isMultipart()) return reply.code(400).send({ ok: false, error: 'multipart/form-data expected' });
    let caption = '';
    const files: { bytes: Buffer; mime: string; filename: string }[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        if (bytes.length) files.push({ bytes, mime: part.mimetype, filename: part.filename });
      } else if (part.fieldname === 'caption') caption = String(part.value ?? '').trim();
    }
    if (!files.length) return reply.code(400).send({ ok: false, error: 'No file' });
    const base = caption || (row.dish && !row.dish.startsWith('[') ? row.dish.split(',')[0]!.toLowerCase() : (row.theme ?? 'photo').toLowerCase());
    const withDay = /#day\d+/i.test(base) ? base : `${base} #day${row.day_no}`;
    const ids: number[] = [];
    for (const f of files) {
      const isVideo = f.mime.startsWith('video/');
      const { asset } = await receiveAsset(ctx.pool, { kind: isVideo ? 'video' : 'document', bytes: isVideo ? undefined : f.bytes, mime: f.mime, filename: f.filename, caption: withDay });
      ids.push(asset.id);
    }
    return { ok: true, assetIds: ids, caption: withDay };
  });

  app.get('/api/status', async () => ({ text: await statusText(ctx) }));

  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    if (!/^[0-9a-f]{64}$/.test(req.params.id)) return reply.code(404).send();
    const f = await getFile(ctx.pool, req.params.id);
    if (!f) return reply.code(404).send();
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(f.bytes);
  });

  app.get<{ Params: { dayNo: string; name: string } }>('/api/packs/:dayNo/:name', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send();
    const p = (await ctx.pool.query<{ caption_txt: string; canva_brief: string; reel_pack_txt: string | null }>('select caption_txt, canva_brief, reel_pack_txt from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
    if (!p) return reply.code(404).send();
    const text = { 'caption.txt': p.caption_txt, 'canva-brief.txt': p.canva_brief, 'reel-pack.txt': p.reel_pack_txt }[req.params.name];
    if (!text) return reply.code(404).send();
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="day${row.day_no}-${req.params.name}"`);
    return reply.send(text);
  });
}

export type { CalendarRow };
