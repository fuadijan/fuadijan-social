/**
 * Database tests. They run only with TEST_DATABASE_URL set to a database whose name ends in "_test" (it is wiped
 * first). Locally: TEST_DATABASE_URL=postgres://postgres@localhost:5433/fuadijan_social_test npx vitest run
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/config.js';
import { createDatabaseIfMissing, createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { readWorkbook, seedRows, WORKBOOK_PATH } from '../calendar/seed.js';
import { allRows, editField, markPosted, pushRow, rowByDay, skipRow } from '../src/calendar/rows.js';
import { FixtureClaude } from '../src/brain/client.js';
import type { AppContext } from '../src/context.js';
import { FileMenuSource } from '../src/menu/index.js';
import { CachedMenu } from '../src/menu/source.js';
import { applyAnswer, handleCommand, handleFreeText } from '../src/messaging/commands.js';
import { ConsoleMessenger } from '../src/messaging/messenger.js';
import { openQuestions } from '../src/pipeline/questions.js';
import { receiveAsset, Worker } from '../src/pipeline/worker.js';
import { eveningNudge, morningBrief, postTimeCheck } from '../src/reminders/index.js';
import { existsSync } from 'node:fs';

const url = process.env.TEST_DATABASE_URL;
const safe = url ? new URL(url).pathname.endsWith('_test') : false;
const haveWorkbook = existsSync(WORKBOOK_PATH);

describe.skipIf(!safe || !haveWorkbook)('database', () => {
  const pool = createPool(url!);
  const messenger = new ConsoleMessenger(false);
  const ctx: AppContext = {
    pool,
    claude: new FixtureClaude(pool),
    menu: new CachedMenu(new FileMenuSource(join(process.cwd(), 'test', 'fixtures', 'menu-screens.json'))),
    messenger,
    log: { info() {}, warn() {}, error() {} },
    now: () => new Date('2026-11-03T21:00:00Z'), // Wed 4 Nov 08:00 Sydney
  };

  beforeAll(async () => {
    await createDatabaseIfMissing(url!);
    await pool.query('drop schema public cascade; create schema public;');
  });
  afterAll(() => pool.end());

  it('migrates once, then reports up to date', async () => {
    expect(await migrate(pool, () => {})).toEqual(['0001_init.sql', '0002_asset_match.sql', '0003_copy_options.sql', '0004_slogans.sql', '0005_plans.sql', '0006_custom.sql']);
    expect(await migrate(pool, () => {})).toEqual([]);
  });

  it('seeds the 30 rows from the workbook with the clean-ups applied', async () => {
    const wb = await readWorkbook();
    expect(wb.rows).toHaveLength(30);
    const res = await seedRows(pool, wb.rows);
    expect(res).toMatchObject({ plan: '2026-11', inserted: 30, updated: 0 });
    const rows = await allRows(pool);
    expect(rows[0]).toMatchObject({ day_no: 1, date: '2026-11-03', slot: 'reel', template: 'brand-intro', status: 'planned' });
    expect(rows[29]!.date).toBe('2026-12-02');
    expect(rows.filter((r) => r.slot === 'reel')).toHaveLength(23);
    expect(rows[1]!.caption).not.toContain('📍');
    expect(rows[1]!.confirmation_notes).toBeNull(); // prefix of creative_instructions
    expect(rows[6]!.story_ideas).not.toContain('# Days');
  });

  it('re-seeds without touching a field the owner edited', async () => {
    const row = (await rowByDay(pool, 2))!;
    await editField(pool, row, 'caption', 'My own caption', 'owner-telegram');
    const wb = await readWorkbook();
    const res = await seedRows(pool, wb.rows);
    expect(res.updated).toBe(0);
    expect(res.protectedFields).toEqual([{ day_no: 2, field: 'caption' }]);
    expect((await rowByDay(pool, 2))!.caption).toBe('My own caption');
  });

  it('pushes, skips and marks posted with an edits history', async () => {
    const d5 = (await rowByDay(pool, 5))!;
    expect(await pushRow(pool, d5, 1, 'owner-telegram')).toBe('2026-11-08');
    expect(await pushRow(pool, (await rowByDay(pool, 5))!, -1, 'owner-telegram')).toBe('2026-11-07');

    const d29 = (await rowByDay(pool, 29))!;
    expect(await skipRow(pool, d29, 'just-this', 'owner-web')).toBe('2026-12-03');
    const d28 = (await rowByDay(pool, 28))!;
    expect(await skipRow(pool, d28, 'push-all', 'owner-web')).toBe('2026-12-01');
    expect((await rowByDay(pool, 30))!.date).toBe('2026-12-03');
    expect((await rowByDay(pool, 29))!.date).toBe('2026-12-04');

    await markPosted(pool, (await rowByDay(pool, 1))!, 'owner-telegram', new Date('2026-11-03T08:00:00Z'));
    const posted = (await rowByDay(pool, 1))!;
    expect(posted.status).toBe('posted');
    expect(posted.posted_at).not.toBeNull();
    const edits = (await pool.query("select field, source from calendar_edits where row_id = $1 and source <> 'seed' order by id", [posted.id])).rows;
    expect(edits).toEqual([{ field: 'status', source: 'owner-telegram' }]);
  });

  it('runs a photo through the pipeline with fixtures: question → answer → pack → notify', async () => {
    const bytes = readFileSync('brand/reference/real-03.jpg');
    await receiveAsset(pool, { kind: 'document', bytes, mime: 'image/jpeg', filename: 'chapli.jpg', caption: 'chapli kebab #day2' });
    const worker = new Worker(ctx, 1000);
    await worker.drain();
    const open = await openQuestions(pool);
    expect(open).toHaveLength(1);
    expect(open[0]!.question).toMatch(/Boldly spiced/);
    const job = (await pool.query('select stage, status from jobs order by id desc limit 1')).rows[0];
    expect(job).toEqual({ stage: 'resolve', status: 'waiting' });
    expect((await rowByDay(pool, 2))!.status).toBe('photo-needed');

    await applyAnswer(ctx, open[0]!.id, 's0', 'dry-run');
    await worker.drain();
    // The copy is resolved; before the design the owner picks the wording (calendar wording + two alternatives).
    const wording = (await openQuestions(pool)).find((q) => q.field === 'wording')!;
    expect(wording).toBeTruthy();
    expect(wording.options.map((o) => o.label)).toEqual(['1 · Calendar wording', '2 · Short and punchy', '3 · Warm and story-led']);
    expect(messenger.sent.some((m) => m.text?.startsWith('✍️'))).toBe(true);
    expect((await pool.query('select stage, status from jobs order by id desc limit 1')).rows[0]).toEqual({ stage: 'render', status: 'waiting' });
    await applyAnswer(ctx, wording.id, 'v1', 'dry-run');
    await worker.drain();
    expect((await pool.query('select stage, status from jobs order by id desc limit 1')).rows[0]).toEqual({ stage: 'done', status: 'done' });
    expect((await rowByDay(pool, 2))!.status).toBe('ready');
    const pack = (await pool.query<{ caption_txt: string; folder: string; hashtags: string[]; caption: string; sources: { design: { layout: string; score: number } | null; wording: number } }>('select caption_txt, folder, hashtags, caption, sources from packs')).rows[0]!;
    expect(pack.folder).toBe('2026-11-04 chapli-kebab');
    expect(pack.caption).toBe('Hand-formed, grilled over charcoal. Chapli Kebab at Fuadijan.');
    expect(pack.sources.wording).toBe(1);
    expect(pack.sources.design).toMatchObject({ layout: 'B', score: 8.5 });
    expect((await pool.query('select chosen from copy_options')).rows[0]).toEqual({ chosen: 1 });
    expect(messenger.sent.some((m) => m.text?.startsWith('🎨 Layout B'))).toBe(true);
    expect(pack.hashtags).toHaveLength(5);
    expect(pack.caption_txt).toContain('=== POST AT ===');
    const files = messenger.sent.filter((m) => m.file).map((m) => m.file);
    // The render stage made the designs, so the owner gets those as files rather than the plain crops.
    expect(files).toEqual(['day2-feed.png', 'day2-story.png']);
    const renders = (await pool.query<{ format: string }>('select format from renders where calendar_row_id = $1 order by format', [(await rowByDay(pool, 2))!.id])).rows.map((r) => r.format);
    expect(renders).toEqual(['feed', 'story']);
    const assets = (await pool.query<{ quality: { verdict: string }; prepped: Record<string, string> }>('select quality, prepped from assets')).rows[0]!;
    expect(assets.quality.verdict).toBe('ok');
    // The cutout keys appear only when the mask was usable; this photo's plate covers under 25% of the frame.
    expect(Object.keys(assets.prepped).filter((k) => k !== 'cutout' && k !== 'shadow').sort()).toEqual(['1x1', '4x5', '9x16', 'thumb']);
    expect(Number(((await pool.query('select count(*) n from claude_calls')).rows[0] as { n: string }).n)).toBeGreaterThanOrEqual(1);
  });

  it('asks which day when the caption has no #day and Claude is unsure', async () => {
    messenger.sent.length = 0;
    await receiveAsset(pool, { kind: 'document', bytes: readFileSync('brand/reference/real-01.jpg'), mime: 'image/jpeg', filename: 'karahi.jpg', caption: 'chicken karahi' });
    const worker = new Worker(ctx, 1000);
    await worker.drain();
    const open = await openQuestions(pool);
    expect(open).toHaveLength(1);
    expect(open[0]!.field).toBe('match');
    expect(open[0]!.options.map((o) => o.value)).toContain('unscheduled');
    expect(messenger.sent.some((m) => m.text?.startsWith('Tip:'))).toBe(true);
    const day4 = (await rowByDay(pool, 4))!;
    expect(open[0]!.options.some((o) => o.value === String(day4.id))).toBe(true);
    await applyAnswer(ctx, open[0]!.id, `r${day4.id}`, 'dry-run');
    await worker.drain();
    // The wording question comes before the design; the calendar wording is option 1.
    const wording = (await openQuestions(pool)).find((q) => q.field === 'wording' && q.row_id === day4.id)!;
    expect(wording).toBeTruthy();
    await applyAnswer(ctx, wording.id, 'v0', 'dry-run');
    await worker.drain();
    // Day 4 is a reel: the pack carries the reel text and the default fixture copy.
    const pack = (await pool.query<{ reel_pack_txt: string | null }>('select reel_pack_txt from packs where calendar_row_id = $1', [day4.id])).rows[0]!;
    expect(pack.reel_pack_txt).toContain('Hook (first second):');
    expect((await rowByDay(pool, 4))!.status).toBe('ready');
  });

  it('sends the brief, post-time and nudge once each', async () => {
    messenger.sent.length = 0;
    await morningBrief(ctx);
    await morningBrief(ctx);
    expect(messenger.sent.filter((m) => m.text?.startsWith('☀️'))).toHaveLength(1);
    const brief = messenger.sent[0]!.text!;
    expect(brief).toContain('Wed 4 Nov — Feed · Chapli Kebab');
    expect(brief).toContain('Nothing — ready to post.');

    const atSix: AppContext = { ...ctx, now: () => new Date('2026-11-04T07:00:00Z') }; // 18:00 Sydney
    await postTimeCheck(atSix);
    await postTimeCheck(atSix);
    expect(messenger.sent.filter((m) => m.text?.startsWith('⏰'))).toHaveLength(1);
    await eveningNudge(atSix);
    expect(messenger.sent.filter((m) => m.text?.startsWith('🌙'))).toHaveLength(1);
  });

  it('loads the slogan bank from a sheet and offers the item\'s slogans as wordings', async () => {
    const { readSlogans, seedSlogans } = await import('../calendar/slogans.js');
    const { slogansFor, listSlogans } = await import('../src/slogans.js');
    const { optionsFrom } = await import('../src/pipeline/wording.js');
    const rows = await readSlogans(['test/fixtures/slogans.xlsx', 'calendar/does-not-exist.xlsx']);
    expect(rows.map((r) => r.item)).toEqual(['Chapli Kebab', 'Chapli Kebab', 'Chicken Karahi', 'all']);
    expect(await seedSlogans(pool, rows)).toEqual({ loaded: 4, items: 3 });
    expect(await seedSlogans(pool, rows)).toEqual({ loaded: 4, items: 3 }); // idempotent
    expect(await listSlogans(pool)).toHaveLength(4);
    const forChapli = await slogansFor(pool, ['Chapli Kebab', null]);
    expect(forChapli.map((s) => s.headline)).toEqual(['Hand-formed.\nFire-finished.', 'The kebab\nAuburn talks about', 'Smoked. Grilled.\nRooted in Tradition.']);
    expect((await slogansFor(pool, ['Lamb Karahi'])).map((s) => s.item)).toEqual(['all']);
    const copy = { label: 'L', headline: 'Chapli\nKebab', line: 'l', caption: 'c', cta: 'x', hashtags: ['#a', '#b', '#c'], alt_text: 'a', story_text: 's', facebook_caption: 'c x', on_screen_text: [], unresolved: [], variants: [] };
    const options = optionsFrom(copy, forChapli);
    expect(options.map((o) => o.name)).toEqual(['Calendar wording', 'Slogan · Chapli Kebab', 'Slogan · Chapli Kebab', 'Slogan · house']);
    expect(options[1]).toMatchObject({ headline: 'Hand-formed.\nFire-finished.', line: 'Grilled over charcoal every evening.', caption: 'c' });
    await handleCommand(ctx, '/slogan chapli kebab -- Big flavour. / Small plate. | Comes with roti, raita and salad.');
    expect((await listSlogans(pool, 'chapli kebab')).at(-1)).toMatchObject({ headline: 'Big flavour.\nSmall plate.', line: 'Comes with roti, raita and salad.', source: 'owner' });
    await handleCommand(ctx, '/slogan chapli kebab -- remove 3');
    expect(await listSlogans(pool, 'chapli kebab')).toHaveLength(2);
  });

  it('loads next month beside the current one; Day N stays this month until the new plan starts', async () => {
    const { allRows: rowsOf, currentPlan, plans, rowsBetween: between } = await import('../src/calendar/rows.js');
    const wb = await readWorkbook();
    const december = wb.rows.map((r) => ({ ...r, date: r.date.replace(/^2026-11-/, '2026-12-').replace(/^2026-12-0([12])$/, '2027-01-0$1'), status: 'planned' as const }));
    const res = await seedRows(pool, december);
    expect(res).toMatchObject({ plan: '2026-12', inserted: 30, updated: 0 });
    expect((await plans(pool)).map((p) => p.plan)).toEqual(['2026-11', '2026-12']);
    expect(await currentPlan(pool, '2026-11-20')).toBe('2026-11');
    expect(await currentPlan(pool, '2026-12-03')).toBe('2026-12');
    expect(await currentPlan(pool, '2026-10-01')).toBe('2026-11');
    expect((await rowsOf(pool, '2026-11')).map((r) => r.plan)).toEqual(Array(30).fill('2026-11'));
    expect((await rowByDay(pool, 2, '2026-12'))!.date).toBe('2026-12-04');
    expect((await between(pool, '2026-12-01', '2026-12-05')).map((r) => `${r.plan}:${r.day_no}`)).toContain('2026-12:1');
    // Re-loading December changes nothing.
    expect(await seedRows(pool, december)).toMatchObject({ plan: '2026-12', inserted: 0, updated: 0 });
  });

  it("makes a custom post from the Create flow: an adopted photo, the owner's wording, a locked style, feed only", async () => {
    const { adoptAsset, createCustomPost, recentPhotos } = await import('../src/pipeline/custom.js');
    messenger.sent.length = 0;
    const photos = await recentPhotos(pool);
    const chapli = photos.find((p) => p.dayNo === 2)!;
    expect(chapli).toBeTruthy();
    const row = await createCustomPost(pool, {
      product: 'Chapli Kebab', template: 'from-the-fire', style: 'split', formats: ['feed'],
      wording: { headline: 'Chapli\nFirst', line: 'Problems later.', caption: '' }, sloganId: null, date: '2026-11-10', postTime: '19:00',
    }, '2026-11-04');
    expect(row).toMatchObject({ plan: '2026-11', day_no: 101, date: '2026-11-10', slot: 'feed', type: 'custom', dish: 'Chapli Kebab', template: 'from-the-fire', post_time: '19:00', status: 'planned' });
    expect(row.custom).toMatchObject({ style: 'split', formats: ['feed'], wording: { headline: 'Chapli\nFirst' } });
    expect(await rowByDay(pool, 101)).toMatchObject({ id: row.id });
    const job = await adoptAsset(pool, row, chapli.assetId);
    expect(job).toMatchObject({ calendar_row_id: row.id, stage: 'resolve', status: 'queued' });
    const worker = new Worker(ctx, 1000);
    await worker.drain();
    // No wording question: the owner's words are used as given; the design is split, and only the feed is kept.
    expect((await openQuestions(pool, row.id))).toHaveLength(0);
    expect((await pool.query('select stage, status, state from jobs where id = $1', [job.id])).rows[0]).toMatchObject({ stage: 'done', status: 'done', state: expect.objectContaining({ copy: expect.objectContaining({ headline: 'Chapli\nFirst', line: 'Problems later.' }), wordingChosen: 0 }) });
    expect((await pool.query('select format from renders where calendar_row_id = $1', [row.id])).rows).toEqual([{ format: 'feed' }]);
    expect((await rowByDay(pool, 101))!.status).toBe('ready');
    const pack = (await pool.query<{ sources: { design: { style: string; source: string } | null } }>('select sources from packs where calendar_row_id = $1', [row.id])).rows[0]!;
    expect(pack.sources.design).toMatchObject({ style: 'split', source: 'owner' });
    expect(messenger.sent.some((m) => m.text?.startsWith('🎨 Split style'))).toBe(true);
    // The adopted photo is listed once, under its new day too.
    expect((await recentPhotos(pool)).filter((p) => p.thumb === chapli.thumb)).toHaveLength(1);
  });

  it('understands "posted 2" and "skip 3"', async () => {
    messenger.sent.length = 0;
    await handleFreeText(ctx, 'posted 2');
    expect((await rowByDay(pool, 2))!.status).toBe('posted');
    expect(messenger.sent.at(-1)!.text).toMatch(/^✅ Day 2/);
    await handleFreeText(ctx, 'skip 3');
    const q = (await openQuestions(pool)).find((x) => x.field === 'skip')!;
    expect(q).toBeTruthy();
    await applyAnswer(ctx, q.id, 'one', 'telegram');
    expect((await rowByDay(pool, 3))!.date).not.toBe('2026-11-05');
  });
});
