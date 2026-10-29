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
import { applyAnswer, handleFreeText } from '../src/messaging/commands.js';
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
    expect(await migrate(pool, () => {})).toEqual(['0001_init.sql']);
    expect(await migrate(pool, () => {})).toEqual([]);
  });

  it('seeds the 30 rows from the workbook with the clean-ups applied', async () => {
    const wb = await readWorkbook();
    expect(wb.rows).toHaveLength(30);
    const res = await seedRows(pool, wb.rows);
    expect(res).toMatchObject({ inserted: 30, updated: 0 });
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
    expect((await pool.query('select stage, status from jobs order by id desc limit 1')).rows[0]).toEqual({ stage: 'done', status: 'done' });
    expect((await rowByDay(pool, 2))!.status).toBe('ready');
    const pack = (await pool.query<{ caption_txt: string; folder: string; hashtags: string[] }>('select caption_txt, folder, hashtags from packs')).rows[0]!;
    expect(pack.folder).toBe('2026-11-04 chapli-kebab');
    expect(pack.hashtags).toHaveLength(5);
    expect(pack.caption_txt).toContain('=== POST AT ===');
    const files = messenger.sent.filter((m) => m.file).map((m) => m.file);
    // The render stage made the designs, so the owner gets those as files rather than the plain crops.
    expect(files).toEqual(['day2-feed.png', 'day2-story.png']);
    const renders = (await pool.query<{ format: string }>('select format from renders where calendar_row_id = $1 order by format', [(await rowByDay(pool, 2))!.id])).rows.map((r) => r.format);
    expect(renders).toEqual(['feed', 'story']);
    const assets = (await pool.query<{ quality: { verdict: string }; prepped: Record<string, string> }>('select quality, prepped from assets')).rows[0]!;
    expect(assets.quality.verdict).toBe('ok');
    expect(Object.keys(assets.prepped).sort()).toEqual(['1x1', '4x5', '9x16']);
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
