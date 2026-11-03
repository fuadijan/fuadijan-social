/**
 * The render registry: every `template` value the sheet uses, mapped to a template key and a footer. Boot (and
 * the seed) fail if a sheet value has no mapping. Cut 1 uses it for the Canva brief and the labels; Cut 2 adds the
 * satori templates behind the same keys.
 */
import type { Style } from './styles.js';

export type TemplateKey = 'hero-photo' | 'review' | 'carousel' | 'story' | 'reel-cover' | 'text-only';
export type Footer = 'brand' | 'address';

/** `style` is the composition the calendar template prefers; the art director may still choose another when the photo cannot carry it. */
interface Entry { key: TemplateKey; footer: Footer; label: string; style?: Style }

const REGISTRY: Record<string, Entry> = {
  'from-the-fire': { key: 'hero-photo', footer: 'brand', label: 'FROM THE FIRE' },
  'from-the-karahi': { key: 'hero-photo', footer: 'brand', label: 'FROM THE KARAHI' },
  'chapli-from-the-fire': { key: 'hero-photo', footer: 'brand', label: 'FROM THE FIRE' },
  'customer-favourite': { key: 'hero-photo', footer: 'brand', label: 'FROM THE KARAHI', style: 'split' },
  'snack-pack': { key: 'hero-photo', footer: 'address', label: 'FROM THE FIRE', style: 'flat' },
  'modern-fuadijan': { key: 'hero-photo', footer: 'brand', label: 'MODERN FUADIJAN', style: 'poster' },
  'family-feast': { key: 'hero-photo', footer: 'address', label: 'ROOTED IN TRADITION' },
  'family-table': { key: 'hero-photo', footer: 'address', label: 'ROOTED IN TRADITION' },
  'bbq-feast': { key: 'hero-photo', footer: 'address', label: 'FROM THE FIRE', style: 'split' },
  'weekend-feast': { key: 'hero-photo', footer: 'address', label: 'ROOTED IN TRADITION', style: 'invite' },
  'art-of-karahi': { key: 'hero-photo', footer: 'brand', label: 'FROM THE KARAHI' },
  'rooted-in-tradition': { key: 'hero-photo', footer: 'brand', label: 'ROOTED IN TRADITION' },
  'save-room': { key: 'hero-photo', footer: 'address', label: 'SAVE ROOM' },
  'fresh-pour': { key: 'hero-photo', footer: 'brand', label: 'FRESH POUR' },
  'from-the-charcoal-sea': { key: 'hero-photo', footer: 'brand', label: 'FROM THE CHARCOAL SEA' },
  'what-we-ate-today': { key: 'hero-photo', footer: 'brand', label: 'WHAT WE ATE TODAY' },
  'for-our-customers': { key: 'hero-photo', footer: 'address', label: 'FOR OUR CUSTOMERS' },
  'you-said-it-photo': { key: 'hero-photo', footer: 'address', label: 'YOU SAID IT' },
  'new-product-reveal': { key: 'hero-photo', footer: 'brand', label: 'FROM THE FIRE', style: 'invite' },
  'customer-review': { key: 'review', footer: 'address', label: 'CUSTOMER LOVE' },
  'you-said-it': { key: 'review', footer: 'address', label: 'YOU SAID IT' },
  'chapli-education': { key: 'carousel', footer: 'brand', label: 'FROM THE FIRE' },
  'audience-poll': { key: 'carousel', footer: 'brand', label: 'MODERN FUADIJAN' },
  'brand-intro': { key: 'text-only', footer: 'brand', label: 'THIS IS FUADIJAN' },
  'brand-finale': { key: 'text-only', footer: 'brand', label: 'THIRTY DAYS OF FIRE' },
  'auburn-community': { key: 'text-only', footer: 'address', label: 'PROUDLY AUBURN' },
  'behind-fuadijan': { key: 'text-only', footer: 'brand', label: 'BEHIND FUADIJAN' },
  'team-picks': { key: 'text-only', footer: 'brand', label: 'TEAM PICKS' },
  'new-product-teaser': { key: 'text-only', footer: 'brand', label: 'FROM THE FIRE' },
};

export function templateKeyFor(sheetTemplate: string): TemplateKey {
  const e = REGISTRY[sheetTemplate];
  if (!e) throw new Error(`No render template mapped for sheet template "${sheetTemplate}". Add it to src/render/registry.ts.`);
  return e.key;
}

export function templateEntry(sheetTemplate: string): Entry {
  const e = REGISTRY[sheetTemplate];
  if (!e) throw new Error(`No render template mapped for sheet template "${sheetTemplate}".`);
  return e;
}

export function knownTemplates(): string[] {
  return Object.keys(REGISTRY);
}

/** The photo-post series (hero-photo templates) a custom design can use, one per label + footer + style. */
export function heroTemplates(): { template: string; label: string; footer: Footer; style: Style | null }[] {
  const seen = new Set<string>();
  const out: { template: string; label: string; footer: Footer; style: Style | null }[] = [];
  for (const [template, e] of Object.entries(REGISTRY)) {
    if (e.key !== 'hero-photo') continue;
    const k = `${e.label}|${e.footer}|${e.style ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ template, label: e.label, footer: e.footer, style: e.style ?? null });
  }
  return out;
}

/** Words that place a product in a series, from its menu category ("Beverages", "Sweets") or its name. */
const SEAFOOD = /barramundi|prawn|shrimp|seafood|\bfish\b|salmon|snapper|calamari|squid|\bcrab\b|lobster|mussel|oyster/i;
const DRINK = /juice|lassi|chai|shake|drink|beverage|cola|soda|mocktail|coconut water|\bwater\b|\btea\b|coffee/i;
const SWEET = /kheer|gulab|jamun|dessert|sweet|mithai|nutella|halwa|falooda|ice cream|rasmalai/i;
const KARAHI = /karahi|curr|nihari|haleem|daal|\bdal\b/i;
const MODERN = /burger|wrap|\broll\b|snack|shami/i;

/** The series a custom post starts from: seafood from the charcoal sea, drinks pour, sweets save room, karahis and curries from the karahi, burgers and snacks modern, else the first hero series. */
export function suggestedTemplate(product: string, category?: string | null): string {
  const hay = `${category ?? ''} ${product}`;
  const all = heroTemplates();
  const by = (re: RegExp, label: string) => (re.test(hay) ? all.find((t) => t.label === label)?.template ?? null : null);
  return by(SEAFOOD, 'FROM THE CHARCOAL SEA') ?? by(DRINK, 'FRESH POUR') ?? by(SWEET, 'SAVE ROOM') ?? by(KARAHI, 'FROM THE KARAHI') ?? by(MODERN, 'MODERN FUADIJAN') ?? all[0]!.template;
}

/**
 * A series as a sheet names it: a template value ("from-the-charcoal-sea") or a series label ("FROM THE CHARCOAL
 * SEA", any case) → the hero template to design from; null when neither.
 */
export function templateForSeries(ref: string): string | null {
  const k = ref.trim().toLowerCase().replace(/\s+/g, '-');
  // A template's own name wins as written; words are a label first ("YOU SAID IT" is the photo series, "you-said-it" the review design).
  if (REGISTRY[ref.trim()]) return ref.trim();
  const label = ref.trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  // A photo series first (the one a design starts from), then any other template with that label (YOU SAID IT is a review).
  return heroTemplates().find((t) => t.label === label)?.template ?? Object.entries(REGISTRY).find(([, e]) => e.label === label)?.[0] ?? (REGISTRY[k] ? k : null);
}

/** The series label of a template the registry knows, else null. */
export function seriesOfTemplate(template: string): string | null {
  return REGISTRY[template]?.label ?? null;
}

/** Boot check: every template value in the table has a mapping. */
export function assertAllMapped(values: string[]): void {
  const missing = values.filter((v) => !REGISTRY[v]);
  if (missing.length) throw new Error(`Sheet templates without a render mapping: ${missing.join(', ')}`);
}
