/**
 * The pack texts: caption.txt in the exact layout from the brief, reel-pack.txt for reels, and the Canva brief
 * the owner can rebuild a design from by hand in two minutes.
 */
import type { CalendarRow } from '../calendar/rows.js';
import type { ResolvedCopy } from '../brain/schemas.js';
import { templateEntry, templateKeyFor } from '../render/registry.js';
import { formatDay } from '../time.js';

export interface PackSettings {
  storeAddress: string;
  openHours: string;
  websiteUrl: string;
  instagramHandle: string;
}

export const BRAND_LINE = 'SMOKED. GRILLED. ROOTED IN TRADITION.';

export function postTimeFor(row: CalendarRow, defaults: { post: string; story: string }): string {
  return (row.post_time ?? defaults.post).slice(0, 5);
}

export function captionTxt(row: CalendarRow, copy: ResolvedCopy, s: PackSettings, postTime: string): string {
  const story = [copy.story_text.trim(), `Link: ${s.websiteUrl || '(website link not set — /set website <url>)'}   Tag: ${s.instagramHandle}   Location: Auburn, NSW`].join('\n');
  return [
    '=== CAPTION ===',
    copy.caption.trim(),
    copy.cta.trim(),
    `📍 ${s.storeAddress}`,
    '',
    '=== HASHTAGS (first comment or end of caption) ===',
    copy.hashtags.join(' '),
    '',
    '=== ALT TEXT ===',
    copy.alt_text.trim(),
    '',
    '=== STORY ===',
    story,
    '',
    '=== FACEBOOK ===',
    copy.facebook_caption.trim(),
    '',
    '=== POST AT ===',
    `${formatDay(row.date)}, ${postTime} — ${row.slot}`,
    '',
  ].join('\n');
}

/** Shot list items from creative_instructions: "1) … 2) …" or "a → b → c". */
export function shotList(instructions: string | null): string[] {
  if (!instructions) return [];
  const text = instructions.replace(/^.*?(shot list|shots|instructions)\s*:\s*/is, '');
  const numbered = [...text.matchAll(/\d+\)\s*([^;.\n]+?)(?=\s*(?:;|\.(?:\s|$)|\d+\)|$))/g)].map((m) => m[1]!.trim());
  if (numbered.length >= 2) return numbered;
  const arrows = text.split(/\s*→\s*/).map((x) => x.replace(/[.;]\s*$/, '').trim()).filter(Boolean);
  if (arrows.length >= 2) return arrows;
  return text.split(/;\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
}

/** Suggested reel length from the brief: 12–18 s brand intros, 15–25 s cooking, else 10–20 s. */
export function reelLength(row: CalendarRow): string {
  const t = `${row.type} ${row.template}`.toLowerCase();
  if (t.includes('brand')) return '12–18 s';
  if (t.includes('karahi') || t.includes('grill') || t.includes('hero')) return '15–25 s';
  return '10–20 s';
}

export function reelPackTxt(row: CalendarRow, copy: ResolvedCopy, clipsReceived: number): string {
  const onScreen = copy.on_screen_text.length ? copy.on_screen_text : (row.on_screen_text ?? '').split(/\s*→\s*/).map((x) => x.replace(/^[“"]|[”"]$/g, '').trim()).filter(Boolean);
  const hook = onScreen[0] ?? copy.headline.split('\n')[0] ?? '';
  return [
    `=== REEL — Day ${row.day_no} · ${formatDay(row.date)} ===`,
    `Hook (first second): ${hook}`,
    '',
    'On-screen text, in order:',
    ...onScreen.map((t, i) => `  ${i + 1}. ${t}`),
    '',
    'Shot list:',
    ...shotList(row.creative_instructions).map((s, i) => `  ${i + 1}) ${s}`),
    '',
    `Length: ${reelLength(row)}, vertical 9:16.`,
    "Music: use Instagram's licensed audio.",
    `Clips received: ${clipsReceived}${clipsReceived ? ' (not downloaded — Instagram takes them straight from your phone)' : ' — send them with captions like "karahi clip 1"'}.`,
    copy.unresolved.length ? `Still to confirm: ${copy.unresolved.map((u) => u.placeholder).join('; ')}` : '',
    '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

export function canvaBriefTxt(row: CalendarRow, copy: ResolvedCopy, s: PackSettings, layout: 'A' | 'B', crops: { feed: string; story: string }): string {
  const key = templateKeyFor(row.template);
  const entry = templateEntry(row.template);
  const footer = entry.footer === 'brand'
    ? `thin Sand rule with ✻ · ${BRAND_LINE}`
    : `${s.storeAddress.toUpperCase()}\n  OPEN ${s.openHours.toUpperCase()}`;
  return [
    `CANVA BRIEF — Day ${row.day_no} · ${formatDay(row.date)} · ${row.slot}`,
    `Template: ${key} (sheet: ${row.template}) · Layout ${layout}${layout === 'A' ? ' (plate cutout on Night, text column left)' : ' (full-bleed photo, Night gradient over the lower 45%, text in the band)'}`,
    `Canvas: 1080×1350 feed${row.slot === 'reel' ? ' / 1080×1920 reel cover' : ''} · story 1080×1920`,
    '',
    `Logo: brand/logo.png top-left, 220 px wide, 60 px from the edges`,
    `Label (Saffron #F2B544, uppercase, 0.3em tracking, 26 px): ${copy.label}`,
    `Headline (Instrument Serif, Cream #F3EBDD, ~130 px, line-height 0.95):`,
    ...copy.headline.split('\n').map((l) => `  ${l}`),
    `Rule: 90×3 px Ember #E8742E`,
    `Line (Inter 32–34 px, Cream): ${copy.line}`,
    `Footer (Sand #B8AC9A, uppercase, 0.25em tracking, 22 px, 60 px from the bottom):`,
    `  ${footer}`,
    '',
    `Photo: drop in ${layout === 'A' ? crops.feed + ' (remove background in Canva, soft shadow below the plate, right two-thirds)' : crops.feed + ' (fill the canvas)'}; story uses ${crops.story}.`,
    `Keep text off the food. Nothing in the top 250 px or bottom 300 px of the story.`,
    '',
    `Palette: Night #0F0D0B · Charcoal #171412 · Cream #F3EBDD · Sand #B8AC9A · Ember #E8742E · Saffron #F2B544`,
    `Fonts: Instrument Serif (fallback Playfair Display) for headlines · Inter (fallback DM Sans) for body`,
    '',
  ].join('\n');
}
