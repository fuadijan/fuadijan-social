/**
 * The campaign layout of a Calendar sheet: `Day | CampaignID | ProductID | BenefitID | Series | Format | Hook |
 * Caption | CTA | Hashtags | Status`, the operational calendar the owner's planning documents produce. It is
 * turned into the same rows the classic 18-column sheet gives (calendar.schema.ts), so everything downstream is
 * one path: the series picks the template, the format picks the slot, the hook becomes the theme the writer
 * reads, the ids are resolved against the Campaigns, Products and Benefits tables when the rows are seeded.
 * Dates come from a `Date` column when there is one, else from the first day the owner gives when loading.
 */
import { addDays, type IsoDate } from '../src/time.js';
import { templateForSeries } from '../src/render/registry.js';
import { cellDate, cellText, cellTime, headerIndex, type SheetRow } from './calendar.schema.js';
import type { Cell } from './xlsx.js';

export const CAMPAIGN_LAYOUT_COLUMNS = ['Day', 'CampaignID', 'ProductID', 'BenefitID', 'Series', 'Format', 'Hook', 'Caption', 'CTA', 'Hashtags', 'Status'] as const;

/** True when the header is the campaign layout rather than the classic one (which starts with `date`). */
export function isCampaignLayout(header: string[]): boolean {
  const col = headerIndex(header);
  return col('Date') !== 0 && col('Day', 'Day No', 'DayNo', '#') >= 0 && (col('CampaignID', 'Campaign') >= 0 || col('ProductID', 'Product') >= 0 || col('Series') >= 0 || col('Hook') >= 0);
}

const slotOf = (format: string | null): SheetRow['slot'] => {
  const f = (format ?? '').trim().toLowerCase();
  if (/^r|reel/.test(f)) return 'reel';
  if (/^c|carousel/.test(f)) return 'carousel';
  return 'feed';
};

const statusOf = (s: string | null): SheetRow['status'] => {
  const k = (s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!k || k === 'planned' || k === 'draft' || k === 'scheduled') return 'planned';
  if (k === 'photo-needed' || k === 'needs-photo') return 'photo-needed';
  if (k === 'ready' || k === 'done') return 'ready';
  if (k === 'posted' || k === 'published') return 'posted';
  throw new Error(`status "${s}" is not one of planned, photo-needed, ready, posted`);
};

export interface LayoutOptions {
  /** The date of Day 1 when the sheet has no Date column. */
  start?: IsoDate | null;
}

/**
 * The sheet's data rows as SheetRow inputs (before cleanRow's validation), in day order. Throws, naming the sheet
 * row, on a day that is missing or repeated, a series that is not one of the labels, or a date it cannot work out.
 */
export function campaignLayoutRows(sheet: Cell[][], opts: LayoutOptions = {}): Record<string, unknown>[] {
  const header = (sheet[0] ?? []).map((v) => String(v ?? '').trim());
  const col = headerIndex(header);
  const iDay = col('Day', 'Day No', 'DayNo', '#');
  const iDate = col('Date');
  if (iDate < 0 && !opts.start) throw new Error('The Calendar has no Date column: give the first day (the date of Day 1) when loading it, or add a Date column.');
  const at = (r: Cell[], ...names: string[]) => {
    const i = col(...names);
    return i >= 0 ? cellText(r[i]) : null;
  };
  const out: Record<string, unknown>[] = [];
  const days = new Set<number>();
  sheet.slice(1).forEach((r, i) => {
    if (!r.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) return;
    const where = `Calendar row ${i + 2}`;
    const dayText = cellText(r[iDay]);
    const day = Number(dayText);
    if (!dayText || !Number.isInteger(day) || day < 1) throw new Error(`${where}: Day "${dayText ?? ''}" is not a day number.`);
    if (days.has(day)) throw new Error(`${where}: Day ${day} appears twice.`);
    days.add(day);
    const date = iDate >= 0 ? cellDate(r[iDate]) : addDays(opts.start!, day - 1);
    if (!date) throw new Error(`${where} (Day ${day}): the Date cell is not a date.`);
    const series = at(r, 'Series');
    const product = at(r, 'ProductID', 'Product', 'Dish');
    const benefit = at(r, 'BenefitID', 'Benefit');
    let template: string | null = null;
    if (series) {
      template = templateForSeries(series);
      if (!template) throw new Error(`${where} (Day ${day}): series "${series}" is not one on the Templates sheet.`);
    }
    if (!template) template = benefit && !product ? 'for-our-customers' : 'from-the-fire';
    let status: SheetRow['status'];
    try {
      status = statusOf(at(r, 'Status'));
    } catch (e) {
      throw new Error(`${where} (Day ${day}): ${e instanceof Error ? e.message : String(e)}`);
    }
    const hook = at(r, 'Hook');
    const timeCol = col('Time', 'Post Time', 'PostTime');
    out.push({
      day,
      date,
      slot: slotOf(at(r, 'Format', 'Slot')),
      type: at(r, 'Type') ?? (benefit && !product ? 'benefit' : product ? 'hero-dish' : 'community'),
      dish: product,
      theme: hook,
      caption_hint: null,
      post_time: timeCol >= 0 ? cellTime(r[timeCol]) : null,
      template,
      status,
      asset: null,
      objective: at(r, 'Objective'),
      creative_instructions: at(r, 'Creative Instructions', 'Instructions', 'Brief'),
      on_screen_text: at(r, 'On Screen Text', 'OnScreenText'),
      caption: at(r, 'Caption'),
      cta: at(r, 'CTA'),
      hashtags: at(r, 'Hashtags'),
      story_ideas: at(r, 'Story Ideas', 'Stories', 'Story'),
      confirmation_notes: at(r, 'Confirmation Notes', 'Notes'),
      campaign: at(r, 'CampaignID', 'Campaign'),
      benefit,
    });
  });
  out.sort((a, b) => (a.day as number) - (b.day as number));
  return out;
}
