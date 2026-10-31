/** The structured outputs every Claude call must produce. Zod schemas double as the fixture validators. */
import { z } from 'zod';

export const MatchResult = z.object({
  row_id: z.number().int().nullable().describe('The calendar_rows.id this photo is for, or null when none fits.'),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  dish_canonical: z.string().nullable().describe('The menu name of the dish in the photo, exactly as the menu spells it, or null.'),
  alternatives: z.array(z.object({ row_id: z.number().int(), reason: z.string() })).max(3),
  composition: z.enum(['single-plate', 'scene', 'people', 'other']),
  background_clutter: z.enum(['low', 'medium', 'high']),
  shoot_tip: z.string().nullable().describe('One plain sentence for the owner when clutter is medium or high; otherwise null.'),
  subject_box: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1),
  }).nullable().describe('Where the named dish (plate included) sits in the photo, as fractions of width and height from the top-left; null if it cannot be located.'),
  plate_shape: z.enum(['round', 'square', 'none', 'unknown']).default('unknown').describe('The plate under the dish: round, square/rectangular, none (food straight on a board or bench), or unknown.'),
});
export type MatchResult = z.infer<typeof MatchResult>;
export type SubjectBox = NonNullable<MatchResult['subject_box']>;

export const Unresolved = z.object({
  field: z.enum(['dish', 'caption', 'cta', 'hashtags', 'on_screen_text', 'story_text', 'headline', 'line', 'other']),
  placeholder: z.string().describe('The bracketed text or claim that needs the owner, verbatim.'),
  question: z.string().describe('The question to put to the owner, one sentence.'),
  suggestions: z.array(z.string()).max(4).describe('Suggested answers as buttons; only facts the menu supports or neutral wordings.'),
});
export type Unresolved = z.infer<typeof Unresolved>;

export const CopyVariant = z.object({
  name: z.string().max(30).describe('A two-or-three-word name for this wording, e.g. "Short and punchy".'),
  headline: z.string().describe('Two short lines separated by a newline.'),
  line: z.string().describe('Supporting line, at most ~90 characters, same facts as the main copy.'),
  caption: z.string().describe('The caption in this wording; same facts, no address line, no hashtags.'),
});
export type CopyVariant = z.infer<typeof CopyVariant>;

export const ResolvedCopy = z.object({
  label: z.string().describe('Series label in capitals, e.g. FROM THE FIRE.'),
  headline: z.string().describe('Two short lines separated by a newline, the dish or the hook.'),
  line: z.string().describe('Supporting line, at most ~90 characters, no unverified claims.'),
  caption: z.string().describe('The calendar caption as written, placeholders resolved, no address line, no hashtags.'),
  cta: z.string(),
  hashtags: z.array(z.string()).min(3).max(5).describe('With the # sign, Australian spelling.'),
  alt_text: z.string().describe('One plain sentence describing the image for screen readers.'),
  story_text: z.string().describe('Sticker/poll text for the story, from story_ideas, placeholders resolved.'),
  facebook_caption: z.string().describe('The caption and CTA without hashtags.'),
  on_screen_text: z.array(z.string()).describe('For reels: the on-screen text cards in order, brackets resolved or dropped.'),
  unresolved: z.array(Unresolved).describe('Everything that still needs the owner before this is publishable.'),
  variants: z.array(CopyVariant).max(3).default([]).describe('Two alternative wordings of headline, line and caption for the owner to choose from; the main copy above is the first option.'),
});
export type ResolvedCopy = z.infer<typeof ResolvedCopy>;

/** The art director's decision for one photo: how the design is laid out, before anything is rendered. */
export const DesignSpec = z.object({
  layout: z.enum(['A', 'B']).describe('A: the plate cut out on the Night canvas (only when a cutout exists). B: the photo full-bleed under a gradient band.'),
  text_position: z.enum(['bottom', 'top']).describe('Where the text block sits in layout B; layout A ignores it.'),
  text_side: z.enum(['left', 'right']).describe('Which side the text column sits on; in layout A the plate goes on the other side.'),
  band_strength: z.number().min(0.5).max(1).describe('Opacity of the Night gradient under the text in layout B, 0.5 (light) to 1 (solid). Raised automatically if the maths needs more.'),
  type_scale: z.number().min(0.9).max(1.2).describe('Multiplier on the label, headline and line sizes; 1 is the house default.'),
  crop_focus_y: z.number().min(0.3).max(0.65).describe('Where the dish centre lands in the 4:5 frame, as a fraction from the top: ~0.42 with text at the bottom, ~0.58 with text at the top.'),
  lift_tone: z.boolean().describe('Lift a dim photo towards a mid exposure before compositing.'),
  rationale: z.string().max(200).describe('One sentence on why, for the owner.'),
});
export type DesignSpec = z.infer<typeof DesignSpec>;

/** The critic's read of a rendered design, at phone size. */
export const Critique = z.object({
  score: z.number().min(0).max(10).describe('10 is ready to post; under 7 needs a fix.'),
  legible_on_phone: z.boolean(),
  subject_prominent: z.boolean().describe('The dish is the first thing the eye lands on.'),
  plate_intact: z.boolean().describe('Layout A only: the plate is whole, not clipped by the cutout. True for layout B.'),
  text_over_food: z.boolean().describe('Any text crosses the dish.'),
  too_dark: z.boolean().describe('The food reads muddy or underexposed.'),
  issues: z.array(z.string()).max(5).describe('What is wrong, one short phrase each; empty when nothing is.'),
  fixes: DesignSpec.omit({ rationale: true }).partial().describe('Only the fields that should change, as the new values.'),
  verdict: z.enum(['ship', 'fix', 'reshoot']).describe('ship: send it; fix: apply fixes and render once more; reshoot: no design can rescue this photo.'),
});
export type Critique = z.infer<typeof Critique>;

export const WeeklyReview = z.object({
  summary: z.string(),
  warnings: z.array(z.string()),
});
export type WeeklyReview = z.infer<typeof WeeklyReview>;

export type Purpose = 'match-photo-to-row' | 'resolve-copy' | 'weekly-review' | 'direct-design' | 'critique-design';
