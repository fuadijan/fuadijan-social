/**
 * npm run strategy-workbook [-- --out calendar/Fuadijan-Strategy-2026-11.xlsx]
 *
 * Writes the strategy's 30-day content plan (brand/strategy.json → plan.days) as a plan workbook in the same
 * 18-column Calendar sheet the seed reads, with a Slogans sheet of the strategy's wordings and a Read Me. It is
 * built, not seeded: `npm run seed-calendar -- --file <that file>` makes it the plan for its month, replacing the
 * rows of the same day numbers that the owner has not edited (the seed protects edited fields). Captions come
 * from the strategy's ready captions where one fits the day, otherwise from the dish-hero pattern; every price,
 * offer and name stays a [bracketed] placeholder for the owner to settle.
 */
import { pathToFileURL } from 'node:url';
import { loadStrategy, hashtagsFor, strategyWordings, type Strategy } from '../src/strategy.js';
import { templateKeyFor } from '../src/render/registry.js';
import { CALENDAR_COLUMNS } from './calendar.schema.js';
import { writeWorkbook, type OutCell } from './xlsx-write.js';

export const STRATEGY_WORKBOOK_PATH = 'calendar/Fuadijan-Strategy-2026-11.xlsx';

type Day = Strategy['plan']['days'][number];

const slotOf = (format: string): 'reel' | 'carousel' | 'feed' => (/^R/.test(format) ? 'reel' : /^C/.test(format) ? 'carousel' : 'feed');

function weekOf(s: Strategy, date: string): Strategy['plan']['weeks'][number] | null {
  const idx = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${s.plan.from}T00:00:00Z`)) / 86_400_000 / 7);
  return s.plan.weeks[Math.min(idx, s.plan.weeks.length - 1)] ?? null;
}

/** The ready caption that fits the day: the event's, else the dish's, else a student/family/review one by theme. */
function captionFor(s: Strategy, d: Day, theme: string): Strategy['captions'][number] | null {
  const byItem = (item: string) => s.captions.find((c) => c.item.toLowerCase() === item.toLowerCase()) ?? null;
  if (d.event) {
    const r = s.rituals.find((x) => x.name === d.event);
    if (r && byItem(r.item)) return byItem(r.item);
  }
  if (d.dish && byItem(d.dish)) return byItem(d.dish);
  if (/review/i.test(d.idea)) return byItem('Reviews');
  if (/behind|rush|owner|spice prep/i.test(d.idea)) return byItem('Behind Fuadijan');
  if (/student/i.test(theme)) return byItem('Student Combo');
  if (/family/i.test(theme) && !/parking/i.test(d.idea)) return byItem('Family Feast');
  if (/parking|space/i.test(d.idea)) return byItem('Family Feast');
  return null;
}

function onScreen(s: Strategy, d: Day): string | null {
  const quoted = d.idea.match(/text: "([^"]+)"/);
  if (quoted) return quoted[1]!;
  if (d.event) {
    const p = s.posters.find((x) => x.name === d.event);
    if (p) return `${p.headline.replace(/\n/g, ' ')} / ${p.line}`;
  }
  const q = d.idea.match(/^"([^"]+)"/);
  return q ? q[1]! : null;
}

export function strategyRows(s: Strategy = loadStrategy()): Record<(typeof CALENDAR_COLUMNS)[number], string | null>[] {
  return s.plan.days.map((d) => {
    const week = weekOf(s, d.date);
    const theme = week?.theme ?? '';
    const slot = slotOf(d.format);
    const ready = captionFor(s, d, theme);
    const dish = d.dish ?? (ready && !/Reviews|Behind|Student|Family/.test(ready.item) ? ready.item : null);
    const caption = ready ? ready.caption : dish ? s.captionTemplates.dishHero!.replace('[Dish]', dish) : null;
    const hashtags = hashtagsFor(s, [d.dish, theme, d.event, ...d.sets], 5).join(' ');
    const isRitual = d.event ? s.rituals.find((r) => r.name === d.event) : null;
    const notes: string[] = [];
    if (/deal|price|\$X|giveaway|offer/i.test(d.idea) || /\[offer\]|\$\[X\]/.test(caption ?? '')) notes.push('Confirm the offer/price before posting; the [offer] placeholder is asked for.');
    if (/review/i.test(d.idea)) notes.push('Permission from the reviewer before quoting a name; quote exactly as written.');
    if (/kid|grandma|parents|families at the table|students rate/i.test(d.idea)) notes.push('Consent from everyone recognisable on camera.');
    if (/giveaway/i.test(d.idea)) notes.push('Giveaway terms: follow, like, tag 2 friends; ends Sunday; winner announced on the Story.');
    const slotNote = slot === 'reel' ? 'Film vertical 9:16; hook in the first 1–2 seconds; the design made here is the cover/still.' : slot === 'carousel' ? 'Carousel: one item per slide; the design made here is slide 1.' : 'Feed photo 4:5; keep text off the dish.';
    return {
      date: d.date,
      slot,
      type: d.event ? d.event.toLowerCase().replace(/\s+/g, '-') : slot === 'reel' ? 'reel' : slot === 'carousel' ? 'carousel' : 'hero-dish',
      dish,
      theme: `${theme}${d.event ? ` · ${d.event}` : ''}`,
      caption_hint: d.idea,
      post_time: isRitual && d.event === 'Karahi Night' ? '17:00' : '18:00',
      template: d.template,
      status: 'planned',
      asset: null,
      objective: week ? `${week.goal}.` : null,
      creative_instructions: `${d.idea}. ${slotNote}`,
      on_screen_text: onScreen(s, d),
      caption,
      cta: d.booster,
      hashtags,
      story_ideas: d.booster,
      confirmation_notes: notes.join(' ') || null,
    };
  });
}

export async function buildStrategyWorkbook(path = STRATEGY_WORKBOOK_PATH, s: Strategy = loadStrategy()): Promise<{ rows: number; slogans: number }> {
  const rows = strategyRows(s);
  for (const r of rows) templateKeyFor(r.template!);
  const calendar: OutCell[][] = [[...CALENDAR_COLUMNS], ...rows.map((r) => CALENDAR_COLUMNS.map((c) => r[c]))];
  const wordings = strategyWordings(s);
  const slogans: OutCell[][] = [['Item', 'Slogan', 'Line', 'Caption'], ...wordings.map((w) => [w.item, w.headline, w.line, w.caption])];
  const readMe: OutCell[][] = [
    [s.name],
    [`Built from brand/strategy.json: the ${s.plan.weeks.length}-week plan ${s.plan.from} → ${s.plan.to}.`],
    ...s.plan.weeks.map((w) => [`Week ${w.week} (${w.dates}): ${w.theme} — ${w.goal}`]),
    ['Rituals: ' + s.rituals.map((r) => `${r.name} (${r.when})`).join(' · ')],
    ['Every [bracketed] offer, price and name is a placeholder the agent asks about; nothing is posted unconfirmed.'],
    ['Seed it with: npm run seed-calendar -- --file ' + path],
  ];
  await writeWorkbook(path, [
    { name: 'Calendar', rows: calendar, widths: [12, 9, 16, 18, 24, 40, 9, 20, 9, 8, 40, 60, 40, 60, 40, 40, 40, 40] },
    { name: 'Slogans', rows: slogans, widths: [20, 40, 50, 80] },
    { name: 'Read Me', rows: readMe, widths: [120] },
  ]);
  return { rows: rows.length, slogans: wordings.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outArg = process.argv.indexOf('--out');
  const path = outArg >= 0 && process.argv[outArg + 1] ? process.argv[outArg + 1]! : STRATEGY_WORKBOOK_PATH;
  buildStrategyWorkbook(path).then((r) => {
    console.log(`Wrote ${path}: ${r.rows} days, ${r.slogans} wordings.`);
    console.log(`Make it the plan with: npm run seed-calendar -- --file ${path}`);
  }).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
