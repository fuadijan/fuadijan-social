/**
 * The seven stages, one function each. Each takes the job and returns what the worker should do next:
 * advance to a stage (with state), wait on a question, or finish. Nothing here talks to Telegram directly; the
 * messenger does, so the dry run can swap it for the console.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../context.js';
import { MatchResult, ResolvedCopy, type Unresolved } from '../brain/schemas.js';
import { matchPrompt, resolvePrompt } from '../brain/prompts.js';
import { allRows, daySlug, rowByDay, rowById, rowsBetween, seriesLabel, setStatus, type CalendarRow } from '../calendar/rows.js';
import { getFile, putFile } from '../files.js';
import { crop, cropAround, decode, measure, thumbnail, type Quality } from '../images/prep.js';
import { hasTag, parseCaption, type ParsedCaption } from '../intake/caption.js';
import { findItem } from '../menu/source.js';
import * as fmt from '../messaging/formats.js';
import { templateEntry } from '../render/registry.js';
import { allSettings, dishFactsFor, getSetting } from '../settings.js';
import { summarise, type DesignRun, type DesignSummary } from './design.js';
import { addCustomOption, applyOption, latestCopyOptions, markChosen, storeCopyOptions } from './wording.js';
import { applyCustomWording, customResolveNote, keepFormats } from './custom.js';
import { slogansFor } from '../slogans.js';
import { copyBrief, strategyIfAny } from '../strategy.js';
import { addDays, sydneyDate, sydneyTime } from '../time.js';
import { canvaBriefTxt, captionTxt, postTimeFor, reelPackTxt } from './packs.js';
import { answeredQuestions, askQuestion, openQuestions, setQuestionMessageId } from './questions.js';
import { RENDER_FILENAMES, renderForRow } from './render-stage.js';

export type Stage = 'intake' | 'match' | 'prep' | 'resolve' | 'render' | 'pack' | 'notify' | 'done';

export interface Asset {
  id: number;
  telegram_file_id: string | null;
  telegram_message_id: number | null;
  kind: 'photo' | 'document' | 'video' | 'text';
  filename: string | null;
  mime: string | null;
  caption_raw: string | null;
  parsed_subject: string | null;
  parsed_tags: string[];
  parsed_note: string | null;
  calendar_row_id: number | null;
  set_key: string | null;
  original_file_id: string | null;
  width: number | null;
  height: number | null;
  quality: Quality | null;
  prepped: Record<string, string> | null;
  match: MatchResult | null;
}

export interface JobState {
  jpegFileId?: string;
  qualityAccepted?: boolean;
  match?: MatchResult;
  unscheduled?: boolean;
  copy?: ResolvedCopy;
  note?: string | null;
  packId?: number;
  packFolder?: string;
  isSetFollower?: boolean;
  /** Which question ids this job has already asked and sent, so a re-run doesn't repeat them. */
  askedQuestionIds?: number[];
  /** The index of the wording option the owner chose (0 = the calendar wording); set once the choice is made. */
  wordingChosen?: number;
  /** How the design was decided and what the critic said, for the pack and the Telegram message. */
  design?: DesignRun;
}

export interface Job {
  id: number;
  asset_id: number | null;
  calendar_row_id: number | null;
  stage: Stage;
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed';
  state: JobState;
  waiting_on_question_id: number | null;
  attempts: number;
}

export type Outcome =
  | { kind: 'advance'; stage: Stage; state?: Partial<JobState>; rowId?: number }
  | { kind: 'wait'; questionId: number; state?: Partial<JobState>; rowId?: number }
  | { kind: 'done'; state?: Partial<JobState> }
  | { kind: 'cancel'; reason: string };

export interface StageContext extends AppContext {
  job: Job;
  asset: Asset | null;
}

export const PACKS_DIR = join(process.cwd(), 'packs');

async function loadJpeg(ctx: StageContext): Promise<Buffer> {
  const id = ctx.job.state.jpegFileId ?? ctx.asset?.original_file_id;
  if (!id) throw new Error('This job has no image.');
  const f = await getFile(ctx.pool, id);
  if (!f) throw new Error(`Image ${id} is missing from the files table.`);
  return f.bytes;
}

function caption(asset: Asset | null): ParsedCaption {
  return parseCaption(asset?.caption_raw);
}

async function sendQuestion(ctx: StageContext, q: { rowId: number | null; field: string; question: string; options: { key: string; label: string; value: string }[] }, header?: string) {
  const question = await askQuestion(ctx.pool, { ...q, jobId: ctx.job.id });
  if (header) await ctx.messenger.sendText(header);
  const sent = await ctx.messenger.sendText(question.question, { buttons: question.options.map((o) => ({ key: `q:${question.id}:${o.key}`, label: o.label })), questionId: question.id });
  await setQuestionMessageId(ctx.pool, question.id, sent.messageId);
  return question;
}

// ─── 1. intake ─────────────────────────────────────────────────────────────────────────────────────────────

export async function intake(ctx: StageContext): Promise<Outcome> {
  const asset = ctx.asset;
  if (!asset) throw new Error('intake needs an asset');
  if (asset.kind === 'video' || asset.kind === 'text') return { kind: 'advance', stage: 'match' };

  // A quality question answered → read the answer. The question is asked before the photo has a day, so it is
  // found by job, not by row.
  const answered = (await ctx.pool.query<{ answer: string | null }>(
    "select answer from questions where job_id = $1 and field = 'quality' and answered_at is not null order by answered_at desc limit 1", [ctx.job.id])).rows[0];
  const lastAnswer = answered?.answer ?? undefined;
  if (lastAnswer === 'resend') return { kind: 'cancel', reason: 'The owner will resend this photo as a File.' };

  let jpegFileId = ctx.job.state.jpegFileId;
  if (!jpegFileId) {
    const original = await getFile(ctx.pool, asset.original_file_id ?? '');
    if (!original) throw new Error('The original photo is missing.');
    const { jpeg, width, height } = await decode(original.bytes, asset.mime, asset.filename);
    jpegFileId = await putFile(ctx.pool, jpeg, 'image/jpeg');
    const quality = await measure(jpeg);
    await ctx.pool.query('update assets set width = $2, height = $3, quality = $4 where id = $1', [asset.id, width, height, JSON.stringify(quality)]);
    asset.quality = quality;
    asset.width = width;
    asset.height = height;
  }
  const quality = asset.quality!;
  // Any answer other than "resend" means go ahead: the owner has seen the warning, and asking again would loop.
  const accepted = ctx.job.state.qualityAccepted || (lastAnswer != null && lastAnswer !== 'resend');
  if (!accepted && quality.verdict !== 'ok') {
    const text = quality.verdict === 'small' ? fmt.QUALITY_SMALL : fmt.qualityBad(quality.verdict);
    const q = await sendQuestion(ctx, {
      rowId: asset.calendar_row_id, field: 'quality', question: text,
      options: [{ key: 'use', label: 'Use this one', value: 'use' }, { key: 'resend', label: "I'll resend as a File", value: 'resend' }],
    });
    return { kind: 'wait', questionId: q.id, state: { jpegFileId } };
  }
  return { kind: 'advance', stage: 'match', state: { jpegFileId, qualityAccepted: true } };
}

// ─── 2. match ──────────────────────────────────────────────────────────────────────────────────────────────

async function candidateRows(ctx: StageContext): Promise<CalendarRow[]> {
  const today = sydneyDate(ctx.now());
  const rows = await rowsBetween(ctx.pool, addDays(today, -2), addDays(today, 10));
  return rows.filter((r) => r.status !== 'posted');
}

function textScore(row: CalendarRow, cap: ParsedCaption): number {
  const hay = `${row.dish ?? ''} ${row.theme ?? ''} ${row.type} ${row.template}`.toLowerCase();
  const words = cap.subject.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
}

async function assignRow(ctx: StageContext, row: CalendarRow, match: MatchResult | null): Promise<void> {
  const asset = ctx.asset!;
  // Several photos within 10 minutes for the same day are one set.
  const recent = (await ctx.pool.query<{ set_key: string | null }>(
    "select set_key from assets where calendar_row_id = $1 and id <> $2 and created_at > now() - interval '10 minutes' and set_key is not null order by created_at desc limit 1",
    [row.id, asset.id])).rows[0];
  const setKey = recent?.set_key ?? `row-${row.id}-${Date.now()}`;
  await ctx.pool.query('update assets set calendar_row_id = $2, set_key = $3 where id = $1', [asset.id, row.id, setKey]);
  asset.calendar_row_id = row.id;
  asset.set_key = setKey;
  // A custom post still asking which photo to use has its answer: this one.
  await ctx.pool.query("update questions set answer = 'new', answered_via = 'telegram', answered_at = now() where row_id = $1 and field = 'photo' and answered_at is null", [row.id]);
  if (match?.dish_canonical && (!row.dish || row.dish.startsWith('['))) {
    // Never fill dish on the agent's own; it's a suggestion the owner sees in the pack questions instead.
  }
  await ctx.pool.query('update jobs set calendar_row_id = $2 where id = $1', [ctx.job.id, row.id]);
  ctx.job.calendar_row_id = row.id;
  ctx.job.state.isSetFollower = Boolean(recent?.set_key);
}

export async function match(ctx: StageContext): Promise<Outcome> {
  const asset = ctx.asset;
  if (!asset) throw new Error('match needs an asset');
  const cap = caption(asset);

  // The owner answered "Which day is this for?"
  const prior = (await answeredQuestions(ctx.pool, asset.calendar_row_id ?? -1)).concat(
    (await ctx.pool.query<import('./questions.js').Question>('select * from questions where job_id = $1 and field = $2 and answered_at is not null order by answered_at desc limit 1', [ctx.job.id, 'match'])).rows);
  const matchAnswer = prior.find((q) => q.field === 'match' && q.job_id === ctx.job.id)?.answer;
  if (matchAnswer === 'unscheduled') return { kind: 'advance', stage: asset.kind === 'video' ? 'done' : 'prep', state: { unscheduled: true } };
  if (matchAnswer && /^(\d+|day \d{1,3})$/.test(matchAnswer)) {
    // A button carries the row id; a typed "Day 5" (resolved to "day 5") names the day.
    const typedDay = matchAnswer.match(/^day (\d{1,3})$/);
    const row = typedDay ? await rowByDay(ctx.pool, Number(typedDay[1])) : await rowById(ctx.pool, Number(matchAnswer));
    if (row) {
      await assignRow(ctx, row, null);
      await ctx.messenger.sendText(fmt.photoReceived(row, cap.subject || asset.kind));
      return { kind: 'advance', stage: asset.kind === 'video' ? 'resolve' : 'prep', rowId: row.id };
    }
  }

  if (hasTag(cap, 'unscheduled')) return { kind: 'advance', stage: asset.kind === 'video' ? 'done' : 'prep', state: { unscheduled: true } };

  // Read the photo first (composition, clutter, where the dish sits), even when the caption already names the
  // day: the crop, the cutout and the shooting tip all come from this read.
  const forced = cap.dayNo ? (await allRows(ctx.pool)).find((r) => r.day_no === cap.dayNo) ?? null : null;
  if (cap.dayNo && !forced) throw new Error(`There is no Day ${cap.dayNo}.`);
  const candidates = forced ? [forced] : await candidateRows(ctx);
  const menu = await ctx.menu.get();
  let result: MatchResult | null = null;
  if (asset.kind !== 'video' && asset.kind !== 'text' && candidates.length) {
    const jpeg = await loadJpeg(ctx);
    const thumb = await thumbnail(jpeg, 512);
    const prompt = matchPrompt(cap, candidates, menu, sydneyDate(ctx.now()));
    result = await ctx.claude.call({ purpose: 'match-photo-to-row', fixtureKey: `day${cap.dayNo ?? ''}` || undefined, system: prompt.system, user: prompt.user, image: { bytes: thumb, mime: 'image/jpeg' }, schema: MatchResult, jobId: ctx.job.id });
    await ctx.pool.query('update assets set match = $2 where id = $1', [asset.id, JSON.stringify(result)]);
    asset.match = result;
    if (result.shoot_tip && result.background_clutter !== 'low') await ctx.messenger.sendText(`Tip: ${result.shoot_tip}`);
  }

  if (forced) {
    await assignRow(ctx, forced, result);
    await ctx.messenger.sendText(fmt.photoReceived(forced, result?.dish_canonical ?? cap.subject ?? asset.kind));
    return { kind: 'advance', stage: asset.kind === 'video' ? 'resolve' : 'prep', state: result ? { match: result } : {}, rowId: forced.id };
  }

  const ranked = candidates
    .map((r) => ({ r, score: (result?.row_id === r.id ? 10 : 0) + (result?.alternatives.some((a) => a.row_id === r.id) ? 3 : 0) + textScore(r, cap) }))
    .sort((a, b) => b.score - a.score || a.r.date.localeCompare(b.r.date));
  const chosen = result?.row_id ? candidates.find((r) => r.id === result!.row_id) ?? null : (ranked[0]?.score ? ranked[0].r : null);
  const confident = Boolean(result && result.confidence >= 0.7 && chosen);

  if (confident && chosen) {
    await assignRow(ctx, chosen, result);
    await ctx.messenger.sendText(fmt.photoReceived(chosen, result?.dish_canonical ?? cap.subject ?? asset.kind));
    return { kind: 'advance', stage: 'prep', state: { match: result! }, rowId: chosen.id };
  }

  const top = ranked.slice(0, 3).map((x) => x.r);
  const q = await sendQuestion(ctx, {
    rowId: null, field: 'match',
    question: `Which day is this ${asset.kind === 'video' ? 'clip' : 'photo'} for?${cap.subject ? ` ("${cap.subject}")` : ''}`,
    options: [...top.map((r) => ({ key: `r${r.id}`, label: `Day ${r.day_no} · ${(r.dish ?? r.theme ?? r.type).split(',')[0]!.slice(0, 22)}`, value: String(r.id) })), { key: 'unscheduled', label: 'Unscheduled', value: 'unscheduled' }],
  });
  return { kind: 'wait', questionId: q.id, state: result ? { match: result } : {} };
}

// ─── 3. prep ───────────────────────────────────────────────────────────────────────────────────────────────

export async function prep(ctx: StageContext): Promise<Outcome> {
  const asset = ctx.asset;
  if (!asset) throw new Error('prep needs an asset');
  if (asset.kind === 'video' || asset.kind === 'text') return { kind: 'advance', stage: 'resolve' };
  const jpeg = await loadJpeg(ctx);
  const box = (ctx.job.state.match ?? asset.match)?.subject_box ?? null;
  const prepped: Record<string, string> = {};
  // The feed and story crops are built around the dish Claude located (fallback: sharp's attention crop); the
  // square stays a plain centred crop.
  prepped['4x5'] = await putFile(ctx.pool, await cropAround(jpeg, box, 4 / 5, { focusY: 0.42 }), 'image/jpeg');
  prepped['9x16'] = await putFile(ctx.pool, await cropAround(jpeg, box, 9 / 16, { focusY: 0.40 }), 'image/jpeg');
  prepped['1x1'] = await putFile(ctx.pool, await cropAround(jpeg, box, 1, { focusY: 0.5 }), 'image/jpeg');
  // A small square thumb for the web app's lists (the 1x1 crop is 2160 px).
  prepped.thumb = await putFile(ctx.pool, await thumbnail(await crop(jpeg, '1x1'), 480), 'image/jpeg');
  await ctx.pool.query('update assets set prepped = $2 where id = $1', [asset.id, JSON.stringify(prepped)]);
  asset.prepped = prepped;
  if (ctx.job.state.unscheduled) return { kind: 'advance', stage: 'notify' };
  return { kind: 'advance', stage: 'resolve' };
}

// ─── 4. resolve ────────────────────────────────────────────────────────────────────────────────────────────

export async function resolve(ctx: StageContext): Promise<Outcome> {
  const rowId = ctx.job.calendar_row_id ?? ctx.asset?.calendar_row_id;
  if (!rowId) throw new Error('resolve needs a calendar row');
  const row = await rowById(ctx.pool, rowId);
  if (!row) throw new Error(`Row ${rowId} is gone.`);

  // A later photo in the same set reuses the copy already resolved for the row.
  if (ctx.job.state.isSetFollower) {
    const existing = (await ctx.pool.query<{ id: number }>('select id from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
    if (existing) return { kind: 'advance', stage: 'notify' };
  }

  const stillOpen = (await openQuestions(ctx.pool, row.id)).filter((q) => q.field !== 'quality' && q.field !== 'match');
  if (stillOpen.length) return { kind: 'wait', questionId: stillOpen[0]!.id };

  const menu = await ctx.menu.get();
  const answers = (await answeredQuestions(ctx.pool, row.id)).filter((q) => !['quality', 'match', 'skip', 'wording'].includes(q.field ?? '')).map((q) => ({ question: q.question, answer: q.answer ?? '' }));
  const cap = caption(ctx.asset);
  const entry = templateEntry(row.template);
  const read = ctx.job.state.match ?? ctx.asset?.match ?? null;
  const facts = await dishFactsFor(ctx.pool, [row.dish, cap.subject, read?.dish_canonical]);
  const slogans = await slogansFor(ctx.pool, [row.dish, cap.subject, read?.dish_canonical, seriesLabel(row), row.theme]);
  // A custom post tells the writer what is the owner's and fixed, and what is left to write.
  const note = [ctx.job.state.note ?? cap.note, row.custom ? customResolveNote(row.custom) : null].filter(Boolean).join('\n') || null;
  const prompt = resolvePrompt({
    row, menu, answers, note, dishCanonical: read?.dish_canonical ?? null,
    label: entry.label || seriesLabel(row), footer: entry.footer, priceAllowed: hasTag(cap, 'price') && !hasTag(cap, 'noprice'), facts,
    slogans: slogans.map((s) => `${s.item}: ${s.headline.replace(/\n/g, ' / ')}${s.line ? ` — ${s.line}` : ''}`),
    strategy: strategyIfAny() ? copyBrief(strategyIfAny()!, row) : null,
  });
  const written = await ctx.claude.call({ purpose: 'resolve-copy', fixtureKey: `day${row.day_no}`, system: prompt.system, user: prompt.user, schema: ResolvedCopy, jobId: ctx.job.id });
  const copy = applyCustomWording(written, row.custom);

  // Everything the menu can't settle goes to the owner, one message per question (so each has its buttons).
  const unresolved = copy.unresolved.filter((u) => !answers.some((a) => a.question === u.question));
  if (unresolved.length) {
    await setStatus(ctx.pool, row, 'photo-needed');
    await ctx.messenger.sendText(fmt.questionsMessage(`Day ${row.day_no} — ${row.dish ?? row.theme ?? row.type}`, unresolved.map((u, i) => ({ n: i + 1, question: u.question }))));
    let first: number | null = null;
    for (const u of unresolved) {
      const q = await sendQuestion(ctx, { rowId: row.id, field: fieldFor(u), question: u.question, options: u.suggestions.slice(0, 4).map((s, i) => ({ key: `s${i}`, label: s.slice(0, 40), value: s })) });
      first ??= q.id;
    }
    return { kind: 'wait', questionId: first!, state: { copy } };
  }
  // The main copy and Claude's alternative wordings are kept; the render stage asks which to use.
  await storeCopyOptions(ctx.pool, row.id, ctx.job.id, copy, slogans);
  return { kind: 'advance', stage: 'render', state: { copy } };
}

/**
 * Before the design: which wording? The owner's answer (buttons, the Day page or a typed headline) is applied
 * to the job's copy; with `/set wording off`, a set follower or a single option, the calendar wording is used.
 * Returns a wait outcome while the question is open, null once the copy is settled.
 */
async function chooseWording(ctx: StageContext, row: CalendarRow): Promise<Outcome | null> {
  const copy = ctx.job.state.copy!;
  if (ctx.job.state.wordingChosen !== undefined || ctx.job.state.isSetFollower) return null;
  // The owner composed the wording in the Create flow: nothing to ask.
  if (row.custom?.wording) {
    ctx.job.state.wordingChosen = 0;
    return null;
  }
  const set = await latestCopyOptions(ctx.pool, row.id);
  const mode = (await getSetting(ctx.pool, 'wording_choice')) || 'ask';
  if (!set || set.options.length < 2 || mode === 'off') {
    ctx.job.state.wordingChosen = 0;
    return null;
  }
  const use = (index: number, options: typeof set.options) => {
    ctx.job.state.copy = applyOption(copy, options[index]!);
    ctx.job.state.wordingChosen = index;
  };
  const answered = (await answeredQuestions(ctx.pool, row.id)).filter((q) => q.field === 'wording' && q.job_id === ctx.job.id).at(-1);
  if (answered?.answer != null) {
    // Buttons carry the option number (1-based), and a typed "2" means option 2; anything else is a headline.
    const raw = answered.answer.trim();
    const n = /^\d{1,2}$/.test(raw) ? Number(raw) - 1 : NaN;
    if (Number.isInteger(n) && set.options[n]) {
      await markChosen(ctx.pool, set.id, n);
      use(n, set.options);
    } else {
      const custom = await addCustomOption(ctx.pool, set, answered.answer);
      use(custom.index, custom.set.options);
    }
    return null;
  }
  if (set.chosen != null && set.options[set.chosen]) {
    use(set.chosen, set.options);
    return null;
  }
  // Buttons for the first eight; a longer bank is picked by number (the message lists them all).
  const q = await sendQuestion(ctx, {
    rowId: row.id, field: 'wording',
    question: `Which wording for Day ${row.day_no}? Tap one${set.options.length > 8 ? `, reply with a number up to ${set.options.length}` : ''}, or type your own headline.`,
    options: set.options.slice(0, 8).map((o, i) => ({ key: `v${i}`, label: `${i + 1} · ${o.name}`.slice(0, 40), value: String(i + 1) })),
  }, fmt.wordingOptions(row, set.options));
  return { kind: 'wait', questionId: q.id };
}

function fieldFor(u: Unresolved): string {
  return u.field === 'other' ? 'confirm' : u.field;
}

// ─── 5. render (Cut 2) ─────────────────────────────────────────────────────────────────────────────────────

export async function render(ctx: StageContext): Promise<Outcome> {
  const rowId = ctx.job.calendar_row_id ?? ctx.asset?.calendar_row_id;
  if (!rowId) throw new Error('render needs a calendar row');
  const row = await rowById(ctx.pool, rowId);
  if (!row) throw new Error(`Row ${rowId} is gone.`);
  if (!ctx.job.state.copy) throw new Error('render needs resolved copy');
  const choice = await chooseWording(ctx, row);
  if (choice) return choice;
  const rendered = await renderForRow(ctx, row);
  const { design } = rendered;
  const outputs = keepFormats(rendered.outputs, row.custom);
  await ctx.pool.query('delete from renders where calendar_row_id = $1', [row.id]);
  for (const o of outputs) {
    const fileId = await putFile(ctx.pool, o.png, 'image/png');
    await ctx.pool.query('insert into renders (asset_id, calendar_row_id, template, format, page, file_id) values ($1, $2, $3, $4, $5, $6)',
      [ctx.asset?.id ?? null, row.id, row.template, o.format, o.page, fileId]);
  }
  if (design) ctx.job.state.design = design;
  return { kind: 'advance', stage: 'pack' };
}

// ─── 6. pack ───────────────────────────────────────────────────────────────────────────────────────────────

export async function pack(ctx: StageContext): Promise<Outcome> {
  const rowId = ctx.job.calendar_row_id ?? ctx.asset?.calendar_row_id;
  if (!rowId) throw new Error('pack needs a calendar row');
  const row = await rowById(ctx.pool, rowId);
  if (!row) throw new Error(`Row ${rowId} is gone.`);
  const copy = ctx.job.state.copy;
  if (!copy) throw new Error('pack needs resolved copy');

  const s = await allSettings(ctx.pool);
  const settings = { storeAddress: s.store_address ?? '', openHours: s.open_hours ?? '', websiteUrl: s.website_url ?? '', instagramHandle: s.instagram_handle ?? '@fuadijan' };
  const postTime = postTimeFor(row, { post: s.post_time_default ?? '18:00', story: s.story_time_default ?? '12:00' });
  const clips = Number((await ctx.pool.query<{ n: string }>("select count(*) n from assets where calendar_row_id = $1 and kind = 'video'", [row.id])).rows[0]!.n);

  const assets = (await ctx.pool.query<Asset>('select * from assets where calendar_row_id = $1 order by created_at', [row.id])).rows;
  const hero = ctx.asset?.prepped ? ctx.asset : assets.find((a) => a.prepped);
  // The layout the render stage decided; for older jobs, A when the plate cutout was made and used.
  const design: DesignSummary | null = ctx.job.state.design ? summarise(ctx.job.state.design) : null;
  const layout: 'A' | 'B' = design?.layout ?? (hero?.prepped?.cutout && (await ctx.pool.query("select 1 from renders where calendar_row_id = $1 and format = 'feed'", [row.id])).rowCount ? 'A' : 'B');
  const sources: Record<string, unknown> = { assetIds: assets.map((a) => a.id), crops: {} as Record<string, string>, renders: {} as Record<string, string>, layout, design, wording: ctx.job.state.wordingChosen ?? null };

  const folderName = `${row.date} ${daySlug(row)}`;
  const folder = join(PACKS_DIR, folderName);
  mkdirSync(folder, { recursive: true });
  const captionText = captionTxt(row, copy, settings, postTime);
  const brief = canvaBriefTxt(row, copy, settings, layout, { feed: 'crop-4x5.jpg', story: 'crop-9x16.jpg' });
  const reelText = row.slot === 'reel' ? reelPackTxt(row, copy, clips) : null;
  writeFileSync(join(folder, 'caption.txt'), captionText);
  writeFileSync(join(folder, 'canva-brief.txt'), brief);
  if (reelText) writeFileSync(join(folder, 'reel-pack.txt'), reelText);
  if (design) writeFileSync(join(folder, 'design.json'), JSON.stringify({ ...design, spec: ctx.job.state.design?.spec, critique: ctx.job.state.design?.critique }, null, 2));

  for (const r of (await ctx.pool.query<{ format: 'feed' | 'story' | 'carousel' | 'reel-cover'; page: number | null; file_id: string }>('select format, page, file_id from renders where calendar_row_id = $1 order by format, page', [row.id])).rows) {
    const name = RENDER_FILENAMES[r.format](r.page);
    (sources.renders as Record<string, string>)[name] = r.file_id;
    const f = await getFile(ctx.pool, r.file_id);
    if (f) writeFileSync(join(folder, name), f.bytes);
  }
  if (hero?.prepped) {
    const crops: Record<string, string> = {};
    for (const key of ['4x5', '9x16', '1x1'] as const) {
      const fileId = hero.prepped[key];
      if (!fileId) continue;
      crops[key] = fileId;
      const f = await getFile(ctx.pool, fileId);
      if (f) writeFileSync(join(folder, `crop-${key}.jpg`), f.bytes);
    }
    sources.crops = crops;
  }

  const inserted = await ctx.pool.query<{ id: number }>(
    `insert into packs (calendar_row_id, caption, cta, hashtags, alt_text, story_text, facebook_caption, reel_hook, reel_on_screen_text, reel_shot_list, canva_brief, caption_txt, reel_pack_txt, folder, sources)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [row.id, copy.caption, copy.cta, copy.hashtags, copy.alt_text, copy.story_text, copy.facebook_caption,
      row.slot === 'reel' ? (copy.on_screen_text[0] ?? copy.headline.split('\n')[0] ?? null) : null,
      row.slot === 'reel' ? copy.on_screen_text : null, row.slot === 'reel' ? reelText?.split('\n').filter((l) => /^\s+\d+\)/.test(l)).map((l) => l.replace(/^\s+\d+\)\s*/, '')) ?? null : null,
      brief, captionText, reelText, folderName, JSON.stringify(sources)]);
  await setStatus(ctx.pool, row, 'ready');
  return { kind: 'advance', stage: 'notify', state: { packId: inserted.rows[0]!.id, packFolder: folderName } };
}

// ─── 7. notify ─────────────────────────────────────────────────────────────────────────────────────────────

export async function notify(ctx: StageContext): Promise<Outcome> {
  const asset = ctx.asset;
  if (ctx.job.state.unscheduled) {
    if (asset?.prepped) {
      for (const [key, id] of Object.entries(asset.prepped)) {
        const f = await getFile(ctx.pool, id);
        if (f) await ctx.messenger.sendDocument(f.bytes, `crop-${key}.jpg`);
      }
    }
    await ctx.messenger.sendText('Unscheduled photo: here are the plain crops. Nothing was matched to the calendar.');
    return { kind: 'done' };
  }
  const rowId = ctx.job.calendar_row_id ?? asset?.calendar_row_id;
  if (!rowId) throw new Error('notify needs a calendar row');
  const row = await rowById(ctx.pool, rowId);
  if (!row) throw new Error(`Row ${rowId} is gone.`);

  if (ctx.job.state.isSetFollower && asset?.prepped) {
    const f = await getFile(ctx.pool, asset.prepped['9x16'] ?? asset.prepped['4x5']!);
    if (f) await ctx.messenger.sendDocument(f.bytes, `day${row.day_no}-extra-${asset.id}.jpg`, `Added to Day ${row.day_no}'s set (story crop).`);
    return { kind: 'done' };
  }

  const p = (await ctx.pool.query<{ caption_txt: string; reel_pack_txt: string | null; hashtags: string[]; folder: string; sources: { crops?: Record<string, string>; renders?: Record<string, string>; design?: DesignSummary | null } }>(
    'select caption_txt, reel_pack_txt, hashtags, folder, sources from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
  if (!p) throw new Error('No pack to send.');
  const s = await allSettings(ctx.pool);
  const postTime = postTimeFor(row, { post: s.post_time_default ?? '18:00', story: s.story_time_default ?? '12:00' });

  await sendPackImages(ctx, row, p.sources);
  if (p.sources.design) await ctx.messenger.sendText(fmt.designLine(p.sources.design).replace('{N}', String(row.day_no)));
  await ctx.messenger.sendText(`${fmt.packHeader(row, postTime)}\n\n${p.reel_pack_txt ? `${p.reel_pack_txt}\n` : ''}${p.caption_txt.replace(/\n=== HASHTAGS[\s\S]*?\n\n/, '\n')}`);
  await ctx.messenger.sendText(p.hashtags.join(' '));
  await ctx.messenger.sendText(fmt.packFooter(row));
  await ctx.pool.query("insert into messages_log (direction, channel, kind, text) values ('out', $1, $2, $3)", [ctx.messenger.name, `pack:${row.id}`, p.folder]);
  return { kind: 'done' };
}

/** The rendered designs as files (full quality); the plain crops when nothing was rendered. */
async function sendPackImages(ctx: AppContext, row: CalendarRow, sources: { crops?: Record<string, string>; renders?: Record<string, string> }): Promise<void> {
  const renders = Object.entries(sources.renders ?? {});
  if (renders.length) {
    for (const [name, id] of renders) {
      const f = await getFile(ctx.pool, id);
      if (f) await ctx.messenger.sendDocument(f.bytes, `day${row.day_no}-${name}`);
    }
    return;
  }
  for (const key of ['4x5', '9x16'] as const) {
    const id = sources.crops?.[key];
    if (!id) continue;
    const f = await getFile(ctx.pool, id);
    if (f) await ctx.messenger.sendDocument(f.bytes, `day${row.day_no}-crop-${key}.jpg`);
  }
}

export const STAGES: Record<Exclude<Stage, 'done'>, (ctx: StageContext) => Promise<Outcome>> = { intake, match, prep, resolve, render, pack, notify };

/** Resend the latest pack for a row (post-time reminder, /pack N). */
export async function resendPack(ctx: AppContext, row: CalendarRow): Promise<boolean> {
  const p = (await ctx.pool.query<{ caption_txt: string; reel_pack_txt: string | null; hashtags: string[]; sources: { crops?: Record<string, string>; renders?: Record<string, string> } }>(
    'select caption_txt, reel_pack_txt, hashtags, sources from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
  if (!p) return false;
  const s = await allSettings(ctx.pool);
  const postTime = postTimeFor(row, { post: s.post_time_default ?? '18:00', story: s.story_time_default ?? '12:00' });
  await sendPackImages(ctx, row, p.sources);
  await ctx.messenger.sendText(`${fmt.packHeader(row, postTime)}\n\n${p.reel_pack_txt ? `${p.reel_pack_txt}\n` : ''}${p.caption_txt.replace(/\n=== HASHTAGS[\s\S]*?\n\n/, '\n')}`);
  await ctx.messenger.sendText(p.hashtags.join(' '));
  await ctx.messenger.sendText(fmt.packFooter(row));
  return true;
}

/** Whether a menu item exists for a dish name (used by the Sunday review and the week screen). */
export function dishOnMenu(menuItems: Parameters<typeof findItem>[0], dish: string | null): boolean | null {
  if (!dish || dish.startsWith('[')) return null;
  return dish.split(/[,+]/).some((d) => findItem(menuItems, d.trim()) !== null);
}

export function nowLabel(ctx: AppContext): string {
  return sydneyTime(ctx.now());
}
