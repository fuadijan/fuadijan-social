/**
 * The Telegram caption convention: `<dish or subject> [-- optional note] [#tags]`.
 *
 *   chapli kebab · chicken karahi -- cooked to order, with naan · team photo #day11 · beef seek #story · karahi clip 1
 */
export const KNOWN_TAGS = ['story', 'feed', 'carousel', 'noprice', 'price', 'drafts3', 'unscheduled'] as const;
export type KnownTag = (typeof KNOWN_TAGS)[number];

export interface ParsedCaption {
  subject: string;          // "chicken karahi"
  note: string | null;      // "cooked to order, with naan"
  tags: string[];           // lower-case, without '#': ['story', 'day11']
  dayNo: number | null;     // from #dayN
  /** "chapli 2" / "karahi clip 1" → 2 / 1; the set position when several photos share a subject. */
  sequence: number | null;
  isReview: boolean;        // "review -- AB" …
  reviewerInitials: string | null;
  isClip: boolean;          // "karahi clip 1"
}

export function parseCaption(raw: string | null | undefined): ParsedCaption {
  const text = (raw ?? '').trim();
  const tags: string[] = [];
  let dayNo: number | null = null;
  const withoutTags = text.replace(/(^|\s)#([\w-]+)/g, (_m, _s, t: string) => {
    const tag = t.toLowerCase();
    const day = tag.match(/^day(\d{1,2})$/);
    if (day) dayNo = Number(day[1]);
    tags.push(tag);
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  const [subjectPart, ...noteParts] = withoutTags.split(/\s+--\s+|\s+—\s+/);
  let subject = (subjectPart ?? '').trim();
  const note = noteParts.length ? noteParts.join(' -- ').trim() || null : null;

  const isReview = /^review\b/i.test(subject);
  const reviewerInitials = isReview && note ? (note.match(/^([A-Za-z]{1,4})\b/)?.[1]?.toUpperCase() ?? null) : null;

  let sequence: number | null = null;
  const seq = subject.match(/^(.*?)(?:\s+(?:clip|photo|pic|shot|part)?\s*(\d{1,2}))$/i);
  if (seq && seq[1]) {
    subject = seq[1].trim();
    sequence = Number(seq[2]);
  }
  const isClip = /\bclips?\b/i.test(text);
  subject = subject.replace(/\bclips?\b/gi, '').replace(/\s+/g, ' ').trim();

  return { subject, note, tags, dayNo, sequence, isReview, reviewerInitials, isClip };
}

export function hasTag(p: ParsedCaption, tag: KnownTag): boolean {
  return p.tags.includes(tag);
}
