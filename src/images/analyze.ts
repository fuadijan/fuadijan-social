/**
 * Measures a photo so the design can be decided from numbers rather than a fixed recipe: a 4×4 grid of mean
 * luminance (linear, 0–1) and detail (edge energy, 0–1), the four text zones (top, bottom, left, right) scored
 * for quietness, and the overall exposure. The art director gets this as text next to the thumbnail; the
 * legibility maths uses the zone luminance to size the gradient band.
 */
import sharp from 'sharp';

export type Zone = 'top' | 'bottom' | 'left' | 'right';
export const ZONES: Zone[] = ['bottom', 'top', 'left', 'right'];

export interface CellStats { lum: number; detail: number }
export interface ZoneStats { lum: number; detail: number; quiet: number }

export interface PhotoStats {
  width: number;
  height: number;
  /** Mean linear luminance of the whole photo, 0–1. */
  mean: number;
  /** Share of pixels darker than 0.05 linear (about 60/255 sRGB). */
  darkFraction: number;
  cols: number;
  rows: number;
  /** cells[row][col]. */
  cells: CellStats[][];
  zones: Record<Zone, ZoneStats>;
  /** The zone where cream text under a Night band reads best: dark and flat. */
  quietest: Zone;
  /** Where the brightest (usually the food) mass sits, as fractions of the frame. */
  brightCentre: { x: number; y: number };
}

/** sRGB 0–255 → linear 0–1 (WCAG). */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export async function analyzePhoto(image: Buffer, grid = 4): Promise<PhotoStats> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const base = sharp(image).resize({ width: 256, withoutEnlargement: true }).greyscale();
  const { data, info } = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const { data: edges } = await base.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const sums: { lum: number; edge: number; n: number }[][] = Array.from({ length: grid }, () => Array.from({ length: grid }, () => ({ lum: 0, edge: 0, n: 0 })));
  let total = 0;
  let dark = 0;
  let bx = 0;
  let by = 0;
  let bw = 0;
  for (let y = 0; y < H; y++) {
    const gy = Math.min(grid - 1, Math.floor((y / H) * grid));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lin = srgbToLinear(data[i]!);
      const gx = Math.min(grid - 1, Math.floor((x / W) * grid));
      const cell = sums[gy]![gx]!;
      cell.lum += lin;
      cell.edge += edges[i]!; // sharp clamps the Laplacian to 0–255, so this is the positive edge response
      cell.n++;
      total += lin;
      if (lin < 0.05) dark++;
      const w = lin * lin; // brightness-weighted centre of mass
      bx += x * w;
      by += y * w;
      bw += w;
    }
  }
  const n = W * H;
  const cells: CellStats[][] = sums.map((row) => row.map((c) => ({ lum: round(c.lum / Math.max(1, c.n)), detail: round(Math.min(1, c.edge / Math.max(1, c.n) / 48)) })));

  const zoneCells: Record<Zone, CellStats[]> = {
    top: cells.slice(0, Math.ceil(grid * 0.4)).flat(),
    bottom: cells.slice(Math.floor(grid * 0.6)).flat(),
    left: cells.flatMap((r) => r.slice(0, Math.ceil(grid / 2))),
    right: cells.flatMap((r) => r.slice(Math.floor(grid / 2))),
  };
  const zones = Object.fromEntries(ZONES.map((z) => {
    const cs = zoneCells[z];
    const lum = round(avg(cs.map((c) => c.lum)));
    const detail = round(avg(cs.map((c) => c.detail)));
    // Dark and flat is where cream type on a Night band reads best; detail counts more than brightness because
    // the band can darken a zone but cannot calm it.
    const quiet = round((1 - detail) * 0.6 + (1 - Math.min(1, lum * 2.5)) * 0.4);
    return [z, { lum, detail, quiet }];
  })) as Record<Zone, ZoneStats>;
  const quietest = ZONES.reduce((best, z) => (zones[z].quiet > zones[best].quiet ? z : best), ZONES[0]!);

  return {
    width, height, mean: round(total / n), darkFraction: round(dark / n), cols: grid, rows: grid, cells, zones, quietest,
    brightCentre: { x: round(bw ? bx / bw / W : 0.5), y: round(bw ? by / bw / H : 0.5) },
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 1000) / 1000;

/** The stats as a few lines of text for a prompt. */
export function describeStats(s: PhotoStats): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const gridLines = s.cells.map((row, y) => `  row ${y + 1}: ${row.map((c) => `lum ${pct(c.lum)}/detail ${pct(c.detail)}`).join(' | ')}`);
  return [
    `Photo ${s.width}×${s.height}. Mean luminance ${pct(s.mean)} (linear; 18% is a mid grey), ${pct(s.darkFraction)} of pixels near black. Brightest mass at x=${pct(s.brightCentre.x)}, y=${pct(s.brightCentre.y)} from the top-left.`,
    `Zones (lum / detail / quiet score): ${ZONES.map((z) => `${z} ${pct(s.zones[z].lum)}/${pct(s.zones[z].detail)}/${pct(s.zones[z].quiet)}`).join(', ')}. Quietest: ${s.quietest}.`,
    `Grid (${s.cols}×${s.rows}, top row first):`,
    ...gridLines,
  ].join('\n');
}
