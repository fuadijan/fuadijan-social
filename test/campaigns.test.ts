import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_COLUMNS } from '../calendar/calendar.schema.js';
import { readCampaignsSheet } from '../calendar/campaigns.js';
import { readProductsSheet } from '../calendar/products.js';
import { readBenefitsSheet } from '../calendar/benefits.js';
import { readWorkbook } from '../calendar/seed.js';
import { TEMPLATE_PATH } from '../calendar/template-workbook.js';
import { writeWorkbook, type OutCell } from '../calendar/xlsx-write.js';
import { seriesLabel } from '../src/calendar/rows.js';
import { productFact, productStatus, type Product } from '../src/products.js';
import { suggestedTemplate, templateForSeries } from '../src/render/registry.js';

const dir = mkdtempSync(join(tmpdir(), 'fj-campaigns-'));
const calendarRow = (date: string, dish: string, campaign: string | null = null): OutCell[] =>
  [date, 'feed', 'launch', dish, null, null, '18:30', 'from-the-fire', 'planned', ...Array<null>(9).fill(null), campaign];

describe('the seafood series', () => {
  it('is a series of its own, found from a product name, a category or a sheet label', () => {
    expect(suggestedTemplate('BBQ Barramundi', 'Seafood')).toBe('from-the-charcoal-sea');
    expect(suggestedTemplate('BBQ Prawns')).toBe('from-the-charcoal-sea');
    expect(suggestedTemplate('Chapli Kebab', 'BBQ')).toBe('from-the-fire');
    expect(seriesLabel({ template: 'from-the-charcoal-sea', theme: null, type: 'launch' })).toBe('FROM THE CHARCOAL SEA');
    // The template names the series; the words only guess for a template the registry does not know.
    expect(seriesLabel({ template: 'from-the-fire', theme: 'Barramundi week', type: 'launch' })).toBe('FROM THE FIRE');
    expect(seriesLabel({ template: 'something-else', theme: 'Barramundi week', type: 'launch' })).toBe('FROM THE CHARCOAL SEA');
    expect(seriesLabel({ template: 'you-said-it', theme: null, type: 'social-proof' })).toBe('YOU SAID IT');
    expect(templateForSeries('WHAT WE ATE TODAY')).toBe('what-we-ate-today');
    expect(templateForSeries('FOR OUR CUSTOMERS')).toBe('for-our-customers');
    // A sheet's YOU SAID IT is a photo design; the review design needs a real quote, and is chosen by its own name.
    expect(templateForSeries('YOU SAID IT')).toBe('you-said-it-photo');
    expect(templateForSeries('you-said-it')).toBe('you-said-it');
    expect(templateForSeries('FROM THE CHARCOAL SEA')).toBe('from-the-charcoal-sea');
    expect(templateForSeries('from the charcoal sea')).toBe('from-the-charcoal-sea');
    expect(templateForSeries('fresh-pour')).toBe('fresh-pour');
    expect(templateForSeries('Fresh Pour')).toBe('fresh-pour');
    expect(templateForSeries('FROM THE MOON')).toBeNull();
  });
});

describe('the Campaigns and Products sheets', () => {
  it('reads campaigns with dates, status and series, naming a wrong row', async () => {
    const path = join(dir, 'campaigns.xlsx');
    const head = ['CampaignID', 'Campaign Name', 'Category', 'Series', 'Start Date', 'End Date', 'Status', 'Priority'];
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'Charcoal Seafood Launch', 'Product launch', 'FROM THE CHARCOAL SEA', '2026-12-01', '2026-12-21', 'Active', 'High'], ['CAMP002', 'Juice Bar Launch', null, 'fresh-pour', null, null, null, null]] }]);
    const rows = await readCampaignsSheet(path);
    expect(rows).toEqual([
      { key: 'CAMP001', name: 'Charcoal Seafood Launch', category: 'Product launch', objective: null, success_metric: null, series: 'FROM THE CHARCOAL SEA', template: 'from-the-charcoal-sea', start_date: '2026-12-01', end_date: '2026-12-21', status: 'active', priority: 'high' },
      { key: 'CAMP002', name: 'Juice Bar Launch', category: null, objective: null, success_metric: null, series: 'FRESH POUR', template: 'fresh-pour', start_date: null, end_date: null, status: 'planned', priority: null },
    ]);
    // The planning document's own header: CampaignID | CampaignName | Objective, nothing else.
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [['CampaignID', 'CampaignName', 'Objective'], ['CAMP001', 'Better Food Initiative', 'Food quality perception'], ['CAMP007', 'Community & Trust', 'Reviews and loyalty']] }]);
    expect((await readCampaignsSheet(path)).map((c) => [c.key, c.name, c.objective, c.status])).toEqual([['CAMP001', 'Better Food Initiative', 'Food quality perception', 'planned'], ['CAMP007', 'Community & Trust', 'Reviews and loyalty', 'planned']]);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'One', null, 'FROM THE MOON', null, null, null, null]] }]);
    await expect(readCampaignsSheet(path)).rejects.toThrow(/Campaigns row 2: series "FROM THE MOON"/);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'One', null, null, '2026-12-21', '2026-12-01', 'planned', null]] }]);
    await expect(readCampaignsSheet(path)).rejects.toThrow(/End Date is before Start Date/);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CMP-01', 'One', null, null, 46336, 46418, 'Pre-launch', 1], ['CMP-02', 'Two', null, null, null, null, 'Ready to launch', 2]] }]);
    expect((await readCampaignsSheet(path)).map((c) => [c.key, c.start_date, c.status, c.priority])).toEqual([['CMP-01', '2026-11-10', 'planned', 'high'], ['CMP-02', null, 'planned', 'medium']]);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'One', null, null, null, null, 'maybe', null]] }]);
    await expect(readCampaignsSheet(path)).rejects.toThrow(/status "maybe"/);
    await writeWorkbook(path, [{ name: 'Calendar', rows: [[...CALENDAR_COLUMNS]] }]);
    expect(await readCampaignsSheet(path)).toEqual([]);
  });

  it('reads the roster with every status word the owner might type', async () => {
    const path = join(dir, 'products.xlsx');
    const head = ['ProductID', 'Product Name', 'Category', 'Status', 'Series'];
    await writeWorkbook(path, [{ name: 'Products', rows: [head, ['P001', 'Chapli Kebab', 'BBQ', 'Active', 'FROM THE FIRE'], ['P002', 'BBQ Prawns', 'Seafood', 'Coming Soon', null], [null, 'Stir Fry', 'Main Meal', 'Planned', 'MODERN FUADIJAN']] }]);
    expect(await readProductsSheet(path)).toEqual([
      { key: 'P001', name: 'Chapli Kebab', category: 'BBQ', status: 'active', series: 'FROM THE FIRE', template: 'from-the-fire', launch: null, hero: false, notes: null },
      { key: 'P002', name: 'BBQ Prawns', category: 'Seafood', status: 'coming-soon', series: null, template: null, launch: null, hero: false, notes: null },
      { key: null, name: 'Stir Fry', category: 'Main Meal', status: 'planned', series: 'MODERN FUADIJAN', template: 'modern-fuadijan', launch: null, hero: false, notes: null },
    ]);
    expect(['Current Hero', 'Current Menu', 'Active Growth', 'Upcoming'].map(productStatus)).toEqual(['active', 'active', 'active', 'coming-soon']);
    expect(productFact({ name: 'BBQ Prawns', status: 'coming-soon', launch: '2026-12-15', notes: null } as Product, '2026-12-03')).toMatch(/not on sale on 2026-12-03; it launches 2026-12-15/);
    expect(productFact({ name: 'BBQ Prawns', status: 'coming-soon', launch: '2026-12-15', notes: null } as Product, '2026-12-15')).toBeNull();
    expect(productFact({ name: 'Carrot Juice', status: 'active', launch: 'Current menu', notes: 'A pairing item.' } as Product, '2026-12-15')).toBe('Carrot Juice: A pairing item.');
    expect(productStatus('Growth')).toBe('active');
    expect(productStatus('coming_soon')).toBe('coming-soon');
    expect(productStatus(null)).toBe('active');
    expect(() => productStatus('sold')).toThrow(/not one of/);
    await writeWorkbook(path, [{ name: 'Products', rows: [head, ['P001', 'Chapli Kebab', null, null, null], ['P002', 'chapli kebab', null, null, null]] }]);
    await expect(readProductsSheet(path)).rejects.toThrow(/Products row 3: product "chapli kebab" is listed twice/);
  });

  it('reads the Benefits sheet, under either name', async () => {
    const path = join(dir, 'benefits.xlsx');
    await writeWorkbook(path, [{ name: 'Customer Benefits', rows: [['BenefitID', 'Benefit'], ['BEN001', 'Plenty of Parking Available'], ['BEN002', 'Fully Air Conditioned Dining'], [null, null]] }]);
    expect((await readBenefitsSheet(path)).map((b) => [b.key, b.benefit])).toEqual([['BEN001', 'Plenty of Parking Available'], ['BEN002', 'Fully Air Conditioned Dining']]);
    await writeWorkbook(path, [{ name: 'Customer Benefits', rows: [['BenefitID', 'Benefit Name', 'Category', 'Message', 'Status', 'Series'], ['BEN-02', 'Air-conditioned dining', 'Comfort', 'Enjoy it from 24 December.', 'Available 2026-12-24', 'FOR OUR CUSTOMERS']] }]);
    expect(await readBenefitsSheet(path)).toEqual([{ key: 'BEN-02', benefit: 'Air-conditioned dining', category: 'Comfort', message: 'Enjoy it from 24 December.', status: 'Available 2026-12-24', series: 'FOR OUR CUSTOMERS' }]);
    await writeWorkbook(path, [{ name: 'Benefits', rows: [['BenefitID', 'Benefit'], ['BEN001', 'One'], ['BEN001', 'Two']] }]);
    await expect(readBenefitsSheet(path)).rejects.toThrow(/Benefits row 3: BenefitID BEN001 is used twice/);
    await writeWorkbook(path, [{ name: 'Products', rows: [['ProductID', 'ProductName'], ['P001', 'Chapli Kebab']] }]);
    expect(await readBenefitsSheet(path)).toEqual([]);
  });

  it('reads the campaign layout of a Calendar: Day, ids, series, format and hook', async () => {
    const path = join(dir, 'layout.xlsx');
    const head = ['Day', 'CampaignID', 'ProductID', 'BenefitID', 'Series', 'Format', 'Hook', 'Caption', 'CTA', 'Hashtags', 'Status'];
    await writeWorkbook(path, [{ name: 'Calendar', rows: [
      head,
      [1, 'CAMP001', 'P001', null, 'FROM THE FIRE', 'Reel', "Still haven't tried Chapli Kebab?", 'Some dishes earn their place.', 'Order at fuadijan.com.au', '#ChapliKebab #Fuadijan', null],
      [3, 'CAMP002', null, 'BEN001', 'FOR OUR CUSTOMERS', 'Carousel', 'Easy parking makes a difference', null, null, null, 'Planned'],
      [2, 'CAMP001', 'P002', null, 'FROM THE KARAHI', 'Reel', 'The dish that brings everyone together', null, null, null, null],
      [5, 'CAMP007', null, null, 'WHAT WE ATE TODAY', 'Photo', "Tonight's table", null, null, null, null],
    ] }]);
    await expect(readWorkbook(path)).rejects.toThrow(/no Date column: give the first day/);
    const { rows } = await readWorkbook(path, { start: '2026-12-01' });
    expect(rows.map((r) => [r.day_no, r.date, r.slot, r.template, r.dish, r.benefit, r.campaign, r.theme, r.type])).toEqual([
      [1, '2026-12-01', 'reel', 'from-the-fire', 'P001', null, 'CAMP001', "Still haven't tried Chapli Kebab?", 'hero-dish'],
      [2, '2026-12-02', 'reel', 'from-the-karahi', 'P002', null, 'CAMP001', 'The dish that brings everyone together', 'hero-dish'],
      [3, '2026-12-03', 'carousel', 'for-our-customers', null, 'BEN001', 'CAMP002', 'Easy parking makes a difference', 'benefit'],
      [5, '2026-12-05', 'feed', 'what-we-ate-today', null, null, 'CAMP007', "Tonight's table", 'community'],
    ]);
    expect(rows[0]).toMatchObject({ caption: 'Some dishes earn their place.', cta: 'Order at fuadijan.com.au', hashtags: '#ChapliKebab #Fuadijan', status: 'planned' });
    // A Date column wins over the first day; a bad series or a repeated day names its row.
    await writeWorkbook(path, [{ name: 'Calendar', rows: [[...head, 'Date'], [1, null, 'P001', null, 'FROM THE FIRE', 'Reel', null, null, null, null, null, '2027-01-04']] }]);
    expect((await readWorkbook(path, { start: '2026-12-01' })).rows[0]!.date).toBe('2027-01-04');
    await writeWorkbook(path, [{ name: 'Calendar', rows: [head, [1, null, 'P001', null, 'FROM THE MOON', 'Reel', null, null, null, null, null]] }]);
    await expect(readWorkbook(path, { start: '2026-12-01' })).rejects.toThrow(/Calendar row 2 \(Day 1\): series "FROM THE MOON"/);
    await writeWorkbook(path, [{ name: 'Calendar', rows: [head, [1, null, 'P001', null, null, 'Reel', null, null, null, null, null], [1, null, 'P002', null, null, 'Reel', null, null, null, null, null]] }]);
    await expect(readWorkbook(path, { start: '2026-12-01' })).rejects.toThrow(/Day 1 appears twice/);
  });

  it('takes an optional campaign column after the 18, and refuses a column it does not know', async () => {
    const path = join(dir, 'calendar.xlsx');
    await writeWorkbook(path, [{ name: 'Calendar', rows: [[...CALENDAR_COLUMNS, 'campaign'], calendarRow('2026-12-01', 'P002', 'CAMP001'), calendarRow('2026-12-02', 'Chapli Kebab')] }]);
    const { rows } = await readWorkbook(readFileSync(path));
    expect(rows.map((r) => [r.dish, r.campaign])).toEqual([['P002', 'CAMP001'], ['Chapli Kebab', null]]);
    await writeWorkbook(path, [{ name: 'Calendar', rows: [[...CALENDAR_COLUMNS, 'budget'], calendarRow('2026-12-01', 'Chapli Kebab')] }]);
    await expect(readWorkbook(path)).rejects.toThrow(/columns the app does not know: budget/);
  });

  it('ships in the monthly template with an example row each', async () => {
    const campaigns = await readCampaignsSheet(TEMPLATE_PATH);
    expect(campaigns.map((c) => c.key)).toEqual(['CAMP001', 'CAMP002']);
    expect(campaigns[0]).toMatchObject({ series: 'FROM THE CHARCOAL SEA', template: 'from-the-charcoal-sea', start_date: '2026-12-01', status: 'planned' });
    const products = await readProductsSheet(TEMPLATE_PATH);
    expect(products.map((p) => `${p.name}:${p.status}`)).toEqual(['Chapli Kebab:active', 'BBQ Barramundi:coming-soon', 'Mango Lassi:active', 'Lava Cake:planned']);
    expect((await readBenefitsSheet(TEMPLATE_PATH)).map((b) => b.key)).toEqual(['BEN001', 'BEN002', 'BEN003']);
    expect(campaigns[0]!.objective).toBe('Grow seafood sales');
  });
});
