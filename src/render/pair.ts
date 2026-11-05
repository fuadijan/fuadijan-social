/**
 * Two photos in one design, for two different dishes that look alike once cooked. Each photo carries its dish's
 * name, so nobody has to guess which is which. The feed puts them side by side above the text; the taller story and
 * reel cover stack them, because side by side they would be too narrow to hold a whole plate. The logo and the words stay
 * under the photos, off the food.
 */
import sharp from 'sharp';
import { z } from 'zod';
import type { Brand } from './brand.js';
import { liftTone } from './compose.js';
import { el, footerBox, headline, label, line, logoImg, rule, canvas, spacer, uc, type Ctx, type El } from './templates.js';

const GAP = 6;
/** How much of each canvas the photos take; the rest, under them, is the text's. */
const FEED_PHOTOS = 710;
const TALL_PHOTOS = 1300;
const NAME_MAX = 28;

export interface Panel { left: number; top: number; width: number; height: number }

export function pairPanels(w: number, h: number): [Panel, Panel] {
  if (h / w < 1.5) {
    const width = Math.floor((w - GAP) / 2);
    return [{ left: 0, top: 0, width, height: FEED_PHOTOS }, { left: w - width, top: 0, width, height: FEED_PHOTOS }];
  }
  const height = Math.floor((TALL_PHOTOS - GAP) / 2);
  return [{ left: 0, top: 0, width: w, height }, { left: 0, top: TALL_PHOTOS - height, width: w, height }];
}

/** The shape to crop each photo to, width over height, for a canvas of this size. */
export function pairRatio(w: number, h: number): number {
  const [p] = pairPanels(w, h);
  return p.width / p.height;
}

export const PairData = z.object({
  kind: z.enum(['feed', 'story', 'reel']),
  label: z.string().max(40),
  headline: z.string().max(70),
  line: z.string().max(140).default(''),
  names: z.tuple([z.string().min(1).max(NAME_MAX), z.string().min(1).max(NAME_MAX)]),
  footer: z.enum(['brand', 'address']),
});

function nameTag(ctx: Ctx, name: string, p: Panel): El {
  const { brand } = ctx;
  return el('div', {
    position: 'absolute', left: p.left + 24, top: p.top + p.height - 84, height: 60, paddingLeft: 22, paddingRight: 22, display: 'flex', alignItems: 'center', backgroundColor: 'rgba(15,13,11,0.82)',
    fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 30, letterSpacing: '0.12em', color: brand.colors.cream, whiteSpace: 'nowrap',
  }, uc(name));
}

export function pairLayer(ctx: Ctx, d: z.infer<typeof PairData>): El {
  const { brand, w, h } = ctx;
  const panels = pairPanels(w, h);
  const { margin } = brand.layout;
  const top = panels[1].top + panels[1].height + 34;
  const block: El[] = [label(ctx, d.label, brand.colors.saffron), spacer(14), headline(ctx, d.headline, w - margin * 2 - brand.layout.logoWidth - 24, false, 112).el, rule(ctx)];
  if (d.kind === 'feed' && d.line) block.push(line(ctx, d.line, w - margin * 2, 38, 'left', 2));
  if (d.kind === 'story') block.push(el('div', { display: 'flex', fontFamily: brand.fonts.body.family, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: brand.colors.sand }, brand.brandLine));
  if (d.kind === 'reel') {
    block.push(el('div', { display: 'flex', alignItems: 'center', gap: 14, fontFamily: brand.fonts.body.family, fontSize: 26, color: brand.colors.cream }, [
      el('div', { display: 'flex', width: 54, height: 54, borderRadius: 27, border: `2px solid ${brand.colors.cream}`, alignItems: 'center', justifyContent: 'center' }, '▶'),
      'Watch',
    ]));
  }
  return canvas(ctx, [
    el('div', { position: 'absolute', top, right: margin, display: 'flex' }, logoImg(ctx, {})),
    nameTag(ctx, d.names[0], panels[0]),
    nameTag(ctx, d.names[1], panels[1]),
    el('div', { position: 'absolute', left: margin, right: margin, top, display: 'flex', flexDirection: 'column' }, block),
    ...(d.kind === 'story' ? [] : [footerBox(ctx, d.footer)]),
  ]);
}

/** The two photos on the Night ground with the ember line between them, the text layer on top. */
export async function composePair(brand: Brand, w: number, h: number, photos: [Buffer, Buffer], layer: Buffer): Promise<Buffer> {
  const panels = pairPanels(w, h);
  const hex = brand.colors.night;
  const ground = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), alpha: 1 };
  const placed = await Promise.all(panels.map(async (p, i) => ({
    input: await sharp(await liftTone(photos[i]!)).resize(p.width, p.height, { fit: 'cover', position: sharp.strategy.attention }).png().toBuffer(),
    left: p.left, top: p.top,
  })));
  return sharp({ create: { width: w, height: h, channels: 4, background: ground } }).composite([...placed, { input: layer, left: 0, top: 0 }]).png().toBuffer();
}

