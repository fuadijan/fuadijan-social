/**
 * The product roster: every product the restaurant sells or will sell, with a status and a series. The live
 * menu (src/menu) knows prices and sold-out flags for what is on sale today; the roster adds the products the
 * menu does not list yet (coming soon, planned) and says which series each belongs to, so a launch can be posted
 * about before the dish reaches the website. The Products sheet of a month's workbook fills it
 * (calendar/products.ts). Names are keyed the way the wording bank keys items (itemKey), so a roster product,
 * a menu item and a bank item with the same name are one product.
 */
import type { Db } from './db/pool.js';
import { itemKey } from './slogans.js';

export const PRODUCT_STATUSES = ['active', 'coming-soon', 'planned', 'retired'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Product {
  id: number;
  key: string;
  name: string;
  name_key: string;
  category: string | null;
  status: ProductStatus;
  series: string | null;
  template: string | null;
  /** When it goes on sale, in the owner's words ("2026-12-15", "Current menu"). */
  launch: string | null;
  hero: boolean;
  notes: string | null;
}

export interface ProductInput {
  key?: string | null;
  name: string;
  category?: string | null;
  status?: ProductStatus;
  series?: string | null;
  template?: string | null;
  launch?: string | null;
  hero?: boolean;
  notes?: string | null;
}

/** "Coming Soon" / "coming-soon" / "soon" → coming-soon; unknown words throw, so a sheet typo is caught at import. */
export function productStatus(s: string | null | undefined): ProductStatus {
  const k = (s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!k || k === 'live' || k === 'on-menu' || k.startsWith('active') || k.startsWith('current') || k === 'growth') return 'active';
  if (k === 'coming-soon' || k === 'soon' || k === 'coming' || k === 'upcoming') return 'coming-soon';
  if (k === 'planned' || k === 'idea' || k === 'future') return 'planned';
  if (k === 'retired' || k === 'gone' || k === 'off-menu' || k === 'discontinued') return 'retired';
  throw new Error(`Product status "${s}" is not one of active, coming soon, planned, retired.`);
}

const COLS = 'id, key, name, name_key, category, status, series, template, launch, hero, notes';

/** Insert or update by name (the sheet's ProductID, when given, is kept as the key). */
export async function upsertProduct(db: Db, p: ProductInput): Promise<Product> {
  const name = p.name.trim().replace(/\s+/g, ' ');
  const nameKey = itemKey(name);
  const key = (p.key ?? '').trim().toLowerCase() || nameKey;
  const { rows } = await db.query<Product>(
    `insert into products (key, name, name_key, category, status, series, template, launch, hero, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (name_key) do update set key = excluded.key, name = excluded.name, category = coalesce(excluded.category, products.category),
       status = excluded.status, series = coalesce(excluded.series, products.series), template = coalesce(excluded.template, products.template),
       launch = coalesce(excluded.launch, products.launch), hero = excluded.hero, notes = coalesce(excluded.notes, products.notes), updated_at = now()
     returning ${COLS}`,
    [key, name, nameKey, p.category ?? null, p.status ?? 'active', p.series ?? null, p.template ?? null, p.launch ?? null, p.hero ?? false, p.notes ?? null]);
  return rows[0]!;
}

export async function listProducts(db: Db): Promise<Product[]> {
  return (await db.query<Product>(`select ${COLS} from products order by name`)).rows;
}

/**
 * What the writer must know about a product on a given date: an upcoming one is not on sale before its launch, and
 * the owner's notes hold. Null when there is nothing to say.
 */
export function productFact(p: Product, date: string): string | null {
  const launch = p.launch?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const upcoming = p.status === 'coming-soon' || p.status === 'planned';
  const parts: string[] = [];
  if (upcoming && (!launch || date < launch)) parts.push(`${p.name} is not on sale on ${date}${p.launch ? `; it launches ${p.launch}` : ''}. Never present it as available yet.`);
  if (p.notes) parts.push(`${p.name}: ${p.notes}`);
  return parts.length ? parts.join(' ') : null;
}

/** A product by its sheet id (P004) or its name, exactly or by a loose prefix / contains match as the menu lookup does. */
export async function findProduct(db: Db, ref: string): Promise<Product | null> {
  const k = itemKey(ref);
  if (!k) return null;
  const exact = (await db.query<Product>(`select ${COLS} from products where key = $1 or name_key = $1 limit 1`, [k])).rows[0];
  if (exact) return exact;
  const all = await listProducts(db);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(ref);
  return all.find((p) => norm(p.name).startsWith(q) || q.startsWith(norm(p.name))) ?? all.find((p) => norm(p.name).includes(q)) ?? null;
}
