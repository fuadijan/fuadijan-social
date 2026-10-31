import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalendarRow } from '../src/calendar/rows.js';
import { ResolvedCopy } from '../src/brain/schemas.js';
import { canvaBriefTxt, captionTxt, reelPackTxt, shotList } from '../src/pipeline/packs.js';

const row = (over: Partial<CalendarRow> = {}): CalendarRow => ({
  id: 2, plan: '2026-11', day_no: 2, date: '2026-11-04', slot: 'feed', type: 'hero-dish', dish: 'Chapli Kebab', theme: 'Make Chapli famous', caption_hint: null, post_time: null,
  template: 'from-the-fire', status: 'planned', asset: null, objective: null,
  creative_instructions: 'Reel shot list: 1) Charcoal catching; 2) flame and smoke; 3) Chapli Kebab on the grill; 4) finished spread. Use quick cuts.',
  on_screen_text: '“THIS IS FUADIJAN” → “FROM THE FIRE” → “SMOKED. GRILLED. ROOTED IN TRADITION.”',
  caption: null, cta: null, hashtags: null, story_ideas: null, confirmation_notes: null, posted_at: null, updated_at: new Date(), ...over,
});
const copy = ResolvedCopy.parse(JSON.parse(readFileSync('test/fixtures/claude/resolve-copy-day2.json', 'utf8')));
const settings = { storeAddress: '129 Parramatta Road, Auburn NSW 2144', openHours: '5PM – 10PM', websiteUrl: 'https://fjtv.nutrimeals.au', instagramHandle: '@fuadijan' };

describe('caption.txt', () => {
  it('follows the exact layout from the brief', () => {
    const txt = captionTxt(row(), copy, settings, '18:00');
    const sections = txt.split('\n').filter((l) => l.startsWith('==='));
    expect(sections).toEqual(['=== CAPTION ===', '=== HASHTAGS (first comment or end of caption) ===', '=== ALT TEXT ===', '=== STORY ===', '=== FACEBOOK ===', '=== POST AT ===']);
    expect(txt).toContain('📍 129 Parramatta Road, Auburn NSW 2144');
    expect(txt).toContain('#Fuadijan #ChapliKebab #PakistaniCuisine #AuburnEats #FromTheFire');
    expect(txt).toContain('Link: https://fjtv.nutrimeals.au   Tag: @fuadijan   Location: Auburn, NSW');
    expect(txt).toContain('Wed 4 Nov, 18:00 — feed');
    expect(txt).not.toMatch(/\*\*/);
  });
});

describe('reel pack', () => {
  it('lifts the shot list and on-screen text in order', () => {
    expect(shotList(row().creative_instructions)).toEqual(['Charcoal catching', 'flame and smoke', 'Chapli Kebab on the grill', 'finished spread']);
    const txt = reelPackTxt(row({ slot: 'reel' }), { ...copy, on_screen_text: ['THIS IS FUADIJAN', 'FROM THE FIRE'] }, 3);
    expect(txt).toContain('Hook (first second): THIS IS FUADIJAN');
    expect(txt).toContain('  1. THIS IS FUADIJAN\n  2. FROM THE FIRE');
    expect(txt).toContain('  1) Charcoal catching');
    expect(txt).toContain("Music: use Instagram's licensed audio.");
    expect(txt).toContain('Clips received: 3');
  });

  it('reads arrow-separated on-screen text when Claude gave none', () => {
    const txt = reelPackTxt(row({ slot: 'reel' }), { ...copy, on_screen_text: [] }, 0);
    expect(txt).toContain('  2. FROM THE FIRE');
  });
});

describe('canva brief', () => {
  it('names the template, layout, texts, crop and palette', () => {
    const txt = canvaBriefTxt(row(), copy, settings, 'A', { feed: 'crop-4x5.jpg', story: 'crop-9x16.jpg' });
    expect(txt).toContain('Template: hero-photo (sheet: from-the-fire) · Layout A');
    expect(txt).toContain('  Chapli\n  Kebab');
    expect(txt).toContain('SMOKED. GRILLED. ROOTED IN TRADITION.');
    expect(txt).toContain('crop-4x5.jpg');
    expect(txt).toContain('#F2B544');
  });
  it('uses the address footer for specials and weekend rows', () => {
    const txt = canvaBriefTxt(row({ template: 'snack-pack' }), copy, settings, 'B', { feed: 'crop-4x5.jpg', story: 'crop-9x16.jpg' });
    expect(txt).toContain('129 PARRAMATTA ROAD, AUBURN NSW 2144');
    expect(txt).toContain('OPEN 5PM – 10PM');
  });
});
