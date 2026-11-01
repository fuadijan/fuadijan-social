import { describe, expect, it } from 'vitest';
import type { CalendarRow } from '../src/calendar/rows.js';
import { daySlug, placeholders, rowTitle, seriesLabel } from '../src/calendar/rows.js';
import { briefLine, describeNeeds, morningBrief, shootReminder } from '../src/messaging/formats.js';
import { templateKeyFor, assertAllMapped, knownTemplates } from '../src/render/registry.js';

const row = (over: Partial<CalendarRow> = {}): CalendarRow => ({
  id: 4, plan: '2026-11', day_no: 4, date: '2026-11-06', slot: 'reel', type: 'hero-dish', dish: 'Chicken Karahi', theme: 'From the Karahi', caption_hint: null, post_time: null,
  template: 'from-the-karahi', status: 'planned', asset: null, objective: null,
  creative_instructions: 'Reel shot list: 1) Fresh ingredients ready; 2) karahi warming; 3) ingredients added; 4) finished karahi.',
  on_screen_text: null, caption: 'Pair it with [confirm available bread/rice options].', cta: null, hashtags: null, story_ideas: null, confirmation_notes: null, custom: null, posted_at: null, updated_at: new Date(), ...over,
});

describe('needs and the brief', () => {
  it('says what is still needed in plain words', () => {
    expect(describeNeeds(row(), { photos: 0, clips: 0 }, 0, 1).words).toBe('Needs: clips and 1 confirmation.');
    expect(describeNeeds(row({ slot: 'feed', status: 'ready' }), { photos: 1, clips: 0 }, 0, 0).words).toBe('Nothing — ready to post.');
    expect(describeNeeds(row({ dish: null, slot: 'feed' }), { photos: 0, clips: 0 }, 2, 0).words).toBe('Needs: a dish to choose, a hero photo and 2 confirmations.');
    expect(describeNeeds(row({ status: 'posted' }), { photos: 1, clips: 1 }, 0, 0).words).toBe('Posted.');
  });

  it('writes the brief line like the brief', () => {
    const line = briefLine(row(), describeNeeds(row(), { photos: 0, clips: 0 }, 0, 1), null);
    expect(line).toContain('Fri 6 Nov — Reel · Chicken Karahi (From the Karahi) · planned');
    expect(line).toContain('Shoot: Fresh ingredients ready; karahi warming; ingredients added; finished karahi. Vertical.');
    expect(morningBrief([line], 2)).toContain('Open questions: 2 — /ask');
  });

  it('reminds reels with the shot list and feeds with the hero tips', () => {
    expect(shootReminder(row(), 2, false)).toContain('Fresh ingredients ready → karahi warming');
    expect(shootReminder(row({ slot: 'feed' }), 1, false)).toContain('plain dark bench');
    expect(shootReminder(row(), 4, true)).toContain('details to confirm');
  });
});

describe('row helpers', () => {
  it('finds placeholders, labels, slugs and titles', () => {
    expect(placeholders(row())).toEqual(['confirm available bread/rice options']);
    expect(seriesLabel(row())).toBe('FROM THE KARAHI');
    expect(daySlug(row())).toBe('chicken-karahi');
    expect(daySlug(row({ dish: '[Confirm dessert]', theme: 'Save room — confirm dessert' }))).toBe('save-room-confirm-dessert');
    expect(rowTitle(row())).toBe('Day 4 — Chicken Karahi');
  });
});

describe('render registry', () => {
  it('maps every sheet template and fails on an unknown one', () => {
    const sheet = ['brand-intro', 'from-the-fire', 'chapli-education', 'from-the-karahi', 'customer-review', 'family-feast', 'chapli-from-the-fire', 'modern-fuadijan', 'behind-fuadijan', 'snack-pack', 'auburn-community', 'bbq-feast', 'customer-favourite', 'art-of-karahi', 'you-said-it', 'family-table', 'new-product-teaser', 'new-product-reveal', 'save-room', 'rooted-in-tradition', 'team-picks', 'weekend-feast', 'audience-poll', 'brand-finale'];
    expect(() => assertAllMapped(sheet)).not.toThrow();
    expect(templateKeyFor('customer-review')).toBe('review');
    expect(templateKeyFor('chapli-education')).toBe('carousel');
    expect(() => templateKeyFor('nope')).toThrow(/nope/);
    expect(knownTemplates().length).toBeGreaterThanOrEqual(sheet.length);
  });
});
