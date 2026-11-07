/**
 * The JSON API the web app reads: week, month, day, questions, status, files, packs; and the few writes Cut 1
 * allows (answer a question, mark posted, skip, push). Cut 2 adds edit and upload; then the Create flow (a
 * custom design from a product, a series, a wording, a style and a photo) and the wording bank it draws on.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { AppContext } from '../context.js';
import { EDITABLE_FIELDS, allRows, cleanInvite, setInvite, currentPlan, editField, markPosted, plans, pushRow, recordEdit, rowByDay, rowTitle, rowsBetween, seriesLabel, skipRow, type CalendarRow, type EditableField } from '../calendar/rows.js';
import { receiveAsset } from '../pipeline/worker.js';
import { redoRow } from '../pipeline/worker.js';
import { getFile, putFile } from '../files.js';
import { applyAnswer, statusText } from '../messaging/commands.js';
import { shotList } from '../pipeline/packs.js';
import { openQuestions } from '../pipeline/questions.js';
import { addOwnerOption, allCopyOptions, copyOptionsById, latestCopyOptions, markChosen, remakeNote, rerenderRow, rerenderWithWording, updateOption, type CopyOptions } from '../pipeline/wording.js';
import { POST_PARTS, POST_TEXT_FIELDS, PostBusyError, cleanHashtags, rowIsBusy, rowIsWaiting, setPostParts, setPostText, setReelClips, spreadSloganEdit, switchPostKind, spreadSloganLink, type PostPart, type PostTextField } from '../pipeline/post-text.js';
import { parsePreviewInput, previewDesign } from '../pipeline/preview.js';
import { loadBrand } from '../render/brand.js';
import { WORDING_LIBRARIES, wordingsView } from '../wordings-view.js';
import { adoptAsset, createCustomPost, parseCustomInput, recentPhotos } from '../pipeline/custom.js';
import { rowViews, type RowView } from '../reminders/brief.js';
import { heroTemplates, suggestedTemplate, templateEntry } from '../render/registry.js';
import { STYLE_KEYS, STYLES } from '../render/styles.js';
import { allSettings } from '../settings.js';
import { addSlogan, itemKey, linkSlogan, listSlogans, removeSlogan, sloganById, unlinkSlogan, updateSlogan, type Slogan } from '../slogans.js';
import { eventsOn, loadStrategy, ritualsOn } from '../strategy.js';
import { campaignProgress } from '../campaigns.js';
import { platformVersions, platformsTxt, type PlatformVersions } from '../calendar/record.js';
import { listProducts } from '../products.js';
import { listBenefits } from '../benefits.js';
import { editReferenceRow, listReference } from '../reference.js';
import { addDays, sydneyDate } from '../time.js';

function viewJson(v: RowView, extra: Record<string, unknown> = {}) {
  const r = v.row;
  return {
    id: r.id, dayNo: r.day_no, date: r.date, slot: r.slot, type: r.type, dish: r.dish, theme: r.theme, status: r.status,
    template: r.template, postTime: r.post_time, title: rowTitle(r), series: seriesLabel(r),
    campaign: v.campaign ? { key: v.campaign.key, name: v.campaign.name, status: v.campaign.status } : null,
    benefit: r.benefit,
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
    const assets = (await ctx.pool.query<{ id: number; kind: string; filename: string | null; caption_raw: string | null; prepped: Record<string, string> | null; original_file_id: string | null; still_file_id: string | null; created_at: Date; quality: unknown }>(
      'select id, kind, filename, caption_raw, prepped, original_file_id, still_file_id, created_at, quality from assets where calendar_row_id = $1 order by created_at', [row.id])).rows;
    const pack = (await ctx.pool.query<{ id: number; caption: string; cta: string | null; hashtags: string[]; alt_text: string | null; story_text: string | null; facebook_caption: string | null; reel_pack_txt: string | null; canva_brief: string; caption_txt: string; folder: string; sources: { crops?: Record<string, string> }; created_at: Date }>(
      'select id, caption, cta, hashtags, alt_text, story_text, facebook_caption, reel_pack_txt, canva_brief, caption_txt, folder, sources, platforms, created_at from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0] ?? null;
    const renders = (await ctx.pool.query<{ id: number; format: string; page: number | null; file_id: string }>('select id, format, page, file_id from renders where calendar_row_id = $1 order by format, page', [row.id])).rows;
    const edits = (await ctx.pool.query<{ field: string; old_value: string | null; new_value: string | null; source: string; created_at: Date }>('select field, old_value, new_value, source, created_at from calendar_edits where row_id = $1 and source <> \'seed\' order by created_at desc limit 30', [row.id])).rows;
    const settings = await allSettings(ctx.pool);
    const wording = (await allCopyOptions(ctx.pool, row.id)).map((w) => ({ id: w.id, options: w.options, chosen: w.chosen, createdAt: w.created_at }));
    return {
      ...viewJson(v!),
      row: { ...row, post_time: row.post_time },
      canPair: templateEntry(row.template).key === 'hero-photo',
      questions: qs.map(qJson),
      wording,
      wordingWaiting: qs.some((q) => q.field === 'wording'),
      // The finished set once a pack exists; before that, what the record already says.
      platforms: (pack as { platforms?: PlatformVersions | null } | undefined)?.platforms ?? (row.content ? platformVersions(row, null) : null),
      assets: assets.map((a) => ({ id: a.id, kind: a.kind, caption: a.caption_raw, filename: a.filename, thumb: a.prepped?.thumb ?? a.prepped?.['1x1'] ?? a.still_file_id ?? a.original_file_id, crops: a.prepped, createdAt: a.created_at, quality: a.quality })),
      pack: pack && { ...pack, crops: pack.sources.crops ?? {} },
      renders,
      edits,
      settings: { storeAddress: settings.store_address, openHours: settings.open_hours, websiteUrl: settings.website_url, postTimeDefault: settings.post_time_default, brandLine: loadBrand().brandLine },
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
    return { ok: true, ...await useWording(row, set, index) };
  });

  async function useWording(row: CalendarRow, set: CopyOptions, index: number): Promise<{ message: string; rebuilding: boolean }> {
    const open = (await openQuestions(ctx.pool, row.id)).find((q) => q.field === 'wording');
    if (open) {
      await markChosen(ctx.pool, set.id, index);
      return { message: await applyAnswer(ctx, open.id, String(index + 1), 'web'), rebuilding: true };
    }
    const job = await rerenderWithWording(ctx.pool, row.id, set, index);
    if (!job) {
      await markChosen(ctx.pool, set.id, index);
      return { message: 'Noted; it is used when the day is rendered.', rebuilding: false };
    }
    return { message: `Wording ${index + 1} — rebuilding the designs and the pack.`, rebuilding: true };
  }

  /** One of the post's finished texts, typed over: into the pack at once, with no writer run and no question. */
  app.patch<{ Params: { dayNo: string }; Body: { field?: string; value?: string | null } }>('/api/rows/:dayNo/text', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const field = String(req.body?.field ?? '') as PostTextField;
    if (!POST_TEXT_FIELDS.includes(field)) return reply.code(400).send({ ok: false, error: `field must be one of ${POST_TEXT_FIELDS.join(', ')}` });
    try {
      return { ok: true, ...await setPostText(ctx.pool, row, field, req.body?.value == null ? null : String(req.body.value), 'owner-web') };
    } catch (e) {
      return reply.code(e instanceof PostBusyError ? 409 : 400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** The builder's parts of a post, saved together: the designs are made again once, when the words on them changed. */
  app.post<{ Params: { dayNo: string }; Body: { parts?: Record<string, unknown>; look?: { style?: string; note?: string; invite?: unknown } } }>('/api/rows/:dayNo/parts', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const body = req.body?.parts ?? {};
    const parts: Partial<Record<PostPart, string | null>> = {};
    for (const k of POST_PARTS) if (k in body) parts[k] = body[k] == null ? null : String(body[k]).slice(0, 2200);
    const look = req.body?.look;
    const style = String(look?.style ?? 'auto');
    if (style !== 'auto' && !(STYLE_KEYS as readonly string[]).includes(style)) return reply.code(400).send({ ok: false, error: 'Pick a style.' });
    try {
      if (look && await rowIsBusy(ctx.pool, row.id)) throw new PostBusyError();
      const inviteChanged = look && 'invite' in look ? await setInvite(ctx.pool, row, cleanInvite(look.invite), 'owner-web') : false;
      const r = await setPostParts(ctx.pool, (await rowByDay(ctx.pool, row.day_no, row.plan))!, parts, 'owner-web', look ? { note: remakeNote(style, look.note), force: true } : undefined);
      if (inviteChanged && !r.changed.length && !r.rebuilding) return { ok: true, message: 'Saved. The invite uses these details when the design is made.', rebuilding: false };
      const message = !r.changed.length && !r.rebuilding ? 'Nothing changed.' : !r.changed.length ? 'Making the design again with the new look.' : r.rebuilding ? 'Saved. The designs are being made again with these words.' : 'Saved. The post uses these words.';
      return { ok: true, message, rebuilding: r.rebuilding };
    } catch (e) {
      return reply.code(e instanceof PostBusyError ? 409 : 400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * The design made again from the same words and photo: the art director and the critic run afresh, with the look
   * asked for (a style) and anything the owner wants changed ("words at the top, bigger").
   */
  app.post<{ Params: { dayNo: string }; Body: { style?: string; note?: string; invite?: unknown } }>('/api/rows/:dayNo/remake', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const style = String(req.body?.style ?? 'auto');
    if (style !== 'auto' && !(STYLE_KEYS as readonly string[]).includes(style)) return reply.code(400).send({ ok: false, error: 'Pick a style.' });
    if (await rowIsBusy(ctx.pool, row.id)) return reply.code(409).send({ ok: false, error: new PostBusyError().message });
    if (req.body && 'invite' in req.body) await setInvite(ctx.pool, row, cleanInvite(req.body.invite), 'owner-web');
    const job = await rerenderRow(ctx.pool, row.id, { note: remakeNote(style, req.body?.note) ?? undefined });
    if (!job) return reply.code(400).send({ ok: false, error: 'There is no design to make again yet: it is made when the photo arrives.' });
    return { ok: true, message: 'Making the design again with the same words. About a minute.', rebuilding: true };
  });

  /** A reel made a post, or a post made a reel. */
  app.post<{ Params: { dayNo: string }; Body: { slot?: string } }>('/api/rows/:dayNo/slot', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const slot = req.body?.slot;
    if (slot !== 'feed' && slot !== 'reel') return reply.code(400).send({ ok: false, error: 'A post or a reel.' });
    try {
      const r = await switchPostKind(ctx.pool, row, slot, 'owner-web');
      const now = slot === 'feed' ? 'a post' : 'a reel';
      return { ok: true, rebuilding: r.rebuilding, message: r.rebuilding ? `Now ${now}. The design is being made again in its new shape.` : `Now ${now}. ${slot === 'feed' ? 'It needs a photo, not clips.' : 'It needs clips, and a photo for the cover.'}` };
    } catch (e) {
      return reply.code(e instanceof PostBusyError ? 409 : 400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** The clips picked for a reel, in order; the reel pack lists them. */
  app.post<{ Params: { dayNo: string }; Body: { clips?: unknown } }>('/api/rows/:dayNo/clips', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const ids = Array.isArray(req.body?.clips) ? req.body.clips.filter((x): x is number => Number.isInteger(x)) : [];
    const clips = await setReelClips(ctx.pool, row, ids, 'owner-web');
    return { ok: true, clips, message: clips ? `${clips.length === 1 ? 'This clip is' : `These ${clips.length} clips are`} the reel's, in this order. The reel pack lists them.` : 'No clip picked.' };
  });

  /** The real preview: the chosen words on the chosen photo, drawn the way the design draws them; nothing is stored. */
  app.post<{ Body: Record<string, unknown> }>('/api/preview', async (req, reply) => {
    try {
      return { ok: true, ...await previewDesign(ctx.pool, parsePreviewInput(req.body)) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** The owner's own wording for this post, added to the list and, with `use`, used straight away. */
  app.post<{ Params: { dayNo: string }; Body: Record<string, unknown> }>('/api/rows/:dayNo/wordings', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    try {
      const w = wordingBody(req.body);
      if (req.body?.use && await rowIsBusy(ctx.pool, row.id)) throw new PostBusyError();
      const { set, index } = await addOwnerOption(ctx.pool, row.id, { headline: w.headline, line: w.line ?? '', caption: w.caption ?? '' });
      if (!req.body?.use) return { ok: true, message: 'Added to this post’s wordings.', rebuilding: false };
      return { ok: true, ...await useWording(row, set, index) };
    } catch (e) {
      return reply.code(e instanceof PostBusyError ? 409 : 400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Changes one of the post's wordings. If it is the one in use the post follows: the pack at once, or new designs when the words on them changed. */
  app.patch<{ Params: { dayNo: string; setId: string; index: string }; Body: Record<string, unknown> }>('/api/rows/:dayNo/wordings/:setId/:index', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const latest = await latestCopyOptions(ctx.pool, row.id);
    const index = Number(req.params.index);
    const old = latest?.options[index];
    if (!latest || !old || latest.id !== Number(req.params.setId)) return reply.code(400).send({ ok: false, error: 'No such wording' });
    try {
      const w = wordingBody(req.body);
      const words = { headline: w.headline, line: w.line ?? '', caption: w.caption ?? '' };
      if (await rowIsBusy(ctx.pool, row.id)) throw new PostBusyError();
      const set = await updateOption(ctx.pool, latest, index, words);
      if (latest.chosen !== index) return { ok: true, message: 'Saved.', rebuilding: false };
      if (words.headline === old.headline && words.line === old.line) {
        await setPostText(ctx.pool, row, 'caption', words.caption, 'owner-web');
        return { ok: true, message: 'Saved. The caption in the pack is updated.', rebuilding: false };
      }
      return { ok: true, ...await useWording(row, set, index) };
    } catch (e) {
      return reply.code(e instanceof PostBusyError ? 409 : 400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Which photos the design uses: one, or two different dishes shown together with their names on them. */
  app.post<{ Params: { dayNo: string }; Body: { photos?: { assetId?: number; name?: string | null }[] } }>('/api/rows/:dayNo/photos', async (req, reply) => {
    const row = await rowByDay(ctx.pool, Number(req.params.dayNo));
    if (!row) return reply.code(404).send({ ok: false, error: 'No such day' });
    const photos = (req.body?.photos ?? []).map((p) => ({ assetId: Number(p.assetId), name: String(p.name ?? '').trim().slice(0, 28) || null }));
    if (photos.length < 1 || photos.length > 2) return reply.code(400).send({ ok: false, error: 'Pick one photo or two.' });
    const ids = new Set((await ctx.pool.query<{ id: number }>("select id from assets where calendar_row_id = $1 and kind in ('photo','document') and prepped is not null", [row.id])).rows.map((a) => a.id));
    if (!photos.every((p) => ids.has(p.assetId)) || new Set(photos.map((p) => p.assetId)).size !== photos.length) return reply.code(400).send({ ok: false, error: 'That photo is not on this post.' });
    if (photos.length === 2) {
      if (templateEntry(row.template).key !== 'hero-photo') return reply.code(400).send({ ok: false, error: 'This kind of post has no two-photo design.' });
      if (!photos.every((p) => p.name)) return reply.code(400).send({ ok: false, error: 'Name both dishes, so customers can tell which is which.' });
      if (photos[0]!.name!.toLowerCase() === photos[1]!.name!.toLowerCase()) return reply.code(400).send({ ok: false, error: 'The two dishes need different names.' });
    }
    if (await rowIsBusy(ctx.pool, row.id)) return reply.code(409).send({ ok: false, error: new PostBusyError().message });
    await ctx.pool.query('update calendar_rows set design_photos = $2, updated_at = now() where id = $1', [row.id, JSON.stringify(photos)]);
    await recordEdit(ctx.pool, row.id, 'design_photos', row.design_photos ? row.design_photos.map((p) => p.name ?? `photo ${p.assetId}`).join(' + ') : null, photos.map((p) => p.name ?? `photo ${p.assetId}`).join(' + '), 'owner-web');
    if (await rowIsWaiting(ctx.pool, row.id)) return { ok: true, message: 'Saved. The design uses these photos once your questions are answered.', rebuilding: false };
    const job = await rerenderRow(ctx.pool, row.id, { assetId: photos[0]!.assetId });
    return job ? { ok: true, message: 'Making the designs with your photos.', rebuilding: true } : { ok: true, message: 'Saved. The design uses these photos when it is made.', rebuilding: false };
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
    const files: { bytes: Buffer; mime: string; filename: string; field: string }[] = [];
    // A clip's still comes as `still-<n>`: n is the clip's place among the `file` parts.
    const stills = new Map<number, Buffer>();
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        const still = part.fieldname.match(/^still-(\d+)$/);
        if (still && bytes.length && part.mimetype.startsWith('image/')) stills.set(Number(still[1]), bytes);
        // A clip comes without its bytes (they are never kept): its name and type are enough.
        else if (bytes.length || part.mimetype.startsWith('video/')) files.push({ bytes, mime: part.mimetype, filename: part.filename, field: part.fieldname });
      } else if (part.fieldname === 'caption') caption = String(part.value ?? '').trim();
    }
    if (!files.length) return reply.code(400).send({ ok: false, error: 'No file' });
    const base = caption || (row.dish && !row.dish.startsWith('[') ? row.dish.split(',')[0]!.toLowerCase() : (row.theme ?? 'photo').toLowerCase());
    const withDay = /#day\d+/i.test(base) ? base : `${base} #day${row.day_no}`;
    const ids: number[] = [];
    for (const [i, f] of files.entries()) {
      const isVideo = f.mime.startsWith('video/');
      const { asset } = await receiveAsset(ctx.pool, { kind: isVideo ? 'video' : 'document', bytes: isVideo ? undefined : f.bytes, mime: f.mime, filename: f.filename, caption: withDay });
      const still = isVideo ? stills.get(i) : undefined;
      if (still) await ctx.pool.query('update assets set still_file_id = $2 where id = $1', [asset.id, await putFile(ctx.pool, still, 'image/jpeg')]);
      ids.push(asset.id);
    }
    return { ok: true, assetIds: ids, caption: withDay };
  });

  app.get('/api/status', async () => ({ text: await statusText(ctx) }));

  // ─── the Create flow: a custom design ──────────────────────────────────────────────────────────────────

  /** The roster, the menu and every item in the wording bank, as one list: name, category, status, wordings and the series to start from. */
  async function products(): Promise<{ name: string; category: string | null; series: string | null; status: string; wordings: number; template: string }[]> {
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
    const out = new Map<string, { name: string; category: string | null; series: string | null; status: string; wordings: number; template: string }>();
    // The roster first: it knows the status and the series; a retired product is not offered.
    for (const p of await listProducts(ctx.pool)) {
      if (p.status === 'retired') continue;
      out.set(p.name_key, { name: p.name, category: p.category, series: p.series, status: p.status, wordings: counts.get(p.name_key) ?? 0, template: p.template ?? suggestedTemplate(p.name, p.category) });
    }
    for (const m of menu) {
      const k = itemKey(m.name);
      const have = out.get(k);
      if (have) {
        have.category = have.category ?? m.category;
        continue;
      }
      out.set(k, { name: m.name, category: m.category, series: null, status: 'active', wordings: counts.get(k) ?? 0, template: suggestedTemplate(m.name, m.category) });
    }
    for (const [k, name] of names) if (!out.has(k)) out.set(k, { name, category: null, series: null, status: 'active', wordings: counts.get(k) ?? 0, template: suggestedTemplate(name) });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  app.get('/api/create/options', async () => {
    const settings = await allSettings(ctx.pool);
    return {
      today: sydneyDate(ctx.now()),
      postTimeDefault: settings.post_time_default ?? '18:00',
      footers: { brand: loadBrand().brandLine, address: settings.store_address ?? '' },
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
   * Loads a month's workbook (the monthly template filled in: sheet Calendar, 18 columns, and an optional Slogans
   * sheet) exactly as `npm run seed-calendar -- --file` does, but from the browser: dates as written, the month
   * of the first date names the plan, a day that has started is left alone, owner-edited fields stay protected,
   * and the Slogans sheet joins the wording bank. Nothing is written when any row is wrong.
   */
  app.post('/api/calendar/import', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ ok: false, error: 'multipart/form-data expected' });
    let file: { bytes: Buffer; filename: string } | null = null;
    let start: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();
        if (bytes.length && !file) file = { bytes, filename: part.filename };
      } else if (part.fieldname === 'start') {
        const s = String(part.value ?? '').trim();
        if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return reply.code(400).send({ ok: false, error: 'The first day must be a date (YYYY-MM-DD).' });
        start = s || null;
      }
    }
    if (!file) return reply.code(400).send({ ok: false, error: 'No workbook was sent.' });
    const { loadWorkbook } = await import('../../calendar/seed.js');
    try {
      const { sheetRows: _rows, readMe: _readMe, ...result } = await loadWorkbook(ctx.pool, file.bytes, { keepStarted: true, start, sourceName: file.filename });
      ctx.log.info('Workbook loaded from the web app.', { file: file.filename, plan: result.plan, inserted: result.inserted, updated: result.updated, campaigns: result.campaigns, products: result.products, benefits: result.benefits, slogans: result.slogans.loaded });
      return { ok: true, ...result };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** The planning documents that are not posts: the strategic direction, the roadmap and the libraries. */
  app.get('/api/planning', async () => ({ sheets: await listReference(ctx.pool), products: (await listProducts(ctx.pool)).filter((p) => p.status !== 'retired'), benefits: await listBenefits(ctx.pool) }));

  /** Every campaign with how far its posts have got; several may run at once. */
  app.get('/api/campaigns', async () => ({ campaigns: await campaignProgress(ctx.pool) }));

  // ─── the wording bank (slogans): one product, many wordings ───────────────────────────────────────────

  const wordingJson = (s: Slogan) => ({ id: s.id, item: s.item, itemKey: s.item_key, headline: s.headline, line: s.line, caption: s.caption, source: s.source });

  // Every wording the app holds, each with what uses it: the bank, every post in the plan and the libraries.
  app.get('/api/wordings', async () => ({ ...await wordingsView(ctx.pool), products: (await products()).map((p) => p.name) }));

  /** One row of a wording library, changed by the owner. */
  app.patch<{ Params: { sheet: string; index: string }; Body: { was?: unknown; cells?: unknown } }>('/api/wordings/library/:sheet/:index', async (req, reply) => {
    const { sheet } = req.params;
    if (!WORDING_LIBRARIES.includes(sheet)) return reply.code(404).send({ ok: false, error: 'No such library' });
    const asRow = (v: unknown) => (Array.isArray(v) ? v.map((c) => String(c ?? '').trim()) : null);
    const was = asRow(req.body?.was);
    const cells = asRow(req.body?.cells);
    if (!was || !cells || was.length !== cells.length || !cells.some(Boolean)) return reply.code(400).send({ ok: false, error: 'A row needs its text.' });
    const header = (await listReference(ctx.pool)).find((s) => s.name === sheet)?.header ?? [];
    const tidy = cells.map((c, i) => (/hashtags/i.test(header[i] ?? '') ? cleanHashtags(c) : c));
    if (!await editReferenceRow(ctx.pool, sheet, Number(req.params.index), was, tidy)) return reply.code(409).send({ ok: false, error: 'This row has changed since the page loaded. Reload and try again.' });
    return { ok: true };
  });

  /** A post's headline is its title, 60 characters at most; a reusable one goes on the post's line, so `max` lets it run longer. */
  function wordingBody(body: Record<string, unknown> | undefined, max = 60): { headline: string; line: string | null; caption: string | null } {
    const headline = String(body?.headline ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n').slice(0, max);
    if (!headline) throw new Error('A wording needs a headline.');
    return { headline, line: String(body?.line ?? '').trim().slice(0, 140) || null, caption: String(body?.caption ?? '').trim().slice(0, 2200) || null };
  }

  app.post<{ Body: Record<string, unknown> }>('/api/wordings', async (req, reply) => {
    const item = String(req.body?.item ?? '').trim().slice(0, 60);
    if (!item) return reply.code(400).send({ ok: false, error: 'Which product is this wording for?' });
    try {
      const s = await addSlogan(ctx.pool, { item, ...wordingBody(req.body, 140), source: 'owner-web' });
      return { ok: true, wording: wordingJson(s), posts: await spreadSloganLink(ctx.pool, s.id, item, true) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/wordings/:id', async (req, reply) => {
    try {
      const before = await sloganById(ctx.pool, Number(req.params.id));
      const s = before && await updateSlogan(ctx.pool, before.id, wordingBody(req.body, 140));
      if (!before || !s) return reply.code(404).send({ ok: false, error: 'No such wording' });
      return { ok: true, wording: wordingJson(s), ...await spreadSloganEdit(ctx.pool, before, s) };
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Links a wording to another item. */
  app.post<{ Params: { id: string }; Body: { item?: string } }>('/api/wordings/:id/items', async (req, reply) => {
    const item = String(req.body?.item ?? '').trim().slice(0, 60);
    if (!item) return reply.code(400).send({ ok: false, error: 'Which item should it go on?' });
    if (!await linkSlogan(ctx.pool, Number(req.params.id), item)) return reply.code(404).send({ ok: false, error: 'No such wording' });
    return { ok: true, posts: await spreadSloganLink(ctx.pool, Number(req.params.id), item, true) };
  });

  /** Takes a wording off one item; the wording itself stays. */
  app.delete<{ Params: { id: string; itemKey: string } }>('/api/wordings/:id/items/:itemKey', async (req, reply) => {
    if (!await unlinkSlogan(ctx.pool, Number(req.params.id), req.params.itemKey)) return reply.code(404).send({ ok: false, error: 'It is not on that item.' });
    return { ok: true, posts: await spreadSloganLink(ctx.pool, Number(req.params.id), req.params.itemKey, false) };
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
    const p = (await ctx.pool.query<{ caption_txt: string; canva_brief: string; reel_pack_txt: string | null; platforms: PlatformVersions | null }>('select caption_txt, canva_brief, reel_pack_txt, platforms from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
    if (!p) return reply.code(404).send();
    const text = { 'caption.txt': p.caption_txt, 'canva-brief.txt': p.canva_brief, 'reel-pack.txt': p.reel_pack_txt, 'platforms.txt': p.platforms ? platformsTxt(p.platforms) : null }[req.params.name];
    if (!text) return reply.code(404).send();
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="day${row.day_no}-${req.params.name}"`);
    return reply.send(text);
  });
}

export type { CalendarRow };
