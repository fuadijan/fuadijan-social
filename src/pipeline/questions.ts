/**
 * Open confirmations. A question parks a job (waiting_on_question_id); the answer wakes it. Buttons carry
 * `q:<id>:<key>`; a free-text reply goes to the newest open question.
 */
import type { Db } from '../db/pool.js';

export interface QuestionOption { key: string; label: string; value: string }

export interface Question {
  id: number;
  row_id: number | null;
  job_id: number | null;
  field: string | null;
  question: string;
  options: QuestionOption[];
  answer: string | null;
  answered_via: string | null;
  asked_at: Date;
  answered_at: Date | null;
  telegram_message_id: number | null;
}

export async function askQuestion(db: Db, q: { rowId: number | null; jobId: number | null; field: string; question: string; options: QuestionOption[] }): Promise<Question> {
  const { rows } = await db.query<Question>(
    'insert into questions (row_id, job_id, field, question, options) values ($1, $2, $3, $4, $5) returning *',
    [q.rowId, q.jobId, q.field, q.question, JSON.stringify(q.options)]);
  return rows[0]!;
}

export async function openQuestions(db: Db, rowId?: number): Promise<Question[]> {
  const { rows } = rowId === undefined
    ? await db.query<Question>('select * from questions where answered_at is null order by asked_at')
    : await db.query<Question>('select * from questions where answered_at is null and row_id = $1 order by asked_at', [rowId]);
  return rows;
}

export async function openQuestionCounts(db: Db): Promise<Map<number, number>> {
  const { rows } = await db.query<{ row_id: number; n: string }>('select row_id, count(*) n from questions where answered_at is null and row_id is not null group by row_id');
  return new Map(rows.map((r) => [r.row_id, Number(r.n)]));
}

export async function questionById(db: Db, id: number): Promise<Question | null> {
  return (await db.query<Question>('select * from questions where id = $1', [id])).rows[0] ?? null;
}

export async function latestOpenQuestion(db: Db): Promise<Question | null> {
  return (await db.query<Question>('select * from questions where answered_at is null order by asked_at desc limit 1')).rows[0] ?? null;
}

export async function answeredQuestions(db: Db, rowId: number): Promise<Question[]> {
  return (await db.query<Question>('select * from questions where row_id = $1 and answered_at is not null order by asked_at', [rowId])).rows;
}

export async function setQuestionMessageId(db: Db, id: number, messageId: number | null): Promise<void> {
  if (messageId == null) return;
  await db.query('update questions set telegram_message_id = $2 where id = $1', [id, messageId]);
}

/**
 * Records the answer (a button's value or free text) and wakes any job waiting on it. Returns the question with
 * the answer filled in, or null if it was already answered.
 */
export async function answerQuestion(db: Db, id: number, answer: string, via: 'telegram' | 'web' | 'dry-run'): Promise<Question | null> {
  const { rows } = await db.query<Question>(
    'update questions set answer = $2, answered_via = $3, answered_at = now() where id = $1 and answered_at is null returning *',
    [id, answer, via]);
  const q = rows[0];
  if (!q) return null;
  await db.query("update jobs set status = 'queued', waiting_on_question_id = null, run_after = now(), updated_at = now() where waiting_on_question_id = $1", [id]);
  return q;
}

/**
 * A button key → its value. Typed replies are read generously: an option's key, value or label ("use this one"),
 * a reply that clearly means one of them ("use current", "keep it", "ok" → use; "I'll resend", "file" → resend;
 * "Day 5" → that day's option), or the raw text when nothing fits.
 */
export function resolveAnswer(q: Question, keyOrText: string): string {
  const raw = keyOrText.trim();
  const byKey = q.options.find((o) => o.key === raw);
  if (byKey) return byKey.value;
  const text = raw.toLowerCase().replace(/[^\p{L}\p{N}\s#]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return raw;
  const exact = q.options.find((o) => o.value.toLowerCase() === text || o.label.toLowerCase() === text || o.key.toLowerCase() === text);
  if (exact) return exact.value;

  if (q.field === 'quality') {
    if (/\b(resend|re send|file|another|retake|again|new one|better one)\b/.test(text)) return q.options.find((o) => o.value === 'resend')?.value ?? raw;
    if (/\b(use|current|keep|this one|ok|okay|yes|yep|fine|go|proceed|continue|anyway)\b/.test(text)) return q.options.find((o) => o.value === 'use')?.value ?? raw;
  }
  if (q.field === 'match' || q.field === 'photo') {
    if (/\b(unscheduled|none|no day|not scheduled)\b/.test(text)) return q.options.find((o) => o.value === 'unscheduled')?.value ?? raw;
    const day = text.match(/(?:^|\bday\s*|#day)(\d{1,3})\b/);
    if (day) {
      const opt = q.options.find((o) => new RegExp(`^day ${day[1]}\\b`).test(o.label.toLowerCase()));
      if (opt) return opt.value;
      return `day ${day[1]}`;
    }
  }

  // One option whose label (or a word of it) is named in the reply.
  const words = new Set(text.split(' '));
  const named = q.options.filter((o) => {
    const label = o.label.toLowerCase();
    return text.includes(label) || label.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).some((w) => words.has(w));
  });
  if (named.length === 1) return named[0]!.value;
  return raw;
}
