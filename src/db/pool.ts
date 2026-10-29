/**
 * The Postgres pool, the way the POS does it: TLS on for anything hosted (Railway's certificate is signed by no
 * public CA, so it isn't verified unless DATABASE_CA_FILE points at it), nothing for a Postgres on this PC, and the
 * two 'error' listeners that keep a dropped idle connection from taking the process down.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

export type Db = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export function isLocalDatabaseUrl(url: string): boolean {
  return /@(localhost|127\.0\.0\.1)[:/]/.test(url);
}

function tls(url: string): Pick<pg.ClientConfig, 'ssl'> {
  if (isLocalDatabaseUrl(url)) return {};
  const caFile = process.env.DATABASE_CA_FILE?.trim();
  if (!caFile) return { ssl: { rejectUnauthorized: false } };
  return { ssl: { ca: readFileSync(caFile, 'utf8'), rejectUnauthorized: true } };
}

export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 8, ...tls(url) });
  pool.on('error', (err) => console.warn(`An idle database connection was lost: ${err.message}`));
  pool.on('connect', (client) => client.on('error', () => {}));
  return pool;
}

export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Creates the database named in `url` if it doesn't exist yet (local development and tests). */
export async function createDatabaseIfMissing(url: string): Promise<boolean> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Refusing to create a database named "${dbName}".`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString(), ...tls(url) });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (rowCount) return false;
    await client.query(`create database ${dbName}`);
    return true;
  } finally {
    await client.end();
  }
}
