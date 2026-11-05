/**
 * Database tests. They run only with TEST_DATABASE_URL set to a database whose name ends in "_test" (it is wiped
 * first). Locally: TEST_DATABASE_URL=postgres://postgres@localhost:5433/fuadijan_social_test npx vitest run
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
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
    expect(await migrate(pool, () => {})).toEqual(['0001_init.sql', '0002_asset_match.sql', '0003_copy_options.sql', '0004_slogans.sql', '0005_plans.sql', '0006_custom.sql', '0007_campaigns_products.sql', '0008_benefits_objective.sql', '0009_post_record.sql', '0010_knowledge_base.sql', '0011_retire_old_plan.sql', '0012_design_photos.sql']);
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
    const copy = { label: 'L', headline: 'Chapli\nKebab', line: 'l', caption: 'c', cta: 'x', hashtags: ['#a', '#b', '#c'], alt_text: 'a', story_text: 's', facebook_caption: 'c x', versions: null, on_screen_text: [], unresolved: [], variants: [] };
    const options = optionsFrom(copy, forChapli);
    expect(options.map((o) => o.name)).toEqual(['Calendar wording', 'Slogan · Chapli Kebab', 'Slogan · Chapli Kebab', 'Slogan · house']);
    // The product stays the title; the bank wording and its line become the line.
    expect(options[1]).toMatchObject({ headline: 'Chapli\nKebab', line: 'Hand-formed. Fire-finished. Grilled over charcoal every evening.', caption: 'c' });
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

  it('loads campaigns and the roster with a month, links each post to its campaign, and reports progress', async () => {
    const { loadWorkbook } = await import('../calendar/seed.js');
    const { writeWorkbook } = await import('../calendar/xlsx-write.js');
    const { CALENDAR_COLUMNS } = await import('../calendar/calendar.schema.js');
    const { campaignProgress, findCampaign } = await import('../src/campaigns.js');
    const { findProduct } = await import('../src/products.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = join(mkdtempSync(join(tmpdir(), 'fj-load-')), 'january.xlsx');
    const row = (date: string, dish: string, campaign: string | null) => [date, 'feed', 'launch', dish, null, null, '18:30', 'from-the-fire', 'planned', ...Array<null>(9).fill(null), campaign];
    const sheets = (rows: unknown[][]) => [
      { name: 'Calendar', rows: [[...CALENDAR_COLUMNS, 'campaign'], ...rows] as (string | null)[][] },
      { name: 'Campaigns', rows: [['CampaignID', 'Campaign Name', 'Category', 'Series', 'Start Date', 'End Date', 'Status', 'Priority'], ['CAMP001', 'Charcoal Seafood Launch', 'Product launch', 'FROM THE CHARCOAL SEA', '2027-01-04', '2027-01-25', 'active', 'high'], ['CAMP002', 'Juice Bar Launch', null, 'FRESH POUR', null, null, 'planned', null]] },
      { name: 'Products', rows: [['ProductID', 'Product Name', 'Category', 'Status', 'Series'], ['P001', 'BBQ Barramundi', 'Seafood', 'coming soon', 'FROM THE CHARCOAL SEA'], ['P002', 'BBQ Prawns', 'Seafood', 'planned', null]] },
    ];
    // A row naming a campaign the workbook does not have: nothing of the month is written.
    await writeWorkbook(path, sheets([row('2027-01-04', 'P001', 'CAMP001'), row('2027-01-05', 'Chapli Kebab', 'Summer Push')]));
    await expect(loadWorkbook(pool, path, { keepStarted: true })).rejects.toThrow(/Day 2: campaign "Summer Push"/);
    expect((await pool.query("select count(*)::int n from calendar_rows where plan = '2027-01'")).rows[0]!.n).toBe(0);

    await writeWorkbook(path, sheets([row('2027-01-04', 'P001', 'CAMP001'), row('2027-01-05', 'Chapli Kebab', 'charcoal seafood launch'), row('2027-01-06', 'Mango Lassi', null)]));
    const res = await loadWorkbook(pool, path, { keepStarted: true });
    expect(res).toMatchObject({ plan: '2027-01', inserted: 3, updated: 0, rows: 3, campaigns: 2, products: 2 });
    const seafood = (await findCampaign(pool, 'CAMP001'))!;
    expect(seafood).toMatchObject({ name: 'Charcoal Seafood Launch', template: 'from-the-charcoal-sea', start_date: '2027-01-04', status: 'active', priority: 'high' });
    // The ProductID became the product's name; both rows point at the campaign, by id and by name.
    const d1 = (await rowByDay(pool, 1, '2027-01'))!;
    const d2 = (await rowByDay(pool, 2, '2027-01'))!;
    const d3 = (await rowByDay(pool, 3, '2027-01'))!;
    expect([d1.dish, d1.campaign_id, d2.campaign_id, d3.campaign_id]).toEqual(['BBQ Barramundi', seafood.id, seafood.id, null]);
    expect((await findProduct(pool, 'prawns'))).toMatchObject({ key: 'p002', name: 'BBQ Prawns', status: 'planned' });
    // Progress follows the rows' status; several campaigns are listed side by side.
    await markPosted(pool, d1, 'owner-telegram');
    const progress = await campaignProgress(pool);
    expect(progress.map((c) => `${c.key} ${c.posts}/${c.made}/${c.posted} next ${c.next}`)).toEqual(['camp001 2/1/1 next 2027-01-05', 'camp002 0/0/0 next null']);
    // Loading again updates in place: a campaign's status moves on, the rows stay.
    await writeWorkbook(path, sheets([row('2027-01-04', 'P001', 'CAMP001'), row('2027-01-05', 'Chapli Kebab', 'CAMP001'), row('2027-01-06', 'Mango Lassi', 'CAMP002')]).map((s) => (s.name === 'Campaigns' ? { ...s, rows: s.rows.map((r) => (r[0] === 'CAMP001' ? [...r.slice(0, 6), 'done', 'high'] : r)) } : s)));
    const again = await loadWorkbook(pool, path, { keepStarted: true });
    expect(again).toMatchObject({ inserted: 0, updated: 1, kept: [1] });
    expect((await findCampaign(pool, 'CAMP001'))!.status).toBe('done');
    expect((await rowByDay(pool, 3, '2027-01'))!.campaign_id).toBe((await findCampaign(pool, 'Juice Bar Launch'))!.id);
  });

  it('loads the planning documents as they come: campaigns alone, benefits alone, then a Day-numbered calendar with a first day', async () => {
    const { loadWorkbook } = await import('../calendar/seed.js');
    const { writeWorkbook } = await import('../calendar/xlsx-write.js');
    const { findCampaign } = await import('../src/campaigns.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'fj-docs-'));
    // Document 2: campaigns with an objective, no dates yet.
    const camp = join(dir, 'campaigns.xlsx');
    await writeWorkbook(camp, [{ name: 'Campaigns', rows: [['CampaignID', 'CampaignName', 'Objective'], ['CAMP101', 'Better Food Initiative', 'Food quality perception'], ['CAMP102', 'Better Experience Initiative', 'Customer experience']] }]);
    expect(await loadWorkbook(pool, camp, { keepStarted: true })).toMatchObject({ plan: null, rows: 0, inserted: 0, campaigns: 2, products: 0, benefits: 0 });
    expect((await findCampaign(pool, 'CAMP102'))!.objective).toBe('Customer experience');
    // Document 3: benefits (and a product) in their own workbook.
    const ben = join(dir, 'benefits.xlsx');
    await writeWorkbook(ben, [
      { name: 'Products', rows: [['ProductID', 'ProductName', 'Category', 'Status', 'Series'], ['P101', 'Mixed BBQ Plate', 'BBQ', 'Active', 'FROM THE FIRE']] },
      { name: 'Customer Benefits', rows: [['BenefitID', 'Benefit'], ['BEN001', 'Plenty of Parking Available'], ['BEN002', 'Fully Air Conditioned Dining']] },
    ]);
    expect(await loadWorkbook(pool, ben, { keepStarted: true })).toMatchObject({ plan: null, campaigns: 0, products: 1, benefits: 2 });
    // Document 4: the operational calendar by Day number, loaded with the date of Day 1.
    const cal = join(dir, 'calendar.xlsx');
    const head = ['Day', 'CampaignID', 'ProductID', 'BenefitID', 'Series', 'Format', 'Hook', 'Caption', 'CTA', 'Hashtags', 'Status'];
    await writeWorkbook(cal, [{ name: 'Calendar', rows: [head, [1, 'CAMP101', 'P101', null, 'FROM THE FIRE', 'Reel', 'Still hungry?', null, null, null, null], [2, 'CAMP102', null, 'BEN001', 'FOR OUR CUSTOMERS', 'Carousel', 'Easy parking makes a difference', null, null, null, null]] }]);
    await expect(loadWorkbook(pool, cal, { keepStarted: true })).rejects.toThrow(/no Date column/);
    const res = await loadWorkbook(pool, cal, { keepStarted: true, start: '2027-03-01' });
    expect(res).toMatchObject({ plan: '2027-03', inserted: 2, from: '2027-03-01', to: '2027-03-02' });
    const d1 = (await rowByDay(pool, 1, '2027-03'))!;
    const d2 = (await rowByDay(pool, 2, '2027-03'))!;
    expect([d1.dish, d1.theme, d1.template, d1.slot, d1.campaign_id]).toEqual(['Mixed BBQ Plate', 'Still hungry?', 'from-the-fire', 'reel', (await findCampaign(pool, 'CAMP101'))!.id]);
    expect([d2.dish, d2.benefit, d2.template, d2.slot, d2.type]).toEqual([null, 'Plenty of Parking Available', 'for-our-customers', 'carousel', 'benefit']);
    // Post records dated by weekday: each is found by its date, so a partial sheet never lands on the wrong day.
    const rec = join(dir, 'record.xlsx');
    const recHead = ['Date', 'Day', 'ProductID', 'Series', 'Format', 'Canva Headline', 'Hook', 'Priority'];
    const april = (rows: string[][]) => writeWorkbook(rec, [{ name: 'Calendar', rows: [recHead, ...rows] }]);
    await april([['2027-04-07', 'Wednesday', 'Chapli Kebab', 'FROM THE FIRE', 'Reel', 'CHAPLI\nKEBAB', 'Still hungry?', 'High'], ['2027-04-08', 'Thursday', 'BBQ Barramundi', 'FROM THE CHARCOAL SEA', 'Reel', 'WHOLE BBQ\nBARRAMUNDI', 'Not a kebab.', 'High']]);
    expect(await loadWorkbook(pool, rec, { keepStarted: true })).toMatchObject({ plan: '2027-04', inserted: 2, unread: [] });
    // The same sheet again changes nothing: the stored record compares equal however jsonb orders its keys.
    expect(await loadWorkbook(pool, rec, { keepStarted: true })).toMatchObject({ inserted: 0, updated: 0 });
    // Only the Thursday this time: it updates that day and leaves Wednesday, and a new date takes the next day.
    await april([['2027-04-08', 'Thursday', 'BBQ Barramundi', 'FROM THE CHARCOAL SEA', 'Reel', 'WHOLE\nBARRAMUNDI', 'Not a kebab.', 'High'], ['2027-04-09', 'Friday', 'Mango Lassi', 'FRESH POUR', 'Photo', 'MANGO\nLASSI', 'Poured cold.', 'Low']]);
    expect(await loadWorkbook(pool, rec, { keepStarted: true })).toMatchObject({ inserted: 1, updated: 1 });
    const april1 = (await rowByDay(pool, 1, '2027-04'))!;
    const april2 = (await rowByDay(pool, 2, '2027-04'))!;
    const april3 = (await rowByDay(pool, 3, '2027-04'))!;
    expect([april1.date, april1.content?.canva_headline, april1.slot]).toEqual(['2027-04-07', 'CHAPLI\nKEBAB', 'reel']);
    expect([april2.date, april2.content?.canva_headline, april2.template]).toEqual(['2027-04-08', 'WHOLE\nBARRAMUNDI', 'from-the-charcoal-sea']);
    expect([april3.date, april3.dish, april3.content?.priority]).toEqual(['2027-04-09', 'Mango Lassi', 'Low']);
    // The knowledge base's own names: hyphenated ids, a sheet called Operational Calendar, status words, sheets with no home yet.
    const kb = join(dir, 'kb.xlsx');
    await writeWorkbook(kb, [
      { name: 'Campaigns', rows: [['CampaignID', 'Campaign Name', 'Category', 'Start Date', 'End Date', 'Priority', 'Objective', 'Success Metric', 'Status'], ['CMP-03', 'Seafood Expansion', 'Seafood', '2026-11-04', '2027-10-31', 'High', 'Grow seafood.', 'Seafood units', 'Active']] },
      { name: 'Products', rows: [['ProductID', 'Product Name', 'Category', 'Status', 'Launch Date', 'Series', 'Hero Product', 'Notes'], ['PRD-08', 'BBQ Prawns', 'Seafood', 'Upcoming', '2026-12-15', 'FROM THE CHARCOAL SEA', 'No', 'Launch date supplied by the business.']] },
      { name: 'Customer Benefits', rows: [['BenefitID', 'Benefit Name', 'Message'], ['BEN-09', 'More choice', 'More choice across BBQ seafood.']] },
      { name: 'Hooks Library', rows: [['HookID', 'Series', 'Hook'], ['HK-001', 'FROM THE FIRE', 'Hear the sizzle.'], ['HK-002', 'SAVE ROOM', 'Save room.']] },
      { name: 'Scratch', rows: [['a'], ['b']] },
    ]);
    expect(await loadWorkbook(pool, kb, { sourceName: 'kb.xlsx' })).toMatchObject({ plan: null, campaigns: 1, products: 1, benefits: 1, reference: ['Hooks Library'], unreadSheets: ['Scratch'] });
    // Planning documents alone are a load, and what bears on a post reaches the writer.
    const { planningBrief, listReference } = await import('../src/reference.js');
    const strategic = join(dir, 'strategic.xlsx');
    await writeWorkbook(strategic, [
      { name: 'Content Pillars', rows: [['Pillar', 'Purpose', 'Customer Message'], ['FROM THE FIRE', 'Make BBQ memorable.', 'Better flavour.']] },
      { name: 'Read Me', rows: [['Topic', 'Working Rule'], ['Product timing', 'Before 15 Dec, BBQ is grilled, not charcoal.'], ['Status', 'Records start as Planned.']] },
    ]);
    expect(await loadWorkbook(pool, strategic)).toMatchObject({ plan: null, reference: ['Content Pillars', 'Working Rules'], unreadSheets: [] });
    const brief = await planningBrief(pool, 'FROM THE FIRE');
    expect(brief).toContain('Make BBQ memorable.');
    expect(brief).toContain('Before 15 Dec, BBQ is grilled, not charcoal.');
    expect(brief).toContain('Hear the sizzle.');
    expect(brief).not.toContain('Save room.');
    expect(brief).not.toContain('Records start as Planned.');
    expect((await listReference(pool)).map((s) => s.name)).toEqual(['Content Pillars', 'Working Rules', 'Hooks Library']);
    const ops = join(dir, 'ops.xlsx');
    await writeWorkbook(ops, [{ name: 'Operational Calendar', rows: [['ContentID', 'Date', 'Day', 'CampaignID', 'Campaign', 'ProductID', 'Product', 'BenefitID', 'Customer Benefit', 'Series', 'Format', 'Hook', 'Facebook Hashtags'], ['C26', '2027-05-04', 'Tuesday', 'CMP-03', 'Seafood Expansion', 'PRD-08', 'BBQ Prawns', 'BEN-09', 'More choice', 'YOU SAID IT', 'Reel', 'Coming soon.', '#Fuadijan #Seafood']] }]);
    expect(await loadWorkbook(pool, ops, { keepStarted: true })).toMatchObject({ plan: '2027-05', inserted: 1, unread: [] });
    const c26 = (await rowByDay(pool, 1, '2027-05'))!;
    expect([c26.dish, c26.benefit, c26.template, c26.content?.content_id, c26.content?.facebook_hashtags]).toEqual(['BBQ Prawns', 'More choice', 'you-said-it-photo', 'C26', '#Fuadijan #Seafood']);
    expect(c26.campaign_id).toBe((await findCampaign(pool, 'CMP-03'))!.id);
    // A retired post is gone from every list, its day number is free, and its plan is no longer a plan.
    const { plans, rowsBetween: between, rowsOnDate } = await import('../src/calendar/rows.js');
    await pool.query("update calendar_rows set retired_at = now(), plan = 'retired-' || plan where plan = '2027-04'");
    expect((await plans(pool)).map((p) => p.plan)).not.toContain('retired-2027-04');
    expect(await between(pool, '2027-04-01', '2027-04-30')).toEqual([]);
    expect(await rowsOnDate(pool, '2027-04-07')).toEqual([]);
    await april([['2027-04-07', 'Wednesday', 'Chapli Kebab', 'FROM THE FIRE', 'Reel', 'NEW\nCHAPLI', 'Fresh start.', 'High']]);
    expect(await loadWorkbook(pool, rec, { keepStarted: true })).toMatchObject({ plan: '2027-04', inserted: 1, updated: 0 });
    expect((await rowByDay(pool, 1, '2027-04'))!.content?.canva_headline).toBe('NEW\nCHAPLI');
    // A retired wording leaves the bank, and adding the same one again brings it back on purpose.
    const { addSlogan, listSlogans: bank } = await import('../src/slogans.js');
    const retiredOne = await addSlogan(pool, { item: 'Retire Me', headline: 'Old line.', source: 'strategy' });
    await pool.query('update slogans set retired_at = now() where id = $1', [retiredOne.id]);
    expect(await bank(pool, 'Retire Me')).toEqual([]);
    await addSlogan(pool, { item: 'Retire Me', headline: 'Old line.', source: 'owner' });
    expect(await bank(pool, 'Retire Me')).toHaveLength(1);
    // A workbook with nothing the app reads is refused.
    const none = join(dir, 'none.xlsx');
    await writeWorkbook(none, [{ name: 'Notes', rows: [['hello']] }]);
    await expect(loadWorkbook(pool, none)).rejects.toThrow(/none of the sheets the app reads/);
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

  it("a /redo of a custom post asks which wording, with the owner's original offered beside the new ones", async () => {
    const { latestCopyOptions } = await import('../src/pipeline/wording.js');
    messenger.sent.length = 0;
    const row = (await rowByDay(pool, 101))!;
    await handleCommand(ctx, '/redo Chapli Kebab #day 101 new title about the smoke');
    expect(messenger.sent.at(-1)!.text).toMatch(/Re-running Day 101 \(Chapli Kebab\) with "Chapli Kebab new title about the smoke"/);
    await new Worker(ctx, 1000).drain();
    // The first run took the owner's words without asking; the redo asks like any post.
    const open = (await openQuestions(pool, row.id)).filter((q) => q.field === 'wording');
    expect(open).toHaveLength(1);
    const set = (await latestCopyOptions(pool, row.id))!;
    expect(set.options[0]).toMatchObject({ name: 'Calendar wording', headline: 'Fuadijan\nAuburn' });
    expect(set.options.find((o) => o.name === 'Your original wording')).toMatchObject({ headline: 'Chapli\nFirst', line: 'Problems later.' });
    expect(open[0]!.options.some((o) => /Your original wording/.test(o.label))).toBe(true);
    // Picking the new wording renders with it.
    await applyAnswer(ctx, open[0]!.id, '1', 'dry-run');
    await new Worker(ctx, 1000).drain();
    const job = (await pool.query<{ state: { copy: { headline: string }; wordingChosen: number; jpegFileId?: string } }>(
      "select state from jobs where calendar_row_id = $1 and state ? 'redo' order by id desc limit 1", [row.id])).rows[0]!;
    expect(job.state.copy.headline).toBe('Fuadijan\nAuburn');
    expect(job.state.wordingChosen).toBe(0);
    // The redo designs from the intake's upright JPEG, not the raw original.
    expect(job.state.jpegFileId).toBeTruthy();

    // The owner's own words, typed after the pack: a new option, the custom post's wording, and a re-render with them.
    messenger.sent.length = 0;
    await handleCommand(ctx, '/wording 101 -- Chapli Kebab | Hand formed, special spices');
    expect(messenger.sent.at(-1)!.text).toMatch(/Your words for Day 101: "Chapli Kebab" — Hand formed, special spices/);
    await new Worker(ctx, 1000).drain();
    const own = (await latestCopyOptions(pool, row.id))!;
    expect(own.options[own.chosen!]).toMatchObject({ name: 'Your words', headline: 'Chapli Kebab', line: 'Hand formed, special spices' });
    expect((await rowByDay(pool, 101))!.custom).toMatchObject({ wording: { headline: 'Chapli Kebab', line: 'Hand formed, special spices' } });
    const rerun = (await pool.query<{ state: { copy: { headline: string; line: string } } }>("select state from jobs where calendar_row_id = $1 order by id desc limit 1", [row.id])).rows[0]!;
    expect(rerun.state.copy).toMatchObject({ headline: 'Chapli Kebab', line: 'Hand formed, special spices' });
    expect((await openQuestions(pool, row.id))).toHaveLength(0);
  });

  it('makes a custom post from /custom in Telegram, offering the product\'s earlier photo as a button', async () => {
    messenger.sent.length = 0;
    await handleCommand(ctx, '/custom Chapli Kebab flat story 2026-11-12 7pm -- Hot and fresh. | Tonight only.');
    const row = (await rowByDay(pool, 102))!;
    expect(row).toMatchObject({ type: 'custom', dish: 'Chapli Kebab', date: '2026-11-12', post_time: '19:00', template: 'from-the-fire' });
    // The title is the product's name as the menu spells it; the owner's words are the line.
    expect(row.custom).toMatchObject({ style: 'flat', formats: ['story'], wording: { headline: 'Chapli Kebab', line: 'Hot and fresh.', caption: 'Tonight only.' } });
    expect(messenger.sent[0]!.text).toMatch(/^🆕 Day 102 — Chapli Kebab \(custom\)/);
    const q = (await openQuestions(pool, row.id)).find((x) => x.field === 'photo')!;
    // Day 101 adopted the same photo; it is offered once, under the day it was first sent for.
    expect(q.options.map((o) => o.label)).toEqual([expect.stringMatching(/^Day 2 · Chapli/), "I'll send a new one"]);
    // Typed, not tapped: "day 2" is read as that day's photo.
    await applyAnswer(ctx, q.id, 'Day 2', 'telegram');
    expect(messenger.sent.at(-1)!.text).toMatch(/→ Day 102\. Designing now\./);
    await new Worker(ctx, 1000).drain();
    expect((await rowByDay(pool, 102))!.status).toBe('ready');
    expect((await pool.query('select format from renders where calendar_row_id = $1', [row.id])).rows).toEqual([{ format: 'story' }]);
    expect((await openQuestions(pool, row.id))).toHaveLength(0);
  });

  it('warns once about a small photo, and "use this one" lets it through', async () => {
    messenger.sent.length = 0;
    const small = await sharp(readFileSync('brand/reference/real-01.jpg')).resize({ width: 900 }).jpeg().toBuffer();
    await receiveAsset(pool, { kind: 'photo', bytes: small, mime: 'image/jpeg', filename: null, caption: 'beef seekh #day3' });
    const worker = new Worker(ctx, 1000);
    await worker.drain();
    const q = (await openQuestions(pool)).find((x) => x.field === 'quality')!;
    expect(q).toBeTruthy();
    expect(q.question).toMatch(/sharper post/);
    expect(q.row_id).toBeNull(); // asked before the photo has a day
    await applyAnswer(ctx, q.id, 'use this one', 'telegram');
    await worker.drain();
    // Asked once for this job, and the photo went on to its day.
    expect((await pool.query("select count(*)::int n from questions where job_id = $1 and field = 'quality'", [q.job_id])).rows[0]!.n).toBe(1);
    expect((await openQuestions(pool)).filter((x) => x.field === 'quality')).toHaveLength(0);
    expect((await pool.query('select stage from jobs where id = $1', [q.job_id])).rows[0]!.stage).not.toBe('intake');
    expect(messenger.sent.some((m) => /^Got it — .*Day 3/.test(m.text ?? ''))).toBe(true);
  });

  it('lays the strategy plan over the running month, leaving started days alone', async () => {
    const { strategyRows } = await import('../calendar/strategy-workbook.js');
    const { cleanRow } = await import('../calendar/calendar.schema.js');
    const { loadStrategy } = await import('../src/strategy.js');
    const rows = strategyRows(loadStrategy()).map((r, i) => cleanRow(r, i + 1));
    const day2Before = (await rowByDay(pool, 2))!;
    const day9Before = (await rowByDay(pool, 9))!;
    const res = await seedRows(pool, rows, rows[0]!.date, { keepStarted: true });
    expect(res.plan).toBe('2026-11');
    expect(res.inserted).toBe(0);
    // Day 2 (photo received, posted) and Day 3 (photo received) stay; Day 9 takes the strategy's row as written.
    expect(res.kept).toEqual(expect.arrayContaining([2, 3]));
    expect(await rowByDay(pool, 2)).toMatchObject({ dish: day2Before.dish, date: day2Before.date, template: day2Before.template });
    const day9 = (await rowByDay(pool, 9))!;
    expect(day9.date).toBe('2026-11-10');
    expect(day9).toMatchObject({ slot: 'carousel', dish: 'Chicken Karahi', template: 'audience-poll', theme: 'Karahi Week' });
    expect(day9.date).not.toBe(day9Before.date);
    expect((await rowByDay(pool, 10))).toMatchObject({ date: '2026-11-11', type: 'karahi-night', post_time: '17:00' });
  });

  it('seeds the strategy wordings into the bank once, however often it runs', async () => {
    const { seedStrategyWordings, strategyWordings, loadStrategy } = await import('../src/strategy.js');
    const before = Number((await pool.query("select count(*)::int n from slogans where source = 'strategy'")).rows[0]!.n);
    expect(before).toBe(0);
    await seedStrategyWordings(pool);
    await seedStrategyWordings(pool);
    const rows = (await pool.query<{ item: string; item_key: string; headline: string; line: string | null }>("select item, item_key, headline, line from slogans where source = 'strategy'")).rows;
    expect(rows).toHaveLength(strategyWordings(loadStrategy()).length);
    expect(rows.find((r) => r.item_key === 'karahi night' && r.headline === 'Karahi\nNight')?.line).toMatch(/Every Wednesday/);
    expect(rows.filter((r) => r.item_key === 'all')).toHaveLength(4);
  });

  it('stops promising a pack once the newest job has failed, and promises it again when a new one starts', async () => {
    const { rowViews } = await import('../src/reminders/brief.js');
    const { rows: [made] } = await pool.query<{ id: number }>(
      "insert into calendar_rows (plan, day_no, date, slot, type, dish, template, status) values ('2099-01', 1, '2099-01-05', 'feed', 'hero-dish', 'Lamb Karahi', 'from-the-karahi', 'planned') returning id");
    const rowId = made!.id;
    const { rows: [photo] } = await pool.query<{ id: number }>("insert into assets (kind, calendar_row_id) values ('document', $1) returning id", [rowId]);
    const words = async () => (await rowViews(ctx, [(await rowByDay(pool, 1, '2099-01'))!]))[0]!.needs.words;
    expect(await words()).toBe('Nothing more from you; the pack is on its way.');
    // A job that knows its post only through its photo counts.
    await pool.query("insert into jobs (asset_id, stage, status) values ($1, 'resolve', 'failed')", [photo!.id]);
    expect(await words()).toBe("The last try didn't finish. Send the photo again, or reply /redo 1.");
    await pool.query("insert into jobs (asset_id, calendar_row_id, stage, status) values ($1, $2, 'resolve', 'queued')", [photo!.id, rowId]);
    expect(await words()).toBe('Nothing more from you; the pack is on its way.');
    await pool.query("insert into jobs (calendar_row_id, stage, status) values ($1, 'resolve', 'failed')", [rowId]);
    await pool.query("update calendar_rows set status = 'ready' where id = $1", [rowId]);
    expect(await words()).toBe("Ready to post, but your last change didn't finish. Send it again with /redo 1.");
  });

  it("takes the owner's text straight into the pack, and new designs only when the words on them change", async () => {
    const { setPostText, PostBusyError } = await import('../src/pipeline/post-text.js');
    const { latestCopyOptions, addOwnerOption, updateOption, rerenderRow } = await import('../src/pipeline/wording.js');
    const row = (await rowByDay(pool, 2))!;
    const worker = new Worker(ctx, 1000);
    const pack = async () => (await pool.query<{ id: number; caption: string; caption_txt: string; hashtags: string[]; platforms: { tiktok: { script: string }; stories: string[] } }>('select id, caption, caption_txt, hashtags, platforms from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0]!;
    const jobs = async () => Number((await pool.query<{ n: string }>('select count(*) n from jobs where calendar_row_id = $1', [row.id])).rows[0]!.n);
    const before = await jobs();

    // Text not on the design: into the pack at once, and no new job.
    expect(await setPostText(pool, row, 'caption', 'Typed by the owner.', 'owner-web')).toEqual({ rebuilding: false });
    expect(await setPostText(pool, row, 'hashtags', 'halal, #Karahi', 'owner-web')).toEqual({ rebuilding: false });
    expect(await setPostText(pool, row, 'tiktok_script', 'Line one.\nLine two.', 'owner-web')).toEqual({ rebuilding: false });
    expect(await setPostText(pool, row, 'story_sequence', 'Story 1\nStory 2', 'owner-web')).toEqual({ rebuilding: false });
    const edited = await pack();
    expect(edited.caption).toBe('Typed by the owner.');
    expect(edited.caption_txt).toContain('Typed by the owner.');
    expect(edited.hashtags).toEqual(['#halal', '#Karahi']);
    expect(edited.platforms.tiktok.script).toBe('Line one.\nLine two.');
    expect(edited.platforms.stories).toEqual(['Story 1', 'Story 2']);
    expect(await jobs()).toBe(before);
    expect((await rowByDay(pool, 2))!.content?.tiktok_script).toBe('Line one.\nLine two.');
    expect((await latestCopyOptions(pool, row.id))!.options[1]).toMatchObject({ caption: 'Typed by the owner.', owner: true });
    await expect(setPostText(pool, row, 'caption', '  ', 'owner-web')).rejects.toThrow(/cannot be empty/);

    // Text on the design: new designs from the same words, with no writer run and no wording question.
    const fresh = (await rowByDay(pool, 2))!;
    expect(await setPostText(pool, fresh, 'canva_headline', 'Chapli\nKebab', 'owner-web')).toEqual({ rebuilding: true });
    await expect(setPostText(pool, fresh, 'cta', 'Too soon', 'owner-web')).rejects.toBeInstanceOf(PostBusyError);
    await worker.drain();
    expect((await pool.query('select stage, status from jobs where calendar_row_id = $1 order by id desc limit 1', [row.id])).rows[0]).toEqual({ stage: 'done', status: 'done' });
    expect((await openQuestions(pool, row.id)).filter((q) => q.field === 'wording')).toEqual([]);
    const rebuilt = await pack();
    expect(rebuilt.id).not.toBe(edited.id);
    expect(rebuilt.caption).toBe('Typed by the owner.');
    expect(rebuilt.hashtags).toEqual(['#halal', '#Karahi']);
    expect(rebuilt.platforms.tiktok.script).toBe('Line one.\nLine two.');

    // A wording of the owner's joins the list; changing another marks it as theirs.
    const added = await addOwnerOption(pool, row.id, { headline: 'Chapli Kebab', line: 'My line.', caption: 'My caption.' });
    expect(added.set.options[added.index]).toMatchObject({ name: 'Your words', owner: true });
    const changed = await updateOption(pool, added.set, 0, { line: 'Better line.' });
    expect(changed.options[0]).toMatchObject({ line: 'Better line.', owner: true, name: 'Calendar wording (edited)' });
    expect(await rerenderRow(pool, -1)).toBeNull();

    // A new workbook leaves what the owner typed in the record, and may change the rest of it.
    const wb = await readWorkbook();
    const sheet = { ...wb.rows.find((r) => r.day_no === 2)!, content: { tiktok_script: 'From the sheet', kpi: 'Saves' } };
    await seedRows(pool, [sheet], wb.rows[0]!.date);
    expect((await rowByDay(pool, 2))!.content).toMatchObject({ tiktok_script: 'Line one.\nLine two.', kpi: 'Saves' });
  });

  it('makes the design from the photos the owner picks, two with their names, and a new photo starts over', async () => {
    const { rerenderRow } = await import('../src/pipeline/wording.js');
    const row = (await rowByDay(pool, 2))!;
    const worker = new Worker(ctx, 1000);
    const { rows: [first] } = await pool.query<{ id: number; prepped: Record<string, string>; original_file_id: string }>("select id, prepped, original_file_id from assets where calendar_row_id = $1 and prepped is not null order by id limit 1", [row.id]);
    const { rows: [second] } = await pool.query<{ id: number }>("insert into assets (kind, calendar_row_id, original_file_id, prepped) values ('document', $1, $2, $3) returning id", [row.id, first!.original_file_id, JSON.stringify(first!.prepped)]);
    await pool.query('update calendar_rows set design_photos = $2 where id = $1', [row.id, JSON.stringify([{ assetId: first!.id, name: 'Lamb Karahi' }, { assetId: second!.id, name: 'Chicken Karahi' }])]);
    await rerenderRow(pool, row.id, { assetId: first!.id });
    const critiques = async () => Number((await pool.query<{ n: string }>('select count(*) n from claude_calls').catch(() => ({ rows: [{ n: '0' }] }))).rows[0]!.n);
    const calls = await critiques();
    await worker.drain();
    expect((await pool.query('select stage, status from jobs where calendar_row_id = $1 order by id desc limit 1', [row.id])).rows[0]).toEqual({ stage: 'done', status: 'done' });
    // The fixed layout asks nothing of the art director or the critic.
    expect(await critiques()).toBe(calls);
    expect((await pool.query<{ format: string }>('select format from renders where calendar_row_id = $1 order by format', [row.id])).rows.map((r) => r.format)).toEqual(['feed', 'story']);
    // A post that was already out stays posted.
    await pool.query("update calendar_rows set status = 'posted' where id = $1", [row.id]);
    await rerenderRow(pool, row.id, { assetId: first!.id });
    await worker.drain();
    expect((await rowByDay(pool, 2))!.status).toBe('posted');
    await pool.query("update calendar_rows set status = 'ready' where id = $1", [row.id]);
    // A redo starts from the first photo picked.
    const { redoRow } = await import('../src/pipeline/worker.js');
    const redo = await redoRow(pool, row.id, null);
    expect(redo!.asset_id).toBe(first!.id);
    await pool.query("update jobs set status = 'done' where id = $1", [redo!.id]);
    // A photo sent later, outside the set, is what the owner wants to see now.
    await pool.query("update assets set set_key = null, created_at = now() - interval '1 hour' where calendar_row_id = $1", [row.id]);
    await receiveAsset(pool, { kind: 'document', bytes: readFileSync('brand/reference/real-03.jpg'), mime: 'image/jpeg', filename: 'new.jpg', caption: 'chapli kebab #day2' });
    await worker.drain();
    expect((await rowByDay(pool, 2))!.design_photos).toBeNull();
    for (const q of await openQuestions(pool, row.id)) await pool.query("update questions set answered_at = now(), answer = 'x' where id = $1", [q.id]);
    await pool.query("update jobs set status = 'done' where calendar_row_id = $1 and status in ('waiting', 'queued')", [row.id]);
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
