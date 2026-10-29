import { describe, expect, it } from 'vitest';
import { cellDate, cleanRow, dedupeNotes, stripAddressLine, stripPastedHeading, CALENDAR_COLUMNS } from '../calendar/calendar.schema.js';

describe('workbook clean-ups', () => {
  it('takes the date part of a midnight-UTC cell without converting zones', () => {
    expect(cellDate(new Date('2026-11-03T00:00:00Z'))).toBe('2026-11-03');
    expect(cellDate('2026-11-03T00:00:00.000Z')).toBe('2026-11-03');
  });

  it('strips the trailing address line from a caption', () => {
    expect(stripAddressLine('Meet the Chapli Kebab at Fuadijan.  \n📍 129 Parramatta Rd, Auburn')).toBe('Meet the Chapli Kebab at Fuadijan.');
    expect(stripAddressLine('No address here')).toBe('No address here');
  });

  it('strips a pasted narrative heading from story_ideas', () => {
    expect(stripPastedHeading('Share the table; poll “BBQ night or Karahi night?”\n\n---\n\n# Days 8–14 · Make Chapli Famous')).toBe('Share the table; poll “BBQ night or Karahi night?”');
  });

  it('treats identical or prefix confirmation notes as empty', () => {
    expect(dedupeNotes('Same text', 'Same text')).toBeNull();
    expect(dedupeNotes('First paragraph.', 'First paragraph.\n\nOn-image text: …')).toBeNull();
    expect(dedupeNotes('Different', 'Instructions')).toBe('Different');
    expect(dedupeNotes(null, 'x')).toBeNull();
  });

  it('cleans a full row', () => {
    const raw = Object.fromEntries(CALENDAR_COLUMNS.map((c) => [c, null])) as Record<(typeof CALENDAR_COLUMNS)[number], unknown>;
    Object.assign(raw, {
      date: new Date('2026-11-04T00:00:00Z'), slot: 'feed', type: 'hero-dish', dish: 'Chapli Kebab', template: 'from-the-fire', status: 'planned',
      caption: 'Meet the Chapli Kebab.  \n📍 129 Parramatta Rd, Auburn', creative_instructions: 'Photo: one kebab.', confirmation_notes: 'Photo: one kebab.',
    });
    const row = cleanRow(raw, 2);
    expect(row).toMatchObject({ day_no: 2, date: '2026-11-04', slot: 'feed', caption: 'Meet the Chapli Kebab.', confirmation_notes: null, post_time: null });
  });
});
