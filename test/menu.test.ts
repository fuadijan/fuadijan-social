import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMenuScreens } from '../src/menu/menu-screens.js';
import { findItem, menuNames } from '../src/menu/source.js';
import { suggestDish } from '../src/calendar/suggest.js';

const menu = parseMenuScreens(JSON.parse(readFileSync('test/fixtures/menu-screens.json', 'utf8')));

describe('menu screens source', () => {
  it('flattens sections into items with cents and sold-out flags', () => {
    expect(menu.items).toHaveLength(12);
    const karahi = findItem(menu, 'chicken karahi');
    expect(karahi).toMatchObject({ name: 'Chicken Karahi', category: 'Karahi', priceCents: 2800, soldOut: false });
    expect(findItem(menu, 'Lamb Karahi')?.soldOut).toBe(true);
    expect(findItem(menu, 'roti')?.priceCents).toBe(250);
  });

  it('matches loosely but not wildly', () => {
    expect(findItem(menu, 'chapli')?.name).toBe('Chapli Kebab');
    expect(findItem(menu, 'snack pack')?.name).toBe('Chicken Tikka Snack Pack');
    expect(findItem(menu, 'pizza')).toBeNull();
  });

  it('lists available names only', () => {
    expect(menuNames(menu)).not.toContain('Lamb Karahi');
    expect(menuNames(menu)).toContain('Naan');
  });

  it('suggests a hero dish by rotation', () => {
    const a = suggestDish({ day_no: 1 }, menu);
    const b = suggestDish({ day_no: 2 }, menu);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(suggestDish({ day_no: 1 }, { items: [], fetchedAt: new Date(), source: 'x' })).toBeNull();
  });

  it('refuses a payload without a menu array', () => {
    expect(() => parseMenuScreens({ nope: [] })).toThrow();
  });
});

describe('dish facts', () => {
  it('matches facts to the texts that name the dish', async () => {
    const { dishFactsFor } = await import('../src/settings.js');
    const fake = { query: async (sql: string) => ({ rows: sql.includes("like 'fact:%'") ? [{ key: 'fact:chapli kebab', value: 'served with raita and salad' }, { key: 'fact:chicken karahi', value: 'cooked to order' }] : [], rowCount: 0 }) } as unknown as import('../src/db/pool.js').Db;
    expect(await dishFactsFor(fake, ['Chapli Kebab', null])).toEqual(['Chapli Kebab: served with raita and salad']);
    expect(await dishFactsFor(fake, ['Mixed menu'])).toEqual([]);
  });
});
