/**
 * The builder's real preview: the owner's words on the owner's photo, drawn by the same renderer as the post, before
 * anything is made. No Claude, no cutout and nothing stored: the art director and the critic still have their say when
 * the design is made, so the preview is the house layout (Poster and Flat, which need the plate cut out, show as Band).
 */
import sharp from 'sharp';
import { cleanInvite, rowByDay, type InviteDetails } from '../calendar/rows.js';
import type { Db } from '../db/pool.js';
import { getFile } from '../files.js';
import { crop, decode } from '../images/prep.js';
import { loadBrand } from '../render/brand.js';
import { renderPost, styleFor } from '../render/index.js';
import { templateEntry } from '../render/registry.js';
import { STYLE_KEYS, STYLES, type Style } from '../render/styles.js';
import { allSettings } from '../settings.js';

export interface PreviewInput {
  template: string;
  kind: 'post' | 'reel';
  /** The small label over the title; empty means the series' own. */
  label: string;
  headline: string;
  line: string;
  /** A reel's cover text. */
  hook: string;
  style: Style | 'auto';
  dish: string | null;
  date: string | null;
  photo: { assetId: number } | { dayNo: number } | { dataUrl: string } | null;
  /** What the Invite style prints; null means the post's date, the opening hours and FROM. */
  invite: InviteDetails | null;
}

export interface PreviewResult {
  images: { format: 'feed' | 'story' | 'reel-cover'; dataUrl: string }[];
  style: Style;
  note: string | null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/** The request body, checked; throws a message the owner can read. */
export function parsePreviewInput(body: unknown): PreviewInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const template = str(b.template, 60);
  try {
    templateEntry(template);
  } catch {
    throw new Error('Pick a series.');
  }
  const headline = str(b.headline, 60).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n');
  if (!headline) throw new Error('The title is empty.');
  const style = str(b.style, 10) || 'auto';
  if (style !== 'auto' && !(STYLE_KEYS as readonly string[]).includes(style)) throw new Error('Pick a style.');
  const p = (b.photo ?? null) as Record<string, unknown> | null;
  const photo = !p ? null
    : Number.isInteger(p.assetId) ? { assetId: Number(p.assetId) }
    : Number.isInteger(p.dayNo) ? { dayNo: Number(p.dayNo) }
    : typeof p.dataUrl === 'string' ? { dataUrl: p.dataUrl }
    : null;
  return {
    template, kind: b.kind === 'reel' ? 'reel' : 'post', label: str(b.label, 40), headline, line: str(b.line, 140), hook: str(b.hook, 70),
    style: style as Style | 'auto', dish: str(b.dish, 60) || null, date: str(b.date, 10) || null, photo, invite: cleanInvite(b.invite),
  };
}

async function preppedOf(db: Db, assetId: number): Promise<{ feed: Buffer; tall: Buffer | null } | null> {
  const a = (await db.query<{ prepped: Record<string, string> | null }>("select prepped from assets where id = $1 and kind in ('photo','document')", [assetId])).rows[0];
  const feedId = a?.prepped?.['4x5'];
  if (!feedId) return null;
  const feed = (await getFile(db, feedId))?.bytes;
  if (!feed) return null;
  const tallId = a.prepped?.['9x16'];
  return { feed, tall: tallId ? (await getFile(db, tallId))?.bytes ?? null : null };
}

/** The photo to draw on: one already received, the day's design photo, or one the owner has only just chosen. */
async function photoFor(db: Db, photo: PreviewInput['photo']): Promise<{ feed: Buffer; tall: Buffer | null } | null> {
  if (!photo) return null;
  if ('assetId' in photo) return preppedOf(db, photo.assetId);
  if ('dayNo' in photo) {
    const row = await rowByDay(db, photo.dayNo);
    if (!row) return null;
    const picked = row.design_photos?.[0]?.assetId;
    const id = picked ?? (await db.query<{ id: number }>("select id from assets where calendar_row_id = $1 and kind in ('photo','document') and prepped ? '4x5' order by created_at desc limit 1", [row.id])).rows[0]?.id;
    return id ? preppedOf(db, id) : null;
  }
  const m = photo.dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) throw new Error('That photo could not be read.');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('That photo is too big to preview.');
  const { jpeg } = await decode(bytes, m[1]);
  return { feed: await crop(jpeg, '4x5'), tall: await crop(jpeg, '9x16') };
}

const toJpegUrl = async (png: Buffer) => `data:image/jpeg;base64,${(await sharp(png).resize({ width: 720 }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`;

export async function previewDesign(db: Db, input: PreviewInput): Promise<PreviewResult> {
  const entry = templateEntry(input.template);
  const photo = await photoFor(db, input.photo);
  if (!photo) throw new Error('Choose a photo first; the preview draws on it.');
  const s = await allSettings(db);
  const settings = { storeAddress: s.store_address ?? '', openHours: s.open_hours ?? '', handle: s.instagram_handle ?? '@fuadijan', website: s.website_url ?? '' };
  const asked: Style = input.style === 'auto' ? entry.style ?? 'band' : input.style;
  const design = { style: asked };
  const style = styleFor({ photo: photo.feed, cutout: null, design });
  const outputs = await renderPost({
    sheetTemplate: input.template, slot: input.kind === 'reel' ? 'reel' : 'feed', label: input.label || entry.label, headline: input.headline, line: input.line,
    hook: input.kind === 'reel' ? input.hook || input.headline : null, photo: photo.feed, storyPhoto: photo.tall, cutout: null, settings, design, date: input.date, dish: input.dish, invite: input.invite,
  }, loadBrand());
  const wanted = outputs.filter((o) => (input.kind === 'reel' ? o.format === 'reel-cover' : o.format === 'feed' || o.format === 'story'));
  const images = await Promise.all(wanted.map(async (o) => ({ format: o.format as 'feed' | 'story' | 'reel-cover', dataUrl: await toJpegUrl(o.png) })));
  const note = style !== asked
    ? `${STYLES[asked].name} needs the plate cut out of the photo, which happens when the design is made; the preview shows ${STYLES[style].name}.`
    : input.style === 'auto' ? 'The art director may move the words or pick another style when the design is made; the words stay as you see them.' : null;
  return { images, style, note };
}
