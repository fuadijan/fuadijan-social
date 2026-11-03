/**
 * Campaigns: a launch, a countdown or a seasonal push with dates, a status, a series and the calendar rows under
 * it. The Campaigns sheet of a month's workbook fills the table (calendar/campaigns.ts); a calendar row names its
 * campaign by id (CAMP001) or by name in the sheet's `campaign` column. Progress is read off the rows: how many
 * posts the campaign has, how many are made (ready or posted) and how many are posted.
 */
import type { Db } from './db/pool.js';
import type { IsoDate } from './time.js';

export const CAMPAIGN_STATUSES = ['planned', 'active', 'done'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const PRIORITIES = ['high', 'medium', 'low'] as const;

export interface Campaign {
  id: number;
  key: string;
  name: string;
  category: string | null;
  /** What the campaign is for, in the owner's words ("Food quality perception"). */
  objective: string | null;
  series: string | null;
  template: string | null;
  start_date: IsoDate | null;
  end_date: IsoDate | null;
  status: CampaignStatus;
  priority: string | null;
}

export interface CampaignProgress extends Campaign {
  posts: number;
  made: number;
  posted: number;
  /** The date of the next post not yet posted, if any. */
  next: IsoDate | null;
}

/** The sheet's CampaignID as the table keys it: trimmed, lower-cased ("CAMP001" → "camp001"). */
export const campaignKey = (id: string) => id.trim().toLowerCase().replace(/\s+/g, ' ');

const COLS = "id, key, name, category, objective, series, template, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, status, priority";

export interface CampaignInput {
  key: string;
  name: string;
  category?: string | null;
  objective?: string | null;
  series?: string | null;
  template?: string | null;
  start_date?: IsoDate | null;
  end_date?: IsoDate | null;
  status?: CampaignStatus;
  priority?: string | null;
}

/** Insert or update by key: the sheet is the owner's record of a campaign, so what it says wins. */
export async function upsertCampaign(db: Db, c: CampaignInput): Promise<Campaign> {
  const { rows } = await db.query<Campaign>(
    `insert into campaigns (key, name, category, objective, series, template, start_date, end_date, status, priority)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (key) do update set name = excluded.name, category = excluded.category, objective = excluded.objective, series = excluded.series, template = excluded.template,
       start_date = excluded.start_date, end_date = excluded.end_date, status = excluded.status, priority = excluded.priority, updated_at = now()
     returning ${COLS}`,
    [campaignKey(c.key), c.name.trim(), c.category ?? null, c.objective ?? null, c.series ?? null, c.template ?? null, c.start_date ?? null, c.end_date ?? null, c.status ?? 'planned', c.priority ?? null]);
  return rows[0]!;
}

export async function listCampaigns(db: Db): Promise<Campaign[]> {
  return (await db.query<Campaign>(`select ${COLS} from campaigns order by start_date nulls last, name`)).rows;
}

/** A campaign by its id as the sheet writes it (CAMP001) or by its name, case-insensitively. */
export async function findCampaign(db: Db, ref: string): Promise<Campaign | null> {
  const k = campaignKey(ref);
  if (!k) return null;
  return (await db.query<Campaign>(`select ${COLS} from campaigns where key = $1 or lower(name) = $1 limit 1`, [k])).rows[0] ?? null;
}

export async function campaignById(db: Db, id: number): Promise<Campaign | null> {
  return (await db.query<Campaign>(`select ${COLS} from campaigns where id = $1`, [id])).rows[0] ?? null;
}

/** Every campaign with how far its posts have got. */
export async function campaignProgress(db: Db): Promise<CampaignProgress[]> {
  return (await db.query<CampaignProgress>(
    `select ${COLS},
       (select count(*) from calendar_rows r where r.campaign_id = campaigns.id)::int as posts,
       (select count(*) from calendar_rows r where r.campaign_id = campaigns.id and r.status in ('ready', 'posted'))::int as made,
       (select count(*) from calendar_rows r where r.campaign_id = campaigns.id and r.status = 'posted')::int as posted,
       (select to_char(min(r.date), 'YYYY-MM-DD') from calendar_rows r where r.campaign_id = campaigns.id and r.status <> 'posted') as next
     from campaigns order by start_date nulls last, name`)).rows;
}

/** The campaigns rows point at, by row id, for a list of rows. */
export async function campaignsOfRows(db: Db, campaignIds: (number | null)[]): Promise<Map<number, Campaign>> {
  const ids = [...new Set(campaignIds.filter((x): x is number => x != null))];
  const out = new Map<number, Campaign>();
  if (!ids.length) return out;
  for (const c of (await db.query<Campaign>(`select ${COLS} from campaigns where id = any($1::int[])`, [ids])).rows) out.set(c.id, c);
  return out;
}
