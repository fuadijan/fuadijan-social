/** Key/value settings the owner edits from Telegram (/set address|hours|website) or that have defaults. */
import type { Db } from './db/pool.js';

export type SettingKey = 'store_address' | 'open_hours' | 'website_url' | 'post_time_default' | 'story_time_default' | 'instagram_handle' | 'paused';

export const SET_ALIASES: Record<string, SettingKey> = {
  address: 'store_address',
  hours: 'open_hours',
  website: 'website_url',
  'post-time': 'post_time_default',
  'story-time': 'story_time_default',
};

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  return (await db.query<{ value: string }>('select value from settings where key = $1', [key])).rows[0]?.value ?? '';
}

export async function setSetting(db: Db, key: SettingKey, value: string): Promise<void> {
  await db.query('insert into settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value]);
}

export async function allSettings(db: Db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of (await db.query<{ key: string; value: string }>('select key, value from settings')).rows) out[r.key] = r.value;
  return out;
}

export async function isPaused(db: Db): Promise<boolean> {
  return (await getSetting(db, 'paused')) === 'true';
}
