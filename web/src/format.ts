/** Dates arrive as YYYY-MM-DD (Sydney calendar dates) and are shown as plain calendar dates, never shifted by the viewer's zone. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function parseIso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Tue 3 Nov" */
export function fmtDate(date: string): string {
  const d = parseIso(date);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "3 Nov" */
export function fmtDayMonth(date: string): string {
  const d = parseIso(date);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const weekdayShort = (date: string): string => WEEKDAYS[parseIso(date).getDay()] ?? '';

/** Post time as HH:MM; blank means the 18:00 default. */
export function fmtTime(time: string | null | undefined, fallback = '18:00'): string {
  if (!time) return fallback;
  return time.slice(0, 5);
}

/** The Monday that starts the ISO week this date falls in. */
export function mondayOf(date: string): string {
  const d = parseIso(date);
  const shift = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  d.setDate(d.getDate() - shift);
  return toIso(d);
}

export function addDays(date: string, n: number): string {
  const d = parseIso(date);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** "Mon 3 – Sun 9 Nov" */
export function fmtWeekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  const a = parseIso(monday);
  const b = parseIso(sunday);
  if (a.getMonth() === b.getMonth()) return `Mon ${a.getDate()} – Sun ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${fmtDate(monday)} – ${fmtDate(sunday)}`;
}

/** A timestamp from the API, shown as a short local date and time. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const SLOT_LABEL = { feed: 'Feed', carousel: 'Carousel', reel: 'Reel' } as const;
export const SLOT_ICON = { feed: '▢', carousel: '▤', reel: '▶' } as const;
export const STATUS_LABEL = { planned: 'Planned', 'photo-needed': 'Photo needed', ready: 'Ready', posted: 'Posted' } as const;

/** What the camera has to produce for a slot, in the owner's words. */
export function shotType(slot: 'feed' | 'carousel' | 'reel', type: string): string[] {
  const out: string[] = [slot === 'reel' ? 'clips' : slot === 'carousel' ? '2–3 close-ups' : 'hero photo'];
  if (/team|behind|customer/i.test(type)) out.push('people (consent)');
  return out;
}

/** The on-screen text, which the sheet writes as "line → line → line". */
export function splitArrows(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\s*→\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Lines of a free-text field, so it renders without dangerouslySetInnerHTML. */
export function paragraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The name a day goes by: dish, else theme, else the row type. */
export function subjectOf(d: { dish: string | null; theme: string | null; type: string }): string {
  return d.dish ?? d.theme ?? d.type;
}
