/**
 * Customer benefits: the owner's own list of what has got better for the customer (plenty of parking, fully
 * air-conditioned dining, a refreshed dining room). A post about an improvement is written from the benefit,
 * never from the work behind it (no renovations, builders or equipment). The Benefits sheet of a workbook fills
 * the table (calendar/benefits.ts); a calendar row names one by id (BEN001) or in words.
 */
import type { Db } from './db/pool.js';

export interface Benefit {
  id: number;
  key: string;
  benefit: string;
}

export const benefitKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function upsertBenefit(db: Db, b: { key?: string | null; benefit: string }): Promise<Benefit> {
  const benefit = b.benefit.trim().replace(/\s+/g, ' ');
  const key = benefitKey(b.key ?? '') || benefitKey(benefit);
  const { rows } = await db.query<Benefit>(
    `insert into benefits (key, benefit) values ($1, $2)
     on conflict (key) do update set benefit = excluded.benefit, updated_at = now()
     returning id, key, benefit`,
    [key, benefit]);
  return rows[0]!;
}

export async function listBenefits(db: Db): Promise<Benefit[]> {
  return (await db.query<Benefit>('select id, key, benefit from benefits order by key')).rows;
}

/** A benefit by its sheet id (BEN001) or its wording, case-insensitively. */
export async function findBenefit(db: Db, ref: string): Promise<Benefit | null> {
  const k = benefitKey(ref);
  if (!k) return null;
  return (await db.query<Benefit>('select id, key, benefit from benefits where key = $1 or lower(benefit) = $1 limit 1', [k])).rows[0] ?? null;
}
