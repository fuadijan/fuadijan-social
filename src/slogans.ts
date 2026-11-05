/**
 * The slogan bank: wordings the owner keeps. A slogan is a headline (two short lines, or one), with an optional
 * supporting line and caption, linked to any number of items (slogan_items), so changing it once changes it for all of
 * them. Item "all" applies to every post. Otherwise an item is a product or a group of them (a category or a series),
 * and a slogan is offered on a post only when the item's whole name is in what the post is about, or names the group of a
 * product it is about: linked to BBQ, it reaches the BBQ products and never a Karahi. Loaded from the Slogans sheet
 * (calendar/slogans.ts), added with /slogan, or edited and linked on the Captions tab.
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

/** Whether a link's name is in the words, as whole words: "tea" is not in "steak". A plural counts. */
export function linkReaches(key: string, about: string): boolean {
  if (key.length < 3) return false;
  const name = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${name}s?($|[^a-z0-9])`).test(about);
}

export interface ProductGroup { name_key: string; category: string | null; series: string | null }

/** Each product on the roster and the groups it is in. */
export async function productGroups(db: Db): Promise<ProductGroup[]> {
  return (await db.query<ProductGroup>("select name_key, category, series from products where status <> 'retired'")).rows;
}

/** What a post is about, for matching links: its words, then the category and series of each product they name. */
export function aboutPost(texts: (string | null | undefined)[], products: ProductGroup[]): string {
  const words = texts.filter((t): t is string => Boolean(t)).join(' | ').toLowerCase().replace(/\s+/g, ' ');
  const groups = products.filter((p) => linkReaches(p.name_key, words)).flatMap((p) => [p.category, p.series]).filter(Boolean);
  return [words, ...groups].join(' | ').toLowerCase();
}

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

/** The slogans that apply to a post: item "all", plus every item the post is about. A wording on several of them comes once. */
export async function slogansFor(db: Db, texts: (string | null | undefined)[]): Promise<Slogan[]> {
  const about = aboutPost(texts, await productGroups(db));
  const all = await listSlogans(db);
  // The item's own slogans first, the house ones ("all") after them.
  const own = all.filter((s) => s.item_key !== 'all' && linkReaches(s.item_key, about));
  const seen = new Set<number>();
  return [...own, ...all.filter((s) => s.item_key === 'all')].filter((s) => !seen.has(s.id) && Boolean(seen.add(s.id)));
}
