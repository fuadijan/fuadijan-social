import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_COLUMNS } from '../calendar/calendar.schema.js';
import { readCampaignsSheet } from '../calendar/campaigns.js';
import { readProductsSheet } from '../calendar/products.js';
import { readWorkbook } from '../calendar/seed.js';
import { TEMPLATE_PATH } from '../calendar/template-workbook.js';
import { writeWorkbook, type OutCell } from '../calendar/xlsx-write.js';
import { seriesLabel } from '../src/calendar/rows.js';
import { productStatus } from '../src/products.js';
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
    expect(seriesLabel({ template: 'from-the-fire', theme: 'Barramundi week', type: 'launch' })).toBe('FROM THE CHARCOAL SEA');
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
      { key: 'CAMP001', name: 'Charcoal Seafood Launch', category: 'Product launch', series: 'FROM THE CHARCOAL SEA', template: 'from-the-charcoal-sea', start_date: '2026-12-01', end_date: '2026-12-21', status: 'active', priority: 'high' },
      { key: 'CAMP002', name: 'Juice Bar Launch', category: null, series: 'FRESH POUR', template: 'fresh-pour', start_date: null, end_date: null, status: 'planned', priority: null },
    ]);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'One', null, 'FROM THE MOON', null, null, null, null]] }]);
    await expect(readCampaignsSheet(path)).rejects.toThrow(/Campaigns row 2: series "FROM THE MOON"/);
    await writeWorkbook(path, [{ name: 'Campaigns', rows: [head, ['CAMP001', 'One', null, null, '2026-12-21', '2026-12-01', 'planned', null]] }]);
    await expect(readCampaignsSheet(path)).rejects.toThrow(/End Date is before Start Date/);
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
      { key: 'P001', name: 'Chapli Kebab', category: 'BBQ', status: 'active', series: 'FROM THE FIRE', template: 'from-the-fire' },
      { key: 'P002', name: 'BBQ Prawns', category: 'Seafood', status: 'coming-soon', series: null, template: null },
      { key: null, name: 'Stir Fry', category: 'Main Meal', status: 'planned', series: 'MODERN FUADIJAN', template: 'modern-fuadijan' },
    ]);
    expect(productStatus('coming_soon')).toBe('coming-soon');
    expect(productStatus(null)).toBe('active');
    expect(() => productStatus('sold')).toThrow(/not one of/);
    await writeWorkbook(path, [{ name: 'Products', rows: [head, ['P001', 'Chapli Kebab', null, null, null], ['P002', 'chapli kebab', null, null, null]] }]);
    await expect(readProductsSheet(path)).rejects.toThrow(/Products row 3: product "chapli kebab" is listed twice/);
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
  });
});
