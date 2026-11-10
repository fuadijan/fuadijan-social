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
 *
 * Ten occasion looks follow (occasion.ts draws them): arch, countdown, ribbon, jaali, deal, menu, weekly, stars,
 * visit and pillars. The art director never picks one; the owner does, for a special day or a weekly ritual.
 */
export const STYLE_KEYS = ['band', 'split', 'poster', 'flat', 'invite', 'arch', 'countdown', 'ribbon', 'jaali', 'deal', 'menu', 'weekly', 'stars', 'visit', 'pillars'] as const;
export type Style = (typeof STYLE_KEYS)[number];

export interface StyleCard {
  key: Style;
  name: string;
  /** For the art director: what it is and when it suits. */
  card: string;
  /** For the critic: what makes this style fail. */
  rules: string;
  /** For the owner, in the web app: one plain sentence. */
  blurb: string;
  needsCutout: boolean;
  /** Whether the story (9:16) is rendered in this style too, or falls back to the band story. */
  story: boolean;
  /** An occasion look: only the owner picks it, never the art director or the critic. */
  occasion?: boolean;
  /** Drawn without a photo too (the photo is optional in the design). */
  photoFree?: boolean;
}

export const STYLES: Record<Style, StyleCard> = {
  band: {
    key: 'band', name: 'Band',
    card: 'The house look. The whole photo (layout B) or the cut-out plate on the Night canvas (layout A), with the label, a two-line serif headline, an ember rule and a supporting line in a column over a Night gradient band. Suits every photo; the safe choice for scenes, hands, bread baskets and anything busy. accent_word sets the first headline line in italic saffron, like a handwritten lead-in ("Time to / Savour the flavours").',
    rules: 'Every word readable at phone size; the text column never crosses the dish; in layout A the plate is whole.',
    blurb: 'The house look: the photo with the label, headline and line over a dark band. Works with every photo.',
    needsCutout: false, story: true,
  },
  split: {
    key: 'split', name: 'Split',
    card: 'One giant word above the dish and one below it, full width, set in capitals; a small eyebrow label at the top and the supporting line under the bottom word. Needs a headline that splits into two short words or phrases (each under about 10 characters) and a photo whose dish sits in the middle third with quiet top and bottom thirds. Strong on a close-up with hands, a skewer, a pot; wrong when the dish fills the frame top to bottom.',
    rules: 'Neither word may touch the dish; both words at the same size; the dish stays the brightest thing between them.',
    blurb: 'One giant word above the dish and one below it. Needs two short words and a dish in the middle of the photo.',
    needsCutout: false, story: true,
  },
  poster: {
    key: 'poster', name: 'Poster',
    card: 'A light Cream paper ground with a faint grid, a huge stacked headline in Night filling the upper half, and the cut-out plate sitting in front of the lower part of the words so they run behind the food; ember sparkles in the corners and the footer at the bottom. Needs a clean plate cutout and a headline of two short lines. A bright, modern, daytime look; suits Modern Fuadijan, lunch, snack packs, anything playful.',
    rules: 'The plate must be whole and in front of the words; the words must still be readable where the plate covers them (at least the top two thirds of each line clear); no Night band anywhere.',
    blurb: 'Light cream paper, a huge headline, the cut-out plate in front of the words. Needs a clean plate; otherwise it becomes Band.',
    needsCutout: true, story: true,
  },
  flat: {
    key: 'flat', name: 'Flat',
    card: 'A solid Ember ground, a pill tag with the label at the top, a big cream headline in capitals, a short Night subline, and the cut-out plate large across the bottom, bleeding off the bottom edge; a cream sticker badge with the opening hours sits on the plate. Needs a clean cutout. Loud and graphic; best for stories, offers, snack packs and openings, less for a quiet signature dish.',
    rules: 'The headline must not touch the plate; the badge must not cover the food; the subline must read in Night on Ember.',
    blurb: 'Solid orange ground, the cut-out plate off the bottom edge, an hours sticker. Needs a clean plate; otherwise it becomes Band.',
    needsCutout: true, story: true,
  },
  invite: {
    key: 'invite', name: 'Invite',
    card: 'A Night panel on the text side with the photo bleeding off the other edge and fading into the Night; the label as an eyebrow ("You are invited" energy), the first headline line in italic saffron, the second in big cream capitals, and under them the details in columns with ember rules: the day and date, the hours, then the address as the RSVP line. For launches, openings, Eid, the finale, a feast night. Works with any photo; the dish shows on one side only.',
    rules: 'Text stays on the Night panel, never over the photo; the details must be readable; the photo fade must look soft, not a hard edge.',
    blurb: 'A dark panel with the photo fading off one side, then the day, date, hours and address. For launches and feast nights.',
    needsCutout: false, story: false,
  },
  arch: {
    key: 'arch', name: 'Arch',
    card: 'Night with a soft glow, the photo cut into an arched window with a saffron outline and a small diamond over the apex, the label, greeting and line centred under it, the brand line at the bottom. For Eid, Ramadan, iftar nights and greetings with a dish.',
    rules: 'The dish must sit inside the arch, not cut by its curve; the greeting reads in one or two lines; nothing overlaps the outline.',
    blurb: 'The photo in an arched window, the greeting centred under it. For Eid, Ramadan and iftar nights.',
    needsCutout: false, story: true, occasion: true,
  },
  countdown: {
    key: 'countdown', name: 'Countdown',
    card: 'A Night panel on the left with a giant saffron count of the days left ("3", "TODAY"), DAYS TO GO under it, then the dish and its line; the big day at the bottom; the photo fades off the right edge. For a launch or a dish that is coming soon.',
    rules: 'The count is the biggest thing on the panel; the text stays on the Night panel, never over the photo.',
    blurb: 'A big count of the days left beside the photo. Set the big day; the count is worked out from the day it goes up.',
    needsCutout: false, story: true, occasion: true,
  },
  ribbon: {
    key: 'ribbon', name: 'Ribbon',
    card: 'The house band design (the photo full-bleed, the text block over the Night band at the bottom) with an Ember ribbon across the top-right corner carrying a few words, NEW ON THE MENU by default. For a new dish, opening day or an anniversary.',
    rules: 'The ribbon words are readable and do not cover the dish; the text block keeps the band rules.',
    blurb: 'A ribbon across the corner of the photo, with words you choose. For a new dish, opening day or an anniversary.',
    needsCutout: false, story: true, occasion: true,
  },
  jaali: {
    key: 'jaali', name: 'Jaali card',
    card: 'A greeting card: a faint saffron lattice on Night inside a double saffron frame with diamonds at the corners, the logo at the top, the photo in a small round window, the greeting centred under it. For Independence Day, Eid, New Year and other greeting days.',
    rules: 'The greeting is centred and readable over the lattice; the round photo shows the dish whole.',
    blurb: 'A lattice pattern in a double frame, the photo in a small round window, the greeting centred. For greeting days.',
    needsCutout: false, story: true, occasion: true, photoFree: true,
  },
  deal: {
    key: 'deal', name: 'Deal',
    card: 'The house band design with a tilted cream price sticker in the top-right corner (a dashed Ember ring, a small word such as ONLY over the price). For specials, family packs and set menus.',
    rules: 'The price is readable at phone size; the sticker does not cover the dish.',
    blurb: 'A round price sticker on the photo. For specials, family packs and set menus.',
    needsCutout: false, story: true, occasion: true,
  },
  menu: {
    key: 'menu', name: 'Menu board',
    card: 'Night with the label, the title, an ember rule and up to six dishes with dotted leaders and saffron prices; a strip of the photo along the bottom fades up into the Night. For an iftar menu, catering or a holiday menu.',
    rules: 'Every dish and price reads at phone size; the list stays above the photo strip.',
    blurb: 'Up to six dishes with prices, and a strip of the photo along the bottom. For iftar, catering and holiday menus.',
    needsCutout: false, story: true, occasion: true, photoFree: true,
  },
  weekly: {
    key: 'weekly', name: 'Weekly night',
    card: 'Night with the logo, label and title centred at the top, then the week as seven day letters in circles with the ritual\'s day filled saffron, the time big under it (the opening hours unless the owner sets one) and the offer in capitals; the photo fills the lower part and fades up into the Night. For a recurring night: Karahi Night on Wednesdays, Chapli Kebab Day, Student Night.',
    rules: 'The filled day is the one the owner set (or the day it goes up); the time and the offer read at phone size; the words stay above the photo.',
    blurb: 'The week with your night\'s day filled in, the time and the offer, the photo below. For Karahi Night and other weekly rituals.',
    needsCutout: false, story: true, occasion: true,
  },
  stars: {
    key: 'stars', name: 'Review wall',
    card: 'Night with the label, the rating big in saffron beside five drawn stars, the title ("And counting"), an ember rule and up to three short guest quotes on Charcoal cards in the italic serif with the initials in sand; the line ("Thank you, Auburn") and the address at the bottom. With a photo, a strip of it along the bottom and two quotes at most. Only the rating and the words the owner typed; never a made-up review.',
    rules: 'The rating and the stars are the first thing seen; every quote reads at phone size; nothing overlaps the address.',
    blurb: 'Your rating big with five stars, and up to three guest quotes on cards. For a review milestone or a thank-you.',
    needsCutout: false, story: true, occasion: true, photoFree: true,
  },
  visit: {
    key: 'visit', name: 'Visit card',
    card: 'The photo (the shop front or a dish) in a rounded window with a saffron outline across the top, then the label (FIND US), the title, an ember rule and a list with saffron heads and cream values: the address, the opening hours, the owner\'s parking note and where to order. Without a photo the list sits in the middle. For a "find us" post or a new neighbourhood.',
    rules: 'Every row reads at phone size; only the settings and the owner\'s note are printed; the list never crosses the brand line.',
    blurb: 'The photo in a rounded frame, then the address, hours, parking and where to order. For a "find us" post.',
    needsCutout: false, story: true, occasion: true, photoFree: true,
  },
  pillars: {
    key: 'pillars', name: 'Promise',
    card: 'Night with the logo and label, then three short statements stacked in the big serif, each with a small saffron numeral (01, 02, 03) and a thin ember rule between them, the line under them and the brand line at the bottom; the photo is a tall strip on the right fading into the Night. Without a photo the statements are centred. For the brand promise ("Smoked. Grilled. Rooted in tradition.") or a halal promise.',
    rules: 'Each statement reads at a glance and keeps to two lines; the words stay on the Night, clear of the photo.',
    blurb: 'Three short statements stacked and numbered, the photo down the right. For the brand promise or a halal promise.',
    needsCutout: false, story: true, occasion: true, photoFree: true,
  },
};

/** The styles the art director may choose from (the occasion looks are the owner's to pick). */
export const DIRECTOR_STYLES = STYLE_KEYS.filter((k) => !STYLES[k].occasion);

export const styleCards = (): string => DIRECTOR_STYLES.map((k) => `- ${k}: ${STYLES[k].card}`).join('\n');

/** The style the owner's note asks for, if any ("poster", "style split", "invite", "the band look"). */
export function styleFromNote(note: string): Style | null {
  const n = note.toLowerCase();
  if (/\b(?:style\s*)?(?:split)\b/.test(n)) return 'split';
  if (/\b(?:style\s*)?(?:poster)\b/.test(n)) return 'poster';
  if (/\b(?:style\s*)?(?:flat)\b/.test(n)) return 'flat';
  if (/\b(?:style\s*)?(?:invite|invitation)\b/.test(n)) return 'invite';
  if (/\bcount ?down\b/.test(n)) return 'countdown';
  if (/\barch(?:ed)?\b/.test(n)) return 'arch';
  if (/\bribbon\b/.test(n)) return 'ribbon';
  if (/\bjaali\b|\bgreeting card\b/.test(n)) return 'jaali';
  if (/\bstyle\s*deal\b|\bdeal (?:style|look)\b|\bprice (?:sticker|badge)\b/.test(n)) return 'deal';
  if (/\bstyle\s*menu\b|\bmenu[ -]?(?:board|style|look)\b/.test(n)) return 'menu';
  if (/\bweekly\b/.test(n)) return 'weekly';
  if (/\breview wall\b|\bstyle\s*stars\b|\bstars? (?:style|look)\b/.test(n)) return 'stars';
  if (/\bvisit[ -]?card\b|\bfind us\b|\bstyle\s*visit\b|\bvisit (?:style|look)\b/.test(n)) return 'visit';
  if (/\bpillars?\b|\bmanifesto\b|\bpromise\b/.test(n)) return 'pillars';
  if (/\bstyle\s*band\b|\bband (?:style|look)\b|\bclassic (?:style|look)\b|\bhouse (?:style|look)\b/.test(n)) return 'band';
  return null;
}

/** The style that can actually be rendered with what is available. */
export function feasibleStyle(style: Style, have: { cutout: boolean; photo: boolean }): Style {
  if (!have.photo) return STYLES[style].photoFree ? style : 'band';
  if (STYLES[style].needsCutout && !have.cutout) return 'band';
  return style;
}

export const isStyle = (s: unknown): s is Style => typeof s === 'string' && (STYLE_KEYS as readonly string[]).includes(s);
