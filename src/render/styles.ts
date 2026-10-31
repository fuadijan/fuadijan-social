/**
 * The five design styles, distilled from the owner's reference designs into cards the art director reads, rules
 * the critic judges by, and the words the owner can use to ask for one. Each style is a different composition in
 * templates.ts/compose.ts; every one is translated into the Fuadijan kit (Night, Cream, Ember, Saffron, the serif
 * headline face), not copied from the reference.
 *
 *  band    the house look: the photo (or the cut-out plate) with the text block over a Night band
 *  split   one giant word above the dish and one below it, the dish in between
 *  poster  a light paper ground, a huge stacked headline, the cut-out plate sitting in front of the words
 *  flat    a solid Ember ground, the cut-out plate bleeding off the bottom edge, pill tags and a sticker badge
 *  invite  a Night panel with the photo bleeding off one side, an italic accent word, event details in columns
 */
export const STYLE_KEYS = ['band', 'split', 'poster', 'flat', 'invite'] as const;
export type Style = (typeof STYLE_KEYS)[number];

export interface StyleCard {
  key: Style;
  name: string;
  /** For the art director: what it is and when it suits. */
  card: string;
  /** For the critic: what makes this style fail. */
  rules: string;
  needsCutout: boolean;
  /** Whether the story (9:16) is rendered in this style too, or falls back to the band story. */
  story: boolean;
}

export const STYLES: Record<Style, StyleCard> = {
  band: {
    key: 'band', name: 'Band',
    card: 'The house look. The whole photo (layout B) or the cut-out plate on the Night canvas (layout A), with the label, a two-line serif headline, an ember rule and a supporting line in a column over a Night gradient band. Suits every photo; the safe choice for scenes, hands, bread baskets and anything busy. accent_word sets the first headline line in italic saffron, like a handwritten lead-in ("Time to / Savour the flavours").',
    rules: 'Every word readable at phone size; the text column never crosses the dish; in layout A the plate is whole.',
    needsCutout: false, story: true,
  },
  split: {
    key: 'split', name: 'Split',
    card: 'One giant word above the dish and one below it, full width, set in capitals; a small eyebrow label at the top and the supporting line under the bottom word. Needs a headline that splits into two short words or phrases (each under about 10 characters) and a photo whose dish sits in the middle third with quiet top and bottom thirds. Strong on a close-up with hands, a skewer, a pot; wrong when the dish fills the frame top to bottom.',
    rules: 'Neither word may touch the dish; both words at the same size; the dish stays the brightest thing between them.',
    needsCutout: false, story: true,
  },
  poster: {
    key: 'poster', name: 'Poster',
    card: 'A light Cream paper ground with a faint grid, a huge stacked headline in Night filling the upper half, and the cut-out plate sitting in front of the lower part of the words so they run behind the food; ember sparkles in the corners and the footer at the bottom. Needs a clean plate cutout and a headline of two short lines. A bright, modern, daytime look; suits Modern Fuadijan, lunch, snack packs, anything playful.',
    rules: 'The plate must be whole and in front of the words; the words must still be readable where the plate covers them (at least the top two thirds of each line clear); no Night band anywhere.',
    needsCutout: true, story: true,
  },
  flat: {
    key: 'flat', name: 'Flat',
    card: 'A solid Ember ground, a pill tag with the label at the top, a big cream headline in capitals, a short Night subline, and the cut-out plate large across the bottom, bleeding off the bottom edge; a cream sticker badge with the opening hours sits on the plate. Needs a clean cutout. Loud and graphic; best for stories, offers, snack packs and openings, less for a quiet signature dish.',
    rules: 'The headline must not touch the plate; the badge must not cover the food; the subline must read in Night on Ember.',
    needsCutout: true, story: true,
  },
  invite: {
    key: 'invite', name: 'Invite',
    card: 'A Night panel on the text side with the photo bleeding off the other edge and fading into the Night; the label as an eyebrow ("You are invited" energy), the first headline line in italic saffron, the second in big cream capitals, and under them the details in columns with ember rules: the day and date, the hours, then the address as the RSVP line. For launches, openings, Eid, the finale, a feast night. Works with any photo; the dish shows on one side only.',
    rules: 'Text stays on the Night panel, never over the photo; the details must be readable; the photo fade must look soft, not a hard edge.',
    needsCutout: false, story: false,
  },
};

export const styleCards = (): string => STYLE_KEYS.map((k) => `- ${k}: ${STYLES[k].card}`).join('\n');

/** The style the owner's note asks for, if any ("poster", "style split", "invite", "the band look"). */
export function styleFromNote(note: string): Style | null {
  const n = note.toLowerCase();
  if (/\b(?:style\s*)?(?:split)\b/.test(n)) return 'split';
  if (/\b(?:style\s*)?(?:poster)\b/.test(n)) return 'poster';
  if (/\b(?:style\s*)?(?:flat)\b/.test(n)) return 'flat';
  if (/\b(?:style\s*)?(?:invite|invitation)\b/.test(n)) return 'invite';
  if (/\bstyle\s*band\b|\bband (?:style|look)\b|\bclassic (?:style|look)\b|\bhouse (?:style|look)\b/.test(n)) return 'band';
  return null;
}

/** The style that can actually be rendered with what is available. */
export function feasibleStyle(style: Style, have: { cutout: boolean; photo: boolean }): Style {
  if (!have.photo) return 'band';
  if (STYLES[style].needsCutout && !have.cutout) return 'band';
  return style;
}

export const isStyle = (s: unknown): s is Style => typeof s === 'string' && (STYLE_KEYS as readonly string[]).includes(s);
