/**
 * How the owner names a day in a command: "/redo 101 …", "/redo #day 101 …", "/redo #day101 …", "/redo day 101 …"
 * all mean Day 101; "/redo Beef Seekh …" names it by its dish. The words that named the day are taken out, so
 * what is left is the note.
 */

export function parseDayRef(words: string[]): { dayNo: number | null; rest: string[] } {
  const text = words.join(' ').trim();
  // A bare number first, so a note that mentions "day 5" later does not win over a leading "101".
  const m = text.match(/^(\d{1,3})(?:\s|$)/) ?? text.match(/(?:^|\s)#?day\s*(\d{1,3})\b/i);
  if (!m || m.index === undefined) return { dayNo: null, rest: words };
  const remaining = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.trim();
  return { dayNo: Number(m[1]), rest: remaining ? remaining.split(/\s+/) : [] };
}

interface DishRow { dish: string | null; status: string; date: string; day_no: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * The row whose dish the words start with ("Beef Seekh shorter caption" → the Beef Seekh day, note "shorter
 * caption"). The longest dish wins; among rows with the same dish, one already started (not "planned") beats
 * a planned one, then the one nearest today, then the higher day number (a custom post over the plan's).
 */
export function rowByDishWords<T extends DishRow>(rows: T[], words: string[], today: string): { row: T; rest: string[] } | null {
  let best: { row: T; k: number; d: string } | null = null;
  const rank = (r: T) => [r.status === 'planned' ? 1 : 0, dayDiff(r.date, today), -r.day_no];
  const better = (a: T, b: T) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! < rb[i]!;
    return false;
  };
  for (const r of rows) {
    const d = norm(r.dish ?? '');
    if (!d) continue;
    const k = d.split(' ').length;
    if (words.length < k || norm(words.slice(0, k).join(' ')) !== d) continue;
    if (!best || d.length > best.d.length || (d.length === best.d.length && better(r, best.row))) best = { row: r, k, d };
  }
  return best ? { row: best.row, rest: words.slice(best.k) } : null;
}
