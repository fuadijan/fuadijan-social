/**
 * The Products sheet of a month's workbook: `ProductID | Product Name | Category | Status | Series`, one product
 * per row, the whole roster including what is not on the menu yet (coming soon, planned). Read whole and checked
 * before anything is written; the same product name is updated, never duplicated.
 */
import type pg from 'pg';
import { productStatus, upsertProduct, type ProductInput, type ProductStatus } from '../src/products.js';
import { templateEntry, templateForSeries } from '../src/render/registry.js';
import { cellText } from './calendar.schema.js';
import { readSheetRows, sourceName, type WorkbookSource } from './xlsx.js';

export const PRODUCT_COLUMNS = ['ProductID', 'Product Name', 'Category', 'Status', 'Series'] as const;

export interface ProductRow extends ProductInput { key: string | null; name: string; category: string | null; status: ProductStatus; series: string | null; template: string | null }

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/** The sheet's products; [] when the sheet is missing; throws, naming the row, on anything wrong. */
export async function readProductsSheet(source: WorkbookSource, sheetName = 'Products'): Promise<ProductRow[]> {
  let rows;
  try {
    rows = await readSheetRows(source, sheetName);
  } catch (e) {
    if (e instanceof Error && /not found/.test(e.message)) return [];
    throw e;
  }
  const header = (rows[0] ?? []).map((v) => norm(cellText(v) ?? ''));
  const col = (name: string) => header.indexOf(norm(name));
  if (col('Product Name') < 0) throw new Error(`${sourceName(source)} sheet "${sheetName}": the header needs the columns ${PRODUCT_COLUMNS.join(' | ')}; missing Product Name.`);
  const at = (r: unknown[], name: string) => (col(name) >= 0 ? cellText(r[col(name)]) : null);
  const out: ProductRow[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const name = at(r, 'Product Name');
    const key = at(r, 'ProductID');
    if (!name && !key) return;
    const where = `${sheetName} row ${i + 2}`;
    if (!name) throw new Error(`${where}: a product needs a Product Name.`);
    const nk = norm(name);
    if (seen.has(nk)) throw new Error(`${where}: product "${name}" is listed twice.`);
    seen.add(nk);
    if (key && seen.has(`id:${norm(key)}`)) throw new Error(`${where}: ProductID ${key} is used twice.`);
    if (key) seen.add(`id:${norm(key)}`);
    let status: ProductStatus;
    try {
      status = productStatus(at(r, 'Status'));
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const series = at(r, 'Series');
    let template: string | null = null;
    if (series) {
      template = templateForSeries(series);
      if (!template) throw new Error(`${where}: series "${series}" is not one on the Templates sheet.`);
    }
    out.push({ key: key ? key.trim() : null, name: name.trim(), category: at(r, 'Category'), status, series: template ? templateEntry(template).label : null, template });
  });
  return out;
}

export async function seedProducts(pool: pg.Pool | { query: pg.Pool['query'] }, rows: ProductRow[]): Promise<{ loaded: number }> {
  for (const r of rows) await upsertProduct(pool, r);
  return { loaded: rows.length };
}
