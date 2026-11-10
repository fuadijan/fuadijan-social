/**
 * Occasion themes for the rendered posts: Independence Day in green and white, Eid, Ramadan. They are set on the
 * hub's Themes page (apps.nutrimeals.au/themes) and read from its public feed, the same feed the TV screens and the
 * phone menu read; ./fj-themes.js (vendored from fuadijan-brand) decides which one covers a day, so a post and the
 * screens never disagree. A post wears the theme of the day it goes up, not the day it was made.
 *
 * The feed is read at most every five minutes. When it can't be read, the last good list is used; with none,
 * posts keep the everyday kit — a failed fetch never stops a design. THEMES=0 turns themes off; THEMES_URL points
 * at another feed (a local hub).
 */
import type { Brand } from './brand.js';
import { THEMES_URL, fetchThemes, pickTheme, type FjTheme } from './fj-themes.js';

export type { FjTheme };

const REFRESH_MS = 5 * 60_000;
let list: FjTheme[] | null = null;
let readAt = 0;

/** The theme covering a post's date (YYYY-MM-DD), or null for the everyday kit. */
export async function themeFor(date: string | null | undefined, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<FjTheme | null> {
  if (process.env.THEMES === '0' || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  if (now - readAt > REFRESH_MS) {
    readAt = now;
    list = (await fetchThemes(process.env.THEMES_URL || THEMES_URL, fetchImpl)) ?? list;
  }
  return pickTheme(list ?? [], date.slice(0, 10));
}

/** For tests: forget the cached feed. */
export function resetThemeCache(): void {
  list = null;
  readAt = 0;
}

/**
 * The kit in a theme's colours: its six roles onto the kit's six (the table in fj-themes.js). Fonts, layout and the
 * logo stay the kit's; every template reads its colours from here, so they all follow.
 */
export function themedBrand(brand: Brand, theme: FjTheme | null | undefined): Brand {
  if (!theme) return brand;
  const c = theme.colors;
  return { ...brand, colors: { night: c.ground, charcoal: c.surface, cream: c.text, sand: c.muted, saffron: c.highlight, ember: c.action } };
}
