import { afterEach, describe, expect, it } from 'vitest';
import { loadBrand } from '../src/render/brand.js';
import { resetThemeCache, themeFor, themedBrand } from '../src/render/theme.js';

const GREEN = { ground: '#01411C', surface: '#0A5C2E', text: '#FFFFFF', muted: '#C9E3D1', highlight: '#FFFFFF', action: '#3DAA5C' };
const feed = (themes: unknown[]) => (async () => new Response(JSON.stringify({ themes }), { status: 200 })) as unknown as typeof fetch;
const independence = { key: 'independence-day', name: 'Independence Day', mode: 'auto', start: '2026-08-13', end: '2026-08-15', yearly: true, colors: GREEN, updatedAt: '' };

afterEach(() => resetThemeCache());

describe('occasion themes on posts', () => {
  it('a post wears the theme covering the day it goes up', async () => {
    expect((await themeFor('2027-08-14', feed([independence])))?.key).toBe('independence-day');
    expect(await themeFor('2027-08-20', feed([independence]))).toBeNull();
    expect(await themeFor(null, feed([independence]))).toBeNull();
  });

  it('keeps the last good list when the feed fails, and the everyday kit with none', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await themeFor('2027-08-14', down)).toBeNull();
    resetThemeCache();
    const t0 = Date.now();
    await themeFor('2027-08-14', feed([independence]), t0);
    // Six minutes on the next read is due, but the feed is down: the list read before still stands.
    expect((await themeFor('2027-08-14', down, t0 + 6 * 60_000))?.key).toBe('independence-day');
    // And a fresh list that no longer has it takes it away.
    expect(await themeFor('2027-08-14', feed([]), t0 + 12 * 60_000)).toBeNull();
  });

  it('recolours the kit, role by role, and leaves everything else alone', () => {
    const brand = loadBrand();
    const themed = themedBrand(brand, { ...independence, mode: 'auto' } as never);
    expect(themed.colors).toEqual({ night: '#01411C', charcoal: '#0A5C2E', cream: '#FFFFFF', sand: '#C9E3D1', saffron: '#FFFFFF', ember: '#3DAA5C' });
    expect(themed.fonts).toBe(brand.fonts);
    expect(themedBrand(brand, null)).toBe(brand);
  });
});
