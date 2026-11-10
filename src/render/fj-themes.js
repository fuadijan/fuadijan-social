// Fuadijan occasion themes: the one rule every app uses to decide which theme
// (Independence Day, Eid, Ramadan…) is on for a given day, and the colour roles
// a theme sets. Vendored by sync.py into the hub (which edits and serves them),
// Menu Screens (TV screens and the phone menu) and Social (the post renderer) —
// edit it HERE, not in an app's copy.
//
// Plain JavaScript with a .d.ts beside it, so the static Menu Screens page can
// load it as a browser module and the TypeScript apps can import it as is.

/**
 * The six colours a theme sets. Each app maps them onto its own palette:
 *
 *   role       social posts   TV screens / phone menu
 *   ground     Night          the TV background, the oxblood tile
 *   surface    Charcoal       the slate tile
 *   text       Cream          (text on the dark tiles stays white)
 *   muted      Sand           the stone tile
 *   highlight  Saffron        prices on dark tiles, the mustard tile, the price list
 *   action     Ember          red accents and prices, the terracotta tile
 */
export const THEME_ROLES = ["ground", "surface", "text", "muted", "highlight", "action"];

/** Where the hub serves every theme, public and cached. */
export const THEMES_URL = "https://apps.nutrimeals.au/api/public/themes";

const HEX = /^#[0-9a-f]{6}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Sydney as YYYY-MM-DD, whatever the device's own clock zone is. */
export function sydneyToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A theme as the feed carries it, or null when it is malformed; colours missing or not #rrggbb fail it. */
export function cleanTheme(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.key !== "string" || !t.key || typeof t.name !== "string") return null;
  if (!["auto", "on", "off"].includes(t.mode)) return null;
  if (!DAY.test(t.start ?? "") || !DAY.test(t.end ?? "")) return null;
  const colors = {};
  for (const role of THEME_ROLES) {
    const c = t.colors?.[role];
    if (typeof c !== "string" || !HEX.test(c)) return null;
    colors[role] = c.toUpperCase();
  }
  return { key: t.key, name: t.name, mode: t.mode, start: t.start, end: t.end, yearly: Boolean(t.yearly), colors, updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : "" };
}

/** Whether a dated theme covers this day; a yearly one by month and day, also across New Year (28 Dec – 2 Jan). */
export function covers(t, day) {
  if (!t.yearly) return t.start <= day && day <= t.end;
  const md = day.slice(5), from = t.start.slice(5), to = t.end.slice(5);
  return from <= to ? from <= md && md <= to : md >= from || md <= to;
}

/** How many days a theme's window spans, so the narrower of two overlapping themes wins (Eid inside Ramadan). */
function span(t) {
  const d = (s) => Date.UTC(2001, +s.slice(5, 7) - 1, +s.slice(8, 10));
  if (!t.yearly) return (Date.UTC(+t.end.slice(0, 4), +t.end.slice(5, 7) - 1, +t.end.slice(8, 10)) - Date.UTC(+t.start.slice(0, 4), +t.start.slice(5, 7) - 1, +t.start.slice(8, 10))) / 864e5;
  const n = (d(t.end) - d(t.start)) / 864e5;
  return n >= 0 ? n : n + 365;
}

/**
 * The theme on for a day (YYYY-MM-DD), or null for the everyday look.
 *
 * A theme switched ON by hand wins over everything (the most recently changed,
 * if two are). Otherwise the themes left on AUTO whose dates cover the day, the
 * narrowest window first, so Eid inside Ramadan shows Eid. OFF never shows.
 */
export function pickTheme(themes, day) {
  const list = (Array.isArray(themes) ? themes : []).map(cleanTheme).filter(Boolean);
  const newest = (a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0);
  const on = list.filter((t) => t.mode === "on").sort(newest);
  if (on.length) return on[0];
  const dated = list.filter((t) => t.mode === "auto" && covers(t, day)).sort((a, b) => span(a) - span(b) || newest(a, b));
  return dated[0] ?? null;
}

/** The feed's themes, or null when it can't be read (callers keep the everyday look, or the last good copy). */
export async function fetchThemes(url = THEMES_URL, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body?.themes) ? body.themes.map(cleanTheme).filter(Boolean) : null;
  } catch {
    return null;
  }
}
