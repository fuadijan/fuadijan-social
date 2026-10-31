/**
 * The two Cut 1 prompts: match a photo to a calendar row, and turn a row's draft copy into publishable copy.
 * Both are told the same guardrails: nothing invented, menu facts only from the menu, ask when unsure.
 */
import type { CalendarRow } from '../calendar/rows.js';
import type { Menu } from '../menu/source.js';
import type { ParsedCaption } from '../intake/caption.js';
import type { PhotoStats } from '../images/analyze.js';
import { describeStats } from '../images/analyze.js';
import type { DesignSpec, MatchResult } from './schemas.js';

const GUARDRAILS = `You work for Fuadijan, a halal Pakistani charcoal BBQ restaurant at Auburn, Sydney. Brand line: "Smoked. Grilled. Rooted in Tradition." Series labels: FROM THE FIRE, FROM THE KARAHI, ROOTED IN TRADITION, MODERN FUADIJAN, BEHIND FUADIJAN.
Hard rules:
- Never invent a menu item, side, price, availability, review, person's name or cooking claim. Menu facts come only from the menu list given to you.
- A claim in [square brackets] or marked "confirm" is unverified: resolve it from the menu if the menu settles it, otherwise list it under unresolved with a question and suggested answers.
- Australian English spelling. No emojis in copy unless the calendar already has them.
- Keep the calendar's wording; you are editing a draft, not writing a new one.`;

function rowSummary(r: CalendarRow): string {
  return [
    `row_id=${r.id} day=${r.day_no} date=${r.date} slot=${r.slot} type=${r.type} template=${r.template}`,
    `  dish: ${r.dish ?? '(flexible)'}  theme: ${r.theme ?? ''}`,
    r.creative_instructions ? `  instructions: ${r.creative_instructions.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n');
}

function menuBlock(menu: Menu, withDescriptions = false): string {
  const lines = menu.items.map((i) => `- ${i.name}${i.category ? ` (${i.category})` : ''}${i.soldOut ? ' [SOLD OUT]' : ''}${i.priceCents != null ? ` $${(i.priceCents / 100).toFixed(2)}` : ''}${withDescriptions && i.description ? ` — ${i.description.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`);
  return lines.length ? lines.join('\n') : '(the menu source returned nothing)';
}

export function matchPrompt(caption: ParsedCaption, candidates: CalendarRow[], menu: Menu, today: string): { system: string; user: string } {
  return {
    system: `${GUARDRAILS}\n\nYou match a photo the owner just sent to the calendar row it is for, and you read the photo. Prefer the row whose dish matches what you see and what the caption says; prefer the nearest upcoming date when several fit. composition is "single-plate" only when one plate or dish fills the frame on a plain surface; a table of several dishes, a kitchen, a grill or people is "scene"/"people". background_clutter is about what a designer would have to crop out. shoot_tip: one sentence the owner can act on when clutter is medium or high, otherwise null. subject_box: the rectangle around the dish the caption names, plate included but not the bread basket, drinks or sauces beside it, as fractions of the image (x, y from the top-left, w, h); the design is cropped around it, so be generous rather than tight. plate_shape: round, square, none (no plate) or unknown; the plate must stay in the design, so the box is the plate's box. Confidence under 0.7 means you want the owner to confirm.`,
    user: `Today is ${today}.\nCaption from the owner: "${caption.subject}"${caption.note ? ` — note: "${caption.note}"` : ''}${caption.tags.length ? ` tags: ${caption.tags.map((t) => `#${t}`).join(' ')}` : ''}\n\nCandidate calendar rows:\n${candidates.map(rowSummary).join('\n')}\n\nMenu:\n${menuBlock(menu)}\n\nPick the row (or null), name the dish as the menu spells it, and describe the photo.`,
  };
}

export interface ResolveContext {
  row: CalendarRow;
  menu: Menu;
  answers: { question: string; answer: string }[];
  note: string | null;
  dishCanonical: string | null;
  label: string;
  footer: 'brand' | 'address';
  priceAllowed: boolean;
  /** What the owner has told us about dishes (/fact), e.g. "Chapli Kebab: served with raita and salad". */
  facts: string[];
}

export function resolvePrompt(ctx: ResolveContext): { system: string; user: string } {
  const r = ctx.row;
  return {
    system: `${GUARDRAILS}\n\nYou turn one calendar row's draft copy into publishable copy. Keep caption and CTA as written unless a note from the owner says otherwise. Find every [bracketed] placeholder and every "confirm"/"only if confirmed" note in caption, on_screen_text, cta, hashtags and creative_instructions. Resolve what the menu settles (dish names, sides, categories, availability); everything else goes in unresolved — do not guess, do not drop a sentence silently. Hashtags: the row's, 3 to 5, a bracketed hashtag is resolved or dropped. headline: two short lines (newline-separated) suitable for a 1080x1350 design, the dish name or the hook. line: one supporting sentence, no unverified claims. Prices appear only when told they are allowed, and only from the menu. The address line is added later; leave it out. alt_text: one plain sentence for screen readers about the dish on its plate and nothing else: name only the dish itself (as the menu spells it) and use generic words for anything else on the plate ("salad", "slices of cucumber", "a dip") — never name a bread, sauce, chutney, raita or side unless the menu description or an owner fact confirms it, never mention the background, the table, the design or the brand colours (the layout is decided after you, so you cannot know them), and never describe things outside the plate (a bread basket, drinks). People in the photo: remind about consent in alt_text only if the row is about team or customers. variants: two alternative wordings the owner can pick instead of the main copy — the first shorter and punchier, the second warmer and more story-led — each with its own headline (two lines), line and caption, every fact identical to the main copy, placeholders resolved the same way, no new claims; name each in two or three words.`,
    user: [
      `Calendar row (day ${r.day_no}, ${r.date}, ${r.slot}, template ${r.template}, series label ${ctx.label}, footer ${ctx.footer}):`,
      `dish: ${r.dish ?? '(flexible)'}${ctx.dishCanonical ? ` — photo shows: ${ctx.dishCanonical}` : ''}`,
      `theme: ${r.theme ?? ''}`,
      `objective: ${r.objective ?? ''}`,
      `creative_instructions: ${r.creative_instructions ?? ''}`,
      `on_screen_text: ${r.on_screen_text ?? ''}`,
      `caption: ${r.caption ?? ''}`,
      `cta: ${r.cta ?? ''}`,
      `hashtags: ${r.hashtags ?? ''}`,
      `story_ideas: ${r.story_ideas ?? ''}`,
      `confirmation_notes: ${r.confirmation_notes ?? ''}`,
      '',
      `Prices allowed: ${ctx.priceAllowed ? 'yes (menu prices only)' : 'no'}`,
      ctx.note ? `Owner's note for this run: "${ctx.note}"` : '',
      ctx.facts.length ? `Facts the owner has confirmed about dishes (treat as true):\n${ctx.facts.map((f) => `- ${f}`).join('\n')}` : '',
      ctx.answers.length ? `Owner's answers so far:\n${ctx.answers.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`).join('\n')}` : 'No answers from the owner yet.',
      '',
      `Menu (with the kitchen's descriptions):\n${menuBlock(ctx.menu, true)}`,
    ].filter((l) => l !== '').join('\n'),
  };
}

// ─── the art director and the critic ───────────────────────────────────────────────────────────────────────

const DESIGN_SYSTEM = `You are the art director for Fuadijan's Instagram feed. The look: a Night (#0F0D0B) canvas, cream serif headlines, a saffron series label, an ember rule, generous type that reads on a phone. Two layouts exist. Layout A cuts the plate out of the photo and sets it on the Night canvas beside the text column; it needs a clean cutout and suits a single plate on a plain surface. Layout B shows the whole photo full-bleed with a Night gradient band under the text; it suits scenes, busy plates, bread baskets, hands, anything where the surroundings matter or the cutout would lose the plate. The owner has preferred layout B on busy photos and wants the plate kept whole and the type big.`;

export interface DirectContext {
  stats: PhotoStats;
  read: MatchResult | null;
  cutoutAvailable: boolean;
  cutoutCoverage: number | null;
  headline: string;
  line: string;
  note: string | null;
  designNotes: string;
  heuristic: DesignSpec;
}

export function directPrompt(ctx: DirectContext): { system: string; user: string } {
  const r = ctx.read;
  return {
    system: `${DESIGN_SYSTEM}\n\nDecide the design for this photo from the thumbnail and the measurements. Put the text where the photo is quiet (low detail) and keep it off the dish; the band under the text is darkened for you, so choose its strength for the look, not for contrast. text_position top is for a photo whose dish sits in the lower half; then crop_focus_y should be about 0.58 so the dish stays under the text. type_scale above 1 when the headline is short or the photo is busy; never below 1 on a busy photo. Pick layout A only when a cutout is available and the plate is the whole subject. Explain in one sentence the owner would understand.`,
    user: [
      describeStats(ctx.stats),
      r ? `Vision read: composition ${r.composition}, clutter ${r.background_clutter}, plate ${r.plate_shape}${r.subject_box ? `, dish box x ${pct(r.subject_box.x)} y ${pct(r.subject_box.y)} w ${pct(r.subject_box.w)} h ${pct(r.subject_box.h)}` : ', dish not located'}.` : 'No vision read of this photo.',
      ctx.cutoutAvailable ? `A plate cutout is available (mask covers ${pct(ctx.cutoutCoverage ?? 0)} of the plate region).` : 'No usable plate cutout: layout A is not possible, choose B.',
      `Headline: "${ctx.headline.replace(/\n/g, ' / ')}" (${ctx.headline.replace(/\n/g, ' ').length} characters). Line: "${ctx.line}" (${ctx.line.length} characters).`,
      ctx.designNotes ? `Owner's standing design notes: "${ctx.designNotes}"` : '',
      ctx.note ? `Owner's note for this run: "${ctx.note}"` : '',
      `The rule-based default would be: ${JSON.stringify({ ...ctx.heuristic, rationale: undefined })}. Improve on it where the photo asks for it.`,
    ].filter((l) => l !== '').join('\n'),
  };
}

export interface CritiqueContext { spec: DesignSpec; dish: string | null; attempt: number; previousIssues: string[] }

export function critiquePrompt(ctx: CritiqueContext): { system: string; user: string } {
  return {
    system: `${DESIGN_SYSTEM}\n\nYou are now the critic. You see the finished feed design at phone size. Judge it as a diner scrolling Instagram would: can every word be read without squinting, is the dish the first thing the eye lands on, is the plate whole, does any text cross the food, is the food muddy or underexposed, does the composition feel balanced. Score 0–10. Under 7 means a fix is needed; propose only the fields that should change, as new values (e.g. a larger type_scale, a stronger band_strength, text_position top, layout B). "reshoot" only when no layout can rescue the photo. Do not rewrite the copy.`,
    user: [
      `Design spec used: ${JSON.stringify({ ...ctx.spec, rationale: undefined })}.`,
      ctx.dish ? `The dish: ${ctx.dish}.` : '',
      ctx.attempt > 1 ? `This is attempt ${ctx.attempt}; the previous attempt was faulted for: ${ctx.previousIssues.join('; ') || 'nothing specific'}.` : '',
      'Fill the rubric.',
    ].filter((l) => l !== '').join('\n'),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
