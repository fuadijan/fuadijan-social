/**
 * node-cron schedules, Sydney time. Each reminder is a named job so POST /run/:job can fire it by hand, and each
 * is sent at most once per day per row (messages_log is the ledger). Everything respects /pause except replies.
 */
import cron from 'node-cron';
import { config, TZ } from '../config.js';
import type { AppContext } from '../context.js';
import { rowsBetween, rowsOnDate, placeholders } from '../calendar/rows.js';
import { WeeklyReview } from '../brain/schemas.js';
import { findItem } from '../menu/source.js';
import { briefLine } from '../messaging/formats.js';
import { formatDay } from '../time.js';
import * as fmt from '../messaging/formats.js';
import { openQuestions } from '../pipeline/questions.js';
import { resendPack } from '../pipeline/stages.js';
import { allSettings, isPaused } from '../settings.js';
import { addDays, sydneyDate, sydneyTime } from '../time.js';
import { rowViews, weekLines } from './brief.js';

export type ReminderJob = 'morning-brief' | 'shoot-reminders' | 'post-time' | 'story-reminder' | 'evening-nudge' | 'weekly-review' | 'worker-tick';

async function once(ctx: AppContext, key: string, send: () => Promise<void>): Promise<boolean> {
  const dup = await ctx.pool.query('select 1 from messages_log where kind = $1 limit 1', [key]);
  if (dup.rowCount) return false;
  await send();
  await ctx.pool.query("insert into messages_log (direction, channel, kind, text) values ('out', $1, $2, '')", [ctx.messenger.name, key]);
  return true;
}

export async function morningBrief(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  await once(ctx, `brief:${today}`, async () => {
    const lines = await weekLines(ctx, today, addDays(today, 6));
    const open = (await openQuestions(ctx.pool)).length;
    await ctx.messenger.sendText(fmt.morningBrief(lines, open));
  });
  await shootReminders(ctx);
}

/** Reels/carousels: 2 and 1 days before with nothing received; feed: the day before; gated rows: 4 days before. */
export async function shootReminders(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  const views = await rowViews(ctx, await rowsBetween(ctx.pool, today, addDays(today, 4)));
  for (const v of views) {
    const ahead = Math.round((Date.parse(`${v.row.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (v.row.status === 'posted' || v.row.status === 'ready') continue;
    const gated = placeholders(v.row).length >= 3 || /gate/i.test(v.row.creative_instructions ?? '');
    if (gated && ahead === 4 && v.openQuestions === 0) {
      await once(ctx, `gate:${v.row.id}:${v.row.date}`, () => ctx.messenger.sendText(fmt.shootReminder(v.row, ahead, true)).then(() => {}));
      continue;
    }
    const nothingYet = v.received.photos === 0 && v.received.clips === 0;
    if (!nothingYet) continue;
    const due = (v.row.slot === 'reel' || v.row.slot === 'carousel') ? ahead === 2 || ahead === 1 : ahead === 1;
    if (due) await once(ctx, `shoot:${v.row.id}:${v.row.date}:${ahead}`, () => ctx.messenger.sendText(fmt.shootReminder(v.row, ahead, false)).then(() => {}));
  }
}

/** Every minute: rows due at this HH:MM today get their pack (or what's missing), once. */
export async function postTimeCheck(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  const now = sydneyTime(ctx.now());
  const s = await allSettings(ctx.pool);
  const views = await rowViews(ctx, await rowsOnDate(ctx.pool, today));
  for (const v of views) {
    if (v.row.status === 'posted') continue;
    const at = (v.row.post_time ?? s.post_time_default ?? '18:00').slice(0, 5);
    if (at !== now) continue;
    await once(ctx, `post-time:${v.row.id}:${today}`, async () => {
      if (v.row.status === 'ready') {
        await ctx.messenger.sendText(fmt.postTimeReminder(v.row, true, v.needs.words));
        await resendPack(ctx, v.row);
      } else {
        await ctx.messenger.sendText(fmt.postTimeReminder(v.row, false, v.needs.words));
      }
    });
  }
}

export async function storyReminder(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  for (const row of await rowsOnDate(ctx.pool, today)) {
    if (!row.story_ideas) continue;
    await once(ctx, `story:${row.id}:${today}`, async () => {
      const p = (await ctx.pool.query<{ story_text: string | null }>('select story_text from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
      await ctx.messenger.sendText(`📱 Story for Day ${row.day_no} today:\n${p?.story_text ?? row.story_ideas}\n${fmt.dayLink(row.day_no)}`);
    });
  }
}

export async function eveningNudge(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  for (const row of await rowsOnDate(ctx.pool, today)) {
    if (row.status === 'posted') continue;
    await once(ctx, `nudge:${row.id}:${today}`, () => ctx.messenger.sendText(fmt.eveningNudge(row)).then(() => {}));
  }
}

/**
 * The Sunday review: the coming week, rows with no dish, dishes repeated back-to-back, dishes not on the menu or
 * sold out, open questions. The facts are computed here; Claude writes the short note from them.
 */
export async function weeklyReview(ctx: AppContext): Promise<void> {
  if (await isPaused(ctx.pool)) return;
  const today = sydneyDate(ctx.now());
  await once(ctx, `review:${today}`, async () => {
    const rows = await rowsBetween(ctx.pool, addDays(today, 1), addDays(today, 7));
    const views = await rowViews(ctx, rows);
    const lines = views.map((v) => briefLine(v.row, v.needs, v.suggestion));
    const open = await openQuestions(ctx.pool);
    const warnings: string[] = [];
    let menu: Awaited<ReturnType<typeof ctx.menu.get>> | null = null;
    try {
      menu = await ctx.menu.get();
    } catch {
      warnings.push('The menu source could not be read, so dish availability was not checked.');
    }
    let prevDish: string | null = null;
    for (const v of views) {
      const dish = v.row.dish && !v.row.dish.startsWith('[') ? v.row.dish : null;
      if (!dish) warnings.push(`Day ${v.row.day_no} (${formatDay(v.row.date)}) has no dish${v.suggestion ? ` — suggestion: ${v.suggestion}` : ''}.`);
      else {
        const first = dish.split(/[,+]/)[0]!.trim();
        if (prevDish && first.toLowerCase() === prevDish.toLowerCase()) warnings.push(`Day ${v.row.day_no} repeats ${first} back-to-back.`);
        prevDish = first;
        if (menu) {
          for (const part of dish.split(/[,+]/).map((d) => d.trim()).filter((d) => d && !/spread|highlights|confirmed|menu/i.test(d))) {
            const item = findItem(menu, part);
            if (!item) warnings.push(`Day ${v.row.day_no}: "${part}" is not on the current menu.`);
            else if (item.soldOut) warnings.push(`Day ${v.row.day_no}: ${item.name} is sold out right now.`);
          }
        }
      }
      if (v.placeholders.length && v.row.status !== 'ready' && v.row.status !== 'posted') warnings.push(`Day ${v.row.day_no} still has ${v.placeholders.length} placeholder${v.placeholders.length === 1 ? '' : 's'} to confirm.`);
    }
    if (open.length) warnings.push(`${open.length} question${open.length === 1 ? '' : 's'} still unanswered (/ask).`);

    let summary = '';
    try {
      const out = await ctx.claude.call({
        purpose: 'weekly-review', fixtureKey: 'default', schema: WeeklyReview,
        system: 'You write a short Sunday note to the owner of Fuadijan about next week of the Instagram calendar. Two short paragraphs, plain words, Australian spelling, no emojis, no invented facts: only what the facts list says. End with the single most useful thing to do first.',
        user: `Coming week:\n${lines.join('\n')}\n\nFacts to mention:\n${warnings.length ? warnings.map((w) => `- ${w}`).join('\n') : '- Nothing is missing.'}`,
      });
      summary = out.summary;
    } catch (e) {
      ctx.log.warn(`weekly review without Claude: ${e instanceof Error ? e.message : e}`);
    }
    await ctx.messenger.sendText(['🗓 Sunday review — the coming week', '', ...(summary ? [summary, ''] : []), ...lines.flatMap((l) => [l, '']), warnings.length ? `Watch out:\n${warnings.map((w) => `• ${w}`).join('\n')}` : 'Nothing is missing.'].join('\n'));
  });
}

export const REMINDERS: Record<Exclude<ReminderJob, 'worker-tick'>, (ctx: AppContext) => Promise<void>> = {
  'morning-brief': morningBrief,
  'shoot-reminders': shootReminders,
  'post-time': postTimeCheck,
  'story-reminder': storyReminder,
  'evening-nudge': eveningNudge,
  'weekly-review': weeklyReview,
};

const toCron = (hhmm: string, dow = '*') => {
  const [h, m] = hhmm.split(':');
  return `${Number(m)} ${Number(h)} * * ${dow}`;
};

export function scheduleReminders(ctx: AppContext): { stop(): void } {
  const guard = (name: string, fn: (c: AppContext) => Promise<void>) => () => fn(ctx).catch((e) => ctx.log.error(`${name} failed`, { err: String(e) }));
  const tasks = [
    cron.schedule(toCron(config.times.brief), guard('morning-brief', morningBrief), { timezone: TZ }),
    cron.schedule('* * * * *', guard('post-time', postTimeCheck), { timezone: TZ }),
    cron.schedule(toCron(config.times.story), guard('story-reminder', storyReminder), { timezone: TZ }),
    cron.schedule(toCron(config.times.nudge), guard('evening-nudge', eveningNudge), { timezone: TZ }),
    cron.schedule(toCron(config.times.review, '0'), guard('weekly-review', weeklyReview), { timezone: TZ }),
  ];
  return { stop: () => tasks.forEach((t) => void t.stop()) };
}
