import { describe, expect, it } from 'vitest';
import type { ResolvedCopy } from '../src/brain/schemas.js';
import type { Slogan } from '../src/slogans.js';
import { asLine, optionAfterSloganEdit, optionsFrom, ownerOptions, type CopyOptions } from '../src/pipeline/wording.js';
import { cleanHashtags, copyWith } from '../src/pipeline/post-text.js';
import { postItems, withBenefitCaptions, type WordingLibrary } from '../src/wordings-view.js';

const copy = {
  headline: 'Beef Seekh', line: 'Hand formed, special spices.', caption: 'Beef Seekh, hand formed and grilled.',
  variants: [{ name: 'Short and punchy', headline: 'Beef Seekh', line: 'Straight off the flame.', caption: 'Beef Seekh, straight off the flame.' }],
} as unknown as ResolvedCopy;

const slogan = (over: Partial<Slogan>): Slogan => ({ id: 1, item: 'all', item_key: 'all', headline: 'Fresh off the grill.\nHalal, always.', line: null, caption: null, source: 'owner', ...over } as Slogan);

describe('wording options', () => {
  it('keeps the product as the title and puts a bank wording on the line', () => {
    const opts = optionsFrom(copy, [slogan({}), slogan({ id: 2, item: 'Beef Seekh', item_key: 'beef seekh', headline: 'Over\nopen flame', line: 'Every evening.', caption: 'Seekh over flame.' })]);
    expect(opts.map((o) => o.name)).toEqual(['Calendar wording', 'Short and punchy', 'Slogan · house', 'Slogan · Beef Seekh']);
    expect(opts[2]).toMatchObject({ headline: 'Beef Seekh', line: 'Fresh off the grill. Halal, always.', caption: copy.caption });
    expect(opts[3]).toMatchObject({ headline: 'Beef Seekh', line: 'Over open flame Every evening.', caption: 'Seekh over flame.' });
  });

  it("carries only the owner's own wordings into the next set", () => {
    const own = { name: 'Your words', headline: 'Lamb Karahi', line: 'Mine.', caption: 'My caption.', owner: true };
    const set = { options: [{ name: 'Calendar wording', headline: 'A', line: 'B', caption: 'C' }, own] } as CopyOptions;
    expect(ownerOptions(set)).toEqual([own]);
    expect(ownerOptions(null)).toEqual([]);
    expect(optionsFrom(copy, [], ownerOptions(set)).at(-1)).toEqual(own);
  });

  it('puts each benefit caption in the one list under its benefit, with or without posts', () => {
    const lib = { name: 'Benefit Caption Templates', title: 'x', header: ['BenefitID', 'Hook'], groupColumn: 0, belongsTo: { 'BEN-01': 'Plenty of parking', 'BEN-02': 'Air conditioning' }, rows: [['BEN-01', 'A'], ['BEN-02', 'B'], ['BEN-01', 'C'], ['BEN-09', 'D']] } as WordingLibrary;
    const parking = { item: 'Plenty of parking', itemKey: 'plenty of parking', category: null, wordings: [], posts: [], templateRows: [], usedOn: [] };
    const groups = withBenefitCaptions([parking], lib);
    expect(groups.map((g) => [g.item, g.templateRows])).toEqual([['Air conditioning', [1]], ['BEN-09', [3]], ['Plenty of parking', [0, 2]]]);
    expect(withBenefitCaptions([parking], undefined)).toEqual([parking]);
  });

  it('puts a post under each dish it names, or under its benefit or series without one', () => {
    const row = { template: 'from-the-karahi', theme: null, type: 'hero-dish', benefit: null };
    expect(postItems({ ...row, dish: 'Lamb Karahi, Chicken Karahi' })).toEqual(['Lamb Karahi', 'Chicken Karahi']);
    expect(postItems({ ...row, dish: '[choose a dish]', benefit: 'Plenty of parking' })).toEqual(['Plenty of parking']);
    expect(postItems({ ...row, dish: null })).toHaveLength(1);
  });

  it('tidies typed hashtags and changes only the edited part of the copy', () => {
    expect(cleanHashtags('halal, #Karahi  #halal\nSydney')).toBe('#halal #Karahi #Sydney');
    const base = { ...copy, cta: 'Order', hashtags: ['#a'], alt_text: 'Alt', story_text: 'Story', label: 'L', facebook_caption: 'FB' } as unknown as ResolvedCopy;
    expect(copyWith(base, 'hashtags', '#x #y').hashtags).toEqual(['#x', '#y']);
    expect(copyWith(base, 'canva_headline', 'New').headline).toBe('New');
    expect(copyWith(base, 'tiktok_script', 'Only the record holds this')).toEqual(base);
    // Clearing a label or a Facebook caption goes back to what the writer drafted.
    expect(copyWith(base, 'canva_subheading', null).label).toBe('L');
    expect(copyWith(base, 'facebook_caption', null).facebook_caption).toBe('FB');
  });

  it('finds a post\'s option from its reusable wording, also when it predates the link, and leaves the owner\'s alone', () => {
    const before = slogan({ id: 7, item: 'Beef Seekh', item_key: 'beef seekh', headline: 'Over\nopen flame', line: null, caption: 'Old caption.' });
    const after = { headline: 'Over\nhot coals', line: 'Every evening.', caption: 'New caption.' };
    const linked = { name: 'Slogan · Beef Seekh', headline: 'Beef Seekh', line: 'Over open flame', caption: 'Old caption.', sloganId: 7 };
    expect(optionAfterSloganEdit(linked, before, after, 'Main.')).toEqual({ ...linked, line: 'Over hot coals Every evening.', caption: 'New caption.' });
    const older = { name: 'Slogan · Beef Seekh', headline: 'Beef Seekh', line: 'Over open flame', caption: 'Old caption.' };
    expect(optionAfterSloganEdit(older, before, after, 'Main.')).toMatchObject({ sloganId: 7, line: 'Over hot coals Every evening.' });
    expect(optionAfterSloganEdit({ ...linked, owner: true }, before, after, 'Main.')).toBeNull();
    expect(optionAfterSloganEdit({ ...linked, sloganId: 8 }, before, after, 'Main.')).toBeNull();
    expect(optionAfterSloganEdit({ name: 'Short and punchy', headline: 'B', line: 'Over open flame', caption: 'C' }, before, after, 'Main.')).toBeNull();
    // Its caption taken away: the post's main caption comes back. One it only borrowed is left.
    expect(optionAfterSloganEdit(linked, before, { ...after, caption: null }, 'Main.')!.caption).toBe('Main.');
    expect(optionAfterSloganEdit({ ...linked, caption: 'Borrowed.' }, { ...before, caption: null }, { ...after, caption: null }, 'Main.')!.caption).toBe('Borrowed.');
  });

  it('flattens a two-line wording into one line and does not repeat its own line', () => {
    expect(asLine('Save\nroom.', null)).toBe('Save room.');
    expect(asLine('Karahi\nNight', 'Every Wednesday')).toBe('Karahi Night Every Wednesday');
    expect(asLine('Karahi Night', 'karahi night')).toBe('Karahi Night');
  });
});
