/**
 * The design decision for a hero photo, in three parts that replace the old fixed recipe:
 *  - a rule-based default from the photo measurements (always available, no network),
 *  - the art director (Claude, with the thumbnail and the numbers) improving on it,
 *  - the owner's words (the /redo note, standing design notes) overriding both.
 * Then the critic looks at the finished PNG at phone size and may ask for one more pass (render-stage.ts).
 */
import sharp from 'sharp';
import type { AppContext } from '../context.js';
import { config } from '../config.js';
import type { PhotoStats } from '../images/analyze.js';
import { Critique, DesignSpec, type MatchResult } from '../brain/schemas.js';
import { critiquePrompt, directPrompt } from '../brain/prompts.js';
import type { Brand } from '../render/brand.js';
import { legibilityFor, predictedContrast, relativeLuminance, contrastRatio, type Legibility } from '../render/legibility.js';
import { STYLES, feasibleStyle, styleFromNote, type Style } from '../render/styles.js';

export type DesignSource = 'heuristic' | 'claude' | 'owner';

export interface DesignRun {
  spec: DesignSpec;
  source: DesignSource;
  /** Fields the owner fixed in the note; the critic may not change them. */
  locked: (keyof DesignSpec)[];
  legibility: Legibility | null;
  critique: Critique | null;
  attempts: number;
  /** The first critique when a second pass ran, so the pack can show the improvement. */
  firstScore: number | null;
}

/** What the pack and the Telegram message keep of a run. */
export interface DesignSummary {
  style: Style;
  accent_word: boolean;
  layout: 'A' | 'B';
  text_position: 'top' | 'bottom';
  text_side: 'left' | 'right';
  band_strength: number;
  type_scale: number;
  source: DesignSource;
  rationale: string;
  contrast: number | null;
  score: number | null;
  first_score: number | null;
  verdict: Critique['verdict'] | null;
  issues: string[];
  attempts: number;
}

export function summarise(run: DesignRun): DesignSummary {
  return {
    style: run.spec.style, accent_word: run.spec.accent_word, layout: run.spec.layout, text_position: run.spec.text_position, text_side: run.spec.text_side,
    band_strength: run.spec.band_strength, type_scale: run.spec.type_scale, source: run.source, rationale: run.spec.rationale,
    contrast: run.legibility?.contrast ?? null, score: run.critique?.score ?? null, first_score: run.firstScore,
    verdict: run.critique?.verdict ?? null, issues: run.critique?.issues ?? [], attempts: run.attempts,
  };
}

export interface DesignInput {
  stats: PhotoStats;
  read: MatchResult | null;
  cutoutAvailable: boolean;
  cutoutCoverage: number | null;
  headline: string;
  line: string;
  note: string | null;
  designNotes: string;
  /** The style the calendar template prefers (registry), if any. */
  templateStyle?: Style | null;
  /** The marketing strategy's visual rules, passed on to the art director. */
  strategy?: string | null;
}

const headlineLines = (headline: string): string[] => headline.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * The style the rules would pick. The template's preference wins when the photo can carry it; otherwise split
 * when the headline is two short words and the dish sits mid-frame with quiet thirds above and below; else band.
 */
export function heuristicStyle(d: DesignInput, dishY: number): Style {
  const have = { cutout: d.cutoutAvailable, photo: true };
  const lines = headlineLines(d.headline);
  const twoShort = lines.length === 2 && lines.every((l) => l.length <= 10);
  const midFrame = dishY > 0.32 && dishY < 0.68;
  const quietEnds = d.stats.zones.top.detail < 0.35 && d.stats.zones.bottom.detail < 0.35;
  if (d.templateStyle && d.templateStyle !== 'band') {
    const t = feasibleStyle(d.templateStyle, have);
    if (t === d.templateStyle && (t !== 'split' || twoShort)) return t;
  }
  if (twoShort && midFrame && quietEnds) return 'split';
  return 'band';
}

/** The rule-based default: where the dish is, where the photo is quiet, how dim it is, how long the words are. */
export function heuristicSpec(d: DesignInput): DesignSpec {
  const { stats, read } = d;
  const box = read?.subject_box ?? null;
  const dishY = box ? box.y + box.h / 2 : stats.brightCentre.y;
  const dishX = box ? box.x + box.w / 2 : stats.brightCentre.x;
  const layout: DesignSpec['layout'] = d.cutoutAvailable && read?.composition === 'single-plate' ? 'A' : 'B';
  // Text goes where the dish isn't: top when the dish sits low in the frame, otherwise bottom; left or right by
  // the quieter half, with the dish's side as the tie-break.
  const text_position: DesignSpec['text_position'] = layout === 'B' && dishY > 0.62 ? 'top' : 'bottom';
  const quietDiff = stats.zones.right.quiet - stats.zones.left.quiet;
  const text_side: DesignSpec['text_side'] = layout === 'A' ? 'left' : quietDiff > 0.08 ? 'right' : quietDiff < -0.08 ? 'left' : dishX < 0.45 ? 'right' : 'left';
  const headlineChars = d.headline.replace(/\n/g, ' ').trim().length;
  const busy = read?.background_clutter === 'high' || stats.zones[text_position].detail > 0.45;
  const type_scale = Math.min(1.2, Math.max(1, (headlineChars <= 14 ? 1.1 : 1) + (busy ? 0.05 : 0)));
  const style = heuristicStyle(d, dishY);
  const first = headlineLines(d.headline)[0] ?? '';
  // A short lead-in line ("Time to", "Fresh from") reads as an accent; a dish name does not.
  const accent_word = style === 'invite' || (style === 'band' && headlineLines(d.headline).length === 2 && first.length <= 9 && /^(?:time|fresh|straight|hot|made|from|our|the|new|try|taste|meet|say|hello|this|your)\b/i.test(first));
  return {
    style,
    accent_word,
    layout,
    text_position,
    text_side,
    band_strength: 0.95,
    type_scale,
    crop_focus_y: text_position === 'top' ? 0.58 : 0.42,
    lift_tone: stats.mean < 0.09,
    rationale: `Rule-based: ${style !== 'band' ? `${STYLES[style].name} style, ` : ''}${layout === 'A' ? 'single plate with a clean cutout' : 'full photo'}, text ${text_position}-${text_side} where the photo is ${stats.zones[text_position].detail < 0.3 ? 'quiet' : 'calmest'}${type_scale > 1 ? ', type enlarged for a short headline' : ''}.`,
  };
}

/**
 * The owner's words win: "/redo 2 layout B", "text on the right", "text at the top", "bigger text", "brighter".
 * Returns the overridden spec and which fields are now locked against the director and the critic.
 */
export function applyOwnerNote(spec: DesignSpec, note: string | null): { spec: DesignSpec; locked: (keyof DesignSpec)[] } {
  const n = (note ?? '').toLowerCase();
  if (!n) return { spec, locked: [] };
  const out = { ...spec };
  const locked: (keyof DesignSpec)[] = [];
  const lock = <K extends keyof DesignSpec>(k: K, v: DesignSpec[K]) => { out[k] = v; if (!locked.includes(k)) locked.push(k); };
  const style = styleFromNote(n);
  if (style) lock('style', style);
  if (/\bno accent\b|\bplain headline\b/.test(n)) lock('accent_word', false);
  else if (/\baccent\b|\bitalic lead\b|\bscript\b/.test(n)) lock('accent_word', true);
  if (/layout\s*b|no cutout|full[- ]bleed|whole photo/.test(n)) lock('layout', 'B');
  else if (/layout\s*a|\bcutout\b/.test(n)) lock('layout', 'A');
  if (/text (?:on |to |at )?(?:the )?right|right side/.test(n)) lock('text_side', 'right');
  else if (/text (?:on |to |at )?(?:the )?left|left side/.test(n)) lock('text_side', 'left');
  if (/text (?:at |on |to )?(?:the )?top|top text/.test(n)) { lock('text_position', 'top'); if (!locked.includes('crop_focus_y')) out.crop_focus_y = 0.58; }
  else if (/text (?:at |on |to )?(?:the )?bottom|bottom text/.test(n)) { lock('text_position', 'bottom'); out.crop_focus_y = 0.42; }
  if (/\b(?:bigger|larger|huge)\b/.test(n)) lock('type_scale', 1.15);
  else if (/\bsmaller\b/.test(n)) lock('type_scale', 0.95);
  if (/\b(?:brighter|lighter|too dark)\b/.test(n)) lock('lift_tone', true);
  if (/\b(?:darker|stronger band|more contrast)\b/.test(n)) lock('band_strength', 1);
  if (locked.length) out.rationale = `Owner's note applied (${locked.join(', ')}). ${spec.rationale}`.slice(0, 200);
  return { spec: out, locked };
}

/** Claude's decision, or the heuristic when Claude is unavailable or fails. */
export async function directDesign(app: AppContext, input: DesignInput, thumb: Buffer, jobId: number | null): Promise<{ spec: DesignSpec; source: DesignSource }> {
  const heuristic = heuristicSpec(input);
  try {
    const prompt = directPrompt({ ...input, heuristic, templateStyle: input.templateStyle ?? null });
    const spec = await app.claude.call({ purpose: 'direct-design', fixtureKey: 'default', system: prompt.system, user: prompt.user, image: { bytes: thumb, mime: 'image/jpeg' }, schema: DesignSpec, jobId });
    return { spec, source: 'claude' };
  } catch (e) {
    app.log.warn(`Art director unavailable, using the rule-based design: ${e instanceof Error ? e.message : e}`);
    return { spec: heuristic, source: 'heuristic' };
  }
}

/**
 * The band strength the maths demands under this text block, never below what the spec asked for. Split has text
 * at both ends, so the stronger of the two bands wins; poster, flat and invite put their text on a solid ground,
 * whose contrast is known without a band.
 */
export function withLegibility(spec: DesignSpec, stats: PhotoStats, brand: Brand): { spec: DesignSpec; legibility: Legibility } {
  const solid = (text: string, ground: string, zone: Legibility['zone']): Legibility => ({ zone, zoneLum: relativeLuminance(ground), bandStrength: 1, contrast: Math.round(contrastRatio(relativeLuminance(text), relativeLuminance(ground)) * 10) / 10 });
  switch (spec.style) {
    case 'split': {
      const top = legibilityFor(stats, 'top', spec.text_side, brand);
      const bottom = legibilityFor(stats, 'bottom', spec.text_side, brand);
      const worst = top.bandStrength >= bottom.bandStrength ? top : bottom;
      const band_strength = Math.max(spec.band_strength, worst.bandStrength);
      return { spec: { ...spec, band_strength }, legibility: { ...worst, bandStrength: band_strength, contrast: predictedContrast(worst.zoneLum, band_strength, brand.colors.night, brand.colors.cream) } };
    }
    case 'poster': return { spec, legibility: solid(brand.colors.night, brand.colors.cream, 'top') };
    case 'flat': return { spec, legibility: solid(brand.colors.cream, brand.colors.ember, 'top') };
    case 'invite': return { spec: { ...spec, band_strength: 1 }, legibility: solid(brand.colors.cream, brand.colors.night, spec.text_side) };
    default: {
      const legibility = legibilityFor(stats, spec.text_position, spec.text_side, brand);
      return { spec: { ...spec, band_strength: Math.max(spec.band_strength, legibility.bandStrength) }, legibility };
    }
  }
}

/** The critic's fixes merged into the spec, skipping the fields the owner locked. */
export function mergeFixes(spec: DesignSpec, fixes: Critique['fixes'], locked: (keyof DesignSpec)[]): DesignSpec {
  const out = { ...spec };
  for (const [k, v] of Object.entries(fixes) as [keyof Critique['fixes'], unknown][]) {
    if (v === undefined || v === null || locked.includes(k)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  if (out.text_position !== spec.text_position && !locked.includes('crop_focus_y')) out.crop_focus_y = out.text_position === 'top' ? 0.58 : 0.42;
  return out;
}

/** The finished feed PNG at phone size → the critic's rubric; null when the critique is off or fails. */
export async function critiqueDesign(app: AppContext, feedPng: Buffer, spec: DesignSpec, dish: string | null, attempt: number, previousIssues: string[], jobId: number | null): Promise<Critique | null> {
  if (!config.claude.critique) return null;
  try {
    const small = await sharp(feedPng).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer();
    const prompt = critiquePrompt({ spec, dish, attempt, previousIssues });
    return await app.claude.call({ purpose: 'critique-design', fixtureKey: 'default', system: prompt.system, user: prompt.user, image: { bytes: small, mime: 'image/jpeg' }, schema: Critique, jobId, model: config.claude.critiqueModel });
  } catch (e) {
    app.log.warn(`Design critique failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export const CRITIQUE_FIX_BELOW = 7;
