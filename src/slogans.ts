/**
 * The slogan bank: wordings the owner keeps. A slogan is a headline (two short lines, or one), with an optional
 * supporting line and caption, linked to any number of items (slogan_items), so changing it once changes it for all of
 * them. Item "all" applies to every post; otherwise a slogan is offered when the item's name appears in the row's dish,
 * the caption subject, Claude's dish read or the series label, the same loose match dish facts use. Loaded from the
 * Slogans sheet (calendar/slogans.ts), added with /slogan, or edited and linked on the Wordings tab.
 */
import type { Db } from './db/pool.js';

/** A wording as one of its items sees it: the lists below give one of these per link. */
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

const LINKED = `select s.id, i.item, i.item_key, s.headline, s.line, s.caption, s.source from slogan_items i join slogans s on s.id = i.slogan_id where s.retired_at is null`;

/** Links a wording to an item; a link it already has stays as it is. */
export async function linkSlogan(db: Db, id: number, item: string): Promise<boolean> {
  const name = item.trim();
  if (!name) return false;
  const known = (await db.query('select 1 from slogans where id = $1 and retired_at is null', [id])).rowCount ?? 0;
  if (!known) return false;
  await db.query('insert into slogan_items (slogan_id, item, item_key) values ($1, $2, $3) on conflict (slogan_id, item_key) do nothing', [id, name, itemKey(name)]);
  return true;
}

/** Takes a wording off one item. With no item left it is kept, listed as not linked to anything. */
export async function unlinkSlogan(db: Db, id: number, key: string): Promise<boolean> {
  return ((await db.query('delete from slogan_items where slogan_id = $1 and item_key = $2', [id, itemKey(key)])).rowCount ?? 0) > 0;
}

export async function addSlogan(db: Db, s: { item: string; headline: string; line?: string | null; caption?: string | null; source?: string }): Promise<Slogan> {
  const { rows } = await db.query<Slogan>(
    `insert into slogans (item, item_key, headline, line, caption, source) values ($1, $2, $3, $4, $5, $6)
     on conflict (item_key, headline) do update set retired_at = null, item = excluded.item, line = coalesce(excluded.line, slogans.line), caption = coalesce(excluded.caption, slogans.caption), source = excluded.source
     returning *`,
    [s.item.trim(), itemKey(s.item), s.headline.trim(), s.line?.trim() || null, s.caption?.trim() || null, s.source ?? 'owner']);
  await linkSlogan(db, rows[0]!.id, s.item);
  return rows[0]!;
}

/** Changes one wording's text in place, for every item it is linked to; null when there is no such wording. */
export async function updateSlogan(db: Db, id: number, s: { headline: string; line?: string | null; caption?: string | null }): Promise<Slogan | null> {
  try {
    const { rows } = await db.query<Slogan>(
      'update slogans set headline = $2, line = $3, caption = $4 where id = $1 returning *',
      [id, s.headline.trim(), s.line?.trim() || null, s.caption?.trim() || null]);
    return rows[0] ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new Error('This product already has a wording with that headline.');
    throw e;
  }
}

export async function sloganById(db: Db, id: number): Promise<Slogan | null> {
  return (await db.query<Slogan>('select * from slogans where id = $1', [id])).rows[0] ?? null;
}

export async function removeSlogan(db: Db, id: number): Promise<boolean> {
  return ((await db.query('delete from slogans where id = $1', [id])).rowCount ?? 0) > 0;
}

/** /slogan <item> -- remove n: takes it off that item, and forgets it once no item has it. */
export async function forgetSloganFor(db: Db, id: number, item: string): Promise<boolean> {
  if (!await unlinkSlogan(db, id, item)) return false;
  await db.query('delete from slogans where id = $1 and not exists (select 1 from slogan_items where slogan_id = $1)', [id]);
  return true;
}

/** Every link, or those of one item, in the order the wordings were added. A wording on two items appears twice. */
export async function listSlogans(db: Db, item?: string | null): Promise<Slogan[]> {
  const { rows } = item
    ? await db.query<Slogan>(`${LINKED} and i.item_key = $1 order by s.id`, [itemKey(item)])
    : await db.query<Slogan>(`${LINKED} order by i.item_key, s.id`);
  return rows;
}

/** Wordings taken off their last item, kept until they are linked again or forgotten. */
export async function unlinkedSlogans(db: Db): Promise<Slogan[]> {
  const { rows } = await db.query<Slogan>(`select s.id, '' as item, '' as item_key, s.headline, s.line, s.caption, s.source from slogans s where s.retired_at is null and not exists (select 1 from slogan_items i where i.slogan_id = s.id) order by s.id`);
  return rows;
}

/** Distinct items with a count, for the list view. */
export async function slogansByItem(db: Db): Promise<{ item: string; n: number }[]> {
  const { rows } = await db.query<{ item: string; n: string }>('select min(i.item) item, count(*) n from slogan_items i join slogans s on s.id = i.slogan_id where s.retired_at is null group by i.item_key order by i.item_key');
  return rows.map((r) => ({ item: r.item, n: Number(r.n) }));
}

/** The slogans that apply to a post: item "all", plus every item whose name appears in the texts. A wording on several of them comes once. */
export async function slogansFor(db: Db, texts: (string | null | undefined)[]): Promise<Slogan[]> {
  const hay = texts.filter((t): t is string => Boolean(t)).join(' | ').toLowerCase().replace(/\s+/g, ' ');
  const all = await listSlogans(db);
  // The item's own slogans first, the house ones ("all") after them.
  const own = all.filter((s) => s.item_key !== 'all' && s.item_key.length >= 3 && hay.includes(s.item_key));
  const seen = new Set<number>();
  return [...own, ...all.filter((s) => s.item_key === 'all')].filter((s) => !seen.has(s.id) && Boolean(seen.add(s.id)));
}
