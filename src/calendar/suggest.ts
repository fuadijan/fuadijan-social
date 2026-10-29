/**
 * Dish-less rows (brand, community, review) get a dish suggested by rotation from the menu. The agent never
 * writes `dish` itself; the owner confirms with a button or types another.
 */
import type { CalendarRow } from './rows.js';
import type { Menu } from '../menu/source.js';

const HERO_WORDS = ['karahi', 'chapli', 'seek', 'seekh', 'tikka', 'kebab', 'kabab', 'burger', 'platter', 'biryani', 'naan'];

export function suggestDish(row: Pick<CalendarRow, 'day_no'>, menu: Menu): string | null {
  const heroes = menu.items.filter((i) => !i.soldOut && HERO_WORDS.some((w) => i.name.toLowerCase().includes(w)));
  const pool = heroes.length ? heroes : menu.items.filter((i) => !i.soldOut);
  if (!pool.length) return null;
  return pool[(row.day_no - 1) % pool.length]!.name;
}

export function needsDish(row: Pick<CalendarRow, 'dish'>): boolean {
  return !row.dish || row.dish.trim().startsWith('[');
}
