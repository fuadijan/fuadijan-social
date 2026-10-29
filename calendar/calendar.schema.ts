/**
 * The shape of one row of the `Calendar` sheet, and the clean-ups applied on import. Pure functions, so the
 * seed and its tests share them.
 */
import { z } from 'zod';
import { fractionToTime, serialToIsoDate } from './xlsx.js';

export const CALENDAR_COLUMNS = [
  'date', 'slot', 'type', 'dish', 'theme', 'caption_hint', 'post_time', 'template', 'status', 'asset',
  'objective', 'creative_instructions', 'on_screen_text', 'caption', 'cta', 'hashtags', 'story_ideas', 'confirmation_notes',
] as const;
export type CalendarColumn = (typeof CALENDAR_COLUMNS)[number];

export const SheetRow = z.object({
  day_no: z.number().int().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(['feed', 'carousel', 'reel']),
  type: z.string().min(1),
  dish: z.string().nullable(),
  theme: z.string().nullable(),
  caption_hint: z.string().nullable(),
  post_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  template: z.string().min(1),
  status: z.enum(['planned', 'photo-needed', 'ready', 'posted']),
  asset: z.string().nullable(),
  objective: z.string().nullable(),
  creative_instructions: z.string().nullable(),
  on_screen_text: z.string().nullable(),
  caption: z.string().nullable(),
  cta: z.string().nullable(),
  hashtags: z.string().nullable(),
  story_ideas: z.string().nullable(),
  confirmation_notes: z.string().nullable(),
});
export type SheetRow = z.infer<typeof SheetRow>;

/** A cell as exceljs gives it: string, number, Date, rich text, or empty. */
export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('') || null;
  }
  if (typeof v === 'object' && v !== null && 'result' in v) return cellText((v as { result: unknown }).result);
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** The sheet's date cells are midnight UTC datetimes: take the date part, never convert zones. */
export function cellDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return serialToIsoDate(v);
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

export function cellTime(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === 'number' && v >= 0 && v < 1) return fractionToTime(v);
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/** Strip the trailing "📍 …" line: the pack adds STORE_ADDRESS itself. */
export function stripAddressLine(caption: string | null): string | null {
  if (!caption) return null;
  const out = caption.replace(/\s*\n?\s*📍[^\n]*\s*$/u, '').trimEnd();
  return out || null;
}

/** Strip a "---\n\n# Days …" block pasted from the narrative onto the end of story_ideas. */
export function stripPastedHeading(text: string | null): string | null {
  if (!text) return null;
  const out = text.replace(/\s*\n\s*---\s*\n[\s\S]*$/u, '').trimEnd();
  return out || null;
}

/** confirmation_notes that repeat (or are a prefix of) creative_instructions carry nothing: treat as empty. */
export function dedupeNotes(notes: string | null, instructions: string | null): string | null {
  if (!notes) return null;
  if (!instructions) return notes;
  const n = notes.trim();
  const i = instructions.trim();
  if (n === i || i.startsWith(n)) return null;
  return notes;
}

export function cleanRow(raw: Record<CalendarColumn, unknown>, dayNo: number): SheetRow {
  const row = {
    day_no: dayNo,
    date: cellDate(raw.date) ?? '',
    slot: cellText(raw.slot)?.toLowerCase() ?? '',
    type: cellText(raw.type) ?? '',
    dish: cellText(raw.dish),
    theme: cellText(raw.theme),
    caption_hint: cellText(raw.caption_hint),
    post_time: cellTime(raw.post_time),
    template: cellText(raw.template) ?? '',
    status: cellText(raw.status)?.toLowerCase() ?? 'planned',
    asset: cellText(raw.asset),
    objective: cellText(raw.objective),
    creative_instructions: cellText(raw.creative_instructions),
    on_screen_text: cellText(raw.on_screen_text),
    caption: stripAddressLine(cellText(raw.caption)),
    cta: cellText(raw.cta),
    hashtags: cellText(raw.hashtags),
    story_ideas: stripPastedHeading(cellText(raw.story_ideas)),
    confirmation_notes: null as string | null,
  };
  row.confirmation_notes = dedupeNotes(cellText(raw.confirmation_notes), row.creative_instructions);
  return SheetRow.parse(row);
}
