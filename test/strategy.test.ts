import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyBrief, designBrief, eventsOn, hashtagsFor, loadStrategy, ritualsOn, strategyWordings } from '../src/strategy.js';
import { buildStrategyWorkbook, strategyRows } from '../calendar/strategy-workbook.js';
import { readWorkbook } from '../calendar/seed.js';
import { readSlogansSheet } from '../calendar/slogans.js';
import { templateKeyFor } from '../src/render/registry.js';

const s = loadStrategy();

describe('the marketing strategy as data', () => {
  it('loads and validates brand/strategy.json', () => {
    expect(s.name).toMatch(/Strategy/);
    expect(s.taglines.length).toBe(4);
    expect(s.rituals.map((r) => r.name)).toEqual(['Karahi Night', 'Chapli Kebab Day', 'Student Night', 'Family Combo Weekend']);
    expect(s.plan.days).toHaveLength(30);
  });

  it('turns taglines, posters and captions into bank wordings a design can carry', () => {
    const w = strategyWordings(s);
    expect(w.filter((x) => x.item === 'all').map((x) => x.headline)).toContain('Fresh off the grill.\nHalal, always.');
    expect(w.find((x) => x.item === 'Karahi Night' && x.headline === 'Karahi\nNight')?.line).toMatch(/Every Wednesday/);
    expect(w.find((x) => x.item === 'Chicken Karahi')?.caption).toMatch(/cooked fresh when you order/);
    for (const x of w) {
      const lines = x.headline.split('\n');
      expect(lines.length, x.headline).toBeLessThanOrEqual(2);
      expect(x.headline.length, x.headline).toBeLessThanOrEqual(60);
    }
  });

  it('knows the rituals and events of a date', () => {
    expect(ritualsOn(s, '2026-11-04').map((r) => r.name)).toEqual(['Karahi Night']); // a Wednesday
    expect(ritualsOn(s, '2026-11-06').map((r) => r.name)).toEqual(['Chapli Kebab Day']); // first Friday
    expect(ritualsOn(s, '2026-11-13')).toHaveLength(0); // a later Friday
    expect(ritualsOn(s, '2026-11-10').map((r) => r.name)).toEqual(['Student Night']);
    expect(eventsOn(s, '2027-02-20').map((e) => e.name)).toContain('Ramadan');
    expect(eventsOn(s, '2026-11-10')).toHaveLength(0);
  });

  it('picks hashtag sets from the post\'s words, core first', () => {
    expect(hashtagsFor(s, ['Chicken Karahi'])).toEqual(['#Fuadijan', '#AuburnEats', '#HalalSydney', '#Karahi', '#ChickenKarahi']);
    expect(hashtagsFor(s, ['Exam fuel', 'student'])).toContain('#SydneyStudents');
    expect(hashtagsFor(s, ['Carrot Juice'])).toContain('#FreshJuice');
    expect(hashtagsFor(s, ['Gulab Jamun'])).toContain('#GulabJamun');
    expect(hashtagsFor(s, ['something else'])).toEqual(['#Fuadijan', '#AuburnEats', '#HalalSydney']);
  });

  it('briefs the writer and the art director', () => {
    const brief = copyBrief(s, { date: '2026-11-04', dish: 'Chicken Karahi', theme: null, type: 'hero-dish', slot: 'feed' });
    expect(brief).toMatch(/Positioning: For families/);
    expect(brief).toMatch(/Wednesday 2026-11-04 is Karahi Night/);
    expect(brief).toMatch(/Hero — Most-loved/);
    expect(brief).toMatch(/karahi: #Karahi/);
    expect(brief).toMatch(/Never lead with "healthy halal meals"/);
    expect(copyBrief(s, { date: '2026-11-07', dish: null, theme: null, type: 'reel', slot: 'reel' })).not.toMatch(/Karahi Night \(/);
    expect(designBrief(s)).toMatch(/Deep green belongs to the halal promise/);
  });

  it('builds the plan workbook the seed can read, every template mapped', async () => {
    const rows = strategyRows(s);
    expect(rows).toHaveLength(30);
    for (const r of rows) templateKeyFor(r.template!);
    const nov6 = rows.find((r) => r.date === '2026-11-06')!;
    expect(nov6).toMatchObject({ slot: 'reel', type: 'chapli-kebab-day', dish: 'Chapli Kebab', template: 'chapli-from-the-fire' });
    expect(nov6.caption).toMatch(/Chapli Kebab Day/);
    expect(nov6.confirmation_notes).toMatch(/offer/);
    expect(rows.find((r) => r.date === '2026-11-11')).toMatchObject({ post_time: '17:00', theme: 'Karahi Week · Karahi Night' });
    expect(rows.find((r) => r.date === '2026-11-03')!.slot).toBe('carousel');

    const dir = mkdtempSync(join(tmpdir(), 'fj-strategy-'));
    const path = join(dir, 'strategy.xlsx');
    const built = await buildStrategyWorkbook(path, s);
    expect(built).toEqual({ rows: 30, slogans: strategyWordings(s).length });
    const wb = await readWorkbook(path);
    expect(wb.rows).toHaveLength(30);
    expect(wb.rows[0]).toMatchObject({ day_no: 1, date: '2026-11-02', slot: 'reel', dish: 'Chicken Tikka' });
    expect(wb.rows[29]).toMatchObject({ day_no: 30, date: '2026-12-01' });
    expect(wb.readMe[0]).toMatch(/Strategy/);
    const slogans = await readSlogansSheet(path);
    expect(slogans.length).toBe(strategyWordings(s).length);
    expect(slogans.find((x) => x.item === 'Karahi Night')?.headline).toBe('Karahi\nNight');
  });
});
