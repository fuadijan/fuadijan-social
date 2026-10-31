/**
 * What the owner can say, from any channel: slash commands, `posted 12`, `skip 12`, `ok`, `review -- AB …`, and
 * free text that goes to the latest open question. Shared by Telegram and the web app's question buttons.
 */
import type { AppContext } from '../context.js';
import { EDITABLE_FIELDS, allRows, editField, markPosted, pushRow, rowByDay, rowTitle, rowsBetween, skipRow, type EditableField } from '../calendar/rows.js';
import { spendThisMonth } from '../brain/client.js';
import * as fmt from './formats.js';
import { answerQuestion, askQuestion, latestOpenQuestion, openQuestions, questionById, resolveAnswer, setQuestionMessageId } from '../pipeline/questions.js';
import { resendPack } from '../pipeline/stages.js';
import { redoRow } from '../pipeline/worker.js';
import { allCopyOptions, latestCopyOptions, rerenderWithWording } from '../pipeline/wording.js';
import { SET_ALIASES, allDishFacts, getSetting, removeDishFact, setDishFact, setSetting } from '../settings.js';
import { formatDay, sydneyDate, sydneyTime, addDays } from '../time.js';
import { weekLines } from '../reminders/brief.js';

export const HELP = [
  '/today · /week · /status · /ask',
  '/pack N — resend Day N\'s pack · /brief N — resend the Canva brief',
  '/redo N <note> — re-run the copy and design with a note ("shorter caption", "layout B", "text on the right", "text at the top", "bigger text")',
  '/wording N — show the wordings written for Day N · /wording N k — use wording k (rebuilds the designs and the pack)',
  '/edit N <field> <text> — fields: dish, caption, cta, hashtags, story_ideas, post_time',
  '/push N <days> — move Day N · skip N — move it to the next free date',
  '/set address|hours|website <text> · /set design <standing notes for the art director> · /set wording ask|off · /pause · /resume',
  '/fact <dish> -- <what is true about it> — remembered for every post about that dish (/fact alone lists them; /fact <dish> -- remove)',
  'posted N — mark Day N posted',
  'Send a photo with a caption like "chapli kebab", "chicken karahi -- cooked to order #day4", "karahi clip 1".',
].join('\n');

export async function handleCommand(app: AppContext, text: string): Promise<void> {
  const [cmdRaw = '', ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.replace(/@\w+$/, '').toLowerCase();
  const arg = rest.join(' ').trim();
  const dayNo = Number(rest[0]);
  const say = (t: string) => app.messenger.sendText(t);
  const { pool } = app;

  switch (cmd) {
    case '/start':
    case '/help':
      return void say(`Fuadijan Social Agent.\n${HELP}`);
    case '/today': {
      const today = sydneyDate(app.now());
      const lines = await weekLines(app, today, today);
      return void say(lines.length ? lines.join('\n\n') : `Nothing on the calendar for ${formatDay(today)}.`);
    }
    case '/week': {
      const today = sydneyDate(app.now());
      const lines = await weekLines(app, today, addDays(today, 6));
      const open = (await openQuestions(pool)).length;
      return void say(fmt.morningBrief(lines, open));
    }
    case '/status':
      return void say(await statusText(app));
    case '/ask': {
      const qs = await openQuestions(pool);
      if (!qs.length) return void say('No open questions.');
      await say(`${qs.length} open question${qs.length === 1 ? '' : 's'}:`);
      for (const q of qs) {
        const sent = await app.messenger.sendText(q.question, { buttons: q.options.map((o) => ({ key: `q:${q.id}:${o.key}`, label: o.label })), questionId: q.id });
        await setQuestionMessageId(pool, q.id, sent.messageId);
      }
      return;
    }
    case '/pack': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      if (!(await resendPack(app, row))) await say(`Day ${row.day_no} has no pack yet — send its photo (or clips) and I'll make one.`);
      return;
    }
    case '/brief': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      const p = (await pool.query<{ canva_brief: string }>('select canva_brief from packs where calendar_row_id = $1 order by created_at desc limit 1', [row.id])).rows[0];
      return void say(p?.canva_brief ?? `Day ${row.day_no} has no Canva brief yet — it comes with the pack.`);
    }
    case '/redo': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      const note = rest.slice(1).join(' ').trim() || null;
      await redoRow(pool, row.id, note);
      return void say(`Re-running Day ${row.day_no}${note ? ` with "${note}"` : ''}.`);
    }
    case '/edit': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      const field = (rest[1] ?? '').toLowerCase().replace('story', 'story_ideas').replace('posttime', 'post_time') as EditableField;
      const value = rest.slice(2).join(' ').trim();
      if (!EDITABLE_FIELDS.includes(field)) return void say(`Fields you can edit: ${EDITABLE_FIELDS.join(', ')}.`);
      if (!value) return void say(`/edit ${row.day_no} ${field} <text>`);
      try {
        await editField(pool, row, field, value, 'owner-telegram');
      } catch (e) {
        return void say(e instanceof Error ? e.message : String(e));
      }
      return void say(`Day ${row.day_no} ${field} updated. /redo ${row.day_no} to refresh the pack.`);
    }
    case '/push': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      const days = Number(rest[1] ?? 1);
      if (!Number.isInteger(days) || !days) return void say(`/push ${row.day_no} <days>`);
      const next = await pushRow(pool, row, days, 'owner-telegram');
      return void say(`${rowTitle(row)} moved to ${formatDay(next)}.`);
    }
    case '/set': {
      const key = SET_ALIASES[(rest[0] ?? '').toLowerCase()];
      const value = rest.slice(1).join(' ').trim();
      if (!key) return void say('/set address|hours|website|post-time|story-time|design|wording <text>');
      if (!value) return void say(`${key} is "${await getSetting(pool, key)}".`);
      await setSetting(pool, key, value);
      return void say(`${key} is now "${value}".`);
    }
    case '/wording': {
      const row = await needRow(app, dayNo);
      if (!row) return;
      const k = Number(rest[1]);
      const sets = await allCopyOptions(pool, row.id);
      if (!sets.length) return void say(`No wordings for Day ${row.day_no} yet — they appear once a photo has been matched and the copy resolved.`);
      if (!rest[1]) {
        const latest = sets[0]!;
        return void say(`${fmt.wordingOptions(row, latest.options)}${latest.chosen != null ? `\n\nIn use: ${latest.chosen + 1}.` : ''}${sets.length > 1 ? `\n${sets.length - 1} earlier set${sets.length > 2 ? 's' : ''} on the Day page.` : ''}\nUse one: /wording ${row.day_no} <number>`);
      }
      const latest = (await latestCopyOptions(pool, row.id))!;
      if (!Number.isInteger(k) || !latest.options[k - 1]) return void say(`Pick 1–${latest.options.length}: /wording ${row.day_no} <number>`);
      const open = (await openQuestions(pool, row.id)).find((q) => q.field === 'wording');
      if (open) {
        await applyAnswer(app, open.id, String(k - 1), 'telegram');
        return;
      }
      const job = await rerenderWithWording(pool, row.id, latest, k - 1);
      return void say(job ? `Wording ${k} for Day ${row.day_no} — rebuilding the designs and the pack.` : `Day ${row.day_no} has nothing rendered yet; the choice is noted for when it is.`);
    }
    case '/fact': {
      if (!arg) {
        const facts = await allDishFacts(pool);
        return void say(facts.length ? `Dish facts:\n${facts.map((f) => `• ${f.dish}: ${f.fact}`).join('\n')}` : 'No dish facts yet. Example: /fact chapli kebab -- served with raita and salad');
      }
      const m = arg.match(/^(.+?)\s*(?:--|—)\s*([\s\S]+)$/);
      if (!m) return void say('Format: /fact <dish> -- <what is true>, e.g. /fact chapli kebab -- served with raita and salad');
      const dish = m[1]!.trim();
      const fact = m[2]!.trim();
      if (/^(remove|delete|forget)$/i.test(fact)) {
        return void say((await removeDishFact(pool, dish)) ? `Forgot the fact about ${dish}.` : `No fact stored for ${dish}.`);
      }
      await setDishFact(pool, dish, fact);
      return void say(`Noted for ${dish}: ${fact}. It applies to every post about ${dish}; /redo the day to refresh a pack.`);
    }
    case '/pause':
      await setSetting(pool, 'paused', 'true');
      return void say('Paused: no reminders until /resume. Photos you send are still processed.');
    case '/resume':
      await setSetting(pool, 'paused', 'false');
      return void say('Resumed.');
    default:
      return void say(`I don't know ${cmd}.\n${HELP}`);
  }
}

async function needRow(app: AppContext, dayNo: number) {
  if (!Number.isInteger(dayNo) || dayNo < 1) {
    await app.messenger.sendText('Which day? e.g. /pack 12');
    return null;
  }
  const row = await rowByDay(app.pool, dayNo);
  if (!row) await app.messenger.sendText(`There is no Day ${dayNo}.`);
  return row;
}

export async function handleFreeText(app: AppContext, text: string): Promise<void> {
  const { pool } = app;
  const t = text.trim();
  const say = (s: string) => app.messenger.sendText(s);

  const posted = t.match(/^posted(?:\s+(\d{1,2}))?$/i);
  if (posted) {
    const row = posted[1] ? await rowByDay(pool, Number(posted[1])) : (await rowsBetween(pool, sydneyDate(app.now()), sydneyDate(app.now())))[0] ?? null;
    if (!row) return void say(posted[1] ? `There is no Day ${posted[1]}.` : 'Nothing is on the calendar for today — say "posted N".');
    await markPosted(pool, row, 'owner-telegram', app.now());
    const next = (await rowsBetween(pool, addDays(row.date, 1), addDays(row.date, 1)))[0] ?? null;
    return void say(fmt.postedConfirm(row, sydneyTime(app.now()), next));
  }

  const skip = t.match(/^skip\s+(\d{1,2})$/i);
  if (skip) {
    const row = await rowByDay(pool, Number(skip[1]));
    if (!row) return void say(`There is no Day ${skip[1]}.`);
    const q = await askQuestion(pool, { rowId: row.id, jobId: null, field: 'skip', question: fmt.skipQuestion(row), options: [{ key: 'all', label: 'Push everything', value: 'push-all' }, { key: 'one', label: 'Just this one', value: 'just-this' }, { key: 'cancel', label: 'Cancel', value: 'cancel' }] });
    const sent = await app.messenger.sendText(q.question, { buttons: q.options.map((o) => ({ key: `q:${q.id}:${o.key}`, label: o.label })), questionId: q.id });
    await setQuestionMessageId(pool, q.id, sent.messageId);
    return;
  }

  if (/^review\s*(--|—)/i.test(t)) {
    const m = t.match(/^review\s*(?:--|—)\s*([A-Za-z.]{1,6})\s*\n?([\s\S]+)$/i);
    if (!m) return void say('Send it as: review -- AB\n<the review text, exactly as written>');
    const initials = m[1]!.toUpperCase();
    const quote = m[2]!.trim();
    const target = (await allRows(pool)).filter((r) => /review|you-said-it/.test(r.template) && r.status !== 'posted').sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!target) return void say('No review day is left on the calendar.');
    await pool.query("insert into assets (kind, caption_raw, parsed_subject, parsed_note, calendar_row_id) values ('text', $1, 'review', $2, $3)", [t, initials, target.id]);
    const open = await openQuestions(pool, target.id);
    for (const q of open.filter((x) => /review|quote/i.test(x.question))) await answerQuestion(pool, q.id, quote, 'telegram');
    return void say(`Review from ${initials} saved for Day ${target.day_no} (${formatDay(target.date)}). It will be quoted exactly as sent.`);
  }

  // Everything else answers the latest open question.
  const q = await latestOpenQuestion(pool);
  if (!q) return void say(/^ok$/i.test(t) ? 'Nothing was waiting on an answer.' : `Noted, but nothing was waiting on an answer. ${HELP.split('\n')[0]}`);
  await applyAnswer(app, q.id, /^ok$/i.test(t) && q.field === 'quality' ? 'use' : t, 'telegram');
}

export async function handleButton(app: AppContext, data: string): Promise<void> {
  const m = data.match(/^q:(\d+):(.+)$/);
  if (!m) return;
  await applyAnswer(app, Number(m[1]), m[2]!, 'telegram');
}

/** Records an answer and does what the question was for (skip/dish are acted on here; the rest wake a job). */
export async function applyAnswer(app: AppContext, questionId: number, keyOrText: string, via: 'telegram' | 'web' | 'dry-run'): Promise<string> {
  const { pool } = app;
  const existing = await questionById(pool, questionId);
  if (!existing) return 'That question is gone.';
  if (existing.answered_at) return 'Already answered.';
  const value = resolveAnswer(existing, keyOrText);
  const q = await answerQuestion(pool, questionId, value, via);
  if (!q) return 'Already answered.';

  let reply = `Got it: ${value}`;
  if (q.field === 'wording') {
    const n = Number(value);
    reply = Number.isInteger(n) ? `Wording ${n + 1} — designing now.` : `Using your headline "${value}" — designing now.`;
  } else if (q.field === 'skip' && q.row_id) {
    const row = (await allRows(pool)).find((r) => r.id === q.row_id);
    if (row && value !== 'cancel') {
      const next = await skipRow(pool, row, value === 'push-all' ? 'push-all' : 'just-this', via === 'web' ? 'owner-web' : 'owner-telegram');
      reply = `${rowTitle(row)} moved to ${formatDay(next)}${value === 'push-all' ? ', and everything after it by a day' : ''}.`;
    } else reply = 'Left as it was.';
  } else if (q.field === 'dish' && q.row_id) {
    const row = (await allRows(pool)).find((r) => r.id === q.row_id);
    if (row && value && value !== 'skip') {
      await editField(pool, row, 'dish', value, via === 'web' ? 'owner-web' : 'owner-telegram');
      reply = `Day ${row.day_no} dish set to ${value}.`;
    }
  }
  if (via !== 'web') await app.messenger.sendText(reply);
  return reply;
}

export async function statusText(app: AppContext): Promise<string> {
  const { pool } = app;
  const rows = await allRows(pool);
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const jobs = (await pool.query<{ status: string; n: string }>('select status, count(*) n from jobs group by status')).rows.map((r) => `${r.status} ${r.n}`).join(', ') || 'none';
  const open = (await openQuestions(pool)).length;
  const spend = await spendThisMonth(pool);
  const lastErr = (await pool.query<{ last_error: string; stage: string }>("select last_error, stage from jobs where last_error is not null order by updated_at desc limit 1")).rows[0];
  const menu = app.menu.status();
  const paused = (await getSetting(pool, 'paused')) === 'true';
  return [
    `Calendar: planned ${by('planned')} · photo-needed ${by('photo-needed')} · ready ${by('ready')} · posted ${by('posted')}`,
    `Jobs: ${jobs}`,
    `Open questions: ${open}`,
    `Claude this month: ${spend.calls} calls, US$${spend.usd.toFixed(2)}${spend.failed ? `, ${spend.failed} failed` : ''} (${app.claude.kind})`,
    `Menu: ${menu.source}, ${menu.items} items${menu.fetchedAt ? `, fetched ${menu.fetchedAt.slice(11, 16)} UTC` : ''}${menu.lastError ? ` — last error: ${menu.lastError}` : ''}`,
    lastErr ? `Last job error (${lastErr.stage}): ${lastErr.last_error}` : 'No job errors.',
    paused ? 'Reminders: PAUSED' : 'Reminders: on',
    `Uptime: ${Math.round(process.uptime() / 60)} min`,
  ].join('\n');
}
