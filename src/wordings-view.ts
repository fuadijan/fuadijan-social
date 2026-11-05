/**
 * Everything the Wordings tab shows, in one list: the wording bank, the wording of every post in the plan and the
 * libraries from the planning documents, each with what it belongs to. A post appears under every dish it names; a
 * post with no dish, under its benefit or series. A bank wording appears under every item it is linked to, which is also
 * how a change to it reaches them all, and lists the posts it is offered on.
 */
import { platformVersions, type PlatformVersions } from './calendar/record.js';
import { allRows, rowTitle, seriesLabel, type CalendarRow } from './calendar/rows.js';
import { listBenefits } from './benefits.js';
import type { Db } from './db/pool.js';
import type { ResolvedCopy } from './brain/schemas.js';
import { allCopyOptions, type CopyOptions } from './pipeline/wording.js';
import { listProducts } from './products.js';
import { listReference } from './reference.js';
import { itemKey, listSlogans, unlinkedSlogans, type Slogan } from './slogans.js';

export interface PostWording {
  dayNo: number;
  date: string;
  status: CalendarRow['status'];
  slot: CalendarRow['slot'];
  title: string;
  series: string;
  headline: string;
  line: string;
  caption: string;
  cta: string;
  hashtags: string;
  platforms: PlatformVersions | null;
  /** The post's latest wordings to pick from, once they are written or the owner has added one. */
  set: { id: number; options: CopyOptions['options']; chosen: number | null; createdAt: Date } | null;
  waiting: boolean;
}

export interface BankWording {
  id: number;
  item: string;
  itemKey: string;
  headline: string;
  line: string | null;
  caption: string | null;
  source: string;
  /** Every item this wording is linked to. */
  items: { item: string; itemKey: string }[];
}

export interface WordingGroup {
  item: string;
  itemKey: string;
  /** Roster details, when the item is a product. */
  category: string | null;
  wordings: BankWording[];
  posts: PostWording[];
  /** Every post the group's wordings reach, for the "used on" line. */
  usedOn: { dayNo: number; date: string; status: CalendarRow['status'] }[];
}


/** The dishes a post names, without a bracket left to settle. */
export function postItems(row: Pick<CalendarRow, 'dish' | 'benefit' | 'template' | 'theme' | 'type'>): string[] {
  const dishes = (row.dish ?? '').split(/[,+]/).map((d) => d.trim()).filter((d) => d && !d.includes('['));
  return dishes.length ? dishes : [row.benefit?.trim() || seriesLabel(row)];
}

const UNLINKED = 'Not linked to anything yet';

/** Sorts posts and bank wordings into their items: "every post" first, then by name. */
export function groupWordings(posts: { row: CalendarRow; wording: PostWording }[], bank: Slogan[], categories: Map<string, string | null> = new Map()): WordingGroup[] {
  const groups = new Map<string, WordingGroup>();
  const group = (item: string, key = itemKey(item)) => {
    const have = groups.get(key);
    if (have) return have;
    const made: WordingGroup = { item: key === 'all' ? 'Every post' : item, itemKey: key, category: categories.get(key) ?? null, wordings: [], posts: [], usedOn: [] };
    groups.set(key, made);
    return made;
  };
  const links = new Map<number, BankWording['items']>();
  for (const s of bank) if (s.item_key) links.set(s.id, [...(links.get(s.id) ?? []), { item: s.item === 'all' ? 'Every post' : s.item, itemKey: s.item_key }]);
  for (const s of bank) group(s.item_key ? s.item : UNLINKED, s.item_key).wordings.push({ id: s.id, item: s.item, itemKey: s.item_key, headline: s.headline, line: s.line, caption: s.caption, source: s.source, items: links.get(s.id) ?? [] });
  for (const p of posts) for (const item of postItems(p.row)) group(item).posts.push(p.wording);
  for (const g of groups.values()) {
    const reached = g.itemKey === 'all' ? posts
      : posts.filter((p) => g.posts.includes(p.wording) || (g.wordings.length > 0 && g.itemKey !== '' && g.itemKey.length >= 3 && `${p.row.dish ?? ''} | ${p.row.theme ?? ''}`.toLowerCase().includes(g.itemKey)));
    g.usedOn = reached.map((p) => ({ dayNo: p.row.day_no, date: p.row.date, status: p.row.status }));
  }
  const rank = (g: WordingGroup) => (g.itemKey === 'all' ? 0 : g.itemKey === '' ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
}

/** The libraries that hold wordings, and the column that says what each row belongs to. */
const LIBRARIES = [
  { name: 'Hooks Library', title: 'Hooks', groupBy: 'Series' },
  { name: 'CTA Library', title: 'Calls to action', groupBy: 'Goal' },
  { name: 'Hashtag Library', title: 'Hashtags', groupBy: 'Tag Group' },
  { name: 'Benefit Caption Templates', title: 'Benefit captions', groupBy: 'BenefitID' },
] as const;
export const WORDING_LIBRARIES: readonly string[] = LIBRARIES.map((l) => l.name);

export interface WordingLibrary {
  name: string;
  title: string;
  header: string[];
  rows: string[][];
  groupColumn: number;
  /** What a group's value stands for: the products in a series, a benefit's name. */
  belongsTo: Record<string, string>;
}

async function libraries(db: Db): Promise<WordingLibrary[]> {
  const sheets = new Map((await listReference(db)).map((s) => [s.name, s]));
  const products = (await listProducts(db)).filter((p) => p.status !== 'retired');
  const inSeries: Record<string, string> = {};
  for (const p of products) {
    if (!p.series) continue;
    const key = p.series.trim().toUpperCase();
    inSeries[key] = inSeries[key] ? `${inSeries[key]}, ${p.name}` : p.name;
  }
  const benefits: Record<string, string> = {};
  for (const b of await listBenefits(db)) benefits[b.key.toUpperCase()] = b.benefit;
  return LIBRARIES.flatMap((l) => {
    const s = sheets.get(l.name);
    if (!s) return [];
    return [{ name: l.name, title: l.title, header: s.header, rows: s.rows, groupColumn: s.header.findIndex((h) => h.trim().toLowerCase() === l.groupBy.toLowerCase()), belongsTo: l.name === 'Benefit Caption Templates' ? benefits : inSeries }];
  });
}

export async function wordingsView(db: Db): Promise<{ groups: WordingGroup[]; libraries: WordingLibrary[] }> {
  const rows = await allRows(db);
  const ids = rows.map((r) => r.id);
  const packs = new Map((await db.query<{ calendar_row_id: number; caption: string; cta: string | null; hashtags: string[]; platforms: PlatformVersions | null }>(
    'select distinct on (calendar_row_id) calendar_row_id, caption, cta, hashtags, platforms from packs where calendar_row_id = any($1) order by calendar_row_id, created_at desc, id desc', [ids])).rows.map((p) => [p.calendar_row_id, p]));
  const copies = new Map((await db.query<{ calendar_row_id: number; copy: ResolvedCopy }>(
    "select distinct on (calendar_row_id) calendar_row_id, state->'copy' copy from jobs where calendar_row_id = any($1) and state ? 'copy' order by calendar_row_id, id desc", [ids])).rows.map((j) => [j.calendar_row_id, j.copy]));
  const waiting = new Set((await db.query<{ row_id: number }>("select distinct row_id from questions where answered_at is null and field = 'wording' and row_id = any($1)", [ids])).rows.map((q) => q.row_id));
  const posts = await Promise.all(rows.map(async (row) => {
    const pack = packs.get(row.id);
    const copy = copies.get(row.id);
    const latest = (await allCopyOptions(db, row.id))[0] ?? null;
    const wording: PostWording = {
      dayNo: row.day_no, date: row.date, status: row.status, slot: row.slot, title: rowTitle(row), series: seriesLabel(row),
      headline: copy?.headline ?? row.content?.canva_headline ?? '',
      line: copy?.line ?? row.content?.hook ?? '',
      caption: pack?.caption ?? row.caption ?? '',
      cta: pack?.cta ?? row.cta ?? '',
      hashtags: pack?.hashtags.join(' ') ?? row.hashtags ?? '',
      platforms: pack?.platforms ?? (row.content ? platformVersions(row, null) : null),
      set: latest && { id: latest.id, options: latest.options, chosen: latest.chosen, createdAt: latest.created_at },
      waiting: waiting.has(row.id),
    };
    return { row, wording };
  }));
  const categories = new Map((await listProducts(db)).map((p) => [p.name_key, p.category]));
  return { groups: groupWordings(posts, [...await listSlogans(db), ...await unlinkedSlogans(db)], categories), libraries: await libraries(db) };
}
