/**
 * npm run dry-run -- --day 2 --file samples/chapli.jpg [--caption "chapli kebab"] [--answer "..."]
 *
 * Runs the whole pipeline locally against the local database with Telegram replaced by the console and Claude
 * by fixtures, then prints the pack. Seeds the calendar first if the table is empty. Questions the pipeline asks
 * are answered with their first suggestion (or --answer), so the run always ends in a pack you can read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { FixtureClaude } from './brain/client.js';
import { rowByDay } from './calendar/rows.js';
import { consoleLogger, type AppContext } from './context.js';
import { createDatabaseIfMissing, createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { FileMenuSource } from './menu/index.js';
import { CachedMenu } from './menu/source.js';
import { applyAnswer } from './messaging/commands.js';
import { ConsoleMessenger } from './messaging/messenger.js';
import { openQuestions } from './pipeline/questions.js';
import { PACKS_DIR } from './pipeline/stages.js';
import { receiveAsset, Worker } from './pipeline/worker.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const dayNo = Number(arg('day', '2'));
  const file = arg('file', 'samples/chapli.jpg')!;
  const forcedAnswer = arg('answer');
  await createDatabaseIfMissing(config.databaseUrl);
  const pool = createPool(config.databaseUrl);
  await migrate(pool, () => {});

  if (!(await pool.query('select 1 from calendar_rows limit 1')).rowCount) {
    const { readWorkbook, seedRows } = await import('../calendar/seed.js');
    const wb = await readWorkbook();
    await seedRows(pool, wb.rows);
    console.log(`Seeded ${wb.rows.length} calendar rows.`);
  }
  const row = await rowByDay(pool, dayNo);
  if (!row) throw new Error(`There is no Day ${dayNo}.`);

  const messenger = new ConsoleMessenger(true);
  const ctx: AppContext = {
    pool,
    claude: new FixtureClaude(pool),
    menu: new CachedMenu(new FileMenuSource(join(process.cwd(), 'test', 'fixtures', 'menu-screens.json'))),
    messenger,
    log: consoleLogger,
    // The dry run pretends it is the morning of the day before the row, so the row is a candidate.
    now: () => new Date(`${row.date}T20:00:00Z`),
  };

  const caption = arg('caption', `${(row.dish ?? row.theme ?? 'photo').split(',')[0]!.toLowerCase()} #day${dayNo}`)!;
  const isVideo = /\.(mp4|mov)$/i.test(file);
  const bytes = isVideo ? undefined : readFileSync(file);
  console.log(`\nDry run: Day ${dayNo} (${row.date}, ${row.slot}) ← ${file} with caption "${caption}"\n`);
  await receiveAsset(pool, { kind: isVideo ? 'video' : 'document', bytes, mime: isVideo ? 'video/mp4' : 'image/jpeg', filename: file.split(/[\\/]/).pop() ?? null, caption });

  const worker = new Worker(ctx, 1000);
  for (let round = 0; round < 10; round++) {
    await worker.drain();
    const open = (await openQuestions(pool)).filter((q) => q.field !== 'skip');
    if (!open.length) break;
    for (const q of open) {
      const answer = forcedAnswer ?? q.options[0]?.value ?? 'ok';
      console.log(`\n→ answering "${q.question.split('\n')[0]}" with "${answer}"`);
      await applyAnswer(ctx, q.id, answer, 'dry-run');
    }
  }

  const pack = (await pool.query<{ folder: string; caption_txt: string; canva_brief: string; reel_pack_txt: string | null }>('select folder, caption_txt, canva_brief, reel_pack_txt from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
  if (!pack) {
    const job = (await pool.query<{ stage: string; status: string; last_error: string | null }>('select stage, status, last_error from jobs order by id desc limit 1')).rows[0];
    console.log(`\nNo pack was produced. Last job: ${JSON.stringify(job)}`);
    process.exitCode = 1;
  } else {
    console.log(`\n════════ PACK ${join(PACKS_DIR, pack.folder)} ════════\n`);
    if (pack.reel_pack_txt) console.log(`${pack.reel_pack_txt}\n`);
    console.log(pack.caption_txt);
    console.log('──── canva-brief.txt ────');
    console.log(pack.canva_brief);
  }
  await pool.end();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
