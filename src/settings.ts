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

/** Owner-confirmed facts about dishes, keyed "fact:<dish lower-case>"; the value is the fact sentence. */
export async function setDishFact(db: Db, dish: string, fact: string): Promise<void> {
  await db.query('insert into settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [`fact:${dish.trim().toLowerCase()}`, fact.trim()]);
}

export async function removeDishFact(db: Db, dish: string): Promise<boolean> {
  return ((await db.query('delete from settings where key = $1', [`fact:${dish.trim().toLowerCase()}`])).rowCount ?? 0) > 0;
}

export async function allDishFacts(db: Db): Promise<{ dish: string; fact: string }[]> {
  const { rows } = await db.query<{ key: string; value: string }>("select key, value from settings where key like 'fact:%' order by key");
  return rows.map((r) => ({ dish: r.key.slice(5), fact: r.value }));
}

/** The facts whose dish name appears in any of the given texts (row dish, caption subject, Claude's dish). */
export async function dishFactsFor(db: Db, texts: (string | null | undefined)[]): Promise<string[]> {
  const hay = texts.filter((t): t is string => Boolean(t)).join(' | ').toLowerCase();
  return (await allDishFacts(db)).filter((f) => hay.includes(f.dish)).map((f) => `${f.dish.replace(/\b\w/g, (c) => c.toUpperCase())}: ${f.fact}`);
}
