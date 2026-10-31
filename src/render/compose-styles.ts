/**
 * sharp compositing for the styled layouts (styled.ts draws the type):
 *  poster  paper ground → ink layer → plate shadow → plate (in front of the words)
 *  flat    Ember ground → plate bleeding off the bottom → text layer (pill, headline, badge)
 *  invite  Night → the photo on one side fading into the Night → text layer
 * Split uses composeLayoutB (photo full-bleed under the layer) unchanged.
 */
import sharp, { type OverlayOptions } from 'sharp';
import type { Brand } from './brand.js';
import { liftTone, type Cutout } from './compose.js';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

const solid = (hex: string, w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { ...hexToRgb(hex), alpha: 1 } } }).png().toBuffer();

/**
 * A composite input clipped to the canvas, since sharp refuses offsets outside it. Returns null when nothing of
 * the image lands on the canvas.
 */
async function clipped(input: Buffer, left: number, top: number, w: number, h: number): Promise<OverlayOptions | null> {
  const meta = await sharp(input).metadata();
  const iw = meta.width!;
  const ih = meta.height!;
  const x0 = Math.max(0, -left);
  const y0 = Math.max(0, -top);
  const x1 = Math.min(iw, w - left);
  const y1 = Math.min(ih, h - top);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === 0 && y0 === 0 && x1 === iw && y1 === ih) return { input, left, top };
  const cut = await sharp(input).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
  return { input: cut, left: left + x0, top: top + y0 };
}

/** The cutout and its shadow scaled so the plate is `cw` wide (and at most `maxH` tall), placed with its top-left at (left, top). */
async function plateInputs(cut: Cutout, cw: number, maxH: number, left: number, top: number, w: number, h: number, brand: Brand, lift = true): Promise<{ inputs: OverlayOptions[]; cw: number; ch: number }> {
  const scale = Math.min(cw / cut.width, maxH / cut.height);
  const pw = Math.round(cut.width * scale);
  const ph = Math.round(cut.height * scale);
  const shadowMeta = await sharp(cut.shadow).metadata();
  const sw = Math.round(shadowMeta.width! * scale);
  const sh = Math.round(shadowMeta.height! * scale);
  const pad = Math.round((sw - pw) / 2);
  const plate = await sharp(lift ? await liftTone(cut.cutout) : cut.cutout).resize(pw, ph).png().toBuffer();
  const shadow = await sharp(cut.shadow).resize(sw, sh).png().toBuffer();
  const inputs = (await Promise.all([
    clipped(shadow, left - pad, top - pad + brand.cutout.shadow.offsetY, w, h),
    clipped(plate, left, top, w, h),
  ])).filter((x): x is OverlayOptions => x !== null);
  return { inputs, cw: pw, ch: ph };
}

/** Cream paper: a faint Sand grid, a soft Charcoal glow where the plate will sit, ember sparkles in the corners. */
export async function paperBackground(brand: Brand, w: number, h: number, glowAt: { x: number; y: number }): Promise<Buffer> {
  const star = (cx: number, cy: number, r: number) => `<path d="M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r} Z" fill="${brand.colors.ember}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <pattern id="g" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M54 0H0V54" fill="none" stroke="${brand.colors.sand}" stroke-opacity="0.38" stroke-width="1"/></pattern>
      <radialGradient id="v" cx="${glowAt.x}" cy="${glowAt.y}" r="0.6"><stop offset="0" stop-color="${brand.colors.charcoal}" stop-opacity="0.22"/><stop offset="1" stop-color="${brand.colors.charcoal}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="${brand.colors.cream}"/>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#v)"/>
    ${star(w * 0.13, h * 0.84, 26)}${star(w * 0.19, h * 0.875, 15)}
    ${star(w * 0.9, h * 0.8, 24)}${star(w * 0.855, h * 0.83, 13)}
    ${star(w * 0.88, h * 0.1, 12)}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Poster: the plate sits in front of the stacked headline, centred, its top at `plate.top` of the height. */
export async function composePoster(brand: Brand, w: number, h: number, cut: Cutout, inkLayer: Buffer, plate: { top: number; maxHeight: number; width: number }): Promise<Buffer> {
  const cw = Math.round(w * plate.width);
  const maxH = Math.round(h * plate.maxHeight);
  const scale = Math.min(cw / cut.width, maxH / cut.height);
  const pw = Math.round(cut.width * scale);
  const ph = Math.round(cut.height * scale);
  const left = Math.round((w - pw) / 2);
  const top = Math.round(h * plate.top);
  const background = await paperBackground(brand, w, h, { x: 0.5, y: (top + ph / 2) / h });
  const { inputs } = await plateInputs(cut, cw, maxH, left, top, w, h, brand);
  return sharp(background).composite([{ input: inkLayer, left: 0, top: 0 }, ...inputs]).png().toBuffer();
}

/** Flat: Ember ground, the plate wide across the bottom and off the edge, the text layer over everything. */
export async function composeFlat(brand: Brand, w: number, h: number, cut: Cutout, textLayer: Buffer, plate: { top: number; width: number }): Promise<Buffer> {
  const cw = Math.round(w * plate.width);
  const top = Math.round(h * plate.top);
  const left = Math.round((w - cw) / 2);
  const { inputs } = await plateInputs(cut, cw, h, left, top, w, h, brand);
  const ground = await solid(brand.colors.ember, w, h);
  return sharp(ground).composite([...inputs, { input: textLayer, left: 0, top: 0 }]).png().toBuffer();
}

/**
 * Invite: the photo covers `share` of the width from the `photoSide` edge and fades into the Night over the
 * inner 45% of its width, so the text panel is solid Night.
 */
export async function composeInvite(brand: Brand, w: number, h: number, jpeg: Buffer, textLayer: Buffer, photoSide: 'left' | 'right', share: number, opts: { lift?: boolean | 'auto' } = {}): Promise<Buffer> {
  const lift = opts.lift ?? 'auto';
  const lifted = lift === 'auto' ? await liftTone(jpeg) : lift ? await liftTone(jpeg, true) : jpeg;
  const pw = Math.round(w * share);
  const photo = await sharp(lifted).resize(pw, h, { fit: 'cover', position: sharp.strategy.attention }).modulate({ saturation: 1.04, brightness: 0.92 }).png().toBuffer();
  // The fade as a greyscale mask (black = clear, white = photo), joined as the photo's alpha.
  const inner = photoSide === 'right' ? { x1: '0', x2: '1' } : { x1: '1', x2: '0' };
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${h}">
    <defs><linearGradient id="f" x1="${inner.x1}" y1="0" x2="${inner.x2}" y2="0"><stop offset="0" stop-color="black"/><stop offset="0.5" stop-color="white"/><stop offset="1" stop-color="white"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#f)"/>
  </svg>`;
  const alpha = await sharp(Buffer.from(mask)).flatten({ background: '#000000' }).greyscale().raw().toBuffer();
  // (no removeAlpha here: sharp runs it after joinChannel and would strip the mask again)
  const faded = await sharp(photo).joinChannel(alpha, { raw: { width: pw, height: h, channels: 1 } }).png().toBuffer();
  const ground = await solid(brand.colors.night, w, h);
  return sharp(ground)
    .composite([{ input: faded, left: photoSide === 'right' ? w - pw : 0, top: 0 }, { input: textLayer, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
