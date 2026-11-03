/**
 * The planning documents that are not posts: the strategic direction, the 12-week roadmap and the hook, CTA, hashtag
 * and caption-template libraries. Each sheet is kept whole in `reference_sheets`, replaced when it is loaded again,
 * shown on the Strategy page, and the parts that bear on one post reach the writer (planningBrief).
 */
import type { Db } from './db/pool.js';

/** The sheets kept this way; anything else in a workbook is reported as having no place yet. */
export const REFERENCE_SHEETS = [
  'Business Vision', 'Brand Positioning', 'Content Pillars', 'Annual Roadmap', '12-Week Roadmap', 'Working Rules',
  'Hooks Library', 'CTA Library', 'Hashtag Library', 'Benefit Caption Templates', 'Field Guide', 'Mocktail Candidates',
];

export interface ReferenceSheet {
  name: string;
  source: string | null;
  header: string[];
  rows: string[][];
}

export async function storeReference(db: Db, s: ReferenceSheet): Promise<void> {
  await db.query(
    `insert into reference_sheets (name, source, header, rows) values ($1, $2, $3, $4)
     on conflict (name) do update set source = excluded.source, header = excluded.header, rows = excluded.rows, loaded_at = now()`,
    [s.name, s.source, JSON.stringify(s.header), JSON.stringify(s.rows)]);
}

export async function listReference(db: Db): Promise<ReferenceSheet[]> {
  const { rows } = await db.query<ReferenceSheet>('select name, source, header, rows from reference_sheets');
  return rows.sort((a, b) => REFERENCE_SHEETS.indexOf(a.name) - REFERENCE_SHEETS.indexOf(b.name));
}

/** What the planning documents say that bears on a post in this series: its pillar, the positioning, the working rules and some of its hooks. Null before they are loaded. */
export async function planningBrief(db: Db, series: string): Promise<string | null> {
  const sheets = new Map((await listReference(db)).map((s) => [s.name, s]));
  const column = (s: ReferenceSheet, name: string) => s.header.findIndex((h) => h.trim().toLowerCase() === name);
  const parts: string[] = [];

  const pillars = sheets.get('Content Pillars');
  if (pillars) {
    const iPillar = column(pillars, 'pillar');
    const iPurpose = column(pillars, 'purpose');
    const iMessage = column(pillars, 'customer message');
    const row = pillars.rows.find((r) => r[iPillar]?.trim().toUpperCase() === series.trim().toUpperCase());
    if (row) parts.push(`This series, ${series}: ${row[iPurpose] ?? ''} Customer message: ${row[iMessage] ?? ''}`.trim());
  }
  const positioning = sheets.get('Brand Positioning');
  if (positioning) {
    const iArea = column(positioning, 'area');
    const iMessage = column(positioning, 'message');
    const lines = positioning.rows.filter((r) => r[iArea] && r[iMessage]).map((r) => `- ${r[iArea]}: ${r[iMessage]}`);
    if (lines.length) parts.push(`Brand positioning:\n${lines.join('\n')}`);
  }
  const rules = sheets.get('Working Rules');
  if (rules) {
    const lines = rules.rows.filter((r) => r[0] && r[1] && !/^(status|source record)$/i.test(r[0].trim())).map((r) => `- ${r[0]}: ${r[1]}`);
    if (lines.length) parts.push(`Working rules that always hold:\n${lines.join('\n')}`);
  }
  const hooks = sheets.get('Hooks Library');
  if (hooks) {
    const iSeries = column(hooks, 'series');
    const iHook = column(hooks, 'hook');
    const lines = hooks.rows.filter((r) => r[iSeries]?.trim().toUpperCase() === series.trim().toUpperCase()).slice(0, 8).map((r) => `- ${r[iHook]}`);
    if (lines.length) parts.push(`Hooks the owner keeps for this series (a variant may build on one):\n${lines.join('\n')}`);
  }
  const tags = sheets.get('Hashtag Library');
  if (tags) {
    const iGroup = column(tags, 'tag group');
    const iPlatform = column(tags, 'platform');
    const iTags = column(tags, 'hashtags');
    const lines = tags.rows.filter((r) => [series.trim().toUpperCase(), 'CORE BRAND'].includes(r[iGroup]?.trim().toUpperCase() ?? '')).map((r) => `- ${r[iGroup]}, ${r[iPlatform]}: ${r[iTags]}`);
    if (lines.length) parts.push(`Hashtags for a post that has none of its own:\n${lines.join('\n')}`);
  }
  return parts.length ? `Planning documents.\n${parts.join('\n')}` : null;
}
