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
});
export type ResolvedCopy = z.infer<typeof ResolvedCopy>;

export const WeeklyReview = z.object({
  summary: z.string(),
  warnings: z.array(z.string()),
});
export type WeeklyReview = z.infer<typeof WeeklyReview>;

export type Purpose = 'match-photo-to-row' | 'resolve-copy' | 'weekly-review';
