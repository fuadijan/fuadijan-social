/** The week's lines, shared by the morning brief, /today, /week and the web app's Week screen. */
import type { AppContext } from '../context.js';
import { placeholders, rowsBetween, type CalendarRow } from '../calendar/rows.js';
import { needsDish, suggestDish } from '../calendar/suggest.js';
import { briefLine, describeNeeds, type Needs } from '../messaging/formats.js';
import { openQuestionCounts } from '../pipeline/questions.js';
import type { IsoDate } from '../time.js';

export interface RowReceived { photos: number; clips: number }

export async function receivedByRow(ctx: AppContext): Promise<Map<number, RowReceived>> {
  const { rows } = await ctx.pool.query<{ calendar_row_id: number; photos: string; clips: string }>(
    "select calendar_row_id, count(*) filter (where kind in ('photo','document')) photos, count(*) filter (where kind = 'video') clips from assets where calendar_row_id is not null group by calendar_row_id");
  return new Map(rows.map((r) => [r.calendar_row_id, { photos: Number(r.photos), clips: Number(r.clips) }]));
}

export interface RowView {
  row: CalendarRow;
  needs: Needs;
  received: RowReceived;
  openQuestions: number;
  suggestion: string | null;
  placeholders: string[];
}

export async function rowViews(ctx: AppContext, rows: CalendarRow[]): Promise<RowView[]> {
  const received = await receivedByRow(ctx);
  const open = await openQuestionCounts(ctx.pool);
  let menu: Awaited<ReturnType<typeof ctx.menu.get>> | null = null;
  try {
    menu = await ctx.menu.get();
  } catch {
    menu = null;
  }
  return rows.map((row) => {
    const rec = received.get(row.id) ?? { photos: 0, clips: 0 };
    const ph = placeholders(row);
    const needs = describeNeeds(row, rec, open.get(row.id) ?? 0, ph.length);
    const suggestion = needsDish(row) && menu ? suggestDish(row, menu) : null;
    return { row, needs, received: rec, openQuestions: open.get(row.id) ?? 0, suggestion, placeholders: ph };
  });
}

export async function weekLines(ctx: AppContext, from: IsoDate, to: IsoDate): Promise<string[]> {
  const views = await rowViews(ctx, await rowsBetween(ctx.pool, from, to));
  return views.map((v) => briefLine(v.row, v.needs, v.suggestion));
}
