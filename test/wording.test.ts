import { describe, expect, it } from 'vitest';
import type { ResolvedCopy } from '../src/brain/schemas.js';
import type { Slogan } from '../src/slogans.js';
import { asLine, optionsFrom } from '../src/pipeline/wording.js';

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

  it('flattens a two-line wording into one line and does not repeat its own line', () => {
    expect(asLine('Save\nroom.', null)).toBe('Save room.');
    expect(asLine('Karahi\nNight', 'Every Wednesday')).toBe('Karahi Night Every Wednesday');
    expect(asLine('Karahi Night', 'karahi night')).toBe('Karahi Night');
  });
});
