/**
 * The Benefits sheet of a workbook (also accepted as "Customer Benefits"): `BenefitID | Benefit Name | Category |
 * Message | Status | Series`, one customer benefit per row; only the id and the name are required. Read whole and
 * checked before anything is written; the same BenefitID is updated, never duplicated.
 */
import type pg from 'pg';
import { upsertBenefit, type BenefitInput } from '../src/benefits.js';
import { cellText, headerIndex } from './calendar.schema.js';
import { readSheetRows, sourceName, type WorkbookSource } from './xlsx.js';

export const BENEFIT_COLUMNS = ['BenefitID', 'Benefit Name', 'Category', 'Message', 'Status', 'Series'] as const;
export const BENEFIT_SHEETS = ['Benefits', 'Customer Benefits'];

export interface BenefitRow extends BenefitInput { key: string | null; benefit: string }

/** The sheet's benefits; [] when no such sheet; throws, naming the row, on anything wrong. */
export async function readBenefitsSheet(source: WorkbookSource): Promise<BenefitRow[]> {
  let rows: Awaited<ReturnType<typeof readSheetRows>> | null = null;
  let sheetName = BENEFIT_SHEETS[0]!;
  for (const name of BENEFIT_SHEETS) {
    try {
      rows = await readSheetRows(source, name);
      sheetName = name;
      break;
    } catch (e) {
      if (!(e instanceof Error && /not found/.test(e.message))) throw e;
    }
  }
  if (!rows) return [];
  const col = headerIndex(rows[0] ?? []);
  const iBenefit = col('Benefit Name', 'Benefit', 'Customer Benefit', 'Text');
  if (iBenefit < 0) throw new Error(`${sourceName(source)} sheet "${sheetName}": the header needs the columns ${BENEFIT_COLUMNS.join(' | ')}; missing Benefit Name.`);
  const iKey = col('BenefitID', 'ID');
  const at = (r: unknown[], name: string) => (col(name) >= 0 ? cellText(r[col(name)]) : null);
  const out: BenefitRow[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const benefit = cellText(r[iBenefit]);
    const key = iKey >= 0 ? cellText(r[iKey]) : null;
    if (!benefit && !key) return;
    const where = `${sheetName} row ${i + 2}`;
    if (!benefit) throw new Error(`${where}: a benefit needs its words.`);
    const k = (key ?? benefit).trim().toLowerCase();
    if (seen.has(k)) throw new Error(`${where}: ${key ? `BenefitID ${key}` : `"${benefit}"`} is used twice.`);
    seen.add(k);
    out.push({ key: key ? key.trim() : null, benefit: benefit.trim(), category: at(r, 'Category'), message: at(r, 'Message'), status: at(r, 'Status'), series: at(r, 'Series') });
  });
  return out;
}

export async function seedBenefits(pool: pg.Pool | { query: pg.Pool['query'] }, rows: BenefitRow[]): Promise<{ loaded: number }> {
  for (const r of rows) await upsertBenefit(pool, r);
  return { loaded: rows.length };
}
