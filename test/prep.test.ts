import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decode, upright } from '../src/images/prep.js';

/** A 300×200 JPEG whose orientation tag says "rotate 90° clockwise to view": a phone photo taken upright. */
async function taggedJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: '#c0392b' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
}

describe('photo orientation', () => {
  it('decodes a tagged phone photo the right way up and drops the tag', async () => {
    const { jpeg, width, height } = await decode(await taggedJpeg(), 'image/jpeg');
    expect({ width, height }).toEqual({ width: 200, height: 300 });
    expect((await sharp(jpeg).metadata()).orientation).toBeUndefined();
  });

  it('sets a stored original upright for the design, and leaves an upright JPEG untouched', async () => {
    const tagged = await taggedJpeg();
    const fixed = await upright(tagged, 'image/jpeg');
    const meta = await sharp(fixed).metadata();
    expect({ width: meta.width, height: meta.height, orientation: meta.orientation }).toEqual({ width: 200, height: 300, orientation: undefined });

    const plain = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2ecc71' } }).jpeg().toBuffer();
    expect(await upright(plain, 'image/jpeg')).toBe(plain);
  });
});
