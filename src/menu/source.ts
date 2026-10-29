/**
 * Menu facts come from one MenuSource: Menu Screens' public /api/menu today, the POS later, a JSON file for tests
 * and dry runs. The agent never invents a dish, side, price or availability: it asks the source, then the owner.
 */
export interface MenuItem {
  id: string;
  name: string;
  category: string | null;
  description: string;
  priceCents: number | null;
  soldOut: boolean;
  note: string | null;
}

export interface Menu {
  items: MenuItem[];
  fetchedAt: Date;
  source: string;
}

export interface MenuSource {
  readonly name: string;
  load(): Promise<Menu>;
}

/** A cached source: the last good menu survives a failed refresh. */
export class CachedMenu {
  private menu: Menu | null = null;
  private lastError: string | null = null;
  constructor(private readonly source: MenuSource, private readonly ttlMs = 15 * 60_000) {}

  async get(): Promise<Menu> {
    if (this.menu && Date.now() - this.menu.fetchedAt.getTime() < this.ttlMs) return this.menu;
    try {
      this.menu = await this.source.load();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (!this.menu) throw err;
    }
    return this.menu;
  }

  status(): { source: string; items: number; fetchedAt: string | null; lastError: string | null } {
    return { source: this.source.name, items: this.menu?.items.length ?? 0, fetchedAt: this.menu?.fetchedAt.toISOString() ?? null, lastError: this.lastError };
  }
}

/** Case-insensitive, punctuation-tolerant name match; "Chicken Karahi" ~ "chicken karahi (large)". */
export function findItem(menu: Menu, name: string): MenuItem | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(name);
  if (!q) return null;
  return menu.items.find((i) => norm(i.name) === q)
    ?? menu.items.find((i) => norm(i.name).startsWith(q) || q.startsWith(norm(i.name)))
    ?? menu.items.find((i) => norm(i.name).includes(q))
    ?? null;
}

export function menuNames(menu: Menu): string[] {
  return [...new Set(menu.items.filter((i) => !i.soldOut).map((i) => i.name))].sort();
}
