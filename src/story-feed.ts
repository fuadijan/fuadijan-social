/**
 * The portrait TV's story feed. Menu Screens' /story page (on fjtv.nutrimeals.au) shows the finished stories of the
 * last week, one after another, on a TV stood on its end. A TV can't sign in at the hub, so the feed answers to a
 * secret key instead: the app makes one the first time the owner asks for the link (/tvlink on Telegram), keeps it
 * in `settings`, and `/tvlink new` swaps it for a fresh one, which switches the old link off.
 *
 * Only finished story images dated today or in the six days before (Sydney) are handed out -- never a story planned
 * for later, nor any other file -- and only to a request carrying the key.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db/pool.js';
import { getFile } from './files.js';
import { getSetting, setSetting } from './settings.js';
import { addDays, sydneyDate } from './time.js';

export const STORY_DAYS = 7;
export const TV_STORY_PAGE = 'https://fjtv.nutrimeals.au/story';

/** The feed's key, made on first use; rotate gives it a fresh one (and the old link stops working). */
export async function storyFeedKey(db: Db, rotate = false): Promise<string> {
  let key = rotate ? '' : await getSetting(db, 'tv_story_key');
  if (!key) {
    key = randomBytes(24).toString('base64url');
    await setSetting(db, 'tv_story_key', key);
  }
  return key;
}

/** The address to open on the portrait TV. */
export function tvStoryLink(key: string, feedOrigin: string): string {
  return `${TV_STORY_PAGE}?feed=${encodeURIComponent(feedOrigin)}&key=${encodeURIComponent(key)}`;
}

export function keyMatches(given: unknown, real: string): boolean {
  if (typeof given !== 'string' || !real) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface StoryItem { fileId: string; date: string; title: string | null }

/** Finished stories dated from six days before `today` to `today`, newest day first, in posting order within a day. */
export async function recentStories(db: Db, today: string): Promise<StoryItem[]> {
  const { rows } = await db.query<{ file_id: string; date: string; title: string | null }>(
    `select r.file_id, to_char(c.date, 'YYYY-MM-DD') as date, coalesce(c.dish, c.theme) as title
       from renders r join calendar_rows c on c.id = r.calendar_row_id
      where r.format = 'story' and c.date between $1::date and $2::date
      order by c.date desc, c.post_time nulls last, r.id`,
    [addDays(today, -(STORY_DAYS - 1)), today],
  );
  return rows.map((r) => ({ fileId: r.file_id, date: r.date, title: r.title }));
}

export function registerStoryFeed(app: FastifyInstance, db: Db, now: () => Date = () => new Date()): void {
  // The list. Read from another origin (the TV page), so it says so; the key is what protects it.
  app.get<{ Querystring: { key?: string } }>('/public/stories', async (req, reply) => {
    reply.header('access-control-allow-origin', '*').header('cache-control', 'no-store');
    if (!keyMatches(req.query.key, await getSetting(db, 'tv_story_key'))) return reply.code(404).send({ ok: false });
    const stories = await recentStories(db, sydneyDate(now()));
    return {
      ok: true,
      stories: stories.map((s) => ({ date: s.date, title: s.title, image: `/public/stories/${s.fileId}?key=${encodeURIComponent(req.query.key!)}` })),
    };
  });

  // One image, and only one of the stories the list would hand out right now.
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>('/public/stories/:id', async (req, reply) => {
    if (!/^[0-9a-f]{64}$/.test(req.params.id) || !keyMatches(req.query.key, await getSetting(db, 'tv_story_key'))) return reply.code(404).send();
    const allowed = (await recentStories(db, sydneyDate(now()))).some((s) => s.fileId === req.params.id);
    const f = allowed ? await getFile(db, req.params.id) : null;
    if (!f) return reply.code(404).send();
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=3600');
    return reply.send(f.bytes);
  });
}
