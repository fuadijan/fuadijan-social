import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { keyMatches, registerStoryFeed, tvStoryLink } from '../src/story-feed.js';

const KEY = 'k'.repeat(32);
const RECENT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PNG = Buffer.from('png-bytes');

/** Just enough of Postgres: the key in settings, the recent-stories query, and one file. */
function fakeDb(key: string | null): Db & { windows: unknown[][] } {
  const windows: unknown[][] = [];
  const db = {
    windows,
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes('from settings')) return { rows: key ? [{ value: key }] : [] };
      if (sql.includes('from renders')) {
        windows.push(params);
        return { rows: [{ file_id: RECENT, date: '2026-11-12', title: 'Chapli kebab' }] };
      }
      if (sql.includes('from files')) {
        const id = params[0];
        return { rows: id === RECENT || id === OTHER ? [{ mime: 'image/png', bytes: PNG }] : [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return db as unknown as Db & { windows: unknown[][] };
}

function server(key: string | null) {
  const app = Fastify();
  const db = fakeDb(key);
  // 2026-11-12 13:00 in Sydney.
  registerStoryFeed(app, db, () => new Date('2026-11-12T02:00:00Z'));
  return { app, db };
}

describe('the portrait TV story feed', () => {
  it('lists the last 7 days of stories (Sydney dates) to a request with the key', async () => {
    const { app, db } = server(KEY);
    const res = await app.inject(`/public/stories?key=${KEY}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toEqual({
      ok: true,
      stories: [{ date: '2026-11-12', title: 'Chapli kebab', image: `/public/stories/${RECENT}?key=${KEY}` }],
    });
    expect(db.windows[0]).toEqual(['2026-11-06', '2026-11-12']);
  });

  it('answers 404 without the key, with a wrong key, or before a key exists', async () => {
    for (const [key, query] of [[KEY, ''], [KEY, '?key=nope'], [KEY, `?key=${KEY}x`], [null, '?key=']] as const) {
      const { app, db } = server(key);
      expect((await app.inject(`/public/stories${query}`)).statusCode).toBe(404);
      expect((await app.inject(`/public/stories/${RECENT}${query}`)).statusCode).toBe(404);
      expect(db.windows).toHaveLength(0);
    }
  });

  it('hands out only images that are in the list right now', async () => {
    const { app } = server(KEY);
    const ok = await app.inject(`/public/stories/${RECENT}?key=${KEY}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.rawPayload.equals(PNG)).toBe(true);
    // A real file, but not a recent story: refused.
    expect((await app.inject(`/public/stories/${OTHER}?key=${KEY}`)).statusCode).toBe(404);
    expect((await app.inject(`/public/stories/not-an-id?key=${KEY}`)).statusCode).toBe(404);
  });

  it('compares keys exactly', () => {
    expect(keyMatches(KEY, KEY)).toBe(true);
    expect(keyMatches(KEY.slice(1), KEY)).toBe(false);
    expect(keyMatches(undefined, KEY)).toBe(false);
    expect(keyMatches('', '')).toBe(false);
  });

  it('builds the TV address with the feed and the key', () => {
    expect(tvStoryLink('a/b', 'https://social.nutrimeals.au'))
      .toBe('https://fjtv.nutrimeals.au/story?feed=https%3A%2F%2Fsocial.nutrimeals.au&key=a%2Fb');
  });
});
