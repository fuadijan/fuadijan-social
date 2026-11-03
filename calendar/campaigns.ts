/**
 * The Campaigns sheet of a month's workbook: `CampaignID | Campaign Name | Category | Objective | Series |
 * Start Date | End Date | Status | Priority`, one campaign per row (only the id and the name are required;
 * "CampaignName" and "Campaign Name" are the same column). Several campaigns run at once; each calendar row names
 * its own in the `campaign` column (the id or the name). The sheet is read whole and checked before anything is
 * written; the same CampaignID is updated, never duplicated.
 */
import type pg from 'pg';
import { CAMPAIGN_STATUSES, campaignKey, upsertCampaign, type CampaignInput, type CampaignStatus } from '../src/campaigns.js';
import { templateEntry, templateForSeries } from '../src/render/registry.js';
import { cellDate, cellText, headerIndex } from './calendar.schema.js';
import { readSheetRows, sourceName, type WorkbookSource } from './xlsx.js';

export const CAMPAIGN_COLUMNS = ['CampaignID', 'Campaign Name', 'Category', 'Objective', 'Success Metric', 'Series', 'Start Date', 'End Date', 'Status', 'Priority'] as const;

export type CampaignRow = Required<Pick<CampaignInput, 'key' | 'name' | 'category' | 'objective' | 'success_metric' | 'series' | 'template' | 'start_date' | 'end_date' | 'status' | 'priority'>>;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, ' ');

export function campaignStatus(s: string | null): CampaignStatus {
  const k = norm(s ?? '').replace(/\s+/g, '-');
  if (!k || k === 'planned' || k === 'pre-launch' || k === 'ready-to-launch' || k === 'upcoming') return 'planned';
  if (k === 'active' || k === 'running' || k === 'live') return 'active';
  if (k === 'done' || k === 'finished' || k === 'complete' || k === 'completed' || k === 'ended') return 'done';
  throw new Error(`status "${s}" is not one of ${CAMPAIGN_STATUSES.join(', ')}`);
}

/** The sheet's campaigns; [] when the sheet is missing; throws, naming the row, on anything wrong. */
export async function readCampaignsSheet(source: WorkbookSource, sheetName = 'Campaigns'): Promise<CampaignRow[]> {
  let rows;
  try {
    rows = await readSheetRows(source, sheetName);
  } catch (e) {
    if (e instanceof Error && /not found/.test(e.message)) return [];
    throw e;
  }
  const col = headerIndex(rows[0] ?? []);
  const need = [['CampaignID', 'ID'], ['Campaign Name', 'Name', 'Campaign']].filter((names) => col(...names) < 0).map((n) => n[0]!);
  if (need.length) throw new Error(`${sourceName(source)} sheet "${sheetName}": the header needs the columns ${CAMPAIGN_COLUMNS.join(' | ')}; missing ${need.join(', ')}.`);
  const at = (r: unknown[], ...names: string[]) => (col(...names) >= 0 ? cellText(r[col(...names)]) : null);
  const out: CampaignRow[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const key = at(r, 'CampaignID', 'ID');
    const name = at(r, 'Campaign Name', 'Name', 'Campaign');
    if (!key && !name) return;
    const where = `${sheetName} row ${i + 2}`;
    if (!key || !name) throw new Error(`${where}: a campaign needs both a CampaignID and a Campaign Name.`);
    if (seen.has(campaignKey(key))) throw new Error(`${where}: CampaignID ${key} is used twice.`);
    seen.add(campaignKey(key));
    const series = at(r, 'Series');
    let template: string | null = null;
    if (series) {
      template = templateForSeries(series);
      if (!template) throw new Error(`${where}: series "${series}" is not one on the Templates sheet.`);
    }
    const start = at(r, 'Start Date');
    const end = at(r, 'End Date');
    const startDate = start ? cellDate(r[col('Start Date')]) : null;
    const endDate = end ? cellDate(r[col('End Date')]) : null;
    if (start && !startDate) throw new Error(`${where}: Start Date "${start}" is not a date.`);
    if (end && !endDate) throw new Error(`${where}: End Date "${end}" is not a date.`);
    if (startDate && endDate && endDate < startDate) throw new Error(`${where}: End Date is before Start Date.`);
    let status: CampaignStatus;
    try {
      status = campaignStatus(at(r, 'Status'));
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const priority = at(r, 'Priority');
    const p = priority ? ({ '1': 'high', '2': 'medium', '3': 'low' } as Record<string, string>)[norm(priority)] ?? norm(priority) : null;
    if (p && !['high', 'medium', 'low'].includes(p)) throw new Error(`${where}: Priority "${priority}" is not high, medium or low.`);
    out.push({ key: key.trim(), name: name.trim(), category: at(r, 'Category'), objective: at(r, 'Objective', 'Goal', 'Purpose'), success_metric: at(r, 'Success Metric', 'KPI'), series: template ? templateEntry(template).label : null, template, start_date: startDate, end_date: endDate, status, priority: p });
  });
  return out;
}

export async function seedCampaigns(pool: pg.Pool | { query: pg.Pool['query'] }, rows: CampaignRow[]): Promise<{ loaded: number }> {
  for (const r of rows) await upsertCampaign(pool, r);
  return { loaded: rows.length };
}
