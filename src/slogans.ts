/**
 * The slogan bank: wordings the owner keeps per menu item. A slogan is a headline (two short lines, or one), with
 * an optional supporting line and caption. Item "all" applies to every post; otherwise a slogan is offered when the
 * item's name appears in the row's dish, the caption subject, Claude's dish read or the series label, the same
 * loose match dish facts use. Loaded from the Slogans sheet (calendar/slogans.ts) or added with /slogan.
 */
import type { Db } from './db/pool.js';

export interface Slogan {
  id: number;
  item: string;
  item_key: string;
  headline: string;
  line: string | null;
  caption: string | null;
  source: string;
}

export const itemKey = (item: string) => item.trim().toLowerCase().replace(/\s+/g, ' ');

export async function addSlogan(db: Db, s: { item: string; headline: string; line?: string | null; caption?: string | null; source?: string }): Promise<Slogan> {
  const { rows } = await db.query<Slogan>(
    `insert into slogans (item, item_key, headline, line, caption, source) values ($1, $2, $3, $4, $5, $6)
     on conflict (item_key, headline) do update set item = excluded.item, line = coalesce(excluded.line, slogans.line), caption = coalesce(excluded.caption, slogans.caption), source = excluded.source
     returning *`,
    [s.item.trim(), itemKey(s.item), s.headline.trim(), s.line?.trim() || null, s.caption?.trim() || null, s.source ?? 'owner']);
  return rows[0]!;
}

export async function removeSlogan(db: Db, id: number): Promise<boolean> {
  return ((await db.query('delete from slogans where id = $1', [id])).rowCount ?? 0) > 0;
}

/** All slogans, or those of one item, in the order they were added. */
export async function listSlogans(db: Db, item?: string | null): Promise<Slogan[]> {
  const { rows } = item
    ? await db.query<Slogan>('select * from slogans where item_key = $1 order by id', [itemKey(item)])
    : await db.query<Slogan>('select * from slogans order by item_key, id');
  return rows;
}

/** Distinct items with a count, for the list view. */
export async function slogansByItem(db: Db): Promise<{ item: string; n: number }[]> {
  const { rows } = await db.query<{ item: string; n: string }>('select min(item) item, count(*) n from slogans group by item_key order by item_key');
  return rows.map((r) => ({ item: r.item, n: Number(r.n) }));
}

/** The slogans that apply to a post: item "all", plus every item whose name appears in the texts. */
export async function slogansFor(db: Db, texts: (string | null | undefined)[]): Promise<Slogan[]> {
  const hay = texts.filter((t): t is string => Boolean(t)).join(' | ').toLowerCase().replace(/\s+/g, ' ');
  const all = await listSlogans(db);
  // The item's own slogans first, the house ones ("all") after them.
  const own = all.filter((s) => s.item_key !== 'all' && s.item_key.length >= 3 && hay.includes(s.item_key));
  return [...own, ...all.filter((s) => s.item_key === 'all')];
}
