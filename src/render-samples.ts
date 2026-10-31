/**
 * npm run render-samples
 *
 * Renders every template with sample data and the owner's real photos into samples/out/, next to a copy of the
 * matching Canva reference, so the look can be approved before Day 2. Also exercises the cutout on the three
 * reference photos (real-01..03) when a background remover is configured.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBrand } from './render/brand.js';
import { renderPost, SAMPLE_INPUTS, SAMPLE_SETTINGS } from './render/index.js';
import { cutoutFrom, cutoutUsable, removerFromConfig } from './images/cutout.js';
import { crop, decode } from './images/prep.js';
import type { Cutout } from './render/compose.js';

const OUT = join(process.cwd(), 'samples', 'out');
const REF = join(process.cwd(), 'brand', 'reference');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const brand = loadBrand();
  // The cutout is taken from the whole photo (a 4:5 crop would clip the plate); layout B and stories use the crop.
  const karahiFull = (await decode(readFileSync(join(REF, 'real-01.jpg')))).jpeg;
  const tikkaFull = (await decode(readFileSync(join(REF, 'real-03.jpg')))).jpeg;
  const karahi = await crop(karahiFull, '4x5');
  const plates = await crop(readFileSync(join(REF, 'real-02.jpg')), '4x5');
  const tikka = await crop(tikkaFull, '4x5');

  let cutout: Cutout | null = null;
  let tikkaCutout: Cutout | null = null;
  try {
    const remover = removerFromConfig();
    if (remover.name !== 'none') {
      for (const [name, jpeg] of [['karahi', karahiFull], ['tikka', tikkaFull]] as const) {
        const started = Date.now();
        const m = await remover.remove(jpeg);
        const c = await cutoutFrom(jpeg, m.mask, { feather: brand.cutout.feather, shadowBlur: brand.cutout.shadow.blur, shadowOpacity: brand.cutout.shadow.opacity });
        writeFileSync(join(OUT, `cutout-${name}.png`), c.cutout);
        console.log(`${remover.name} on ${name}: coverage ${(c.coverage * 100).toFixed(0)}% ${cutoutUsable(c.coverage, brand.cutout.minCoverage, brand.cutout.maxCoverage) ? '(usable → layout A)' : '(not usable → layout B)'} in ${Date.now() - started} ms`);
        if (cutoutUsable(c.coverage, brand.cutout.minCoverage, brand.cutout.maxCoverage)) {
          if (name === 'karahi') cutout = c;
          else tikkaCutout = c;
        }
      }
    }
  } catch (e) {
    console.warn(`No cutout: ${e instanceof Error ? e.message : e}`);
  }

  const styleSettings = { ...SAMPLE_SETTINGS, handle: '@fuadijan', website: 'fuadijan.com.au' };
  const jobs: { name: string; ref: string | null; input: Parameters<typeof renderPost>[0] }[] = [
    { name: 'hero-photo-A-karahi', ref: '01.webp', input: { ...SAMPLE_INPUTS['hero-photo'], photo: karahi, cutout, settings: SAMPLE_SETTINGS } },
    { name: 'hero-photo-B-karahi', ref: '02.webp', input: { ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'from-the-karahi', label: 'SIGNATURE KARAHI', headline: 'Chicken\nKarahi', line: 'Fresh chicken simmered in tomatoes, ginger, garlic and aromatic spices, cooked to order.', photo: karahi, cutout: null, settings: SAMPLE_SETTINGS } },
    { name: 'hero-photo-A-tikka', ref: '04.webp', input: { ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'snack-pack', label: 'HOUSE SPECIAL', headline: 'Built for\nCravings', line: 'Chicken tikka over hot crispy chips.', photo: tikka, cutout: tikkaCutout, settings: SAMPLE_SETTINGS } },
    { name: 'review', ref: null, input: { ...SAMPLE_INPUTS.review, photo: plates, cutout: null, settings: SAMPLE_SETTINGS } },
    { name: 'carousel', ref: null, input: { ...SAMPLE_INPUTS.carousel, photo: tikka, cutout: null, slidePhotos: [karahi], settings: SAMPLE_SETTINGS } },
    { name: 'reel-cover', ref: null, input: { ...SAMPLE_INPUTS['reel-cover'], photo: tikka, cutout: null, settings: SAMPLE_SETTINGS } },
    { name: 'text-only', ref: null, input: { ...SAMPLE_INPUTS['text-only'], photo: null, cutout: null, settings: SAMPLE_SETTINGS } },
    // The five styles (styles.ts) with the same photos; poster and flat need the karahi cutout.
    { name: 'style-band-accent', ref: null, input: { ...SAMPLE_INPUTS['hero-photo'], headline: 'Time to\nSavour the Karahi', photo: karahi, cutout: null, settings: styleSettings, design: { style: 'band', accent_word: true, layout: 'B' } } },
    { name: 'style-split', ref: null, input: { ...SAMPLE_INPUTS['hero-photo'], headline: 'Karahi\nFirst', line: 'Cooked to order, every evening.', photo: tikka, cutout: null, settings: styleSettings, design: { style: 'split', band_strength: 0.8 } } },
    { name: 'style-poster', ref: null, input: { ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'modern-fuadijan', label: 'MODERN FUADIJAN', headline: 'Karahi\nTime!', photo: karahi, cutout, settings: styleSettings, design: { style: 'poster' } } },
    { name: 'style-flat', ref: null, input: { ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'snack-pack', label: 'FROM THE FIRE', headline: 'Looking for\nKarahi?', line: "Don't worry. We're open tonight.", photo: karahi, cutout, settings: styleSettings, design: { style: 'flat' } } },
    { name: 'style-invite', ref: null, input: { ...SAMPLE_INPUTS['hero-photo'], sheetTemplate: 'new-product-reveal', label: "YOU'RE INVITED", headline: 'Grand\nOpening', line: 'Charcoal, karahi and chapli kebab, all evening.', photo: karahi, cutout: null, settings: styleSettings, date: '2026-11-08', design: { style: 'invite' } } },
  ];
  for (const j of jobs) {
    const started = Date.now();
    const out = await renderPost(j.input, brand);
    for (const o of out) {
      const file = join(OUT, `${j.name}${o.format === 'feed' ? '' : `-${o.format}${o.page ? `-${String(o.page).padStart(2, '0')}` : ''}`}.png`);
      writeFileSync(file, o.png);
    }
    if (j.ref && existsSync(join(REF, j.ref))) copyFileSync(join(REF, j.ref), join(OUT, `${j.name}-REFERENCE.webp`));
    console.log(`${j.name}: ${out.map((o) => `${o.format}${o.page ?? ''}`).join(', ')} in ${Date.now() - started} ms`);
  }
  console.log(`\nWritten to ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
