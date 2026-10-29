/**
 * Sydney dates without a date library: the calendar is a list of Sydney calendar days, schedules are Sydney
 * wall-clock times, and everything stored is UTC. Intl does the zone arithmetic.
 */
import { TZ } from './config.js';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' });
const longFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

export type IsoDate = string; // YYYY-MM-DD

export function sydneyDate(now: Date = new Date()): IsoDate {
  return dateFmt.format(now);
}

/** "HH:MM" in Sydney. */
export function sydneyTime(now: Date = new Date()): string {
  return timeFmt.format(now).replace(/^24/, '00');
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Calendar arithmetic on the date part only (UTC noon, so DST never shifts the day). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** "Tue 3 Nov" */
export function formatDay(date: IsoDate): string {
  return longFmt.format(new Date(`${date}T12:00:00Z`)).replace(/,/g, '');
}

/** "Tue" */
export function weekday(date: IsoDate): string {
  return weekdayFmt.format(new Date(`${date}T12:00:00Z`)).replace(/\.$/, '');
}

/** 0 = Sunday … 6 = Saturday, for the Sydney date. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "Wed 4 Nov, 18:00" */
export function formatDayTime(date: IsoDate, time: string): string {
  return `${formatDay(date)}, ${time.slice(0, 5)}`;
}
