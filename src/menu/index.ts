import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { MenuScreensSource, parseMenuScreens } from './menu-screens.js';
import { CachedMenu, type Menu, type MenuSource } from './source.js';

/** data/menu.json: either Menu Screens' JSON shape or a plain { items: [...] } list. */
export class FileMenuSource implements MenuSource {
  readonly name = 'file';
  constructor(private readonly path: string) {}
  async load(): Promise<Menu> {
    const json = JSON.parse(readFileSync(this.path, 'utf8')) as { menu?: unknown; items?: Menu['items'] };
    if (Array.isArray(json.items)) return { items: json.items, fetchedAt: new Date(), source: 'file' };
    return parseMenuScreens(json, 'file');
  }
}

/**
 * The POS (fuadijan-pos, packages/db): read-only role over `item`, `variation`, `category`, `item_category`,
 * `availability`. Not live yet; this reads the schema the POS documents so the switch is a config change.
 */
export class PosMenuSource implements MenuSource {
  readonly name = 'pos';
  constructor(private readonly url: string) {}
  async load(): Promise<Menu> {
    const { createPool } = await import('../db/pool.js');
    const pool = createPool(this.url);
    try {
      const { rows } = await pool.query<{ id: string; name: string; description: string | null; category: string | null; price_cents: number | null; sold_out: boolean }>(
        `select i.id, i.name, i.description,
                (select c.name from item_category ic join category c on c.id = ic.category_id where ic.item_id = i.id order by ic.position nulls last limit 1) as category,
                (select min(v.price_cents) from variation v where v.item_id = i.id and v.archived_at is null) as price_cents,
                exists (select 1 from availability a where a.target_id = i.id and not a.available and (a.until is null or a.until > now())) as sold_out
           from item i where i.archived_at is null order by i.name`);
      return { items: rows.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '', category: r.category, priceCents: r.price_cents, soldOut: r.sold_out, note: null })), fetchedAt: new Date(), source: 'pos' };
    } finally {
      await pool.end();
    }
  }
}

export function menuSourceFromConfig(): MenuSource {
  switch (config.menu.source) {
    case 'file': return new FileMenuSource(config.menu.file);
    case 'pos':
      if (!config.menu.posDatabaseUrl) throw new Error('MENU_SOURCE=pos needs POS_DATABASE_URL.');
      return new PosMenuSource(config.menu.posDatabaseUrl);
    default: return new MenuScreensSource(config.menu.menuScreensUrl);
  }
}

export function cachedMenuFromConfig(): CachedMenu {
  return new CachedMenu(menuSourceFromConfig());
}

export * from './source.js';
