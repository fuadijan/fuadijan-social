/**
 * Text measurement with opentype.js, because satori doesn't auto-fit: the headline is measured, then shrunk in
 * steps until its two lines fit the text column.
 */
import opentype from 'opentype.js';

const cache = new WeakMap<Buffer, opentype.Font>();

export function fontOf(data: Buffer): opentype.Font {
  let f = cache.get(data);
  if (!f) {
    f = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    cache.set(data, f);
  }
  return f;
}

/** Advance width of `text` at `size` px (letter-spacing in em added per glyph). */
export function measure(font: opentype.Font, text: string, size: number, trackingEm = 0): number {
  // Glyph by glyph (advance + kerning) rather than getAdvanceWidth: that runs the GSUB shaper, and opentype.js
  // 2.0 throws on the ccmp lookup type Inter and DM Sans ship with. Plain advances are what a headline needs.
  const scale = size / font.unitsPerEm;
  const chars = [...text];
  let units = 0;
  let prev: opentype.Glyph | null = null;
  for (const ch of chars) {
    const glyph = font.charToGlyph(ch);
    units += glyph.advanceWidth ?? 0;
    if (prev) units += font.getKerningValue(prev, glyph);
    prev = glyph;
  }
  return units * scale + trackingEm * size * Math.max(0, chars.length - 1);
}

/** Splits a one-line headline into two balanced lines at a word boundary. */
export function twoLines(headline: string): [string, string] {
  const given = headline.split('\n').map((l) => l.trim()).filter(Boolean);
  if (given.length >= 2) return [given[0]!, given.slice(1).join(' ')];
  const words = (given[0] ?? '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return [words[0] ?? '', ''];
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) {
      bestDiff = Math.abs(a - b);
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/** The largest size (start → min by step) at which both headline lines fit `width`. */
export function fitHeadline(font: opentype.Font, lines: [string, string], width: number, start: number, min: number, step: number): number {
  for (let size = start; size >= min; size -= step) {
    if (lines.every((l) => measure(font, l, size) <= width)) return size;
  }
  return min;
}

/** Greedy word wrap at `size`; returns at most maxLines lines (the last one ellipsised if needed). */
export function wrap(font: opentype.Font, text: string, size: number, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measure(font, candidate, size) <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last && measure(font, `${last}…`, size) > width) last = last.replace(/\s*\S+$/, '');
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}
