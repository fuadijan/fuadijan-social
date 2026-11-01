import { describe, expect, it } from 'vitest';
import type { CustomSpec } from '../src/calendar/rows.js';
import { applyCustomWording, customNote, customResolveNote, keepFormats, parseCustomInput } from '../src/pipeline/custom.js';
import { parseCaption } from '../src/intake/caption.js';

const good = { product: 'Chicken Karahi', template: 'from-the-karahi', style: 'poster', formats: ['feed', 'story'], wording: { headline: 'Time to\nSavour the Karahi', line: 'Cooked to order.', caption: '' }, date: '2026-11-10', postTime: '18:30' };

describe('the Create flow', () => {
  it('checks the request and keeps two headline lines at most', () => {
    const input = parseCustomInput(good);
    expect(input).toMatchObject({ product: 'Chicken Karahi', template: 'from-the-karahi', style: 'poster', formats: ['feed', 'story'], date: '2026-11-10', postTime: '18:30', sloganId: null });
    expect(input.wording).toEqual({ headline: 'Time to\nSavour the Karahi', line: 'Cooked to order.', caption: '' });
    expect(parseCustomInput({ ...good, wording: { headline: 'One\n\nTwo\nThree' } }).wording?.headline).toBe('One\nTwo');
    expect(parseCustomInput({ ...good, wording: null, style: undefined, postTime: '' })).toMatchObject({ wording: null, style: 'auto', postTime: null });
    expect(parseCustomInput({ ...good, formats: ['story', 'story', 'reel'] }).formats).toEqual(['story']);
    expect(() => parseCustomInput({ ...good, product: ' ' })).toThrow(/product/);
    expect(() => parseCustomInput({ ...good, template: 'customer-review' })).toThrow(/photo series/);
    expect(() => parseCustomInput({ ...good, template: 'nope' })).toThrow(/series/);
    expect(() => parseCustomInput({ ...good, style: 'neon' })).toThrow(/style/);
    expect(() => parseCustomInput({ ...good, formats: [] })).toThrow(/format/);
    expect(() => parseCustomInput({ ...good, date: '10/11/2026' })).toThrow(/date/);
    expect(() => parseCustomInput({ ...good, postTime: '6pm' })).toThrow(/HH:MM/);
    expect(() => parseCustomInput({ ...good, wording: { headline: '' } })).toThrow(/headline/);
  });

  it('locks the chosen style like a note, unless the run names another', () => {
    const spec: CustomSpec = { product: 'Chapli Kebab', style: 'split', formats: ['feed'], wording: null, sloganId: null };
    expect(customNote(spec, null)).toBe('split style');
    expect(customNote(spec, 'bigger text')).toBe('bigger text, split style');
    expect(customNote(spec, 'poster please')).toBe('poster please');
    expect(customNote({ ...spec, style: 'auto' }, 'bigger text')).toBe('bigger text');
    expect(customNote(null, 'x')).toBe('x');
  });

  it("uses the owner's wording as given and asks nothing; the agent's words stay when none is given", () => {
    const copy = { label: 'L', headline: 'Chapli\nKebab', line: 'agent line', caption: 'agent caption', cta: 'Order now.', hashtags: ['#a', '#b', '#c'], alt_text: 'a', story_text: 's', facebook_caption: 'agent caption Order now.', on_screen_text: [], unresolved: [{ field: 'other' as const, placeholder: '', question: 'q', suggestions: [] }], variants: [] };
    const spec: CustomSpec = { product: 'Chapli Kebab', style: 'auto', formats: ['feed'], wording: { headline: 'Karahi\nFirst', line: '', caption: '' }, sloganId: null };
    const out = applyCustomWording(copy, spec);
    expect(out).toMatchObject({ headline: 'Karahi\nFirst', line: 'agent line', caption: 'agent caption', facebook_caption: 'agent caption Order now.', unresolved: [] });
    const own = applyCustomWording(copy, { ...spec, wording: { headline: 'H', line: 'my line', caption: 'my caption' } });
    expect(own).toMatchObject({ headline: 'H', line: 'my line', caption: 'my caption', facebook_caption: 'my caption Order now.' });
    expect(applyCustomWording(copy, { ...spec, wording: null })).toBe(copy);
    expect(customResolveNote(spec)).toMatch(/exactly as given.*Karahi \/ First.*leave unresolved empty/s);
    expect(customResolveNote({ ...spec, wording: null })).toMatch(/Write the headline, line and caption/);
  });

  it('keeps only the formats asked for', () => {
    const outs = [{ format: 'feed' as const }, { format: 'story' as const }];
    expect(keepFormats(outs, { product: 'x', style: 'auto', formats: ['story'], wording: null, sloganId: null }).map((o) => o.format)).toEqual(['story']);
    expect(keepFormats(outs, null)).toBe(outs);
  });

  it('reads the three-digit day tags custom posts use', () => {
    expect(parseCaption('chicken karahi #day101')).toMatchObject({ subject: 'chicken karahi', dayNo: 101 });
  });
});
