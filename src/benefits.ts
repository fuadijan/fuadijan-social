/**
 * Customer benefits: the owner's own list of what has got better for the customer (plenty of parking, fully
 * air-conditioned dining, a refreshed dining room). A post about an improvement is written from the benefit,
 * never from the work behind it (no renovations, builders or equipment). The Benefits sheet of a workbook fills
 * the table (calendar/benefits.ts); a calendar row names one by id (BEN-01) or in words.
 */
import type { Db } from './db/pool.js';

export interface Benefit {
  id: number;
  key: string;
  benefit: string;
  category: string | null;
  /** The sentence the customer reads. */
  message: string | null;
  /** When it applies, in the owner's words ("Current", "Available 2026-12-24"). */
  status: string | null;
  series: string | null;
}

export interface BenefitInput {
  key?: string | null;
  benefit: string;
  category?: string | null;
  message?: string | null;
  status?: string | null;
  series?: string | null;
}

export const benefitKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const COLS = 'id, key, benefit, category, message, status, series';

export async function upsertBenefit(db: Db, b: BenefitInput): Promise<Benefit> {
  const benefit = b.benefit.trim().replace(/\s+/g, ' ');
  const key = benefitKey(b.key ?? '') || benefitKey(benefit);
  const { rows } = await db.query<Benefit>(
    `insert into benefits (key, benefit, category, message, status, series) values ($1, $2, $3, $4, $5, $6)
     on conflict (key) do update set benefit = excluded.benefit, category = excluded.category, message = excluded.message, status = excluded.status, series = excluded.series, updated_at = now()
     returning ${COLS}`,
    [key, benefit, b.category ?? null, b.message ?? null, b.status ?? null, b.series ?? null]);
  return rows[0]!;
}

export async function listBenefits(db: Db): Promise<Benefit[]> {
  return (await db.query<Benefit>(`select ${COLS} from benefits order by key`)).rows;
}

/** A benefit by its sheet id (BEN-01) or its wording, case-insensitively. */
export async function findBenefit(db: Db, ref: string): Promise<Benefit | null> {
  const k = benefitKey(ref);
  if (!k) return null;
  return (await db.query<Benefit>(`select ${COLS} from benefits where key = $1 or lower(benefit) = $1 limit 1`, [k])).rows[0] ?? null;
}
