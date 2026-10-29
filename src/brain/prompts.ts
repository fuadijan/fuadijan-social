/**
 * The two Cut 1 prompts: match a photo to a calendar row, and turn a row's draft copy into publishable copy.
 * Both are told the same guardrails: nothing invented, menu facts only from the menu, ask when unsure.
 */
import type { CalendarRow } from '../calendar/rows.js';
import type { Menu } from '../menu/source.js';
import type { ParsedCaption } from '../intake/caption.js';

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

function menuBlock(menu: Menu): string {
  const lines = menu.items.map((i) => `- ${i.name}${i.category ? ` (${i.category})` : ''}${i.soldOut ? ' [SOLD OUT]' : ''}${i.priceCents != null ? ` $${(i.priceCents / 100).toFixed(2)}` : ''}`);
  return lines.length ? lines.join('\n') : '(the menu source returned nothing)';
}

export function matchPrompt(caption: ParsedCaption, candidates: CalendarRow[], menu: Menu, today: string): { system: string; user: string } {
  return {
    system: `${GUARDRAILS}\n\nYou match a photo the owner just sent to the calendar row it is for, and you read the photo. Prefer the row whose dish matches what you see and what the caption says; prefer the nearest upcoming date when several fit. composition is "single-plate" only when one plate or dish fills the frame on a plain surface; a table of several dishes, a kitchen, a grill or people is "scene"/"people". background_clutter is about what a designer would have to crop out. shoot_tip: one sentence the owner can act on when clutter is medium or high, otherwise null. Confidence under 0.7 means you want the owner to confirm.`,
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
}

export function resolvePrompt(ctx: ResolveContext): { system: string; user: string } {
  const r = ctx.row;
  return {
    system: `${GUARDRAILS}\n\nYou turn one calendar row's draft copy into publishable copy. Keep caption and CTA as written unless a note from the owner says otherwise. Find every [bracketed] placeholder and every "confirm"/"only if confirmed" note in caption, on_screen_text, cta, hashtags and creative_instructions. Resolve what the menu settles (dish names, sides, categories, availability); everything else goes in unresolved — do not guess, do not drop a sentence silently. Hashtags: the row's, 3 to 5, a bracketed hashtag is resolved or dropped. headline: two short lines (newline-separated) suitable for a 1080x1350 design, the dish name or the hook. line: one supporting sentence, no unverified claims. Prices appear only when told they are allowed, and only from the menu. The address line is added later; leave it out. People in the photo: remind about consent in alt_text only if the row is about team or customers.`,
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
      ctx.answers.length ? `Owner's answers so far:\n${ctx.answers.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`).join('\n')}` : 'No answers from the owner yet.',
      '',
      `Menu:\n${menuBlock(ctx.menu)}`,
    ].filter((l) => l !== '').join('\n'),
  };
}
