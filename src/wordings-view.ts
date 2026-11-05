/**
 * Everything the Captions tab shows: each wording first, and under it what uses it. A reusable caption lists the products
 * it is linked to and the posts that offer or use it; a post's own words list that post; a library row lists the posts
 * whose text matches it, since a post keeps only its words and not where they came from.
 */
import { platformVersions, type PlatformVersions } from './calendar/record.js';
import { allRows, rowTitle, seriesLabel, type CalendarRow } from './calendar/rows.js';
import { listBenefits } from './benefits.js';
import type { Db } from './db/pool.js';
import type { ResolvedCopy } from './brain/schemas.js';
import { allCopyOptions, asLine, type CopyOptions, type WordingOption } from './pipeline/wording.js';
import { listProducts } from './products.js';
import { listReference, type ReferenceSheet } from './reference.js';
import { listSlogans, unlinkedSlogans, type Slogan } from './slogans.js';

export interface PostRef { dayNo: number; date: string; status: CalendarRow['status']; inUse?: boolean }

export interface PostWording {
  dayNo: number;
  date: string;
  status: CalendarRow['status'];
  slot: CalendarRow['slot'];
  title: string;
  series: string;
  /** What the post is about: its dishes, or its benefit or series. */
  items: string[];
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

export interface ReusableWording {
  id: number;
  headline: string;
  line: string | null;
  caption: string | null;
  source: string;
  /** Every item it is linked to. */
  items: { item: string; itemKey: string }[];
  posts: PostRef[];
}

/** The dishes a post names, without a bracket left to settle; with none, its benefit or series. */
export function postItems(row: Pick<CalendarRow, 'dish' | 'benefit' | 'template' | 'theme' | 'type'>): string[] {
  const dishes = (row.dish ?? '').split(/[,+]/).map((d) => d.trim()).filter((d) => d && !d.includes('['));
  return dishes.length ? dishes : [row.benefit?.trim() || seriesLabel(row)];
}

const ref = (row: CalendarRow, inUse?: boolean): PostRef => ({ dayNo: row.day_no, date: row.date, status: row.status, ...(inUse ? { inUse } : {}) });

/** Whether a post's option came from this reusable caption; older options have no link and are matched by their words. */
function optionIsFrom(o: WordingOption, s: Pick<Slogan, 'id' | 'headline' | 'line'>): boolean {
  return o.sloganId === s.id || (o.sloganId === undefined && o.name.startsWith('Slogan ·') && o.line === asLine(s.headline, s.line));
}

/**
 * One entry per reusable caption, with the posts it reaches: those about a linked item and those holding it in their
 * list. A caption linked to every post lists only the posts using it; all of them would say nothing.
 */
export function reusableWordings(links: Slogan[], posts: { row: CalendarRow; wording: PostWording }[]): ReusableWording[] {
  const out = new Map<number, ReusableWording & { everyPost: boolean }>();
  for (const s of links) {
    const have = out.get(s.id) ?? { id: s.id, headline: s.headline, line: s.line, caption: s.caption, source: s.source, items: [], posts: [], everyPost: false };
    if (s.item_key) have.items.push({ item: s.item_key === 'all' ? 'Every post' : s.item, itemKey: s.item_key });
    if (s.item_key === 'all') have.everyPost = true;
    out.set(s.id, have);
  }
  return [...out.values()].map(({ everyPost, ...w }) => {
    const reached = posts.flatMap(({ row, wording }) => {
      const options = wording.set?.options ?? [];
      const chosen = wording.set?.chosen;
      const inUse = chosen != null && options[chosen] ? optionIsFrom(options[chosen]!, w) : false;
      const about = `${row.dish ?? ''} | ${row.theme ?? ''}`.toLowerCase();
      const linked = w.items.some((i) => i.itemKey !== 'all' && i.itemKey.length >= 3 && about.includes(i.itemKey));
      const offered = !everyPost && options.some((o) => optionIsFrom(o, w));
      return inUse || linked || offered ? [ref(row, inUse)] : [];
    });
    return { ...w, posts: reached };
  });
}

/** The libraries that hold wordings, and the column that says what each row belongs to. */
const LIBRARIES = [
  { name: 'Hooks Library', title: 'Hooks', groupBy: 'Series' },
  { name: 'CTA Library', title: 'Calls to action', groupBy: 'Goal' },
  { name: 'Hashtag Library', title: 'Hashtags', groupBy: 'Tag Group' },
  { name: 'Benefit Caption Templates', title: 'Benefit captions', groupBy: 'BenefitID' },
] as const;
export const WORDING_LIBRARIES: readonly string[] = LIBRARIES.map((l) => l.name);
const BENEFIT_CAPTIONS = 'Benefit Caption Templates';

export interface WordingLibrary {
  name: string;
  title: string;
  header: string[];
  rows: string[][];
  groupColumn: number;
  /** What a group's value stands for: the products in a series, a benefit's name. */
  belongsTo: Record<string, string>;
  /** The posts using each row, by its place in the library. */
  posts: Record<number, PostRef[]>;
}

const same = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
const tags = (s: string) => s.split(/\s+/).filter((t) => t.startsWith('#')).map((t) => t.toLowerCase());

/** The posts a library row is in: the same hook, CTA or caption, every one of its hashtags, or a post about its benefit. */
export function postsUsingRow(sheet: Pick<ReferenceSheet, 'header'> & { belongsTo?: Record<string, string>; groupColumn?: number }, row: string[], posts: { row: CalendarRow; wording: PostWording }[]): PostRef[] {
  const cell = (re: RegExp) => row[sheet.header.findIndex((h) => re.test(h.trim()))]?.trim() ?? '';
  const hook = same(cell(/^hook$/i));
  const cta = same(cell(/^cta$/i));
  const caption = same(cell(/caption/i));
  const wanted = tags(cell(/^hashtags$/i));
  const platform = cell(/^platform$/i).toLowerCase();
  const benefit = same(sheet.belongsTo?.[(row[sheet.groupColumn ?? -1] ?? '').trim().toUpperCase()]);
  return posts.filter(({ row: r, wording: w }) => {
    const p = w.platforms;
    if (hook && [w.line, r.content?.hook, p?.tiktok.hook].some((t) => same(t) === hook)) return true;
    if (cta && [w.cta, p?.facebook.cta, p?.tiktok.cta].some((t) => same(t) === cta)) return true;
    if (caption && same(w.caption) === caption) return true;
    if (benefit && same(r.benefit) === benefit) return true;
    if (!wanted.length) return false;
    const have = platform === 'facebook' ? p?.facebook.hashtags.join(' ') ?? '' : platform === 'tiktok' ? p?.tiktok.hashtags.join(' ') ?? '' : w.hashtags;
    const on = new Set(tags(have));
    return wanted.every((t) => on.has(t));
  }).map(({ row: r }) => ref(r));
}

async function libraries(db: Db, posts: { row: CalendarRow; wording: PostWording }[]): Promise<WordingLibrary[]> {
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
    const isBenefit = l.name === BENEFIT_CAPTIONS;
    const groupColumn = s.header.findIndex((h) => h.trim().toLowerCase() === l.groupBy.toLowerCase());
    const belongsTo = isBenefit ? benefits : inSeries;
    const using = Object.fromEntries(s.rows.map((row, i) => [i, postsUsingRow(isBenefit ? { header: s.header, belongsTo, groupColumn } : { header: s.header }, row, posts)]));
    return [{ name: l.name, title: l.title, header: s.header, rows: s.rows, groupColumn, belongsTo, posts: using }];
  });
}

export async function wordingsView(db: Db): Promise<{ reusable: ReusableWording[]; posts: PostWording[]; libraries: WordingLibrary[] }> {
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
      dayNo: row.day_no, date: row.date, status: row.status, slot: row.slot, title: rowTitle(row), series: seriesLabel(row), items: postItems(row),
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
  return {
    reusable: reusableWordings([...await listSlogans(db), ...await unlinkedSlogans(db)], posts),
    posts: posts.map((p) => p.wording),
    libraries: await libraries(db, posts),
  };
}
