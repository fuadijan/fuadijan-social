/**
 * Every message the owner reads, as plain text. One place, so the Telegram bot, the email fallback and the
 * tests agree on the wording. Deep links go to the web app's Day screen.
 */
import { config } from '../config.js';
import { rowTitle, seriesLabel, type CalendarRow } from '../calendar/rows.js';
import { shotList } from '../pipeline/packs.js';
import { formatDay } from '../time.js';

export const dayLink = (dayNo: number) => `${config.webUrl}/day/${dayNo}`;

const SLOT_WORD: Record<CalendarRow['slot'], string> = { feed: 'Feed', carousel: 'Carousel', reel: 'Reel' };

export const HERO_TIPS = 'Top-down or 45°, plate on the plain dark bench (not the patterned table), wipe the rim, nothing else in frame, send as a File.';

export interface Needs {
  photo: boolean;
  clips: boolean;
  dish: boolean;
  confirmations: number;
  words: string; // "Needs: hero photo and 2 confirmations" / "Nothing — ready to post."
}

export function describeNeeds(row: CalendarRow, received: { photos: number; clips: number }, openQuestions: number, placeholders: number): Needs {
  const dish = !row.dish || row.dish.startsWith('[');
  const photo = row.slot !== 'reel' && received.photos === 0 && row.status !== 'posted';
  const clips = row.slot === 'reel' && received.clips === 0 && received.photos === 0 && row.status !== 'posted';
  const confirmations = openQuestions || (row.status !== 'ready' && row.status !== 'posted' ? placeholders : 0);
  const parts: string[] = [];
  if (dish && row.status !== 'posted') parts.push('a dish to choose');
  if (photo) parts.push(row.slot === 'carousel' ? '2–3 close-ups' : 'a hero photo');
  if (clips) parts.push('clips');
  if (confirmations) parts.push(`${confirmations} confirmation${confirmations === 1 ? '' : 's'}`);
  if (row.status === 'posted') return { photo, clips, dish, confirmations, words: 'Posted.' };
  if (!parts.length) return { photo, clips, dish, confirmations, words: row.status === 'ready' ? 'Nothing — ready to post.' : 'Nothing more from you; the pack is on its way.' };
  return { photo, clips, dish, confirmations, words: `Needs: ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` };
}

export function briefLine(row: CalendarRow, needs: Needs, suggestion: string | null): string {
  const name = row.dish && !row.dish.startsWith('[') ? row.dish : (suggestion ? `dish to choose (suggest ${suggestion})` : (row.theme ?? row.type));
  const head = `${formatDay(row.date)} — ${SLOT_WORD[row.slot]} · ${name} (${row.theme ?? seriesLabel(row)}) · ${row.status}`;
  const shots = shotList(row.creative_instructions);
  const shoot = row.slot === 'reel' ? (shots.length ? `Shoot: ${shots.join('; ')}. Vertical.` : '') : (needs.photo ? HERO_TIPS : '');
  return [head, `  ${needs.words}${shoot ? ` ${shoot}` : ''}`].join('\n');
}

export function morningBrief(lines: string[], openQuestions: number): string {
  return [
    '☀️ Good morning. Next 7 days:',
    '',
    ...lines.flatMap((l) => [l, '']),
    openQuestions ? `Open questions: ${openQuestions} — /ask` : 'No open questions.',
    `Week view: ${config.webUrl}/`,
  ].join('\n');
}

export function shootReminder(row: CalendarRow, daysAhead: number, gated: boolean): string {
  const when = daysAhead === 0 ? 'today' : daysAhead === 1 ? 'tomorrow' : `in ${daysAhead} days`;
  const shots = shotList(row.creative_instructions);
  if (gated) {
    return [`⚠️ ${rowTitle(row)} is ${when} (${formatDay(row.date)}) and still has details to confirm before anything can be made.`, row.confirmation_notes ?? row.creative_instructions ?? '', `Answer the questions: /ask · ${dayLink(row.day_no)}`].filter(Boolean).join('\n');
  }
  if (row.slot === 'reel') {
    return [`📸 ${formatDay(row.date)} (${when}) is a Reel — ${rowTitle(row).replace(/^Day \d+ — /, '')}. Nothing received yet.`, shots.length ? `Shot list: ${shots.join(' → ')}. Vertical.` : '', `Send clips with the caption "${(row.dish ?? row.theme ?? 'clip').split(',')[0]!.toLowerCase()} clip 1", "… clip 2".`, dayLink(row.day_no)].filter(Boolean).join('\n');
  }
  return [`📸 ${formatDay(row.date)} (${when}) needs a hero photo — ${rowTitle(row).replace(/^Day \d+ — /, '')}.`, HERO_TIPS, dayLink(row.day_no)].join('\n');
}

export function photoReceived(row: CalendarRow, subject: string): string {
  return `Got it — ${subject} → Day ${row.day_no} (${formatDay(row.date)}, ${SLOT_WORD[row.slot]}). Working on it.`;
}

export const QUALITY_SMALL = 'Got it. For a sharper post, send it as a File (📎 → File) — or reply ok to use this one.';
export const qualityBad = (verdict: 'dark' | 'blurry') => `This one looks ${verdict === 'dark' ? 'too dark' : 'blurry'} for a post. Could you take another? Same angle, more light${verdict === 'blurry' ? ', hold still a second' : ''}. (Reply ok to use it anyway.)`;

export function packHeader(row: CalendarRow, postTime: string): string {
  return `📦 ${rowTitle(row)} · ${formatDay(row.date)} · ${SLOT_WORD[row.slot]} · post at ${postTime}`;
}

export function packFooter(row: CalendarRow): string {
  return `Reply "posted ${row.day_no}" when it's up. Canva brief: /brief ${row.day_no} · ${dayLink(row.day_no)}`;
}

export function postTimeReminder(row: CalendarRow, ready: boolean, needsWords: string): string {
  return ready ? `⏰ Time to post ${rowTitle(row)}.` : `⏰ ${rowTitle(row)} is due now but isn't ready: ${needsWords.replace(/^Needs: /, 'still needs ')} (/ask) · ${dayLink(row.day_no)}`;
}

export function eveningNudge(row: CalendarRow): string {
  return `🌙 ${rowTitle(row)} isn't marked posted. Reply "posted ${row.day_no}" if it went up, "skip ${row.day_no}" to move it.`;
}

export function postedConfirm(row: CalendarRow, time: string, next: CalendarRow | null): string {
  return `✅ ${rowTitle(row)} marked posted at ${time}.${next ? ` Tomorrow: Day ${next.day_no} — ${SLOT_WORD[next.slot]} · ${next.dish ?? next.theme ?? next.type}.` : ''}`;
}

export function skipQuestion(row: CalendarRow): string {
  return `Move ${rowTitle(row)} to the next free date — push everything after it by a day, or just this one?`;
}

export const PRIVATE_BOT = 'This bot is private.';

export function questionsMessage(rowTitleText: string, qs: { n: number; question: string }[]): string {
  return [`${rowTitleText} needs ${qs.length} confirmation${qs.length === 1 ? '' : 's'} before it's ready:`, ...qs.map((q) => `${q.n}. ${q.question}`)].join('\n');
}

/** The wording options in full, sent before the question with the buttons. */
export function wordingOptions(row: CalendarRow, options: { name: string; headline: string; line: string; caption: string }[]): string {
  return [
    `✍️ ${rowTitle(row)} — pick the wording before I design it:`,
    ...options.map((o, i) => `${i + 1}. ${o.name}\n   ${o.headline.replace(/\n/g, ' / ')}\n   ${o.line}\n   ${o.caption.length > 160 ? `${o.caption.slice(0, 157)}…` : o.caption}`),
    'Tap a button below, or type your own headline. /set wording off skips this step.',
  ].join('\n\n');
}

export interface DesignLineInput { layout: 'A' | 'B'; text_position: string; text_side: string; type_scale: number; band_strength: number; source: string; rationale: string; score: number | null; first_score: number | null; verdict: string | null; issues: string[]; contrast: number | null }

/** One line on how the design was decided and what the critic thought. */
export function designLine(d: DesignLineInput): string {
  const who = d.source === 'owner' ? 'your note' : d.source === 'claude' ? 'art director' : 'house rules';
  const critic = d.score == null ? '' : ` · critic ${d.first_score != null && d.first_score !== d.score ? `${d.first_score}→${d.score}` : d.score}/10${d.verdict === 'reshoot' ? ' (suggests a reshoot)' : ''}`;
  const issues = d.issues.length ? `\nStill noted: ${d.issues.join('; ')}.` : '';
  return `🎨 Layout ${d.layout}${d.layout === 'B' ? ` · text ${d.text_position}-${d.text_side}` : d.text_side === 'right' ? ' · text right' : ''} · type ×${d.type_scale.toFixed(2)} · band ${Math.round(d.band_strength * 100)}%${d.contrast != null ? ` (contrast ${d.contrast}:1)` : ''} · by ${who}${critic}\n${d.rationale}${issues}\nNot right? /redo ${'{N}'} with "text on the right", "text at the top", "bigger text", "layout A" or "layout B".`;
}
