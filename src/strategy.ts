/**
 * The marketing strategy as data (brand/strategy.json): positioning, voice rules, taglines, hashtag sets, caption
 * templates, the weekly rituals and the event year, the poster concepts and ready captions, and the 30-day plan.
 * Four things read it: the copy prompt (a brief for the writer), the art director (palette and visual rules), the
 * wording bank (taglines, posters and captions are seeded as wordings, source "strategy") and the web app's
 * Strategy screen. The owner edits the file, never the code, to change what the agent is told.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Db } from './db/pool.js';
import { addSlogan } from './slogans.js';
import type { IsoDate } from './time.js';

const Poster = z.object({ headline: z.string(), line: z.string(), visual: z.string() });

export const StrategySchema = z.object({
  name: z.string(),
  version: z.number(),
  source: z.string().optional(),
  positioning: z.string(),
  descriptor: z.string(),
  oneIdea: z.string(),
  knownFor: z.object({ primary: z.string(), secondary: z.string(), trust: z.string() }),
  taglines: z.array(z.object({ text: z.string(), use: z.string() })),
  voice: z.object({ do: z.array(z.string()), dont: z.array(z.string()) }),
  signatureDishes: z.array(z.object({ dish: z.string(), role: z.string(), why: z.string() })),
  segments: z.array(z.object({ segment: z.string(), want: z.string(), message: z.string(), channels: z.string() })),
  platforms: z.array(z.object({ platform: z.string(), job: z.string(), cadence: z.string(), share: z.string() })),
  captionTemplates: z.record(z.string(), z.string()),
  hashtagSets: z.record(z.string(), z.object({ when: z.string(), tags: z.array(z.string()) })),
  rituals: z.array(z.object({ name: z.string(), item: z.string(), when: z.string(), weekday: z.number().int().min(0).max(6).nullable(), rule: z.string().optional(), offer: z.string(), measure: z.string() })),
  events: z.array(z.object({ name: z.string(), item: z.string(), from: z.string(), to: z.string(), approximate: z.boolean().optional(), quarterly: z.boolean().optional(), offers: z.string(), poster: Poster })),
  posters: z.array(Poster.extend({ name: z.string(), item: z.string() })),
  captions: z.array(z.object({ name: z.string(), item: z.string(), headline: z.string(), line: z.string(), caption: z.string(), hashtags: z.string() })),
  photoPrompts: z.array(z.string()),
  photoRules: z.array(z.string()),
  reelIdeas: z.array(z.object({ concept: z.string(), hook: z.string(), shots: z.string(), length: z.string() })),
  visual: z.object({ palette: z.string(), rules: z.array(z.string()) }),
  kpis: z.array(z.object({ layer: z.string(), metric: z.string(), where: z.string(), target: z.string() })),
  monthlyLoop: z.array(z.string()),
  plan: z.object({
    from: z.string(),
    to: z.string(),
    weeks: z.array(z.object({ week: z.number(), dates: z.string(), theme: z.string(), goal: z.string() })),
    days: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), format: z.string(), idea: z.string(), booster: z.string(),
      dish: z.string().nullable(), template: z.string(), sets: z.array(z.string()), event: z.string().optional(),
    })),
  }),
});
export type Strategy = z.infer<typeof StrategySchema>;

let cached: { dir: string; strategy: Strategy } | null = null;

export function loadStrategy(dir = resolve(process.cwd(), 'brand')): Strategy {
  if (cached && cached.dir === dir) return cached.strategy;
  const p = join(dir, 'strategy.json');
  if (!existsSync(p)) throw new Error(`Strategy missing: ${p}`);
  const strategy = StrategySchema.parse(JSON.parse(readFileSync(p, 'utf8')));
  cached = { dir, strategy };
  return strategy;
}

/** The strategy when the file is there, else null: the pipeline must not stop for a missing brief. */
export function strategyIfAny(): Strategy | null {
  try {
    return loadStrategy();
  } catch {
    return null;
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const dayOfMonth = (date: string): number => Number(date.slice(8, 10));

/** The rituals that fall on a date: Karahi Night on a Wednesday, Chapli Kebab Day on the first Friday, … */
export function ritualsOn(s: Strategy, date: IsoDate): Strategy['rituals'] {
  const wd = weekdayOf(date);
  return s.rituals.filter((r) => r.weekday === wd && (r.rule !== 'first-of-month' || dayOfMonth(date) <= 7));
}

/** The seasonal events running on a date. */
export function eventsOn(s: Strategy, date: IsoDate): Strategy['events'] {
  return s.events.filter((e) => e.from <= date && date <= e.to);
}

/** The hashtag sets a post should draw from: core always, then every set whose key or "when" words appear in the texts. */
export function hashtagSetsFor(s: Strategy, texts: (string | null | undefined)[]): { key: string; tags: string[] }[] {
  const hay = texts.filter((t): t is string => Boolean(t)).join(' | ').toLowerCase();
  const out: { key: string; tags: string[] }[] = [];
  for (const [key, set] of Object.entries(s.hashtagSets)) {
    if (key === 'core') {
      out.unshift({ key, tags: set.tags });
      continue;
    }
    const words = [key, ...set.when.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3)];
    if (words.some((w) => hay.includes(w))) out.push({ key, tags: set.tags });
  }
  return out;
}

/** 3–5 hashtags for a post: three core, then the first matching set's. */
export function hashtagsFor(s: Strategy, texts: (string | null | undefined)[], n = 5): string[] {
  const sets = hashtagSetsFor(s, texts);
  const core = sets[0]?.tags.slice(0, 3) ?? [];
  const rest = sets.slice(1).flatMap((x) => x.tags);
  return [...new Set([...core, ...rest])].slice(0, n);
}

/** Everything the bank should hold from the strategy: taglines (every post), poster concepts and ready captions. */
export function strategyWordings(s: Strategy): { item: string; headline: string; line: string | null; caption: string | null }[] {
  const out: { item: string; headline: string; line: string | null; caption: string | null }[] = [];
  for (const t of s.taglines) {
    // "Fresh off the grill. Halal, always." → two lines at the first full stop.
    const parts = t.text.split(/(?<=\.)\s+/).filter(Boolean);
    const headline = parts.length === 2 ? parts.join('\n') : t.text;
    out.push({ item: 'all', headline, line: null, caption: null });
  }
  for (const p of s.posters) out.push({ item: p.item, headline: p.headline, line: p.line, caption: null });
  for (const c of s.captions) out.push({ item: c.item, headline: c.headline, line: c.line, caption: `${c.caption}\n${c.hashtags}` });
  for (const e of s.events) if (!s.posters.some((p) => p.headline === e.poster.headline)) out.push({ item: e.item, headline: e.poster.headline, line: e.poster.line, caption: null });
  return out;
}

/** Upserts the strategy's wordings into the bank (source "strategy"); the same item + headline updates in place. */
export async function seedStrategyWordings(db: Db, s: Strategy = loadStrategy()): Promise<number> {
  let n = 0;
  for (const w of strategyWordings(s)) {
    await addSlogan(db, { item: w.item, headline: w.headline, line: w.line, caption: w.caption, source: 'strategy' });
    n++;
  }
  return n;
}

const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

/** The brief the copy writer gets with every row: positioning, voice, the day's ritual or event, hashtag sets to draw from. */
export function copyBrief(s: Strategy, row: { date: string; dish: string | null; theme: string | null; type: string; slot: string; custom?: { product: string } | null }): string {
  const texts = [row.dish, row.theme, row.type, row.custom?.product];
  const rituals = ritualsOn(s, row.date);
  const events = eventsOn(s, row.date);
  const sets = hashtagSetsFor(s, texts);
  const dish = s.signatureDishes.find((d) => row.dish && (row.dish.toLowerCase().includes(d.dish.toLowerCase()) || d.dish.toLowerCase().includes(row.dish.toLowerCase())));
  return [
    `Brand strategy. Positioning: ${s.positioning}`,
    `Known for: ${s.knownFor.primary} ${s.knownFor.secondary} Trust layer: ${s.knownFor.trust}`,
    `Voice — do:\n${list(s.voice.do)}`,
    `Voice — never:\n${list(s.voice.dont)}`,
    dish ? `This dish's role in the strategy: ${dish.role} — ${dish.why}.` : '',
    `Taglines you may close a caption with (as written):\n${list(s.taglines.map((t) => `${t.text} (${t.use})`))}`,
    rituals.length ? `${WEEKDAYS[weekdayOf(row.date)]} ${row.date} is ${rituals.map((r) => `${r.name} (${r.when})`).join(' and ')}: mention it only if the row's copy or the owner's note is about it; the offer is unconfirmed, so keep it as a [bracketed] placeholder.` : '',
    events.length ? `Running now: ${events.map((e) => `${e.name}${e.approximate ? ' (dates approximate — confirm with the mosque before naming a day)' : ''}`).join('; ')}.` : '',
    `Hashtag sets to draw 3–5 from (the row's own hashtags come first when it has them):\n${list(sets.map((x) => `${x.key}: ${x.tags.join(' ')}`))}`,
    `Caption patterns (shape, not text): ${Object.entries(s.captionTemplates).map(([k, v]) => `${k} → ${v}`).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

/** What the art director is told beyond the kit: the strategy's visual rules and where deep green belongs. */
export function designBrief(s: Strategy): string {
  return `Strategy for the look: ${s.visual.palette}\n${list(s.visual.rules)}`;
}
