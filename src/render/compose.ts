/**
 * Puts the photo under the satori text layer with sharp: layout A (Night canvas, Charcoal glow, warm Ember glow,
 * the plate cutout with its shadow in the right two-thirds) or layout B (the photo full-bleed under the gradient).
 * Exports PNG at 1080×1350 (feed), 1080×1920 (story) or 1080×1080.
 */
import sharp from 'sharp';
import type { Brand } from './brand.js';

export interface Cutout { cutout: Buffer; shadow: Buffer; width: number; height: number }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

/** Night with a soft Charcoal radial glow, as an SVG so the gradient is smooth. */
export async function nightBackground(brand: Brand, w: number, h: number, glowAt = { x: 0.68, y: 0.5 }): Promise<Buffer> {
  const ember = brand.cutout.glow.opacity;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="c" cx="${glowAt.x}" cy="${glowAt.y}" r="0.75"><stop offset="0" stop-color="${brand.colors.charcoal}"/><stop offset="1" stop-color="${brand.colors.night}"/></radialGradient>
      <radialGradient id="e" cx="${glowAt.x}" cy="${glowAt.y}" r="0.45"><stop offset="0" stop-color="${brand.colors.ember}" stop-opacity="${ember}"/><stop offset="1" stop-color="${brand.colors.ember}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#c)"/>
    <rect width="100%" height="100%" fill="url(#e)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Layout A: cutout (with shadow) scaled to widthRatio of the canvas, centred in the right two-thirds. */
export async function composeLayoutA(brand: Brand, w: number, h: number, cut: Cutout, textLayer: Buffer): Promise<Buffer> {
  const targetW = Math.round(w * brand.cutout.widthRatio);
  const scale = Math.min(targetW / cut.width, (h * 0.78) / cut.height);
  const cw = Math.round(cut.width * scale);
  const ch = Math.round(cut.height * scale);
  const left = Math.round(w - cw - w * 0.02); // flush to the right, 2% in; the left rim may run under the headline
  const top = Math.round((h - ch) / 2 + h * 0.02);
  const shadowMeta = await sharp(cut.shadow).metadata();
  const sw = Math.round(shadowMeta.width! * scale);
  const sh = Math.round(shadowMeta.height! * scale);
  const pad = Math.round((sw - cw) / 2);
  const background = await nightBackground(brand, w, h, { x: (left + cw / 2) / w, y: (top + ch / 2) / h });
  const cutoutResized = await sharp(cut.cutout).resize(cw, ch).png().toBuffer();
  const shadowResized = await sharp(cut.shadow).resize(sw, sh).png().toBuffer();
  return sharp(background)
    .composite([
      { input: shadowResized, left: left - pad, top: top - pad + brand.cutout.shadow.offsetY },
      { input: cutoutResized, left, top },
      { input: textLayer, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Layout B: the photo fills the canvas (attention crop), gentle tone, the text layer with its gradient on top. */
export async function composeLayoutB(brand: Brand, w: number, h: number, jpeg: Buffer, textLayer: Buffer): Promise<Buffer> {
  const photo = await sharp(jpeg).resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).modulate({ brightness: 0.96, saturation: 1.04 }).toBuffer();
  return sharp(photo).composite([{ input: textLayer, left: 0, top: 0 }]).png().toBuffer();
}

/** No photo: the text layer over Night. */
export async function composeTextOnly(brand: Brand, w: number, h: number, textLayer: Buffer): Promise<Buffer> {
  const { r, g, b } = hexToRgb(brand.colors.night);
  return sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } }).composite([{ input: textLayer, left: 0, top: 0 }]).png().toBuffer();
}
