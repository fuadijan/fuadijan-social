import { describe, expect, it } from 'vitest';
import type { ResolvedCopy } from '../src/brain/schemas.js';
import type { Slogan } from '../src/slogans.js';
import { asLine, optionAfterSloganEdit, optionsFrom, ownerOptions, type CopyOptions } from '../src/pipeline/wording.js';
import { cleanHashtags, copyWith } from '../src/pipeline/post-text.js';
import { postItems, postsUsingRow, reusableWordings, type PostWording } from '../src/wordings-view.js';
import type { CalendarRow } from '../src/calendar/rows.js';

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

  it('lists the posts under a reusable caption: linked, holding it, or using it', () => {
    const post = (dayNo: number, dish: string, options: PostWording['set'] | null = null, more: Partial<PostWording> = {}) => ({
      row: { day_no: dayNo, date: '2026-11-10', status: 'ready', dish, theme: null } as unknown as CalendarRow,
      wording: { dayNo, set: options, ...more } as PostWording,
    });
    const set = (options: NonNullable<PostWording['set']>['options'], chosen: number | null) => ({ id: 1, options, chosen, createdAt: new Date() });
    const fromIt = { name: 'Slogan · Lamb Karahi', headline: 'T', line: 'Slow cooked', caption: 'C', sloganId: 5 };
    const links = [slogan({ id: 5, item: 'Lamb Karahi', item_key: 'lamb karahi', headline: 'Slow cooked' }), slogan({ id: 5, item: 'Beef Karahi', item_key: 'beef karahi', headline: 'Slow cooked' })];
    const posts = [post(10, 'Lamb Karahi'), post(15, 'Beef Karahi, Naan'), post(20, 'Burger'), post(25, 'Burger', set([fromIt], 0)), post(26, 'Burger', set([{ ...fromIt, sloganId: undefined }], null))];
    const [w] = reusableWordings(links, posts);
    expect(w!.items.map((i) => i.item)).toEqual(['Lamb Karahi', 'Beef Karahi']);
    expect(w!.posts.map((p) => [p.dayNo, Boolean(p.inUse)])).toEqual([[10, false], [15, false], [25, true], [26, false]]);
    // On every post it lists only the posts using it; a caption on nothing reaches nothing.
    const [every] = reusableWordings([slogan({ id: 5, item: 'all', item_key: 'all', headline: 'Slow cooked' })], posts);
    expect(every!.posts.map((p) => p.dayNo)).toEqual([25]);
    const [none] = reusableWordings([slogan({ id: 6, item: '', item_key: '', headline: 'Alone' })], posts);
    expect([none!.items, none!.posts]).toEqual([[], []]);
  });

  it('finds the posts using a library row by their text', () => {
    const post = (dayNo: number, w: Partial<PostWording>, benefit: string | null = null) => ({
      row: { day_no: dayNo, date: '2026-11-10', status: 'ready', benefit, content: null } as unknown as CalendarRow,
      wording: { dayNo, line: '', cta: '', caption: '', hashtags: '', platforms: null, ...w } as PostWording,
    });
    const days = (header: string[], row: string[], posts: ReturnType<typeof post>[], more = {}) => postsUsingRow({ header, ...more }, row, posts).map((p) => p.dayNo);
    expect(days(['HookID', 'Series', 'Hook'], ['H', 'S', '"Rate  this skewer."'], [post(1, { line: 'rate this skewer.' }), post(2, { line: 'Other' })])).toEqual([1]);
    expect(days(['CTAID', 'CTA', 'Goal'], ['C', 'Come in tonight.', 'Visit'], [post(3, { cta: 'Come in tonight.' }), post(4, { cta: 'Later' })])).toEqual([3]);
    expect(days(['Tag Group', 'Platform', 'Hashtags'], ['Core', 'Instagram', '#a #B'], [post(5, { hashtags: '#c #b #A' }), post(6, { hashtags: '#a' })])).toEqual([5]);
    expect(days(['BenefitID', 'Hook', 'Caption Template'], ['BEN-01', 'H', 'C'], [post(7, {}, 'Plenty of parking'), post(8, {}, 'Air conditioning')], { groupColumn: 0, belongsTo: { 'BEN-01': 'Plenty of parking' } })).toEqual([7]);
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
