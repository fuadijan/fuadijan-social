import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ResolvedCopy } from '../src/brain/schemas.js';
import { applyRecord, listLines, platformVersions, platformsTxt, shotsAsInstructions } from '../src/calendar/record.js';
import { brandLineOn, shotList } from '../src/pipeline/packs.js';
import { readWorkbook } from '../calendar/seed.js';
import { sheetDate } from '../calendar/layouts.js';
import { stripAddressLine } from '../calendar/calendar.schema.js';
import { buildRecordExample, RECORD_EXAMPLE } from '../calendar/template-workbook.js';
import { writeWorkbook } from '../calendar/xlsx-write.js';

const dir = mkdtempSync(join(tmpdir(), 'fj-record-'));

const written = {
  label: 'FROM THE FIRE', headline: 'Bbq Fish Whole Barramundi', line: 'Writer line.', caption: 'Writer caption.', cta: 'Writer CTA.',
  hashtags: ['#One', '#Two', '#Three'], alt_text: 'A whole fish.', story_text: 'Fish?', facebook_caption: 'Writer facebook.', on_screen_text: [], unresolved: [],
  variants: [{ name: 'Short', headline: 'Bbq Fish Whole Barramundi', line: 'Short line.', caption: 'Short caption.' }],
  versions: { reel_cover_text: 'WRITER COVER', tiktok_opening: 'Writer opening', tiktok_hook: 'Writer hook', tiktok_script: 'Writer script', tiktok_cta: 'Writer tiktok CTA', tiktok_hashtags: ['#Tok'], stories: ['Writer story'], image_prompt: 'Writer prompt' },
} as unknown as ResolvedCopy;

const row = (content: Record<string, string> | null, hashtags: string | null = null) => ({ content, hashtags, caption: 'Sheet caption.', cta: 'Sheet CTA.', objective: 'Build seafood awareness', benefit: 'More Choice For Customers' });

describe('the post record', () => {
  it("keeps the owner's text over the writer's", () => {
    const copy = applyRecord(written, row({ canva_headline: 'WHOLE BBQ\nBARRAMUNDI', canva_subheading: 'FROM THE CHARCOAL SEA', hook: 'Not everything off the grill is a kebab.', facebook_caption: 'Made to be shared.', facebook_cta: 'Who would you share this with?' }, '#A #B #C #D #E #F #G #H'));
    expect(copy).toMatchObject({ label: 'FROM THE CHARCOAL SEA', headline: 'WHOLE BBQ\nBARRAMUNDI', line: 'Not everything off the grill is a kebab.', facebook_caption: 'Made to be shared.\n\nWho would you share this with?' });
    expect(copy.hashtags).toHaveLength(8);
    // The alternatives keep the owner's title, as the main copy does.
    expect(copy.variants[0]).toMatchObject({ headline: 'WHOLE BBQ\nBARRAMUNDI', line: 'Short line.' });
  });

  it('leaves a classic row alone, a bracketed hashtag to the writer, and the wording to an owner note', () => {
    expect(applyRecord(written, row(null, '#A #B'))).toBe(written);
    expect(applyRecord(written, row({}, '#A [#maybe]')).hashtags).toEqual(written.hashtags);
    const noted = applyRecord(written, row({ canva_headline: 'WHOLE BBQ', hook: 'A hook.' }), true);
    expect(noted).toMatchObject({ headline: written.headline, line: written.line });
  });

  it('draws each platform from the record first and the writer second', () => {
    const p = platformVersions(row({ tiktok_script: 'Owner script.', tiktok_hashtags: '#FoodTok #Barramundi', story_sequence: 'Poll: Fish or BBQ?\nWhy not both?', content_goal: 'Awareness', kpi: 'Reach, saves' }), written);
    expect(p.tiktok).toMatchObject({ script: 'Owner script.', opening: 'Writer opening', hashtags: ['#FoodTok', '#Barramundi'] });
    expect(p.stories).toEqual(['Poll: Fish or BBQ?', 'Why not both?']);
    expect(p.reel_cover).toBe('WRITER COVER');
    expect(p.image_prompt).toBe('Writer prompt');
    expect(p.notes).toMatchObject({ goal: 'Awareness', objective: 'Build seafood awareness', kpi: 'Reach, saves' });
    const txt = platformsTxt(p);
    expect(txt).toContain('=== TIKTOK ===');
    expect(txt).toContain('Owner script.');
    expect(txt).toContain('INTERNAL NOTES (never posted)');
  });

  it('shows what the record has before a pack exists, and leaves out what it does not', () => {
    const p = platformVersions(row({ canva_headline: 'WHOLE BBQ' }), null);
    expect(p).toMatchObject({ canva: { headline: 'WHOLE BBQ' }, instagram: { caption: 'Sheet caption.', cta: 'Sheet CTA.' }, reel_cover: '', stories: [] });
    expect(platformsTxt(p)).not.toContain('=== TIKTOK ===');
  });

  it('turns a shot list cell into the instructions the shoot section reads', () => {
    expect(listLines('Shot 1\nWhole fish on bench\nShot 2: Marinade\n3) Smoke rising\n- Serving shot')).toEqual(['Whole fish on bench', 'Marinade', 'Smoke rising', 'Serving shot']);
    expect(shotList(shotsAsInstructions('Whole fish on bench\nFish hitting grill\nSmoke rising'))).toEqual(['Whole fish on bench', 'Fish hitting grill', 'Smoke rising']);
    expect(shotList(shotsAsInstructions('Real Barramundi preparation; grill; turn; finished serving'))).toEqual(['Real Barramundi preparation', 'grill', 'turn', 'finished serving']);
    expect(shotsAsInstructions(null)).toBeNull();
  });

  it('takes the address out of a caption wherever it sits, because the pack adds it', () => {
    expect(stripAddressLine('Fire.\n\n📍 Auburn\n\n🔥 Smoked.')).toBe('Fire.\n\n🔥 Smoked.');
    expect(stripAddressLine('Fire.\n📍 123 Parramatta Rd')).toBe('Fire.');
  });
});

describe('the brand line', () => {
  it('says smoked only from the day charcoal arrives', () => {
    expect(brandLineOn('2026-12-14')).toBe('GRILLED. ROOTED IN TRADITION.');
    expect(brandLineOn('2026-12-15')).toBe('SMOKED. GRILLED. ROOTED IN TRADITION.');
    expect(brandLineOn(null)).toBe('SMOKED. GRILLED. ROOTED IN TRADITION.');
  });
});

describe('the example record', () => {
  it('loads as one row, every column read', async () => {
    const path = join(dir, 'example.xlsx');
    await buildRecordExample(path);
    const wb = await readWorkbook(path);
    expect(wb.unread).toEqual([]);
    expect(wb.rows).toHaveLength(1);
    const r = wb.rows[0]!;
    expect(r).toMatchObject({ day_no: 1, date: '2026-11-19', slot: 'reel', template: 'from-the-charcoal-sea', dish: 'BBQ Barramundi', campaign: 'CAMP004', benefit: 'More Choice For Customers', theme: RECORD_EXAMPLE.Hook, objective: 'Build seafood awareness', status: 'planned' });
    expect(r.content).toMatchObject({ canva_headline: 'WHOLE BBQ\nBARRAMUNDI', reel_cover_text: 'NOT EVERYTHING OFF\nTHE GRILL IS A KEBAB', tiktok_cta: 'Would you order this?', priority: 'High', funnel_stage: 'Discovery' });
    expect(shotList(r.creative_instructions)).toHaveLength(7);
    expect(r.story_ideas).toContain('Poll: Fish or BBQ?');
    expect(r.hashtags?.split(' ')).toHaveLength(8);
  });
});

describe('dates and weekdays in the sheet', () => {
  it('reads the date forms a planning document uses', () => {
    expect(sheetDate('2026-11-19')).toBe('2026-11-19');
    expect(sheetDate('19/11/2026')).toBe('2026-11-19');
    expect(sheetDate('19 Nov 2026')).toBe('2026-11-19');
    expect(sheetDate('19-Nov', { start: '2026-11-02' })).toBe('2026-11-19');
    expect(sheetDate('Nov 19', { today: '2026-11-04' })).toBe('2026-11-19');
    // A month long past means next year's.
    expect(sheetDate('4-Jan', { today: '2026-11-04' })).toBe('2027-01-04');
    expect(sheetDate('soon')).toBeNull();
  });

  it('numbers a weekday-dated sheet by date, and stops on a weekday that does not match', async () => {
    const path = join(dir, 'weekday.xlsx');
    const head = ['Date', 'Day', 'ProductID', 'Series', 'Format'];
    await writeWorkbook(path, [{ name: 'Calendar', rows: [head, ['19-Nov', 'Thursday', 'Chapli Kebab', 'FROM THE FIRE', 'Reel'], ['18-Nov', 'Wed', 'Chicken Karahi', 'FROM THE KARAHI', 'Photo']] }]);
    const { rows } = await readWorkbook(path, { start: '2026-11-01' });
    expect(rows.map((r) => [r.day_no, r.date, r.dish])).toEqual([[1, '2026-11-18', 'Chicken Karahi'], [2, '2026-11-19', 'Chapli Kebab']]);
    await writeWorkbook(path, [{ name: 'Calendar', rows: [head, ['18-Nov', 'Thursday', 'BBQ Barramundi', 'FROM THE CHARCOAL SEA', 'Reel']] }]);
    await expect(readWorkbook(path, { start: '2026-11-01' })).rejects.toThrow(/Calendar row 2: 2026-11-18 is a Wednesday, but the sheet says Thursday/);
  });

  it('reads a Content Records sheet: serial dates, one column per shot and per story frame', async () => {
    const path = join(dir, 'records.xlsx');
    await writeWorkbook(path, [{ name: 'Content Records', rows: [
      ['PostID', 'Date', 'Day', 'ProductID', 'Series', 'Format', 'Status', 'Instagram Caption', 'Shot 1', 'Shot 2', 'Story 1 Text', 'Story 1 Sticker', 'Story 1 Sticker Options', 'Story 1 Visual', 'TikTok Caption', 'AI Photo Edit Prompt'],
      ['POST-1', 46330, 'Wednesday', 'Chapli Kebab', 'FROM THE FIRE', 'Reel', 'Filmed', 'Hot off the grill.', 'Text card', 'Juice poured', 'Juice Bar opens', 'Countdown', 'Sun 15 Nov', 'A glass', 'Fresh.', 'Keep the real plating.'],
    ] }]);
    const wb = await readWorkbook(path);
    expect(wb.unread).toEqual([]);
    const r = wb.rows[0]!;
    expect(r).toMatchObject({ date: '2026-11-04', status: 'planned', by_date: true, caption: 'Hot off the grill.' });
    expect(shotList(r.creative_instructions)).toEqual(['Text card', 'Juice poured']);
    expect(r.story_ideas).toBe('Story 1: Juice Bar opens · Sticker: Countdown (Sun 15 Nov) · Visual: A glass');
    expect(r.content).toMatchObject({ content_id: 'POST-1', tiktok_caption: 'Fresh.', photo_edit_prompt: 'Keep the real plating.' });
  });

  it("uses a finished caption word for word, and leaves a bracketed one to the writer", () => {
    const clean = applyRecord(written, { content: {}, hashtags: null, caption: 'Owner caption.', cta: 'Owner CTA.' });
    expect(clean).toMatchObject({ caption: 'Owner caption.', cta: 'Owner CTA.' });
    expect(applyRecord(written, { content: {}, hashtags: null, caption: 'Owner [confirm].', cta: null }).caption).toBe(written.caption);
    expect(applyRecord(written, { content: {}, hashtags: null, caption: 'Owner caption.', cta: null }, true).caption).toBe(written.caption);
  });

  it('reports a column nothing reads', async () => {
    const path = join(dir, 'unread.xlsx');
    await writeWorkbook(path, [{ name: 'Calendar', rows: [['Date', 'ProductID', 'Series', 'Instagram Captoin'], ['2026-11-19', 'Chapli Kebab', 'FROM THE FIRE', 'Hello']] }]);
    expect((await readWorkbook(path)).unread).toEqual(['Instagram Captoin']);
  });
});
