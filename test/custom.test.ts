import { describe, expect, it } from 'vitest';
import type { CustomSpec } from '../src/calendar/rows.js';
import { applyCustomWording, customNote, customResolveNote, defaultTemplate, keepFormats, parseCustomCommand, parseCustomInput, photosOf } from '../src/pipeline/custom.js';
import { parseCaption } from '../src/intake/caption.js';

describe('/custom from Telegram', () => {
  it('reads the product and the choices from one line', () => {
    const c = parseCustomCommand('chapli kebab poster story tomorrow 7pm -- Hand-formed, fire-finished. | Come hungry.', '2026-11-04');
    expect(c).toEqual({
      product: 'chapli kebab', style: 'poster', formats: ['story'], date: '2026-11-05', postTime: '19:00',
      // The title is left for the caller to fill with the product's name as the menu spells it.
      wording: { headline: '', line: 'Hand-formed, fire-finished.', caption: 'Come hungry.' }, sloganIndex: null,
    });
    expect(parseCustomCommand('chapli kebab -- title: Smoke / signals | Grilled every evening. | Come hungry.', '2026-11-04').wording)
      .toEqual({ headline: 'Smoke\nsignals', line: 'Grilled every evening.', caption: 'Come hungry.' });
  });

  it('defaults to both formats, today, the art director and the agent’s wording', () => {
    expect(parseCustomCommand('Beef Seekh', '2026-11-04')).toEqual({ product: 'Beef Seekh', style: 'auto', formats: ['feed', 'story'], date: '2026-11-04', postTime: null, wording: null, sloganIndex: null });
    expect(parseCustomCommand('beef seekh both 2026-11-20 18:30 -- 2', '2026-11-04')).toMatchObject({ formats: ['feed', 'story'], date: '2026-11-20', postTime: '18:30', sloganIndex: 2, wording: null });
    expect(() => parseCustomCommand('poster story', '2026-11-04')).toThrow(/Which product/);
    expect(() => parseCustomCommand('chapli -- | only a caption', '2026-11-04')).toThrow(/words/);
  });

  it('picks the karahi series for a karahi and matches a product to its earlier photos', () => {
    expect(defaultTemplate('Chicken Karahi')).toMatch(/karahi/);
    expect(defaultTemplate('Chapli Kebab')).not.toMatch(/karahi/);
    expect(defaultTemplate('Carrot Juice', 'Beverages')).toBe('fresh-pour');
    expect(defaultTemplate('Mango Lassi')).toBe('fresh-pour');
    expect(defaultTemplate('Gulab Jamun', 'Sweets')).toBe('save-room');
    expect(defaultTemplate('Lamb Karahi', 'Karahis & Curries')).toMatch(/karahi/);
    expect(defaultTemplate('Lamb Burger', 'Burgers, Wraps & Snacks')).toBe('modern-fuadijan');
    const photos = [
      { assetId: 1, thumb: null, caption: 'chapli kebab #day2', dayNo: 2, dish: 'Chapli Kebab', createdAt: new Date() },
      { assetId: 2, thumb: null, caption: 'karahi', dayNo: 4, dish: 'Chicken Karahi', createdAt: new Date() },
    ];
    expect(photosOf(photos, 'chapli').map((p) => p.assetId)).toEqual([1]);
    expect(photosOf(photos, 'Lamb Karahi').map((p) => p.assetId)).toEqual([2]);
  });
});

const good = { product: 'Chicken Karahi', template: 'from-the-karahi', style: 'poster', formats: ['feed', 'story'], wording: { headline: 'Time to\nSavour the Karahi', line: 'Cooked to order.', caption: '' }, date: '2026-11-10', postTime: '18:30' };

describe('the Create flow', () => {
  it('checks the request and keeps two headline lines at most', () => {
    const input = parseCustomInput(good);
    expect(input).toMatchObject({ product: 'Chicken Karahi', template: 'from-the-karahi', style: 'poster', formats: ['feed', 'story'], date: '2026-11-10', postTime: '18:30', sloganId: null });
    expect(input.wording).toEqual({ headline: 'Time to\nSavour the Karahi', line: 'Cooked to order.', caption: '' });
    expect(parseCustomInput({ ...good, wording: { headline: 'One\n\nTwo\nThree' } }).wording?.headline).toBe('One\nTwo');
    expect(parseCustomInput({ ...good, wording: null, style: undefined, postTime: '' })).toMatchObject({ wording: null, style: 'auto', postTime: null });
    expect(parseCustomInput({ ...good, formats: ['story', 'story', 'square'] }).formats).toEqual(['story']);
    // A reel is made on its own, with its cover text and the text cards over the video; a post keeps neither.
    const reel = parseCustomInput({ ...good, formats: ['feed', 'reel'], hook: 'Hear that sizzle', onScreen: 'One\n \nTwo', cta: 'Comment aloo or mooli.', hashtags: 'paratha, #Paratha #FromTheTawa' });
    expect(reel).toMatchObject({ formats: ['reel'], hook: 'Hear that sizzle', onScreen: ['One', 'Two'], cta: 'Comment aloo or mooli.', hashtags: '#paratha #Paratha #FromTheTawa' });
    expect(parseCustomInput({ ...good, hook: 'x', onScreen: ['a'] })).toMatchObject({ hook: null, onScreen: null, cta: null, hashtags: null });
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
    const copy = { label: 'L', headline: 'Chapli\nKebab', line: 'agent line', caption: 'agent caption', cta: 'Order now.', hashtags: ['#a', '#b', '#c'], alt_text: 'a', story_text: 's', facebook_caption: 'agent caption Order now.', versions: null, on_screen_text: [], unresolved: [{ field: 'other' as const, placeholder: '', question: 'q', suggestions: [] }], variants: [] };
    const spec: CustomSpec = { product: 'Chapli Kebab', style: 'auto', formats: ['feed'], wording: { headline: 'Karahi\nFirst', line: '', caption: '' }, sloganId: null };
    const out = applyCustomWording(copy, spec);
    expect(out).toMatchObject({ headline: 'Karahi\nFirst', line: 'agent line', caption: 'agent caption', facebook_caption: 'agent caption Order now.', unresolved: [] });
    const own = applyCustomWording(copy, { ...spec, wording: { headline: 'H', line: 'my line', caption: 'my caption' } });
    expect(own).toMatchObject({ headline: 'H', line: 'my line', caption: 'my caption', facebook_caption: 'my caption Order now.' });
    expect(applyCustomWording(copy, { ...spec, wording: null })).toBe(copy);
    // The call to action, hashtags and text cards the owner picked are kept word for word, with or without a wording.
    const picked = applyCustomWording(copy, { ...spec, wording: null, cta: 'Save this.', hashtags: '#one #two', onScreen: ['A', 'B'] });
    expect(picked).toMatchObject({ headline: 'Chapli\nKebab', cta: 'Save this.', hashtags: ['#one', '#two'], on_screen_text: ['A', 'B'], facebook_caption: 'agent caption Save this.' });
    expect(customResolveNote(spec)).toMatch(/exactly as given.*Karahi \/ First.*leave unresolved empty/s);
    expect(customResolveNote({ ...spec, wording: null })).toMatch(/Write the headline, line and caption/);
  });

  it("cleans the invite's details: a date, a time and a short message, or nothing", async () => {
    const { cleanInvite } = await import('../src/calendar/rows.js');
    expect(cleanInvite({ date: '2026-11-14', time: ' 7AM – 10PM ', message: 'All day' })).toEqual({ date: '2026-11-14', time: '7AM – 10PM', message: 'All day' });
    expect(cleanInvite({ date: '14/11', time: '', message: '' })).toBeNull();
    expect(cleanInvite({ message: 'A message much longer than the column allows' })).toEqual({ date: null, time: '', message: 'A message much longer th' });
    expect(cleanInvite(null)).toBeNull();
    expect(parseCustomInput({ ...good, style: 'invite', invite: { time: 'From 7AM' } }).invite).toEqual({ date: null, time: 'From 7AM', message: '' });
  });

  it("keeps a look's price, dishes, text side and italic line, and drops what is not set", async () => {
    const { cleanInvite } = await import('../src/calendar/rows.js');
    expect(cleanInvite({ price: ' $25 ', message: 'Only' })).toEqual({ date: null, time: '', message: 'Only', price: '$25' });
    expect(cleanInvite({ menu: [{ name: 'Chicken karahi', price: '$22' }, { name: '  ', price: '$1' }, { name: 'Lassi' }] })).toEqual({ date: null, time: '', message: '', menu: [{ name: 'Chicken karahi', price: '$22' }, { name: 'Lassi', price: '' }] });
    expect(cleanInvite({ side: 'right', accent: 'orange', lead: 'Made with love' })).toEqual({ date: null, time: '', message: '', side: 'right', accent: 'orange', lead: 'Made with love' });
    // The words for the italic line only count with a colour; an unknown side or colour is dropped.
    expect(cleanInvite({ accent: 'none', lead: 'Fresh from' })).toEqual({ date: null, time: '', message: '', accent: 'none' });
    expect(cleanInvite({ side: 'middle', accent: 'purple', lead: 'x' })).toBeNull();
  });

  it('notes the look and the change asked for when a design is made again', async () => {
    const { remakeNote } = await import('../src/pipeline/wording.js');
    expect(remakeNote('invite', ' words at the top ')).toBe('invite style, words at the top');
    expect(remakeNote('auto', '')).toBeNull();
    expect(remakeNote(null, 'bigger title')).toBe('bigger title');
  });

  it('keeps only the formats asked for', () => {
    const outs = [{ format: 'feed' as const }, { format: 'story' as const }];
    expect(keepFormats(outs, { product: 'x', style: 'auto', formats: ['story'], wording: null, sloganId: null }).map((o) => o.format)).toEqual(['story']);
    expect(keepFormats(outs, null)).toBe(outs);
    const reel = [...outs, { format: 'reel-cover' as const }];
    expect(keepFormats(reel, { product: 'x', style: 'auto', formats: ['reel'], wording: null, sloganId: null }).map((o) => o.format)).toEqual(['reel-cover']);
    expect(keepFormats(reel, { product: 'x', style: 'auto', formats: ['feed'], wording: null, sloganId: null }).map((o) => o.format)).toEqual(['feed']);
  });

  it('reads the three-digit day tags custom posts use', () => {
    expect(parseCaption('chicken karahi #day101')).toMatchObject({ subject: 'chicken karahi', dayNo: 101 });
  });
});
