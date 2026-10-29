/**
 * Menu Screens (square-integration) serves GET /api/menu publicly: { menu: [{ name, items: [...] }], tvScreens,
 * bestSellers }. Each item: { id, name, description, category, price, outOfStock, availabilityNote, ... }. Prices
 * come as dollars.
 */
import type { Menu, MenuItem, MenuSource } from './source.js';

interface RawItem {
  id?: string;
  name?: string;
  description?: string;
  category?: string | null;
  price?: number | string | null;
  outOfStock?: boolean;
  availabilityNote?: string | null;
}
interface RawMenu { menu?: { name?: string; items?: RawItem[] }[] }

export function parseMenuScreens(json: unknown, source = 'menu-screens'): Menu {
  const data = (json ?? {}) as RawMenu;
  if (!Array.isArray(data.menu)) throw new Error('Menu Screens answered without a "menu" array.');
  const seen = new Set<string>();
  const items: MenuItem[] = [];
  for (const section of data.menu) {
    for (const it of section.items ?? []) {
      if (!it.name) continue;
      const id = it.id ?? it.name;
      if (seen.has(id)) continue;
      seen.add(id);
      const price = it.price == null || it.price === '' ? null : Number(it.price);
      items.push({
        id,
        name: it.name.trim(),
        category: it.category ?? section.name ?? null,
        description: (it.description ?? '').trim(),
        priceCents: price != null && Number.isFinite(price) ? Math.round(price * 100) : null,
        soldOut: Boolean(it.outOfStock),
        note: it.availabilityNote ?? null,
      });
    }
  }
  return { items, fetchedAt: new Date(), source };
}

export class MenuScreensSource implements MenuSource {
  readonly name = 'menu-screens';
  constructor(private readonly url: string, private readonly fetchFn: typeof fetch = fetch) {}

  async load(): Promise<Menu> {
    const res = await this.fetchFn(this.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Menu Screens answered HTTP ${res.status}.`);
    return parseMenuScreens(await res.json());
  }
}
