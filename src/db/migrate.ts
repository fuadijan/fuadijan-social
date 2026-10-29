/**
 * Applies src/db/migrations/*.sql in name order, each once, each in its own transaction, under an advisory lock
 * so two starting copies can't both migrate. Runs on boot and from `npm run migrate` (--create also makes the
 * local database).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../config.js';
import { createDatabaseIfMissing, createPool, inTransaction } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(here, 'migrations');

export async function migrate(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext('schema_migrations'))");
    return await runLocked(pool, log);
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('schema_migrations'))").catch(() => {});
    lock.release();
  }
}

async function runLocked(pool: pg.Pool, log: (msg: string) => void): Promise<string[]> {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await inTransaction(pool, async (c) => {
      await c.query(sql);
      await c.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
    log(`Applied ${file}`);
  }
  if (!applied.length) log('Database is up to date.');
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  (async () => {
    if (process.argv.includes('--create') && (await createDatabaseIfMissing(config.databaseUrl))) console.log('Created the database.');
    const pool = createPool(config.databaseUrl);
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
  })().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
