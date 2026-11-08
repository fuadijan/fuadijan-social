/**
 * npm run look-samples
 *
 * Draws one sample of every look (styles.ts) with the owner's real photos, so the Look step in the web app can
 * show what each one makes: web/public/looks/<style>.jpg (small, for the picker) and samples/out/look-<style>*.png
 * (full size, feed and story, to check by eye). Run it again after changing a look.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { cutoutFrom } from './images/cutout.js';
import { crop, decode } from './images/prep.js';
import { loadBrand } from './render/brand.js';
import { renderPost, SAMPLE_SETTINGS, type RenderInput } from './render/index.js';
import { STYLE_KEYS, type Style } from './render/styles.js';

const REF = join(process.cwd(), 'brand', 'reference');
const PICKER = join(process.cwd(), 'web', 'public', 'looks');
const OUT = join(process.cwd(), 'samples', 'out');

async function main(): Promise<void> {
  mkdirSync(PICKER, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const brand = loadBrand();
  const karahiFull = (await decode(readFileSync(join(REF, 'real-01.jpg')))).jpeg;
  const karahi = await crop(karahiFull, '4x5');
  const karahiTall = await crop(karahiFull, '9x16');
  const tikkaFull = (await decode(readFileSync(join(REF, 'real-03.jpg')))).jpeg;
  const tikka = await crop(tikkaFull, '4x5');
  const tikkaTall = await crop(tikkaFull, '9x16');
  // Poster and flat need the plate cut out; an oval mask stands in for the background remover.
  const meta = await sharp(karahiFull).metadata();
  const [W, H] = [meta.width!, meta.height!];
  const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W * 0.44}" ry="${H * 0.42}" fill="white"/></svg>`)).png().toBuffer();
  const cutout = await cutoutFrom(karahiFull, mask, { feather: 3, shadowBlur: 40, shadowOpacity: 0.55 });

  const settings = { ...SAMPLE_SETTINGS, handle: '@fuadijan', website: 'fuadijan.com.au' };
  const date = '2026-11-11';
  const base: RenderInput = { sheetTemplate: 'from-the-karahi', slot: 'feed', label: 'COOKED TO ORDER', headline: 'Made Fresh\nin the Karahi', line: 'Prepared from raw ingredients and cooked fresh for every order.', photo: karahi, storyPhoto: karahiTall, cutout: null, settings, date };
  const looks: Record<Style, Partial<RenderInput>> = {
    band: { headline: 'Fresh from\nthe Karahi', invite: { accent: 'gold' } },
    split: { headline: 'Karahi\nFirst', line: 'Cooked to order.', photo: tikka, storyPhoto: tikkaTall },
    poster: { label: 'MODERN FUADIJAN', headline: 'Karahi\nTime!', cutout },
    flat: { label: 'FROM THE FIRE', headline: 'Looking for\nKarahi?', line: "Don't worry. We're open tonight.", cutout },
    invite: { label: "YOU'RE INVITED", headline: 'Grand\nOpening', line: 'Charcoal, karahi and chapli kebab, all evening.' },
    arch: { label: 'FROM ALL OF US', headline: 'Eid Mubarak', line: 'Open all day for Eid, with karahi fresh from the fire.' },
    countdown: { label: 'COMING SOON', headline: 'Aloo Paratha', line: 'Crispy on top, soft inside, made on the tawa.', invite: { date: '2026-11-14' } },
    ribbon: { label: 'FROM THE TAWA', headline: 'Paratha\nwith Chai', line: 'Freshly made in store and served all day.', invite: { message: 'NEW ON THE MENU' }, photo: tikka, storyPhoto: tikkaTall },
    jaali: { label: '14 AUGUST', headline: 'Happy\nIndependence Day', line: 'From our family to yours.' },
    deal: { label: 'EID SPECIAL', headline: 'Family\nFeast', line: 'Karahi, naan and raita for four.', invite: { price: '$59', message: 'ONLY' } },
    menu: { label: 'RAMADAN', headline: 'Iftar Menu', invite: { menu: [{ name: 'Chicken karahi', price: '$22' }, { name: 'Chapli kebab', price: '$14' }, { name: 'Chicken tikka', price: '$16' }, { name: 'Pakora plate', price: '$9' }, { name: 'Mango lassi', price: '$6' }] } },
  };
  for (const style of STYLE_KEYS) {
    const out = await renderPost({ ...base, ...looks[style], design: { style } }, brand);
    for (const o of out) writeFileSync(join(OUT, `look-${style}${o.format === 'feed' ? '' : `-${o.format}`}.png`), o.png);
    const feed = out.find((o) => o.format === 'feed');
    if (feed) await sharp(feed.png).resize({ width: 360 }).jpeg({ quality: 78, mozjpeg: true }).toFile(join(PICKER, `${style}.jpg`));
    console.log(`${style}: ${out.map((o) => o.format).join(', ')}`);
  }
  console.log(`\nPicker samples in ${PICKER}, full size in ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
