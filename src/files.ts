/**
 * Binary content lives in the `files` table (content-addressed by sha256) with DATA_DIR as a read-through cache,
 * so a redeploy on Railway loses nothing and the local dry run can still open the files it wrote.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import type { Db } from './db/pool.js';

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cachePath(id: string): string {
  return join(config.dataDir, 'files', id.slice(0, 2), id);
}

export async function putFile(db: Db, bytes: Buffer, mime: string): Promise<string> {
  const id = sha256(bytes);
  await db.query('insert into files (id, mime, bytes, size) values ($1, $2, $3, $4) on conflict (id) do nothing', [id, mime, bytes, bytes.length]);
  try {
    mkdirSync(join(config.dataDir, 'files', id.slice(0, 2)), { recursive: true });
    if (!existsSync(cachePath(id))) writeFileSync(cachePath(id), bytes);
  } catch {
    // The cache is a convenience; the database copy is the truth.
  }
  return id;
}

export async function getFile(db: Db, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const meta = (await db.query<{ mime: string }>('select mime from files where id = $1', [id])).rows[0];
  if (!meta) return null;
  const cached = cachePath(id);
  if (existsSync(cached)) return { bytes: readFileSync(cached), mime: meta.mime };
  const row = (await db.query<{ bytes: Buffer; mime: string }>('select bytes, mime from files where id = $1', [id])).rows[0];
  return row ? { bytes: row.bytes, mime: row.mime } : null;
}

export function extensionFor(mime: string): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'text/plain': 'txt' }[mime] ?? 'bin';
}
