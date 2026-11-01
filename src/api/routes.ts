/**
 * The JSON API the web app reads: week, month, day, questions, status, files, packs; and the few writes Cut 1
 * allows (answer a question, mark posted, skip, push). Cut 2 adds edit and upload; then the Create flow (a
 * custom design from a product, a series, a wording, a style and a photo) and the wording bank it draws on.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppContext } from '../context.js';
import { EDITABLE_FIELDS, allRows, currentPlan, editField, markPosted, plans, pushRow, rowByDay, rowTitle, rowsBetween, seriesLabel, skipRow, type CalendarRow, type EditableField } from '../calendar/rows.js';
import { receiveAsset } from '../pipeline/worker.js';
import { redoRow } from '../pipeline/worker.js';
import { getFile } from '../files.js';
import { applyAnswer, statusText } from '../messaging/commands.js';
import { shotList } from '../pipeline/packs.js';
import { openQuestions } from '../pipeline/questions.js';
import { allCopyOptions, copyOptionsById, markChosen, rerenderWithWording } from '../pipeline/wording.js';
import { adoptAsset, createCustomPost, parseCustomInput, recentPhotos } from '../pipeline/custom.js';
import { rowViews, type RowView } from '../reminders/brief.js';
import { heroTemplates } from '../render/registry.js';
import { STYLE_KEYS, STYLES } from '../render/styles.js';
import { allSettings } from '../settings.js';
import { addSlogan, itemKey, listSlogans, removeSlogan, updateSlogan, type Slogan } from '../slogans.js';
import { eventsOn, loadStrategy, ritualsOn } from '../strategy.js';
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

  app.get<{ Querystring: { plan?: string } }>('/api/month', async (req) => {
    const today = sydneyDate(ctx.now());
    const all = await plans(ctx.pool);
    const plan = all.some((p) => p.plan === req.query.plan) ? req.query.plan! : await currentPlan(ctx.pool, today);
    const views = await rowViews(ctx, await allRows(ctx.pool, plan));
    const settings = await allSettings(ctx.pool);
    return { today, plan, plans: all, days: views.map((v) => viewJson(v)), settings: { storeAddress: settings.store_address, openHours: settings.open_hours } };
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
    const wording = (await allCopyOptions(ctx.pool, row.id)).map((w) => ({ id: w.id, options: w.options, chosen: w.chosen, createdAt: w.created_at }));
    return {
      ...viewJson(v!),
      row: { ...row, post_time: row.post_time },
      questions: qs.map(qJson),
      wording,
      wordingWaiting: qs.some((q) => q.field === 'wording'),
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

  // The owner picks a wording: answers the open question when the pipeline is waiting, else rebuilds the pack.
  app.post<{ Params: { dayNo: string }; Body: { setId?: number; index?: number } }>('/api/rows/:dayNo/wording', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const set = await copyOptionsById(ctx.pool, Number(req.body?.setId));
    const index = Number(req.body?.index);
    if (!set || set.calendar_row_id !== row.id || !Number.isInteger(index) || !set.options[index]) return reply.code(400).send({ ok: false, error: 'No such wording' });
    const open = (await openQuestions(ctx.pool, row.id)).find((q) => q.field === 'wording');
    if (open) {
      await markChosen(ctx.pool, set.id, index);
      const message = await applyAnswer(ctx, open.id, String(index + 1), 'web');
      return { ok: true, message };
    }
    const job = await rerenderWithWording(ctx.pool, row.id, set, index);
    if (!job) {
      await markChosen(ctx.pool, set.id, index);
      return { ok: true, message: 'Noted; it is used when the day is rendered.' };
    }
    return { ok: true, message: `Wording ${index + 1} — rebuilding the designs and the pack.` };
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

  // ─── the Create flow: a custom design ──────────────────────────────────────────────────────────────────

  /** Menu items plus every item in the wording bank, with how many wordings each has. */
  async function products(): Promise<{ name: string; category: string | null; wordings: number }[]> {
    let menu: { name: string; category: string | null }[] = [];
    try {
      menu = (await ctx.menu.get()).items.filter((i) => !i.soldOut).map((i) => ({ name: i.name, category: i.category }));
    } catch {
      menu = [];
    }
    const counts = new Map<string, number>();
    const names = new Map<string, string>();
    for (const s of await listSlogans(ctx.pool)) {
      if (s.item_key === 'all') continue;
      counts.set(s.item_key, (counts.get(s.item_key) ?? 0) + 1);
      names.set(s.item_key, s.item);
    }
    const out = new Map<string, { name: string; category: string | null; wordings: number }>();
    for (const m of menu) out.set(itemKey(m.name), { name: m.name, category: m.category, wordings: counts.get(itemKey(m.name)) ?? 0 });
    for (const [k, name] of names) if (!out.has(k)) out.set(k, { name, category: null, wordings: counts.get(k) ?? 0 });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  app.get('/api/create/options', async () => {
    const settings = await allSettings(ctx.pool);
    return {
      today: sydneyDate(ctx.now()),
      postTimeDefault: settings.post_time_default ?? '18:00',
      products: await products(),
      templates: heroTemplates(),
      styles: STYLE_KEYS.map((k) => ({ key: k, name: STYLES[k].name, blurb: STYLES[k].blurb, needsCutout: STYLES[k].needsCutout, story: STYLES[k].story })),
      photos: await recentPhotos(ctx.pool),
    };
  });

  /**
   * Makes the custom post's row. With `assetId` a photo already received is filed for it and the pipeline starts
   * at resolve; otherwise the web app uploads the photo next (POST /api/rows/:dayNo/upload) and intake takes it.
   */
  app.post<{ Body: Record<string, unknown> }>('/api/create', async (req, reply) => {
    let input;
    try {
      input = parseCustomInput(req.body);
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    const row = await createCustomPost(ctx.pool, input, sydneyDate(ctx.now()));
    const assetId = Number(req.body?.assetId);
    if (Number.isInteger(assetId) && assetId > 0) {
      try {
        await adoptAsset(ctx.pool, row, assetId);
      } catch (e) {
        return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e), dayNo: row.day_no });
      }
    }
    return { ok: true, dayNo: row.day_no, date: row.date, plan: row.plan };
  });

  /** The marketing strategy (brand/strategy.json) with today's rituals and running events picked out. */
  app.get('/api/strategy', async (_req, reply) => {
    let strategy;
    try {
      strategy = loadStrategy();
    } catch (e) {
      return reply.code(404).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    const today = sydneyDate(ctx.now());
    const wordings = (await listSlogans(ctx.pool)).filter((s) => s.source === 'strategy').length;
    return { today, strategy, todayRituals: ritualsOn(strategy, today).map((r) => r.name), runningEvents: eventsOn(strategy, today).map((e) => e.name), wordingsInBank: wordings };
  });

  /**
   * Makes the strategy's 30-day plan the month's calendar: the same seed as the workbook, run in-process, with the
   * dates as written (no CALENDAR_START shift) and every day that has started (a photo received, or past
   * "planned") left as it is. Owner-edited fields stay protected as always.
   */
  app.post('/api/strategy/seed', async (_req, reply) => {
    let strategy;
    try {
      strategy = loadStrategy();
    } catch (e) {
      return reply.code(404).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    const { strategyRows } = await import('../../calendar/strategy-workbook.js');
    const { seedRows } = await import('../../calendar/seed.js');
    const { cleanRow } = await import('../../calendar/calendar.schema.js');
    const rows = strategyRows(strategy).map((r, i) => cleanRow(r, i + 1));
    const result = await seedRows(ctx.pool, rows, rows[0]!.date, { keepStarted: true });
    return { ok: true, ...result };
  });

  // ─── the wording bank (slogans): one product, many wordings ───────────────────────────────────────────

  const wordingJson = (s: Slogan) => ({ id: s.id, item: s.item, itemKey: s.item_key, headline: s.headline, line: s.line, caption: s.caption, source: s.source });

  app.get('/api/wordings', async () => {
    const groups = new Map<string, { item: string; itemKey: string; wordings: ReturnType<typeof wordingJson>[] }>();
    for (const s of await listSlogans(ctx.pool)) {
      const g = groups.get(s.item_key) ?? { item: s.item_key === 'all' ? 'Every post' : s.item, itemKey: s.item_key, wordings: [] };
      g.wordings.push(wordingJson(s));
      groups.set(s.item_key, g);
    }
    // The house wordings first, then the products by name.
    const list = [...groups.values()].sort((a, b) => (a.itemKey === 'all' ? -1 : b.itemKey === 'all' ? 1 : a.item.localeCompare(b.item)));
    return { groups: list, products: (await products()).map((p) => p.name) };
  });

  function wordingBody(body: Record<string, unknown> | undefined): { headline: string; line: string | null; caption: string | null } {
    const headline = String(body?.headline ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n').slice(0, 60);
    if (!headline) throw new Error('A wording needs a headline.');
    return { headline, line: String(body?.line ?? '').trim().slice(0, 140) || null, caption: String(body?.caption ?? '').trim().slice(0, 2200) || null };
  }

  app.post<{ Body: Record<string, unknown> }>('/api/wordings', async (req, reply) => {
    const item = String(req.body?.item ?? '').trim().slice(0, 60);
    if (!item) return reply.code(400).send({ ok: false, error: 'Which product is this wording for?' });
    try {
      const s = await addSlogan(ctx.pool, { item, ...wordingBody(req.body), source: 'owner-web' });
      return { ok: true, wording: wordingJson(s) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/wordings/:id', async (req, reply) => {
    try {
      const s = await updateSlogan(ctx.pool, Number(req.params.id), wordingBody(req.body));
      if (!s) return reply.code(404).send({ ok: false, error: 'No such wording' });
      return { ok: true, wording: wordingJson(s) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/wordings/:id', async (req, reply) => {
    if (!(await removeSlogan(ctx.pool, Number(req.params.id)))) return reply.code(404).send({ ok: false, error: 'No such wording' });
    return { ok: true };
  });

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
