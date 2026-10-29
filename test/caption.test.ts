import { describe, expect, it } from 'vitest';
import { parseCaption } from '../src/intake/caption.js';

describe('caption convention', () => {
  it('reads a plain dish', () => {
    const p = parseCaption('chapli kebab');
    expect(p.subject).toBe('chapli kebab');
    expect(p.note).toBeNull();
    expect(p.tags).toEqual([]);
    expect(p.dayNo).toBeNull();
  });

  it('splits the note and the tags', () => {
    const p = parseCaption('chicken karahi -- cooked to order, with naan #day4 #price');
    expect(p.subject).toBe('chicken karahi');
    expect(p.note).toBe('cooked to order, with naan');
    expect(p.tags).toEqual(['day4', 'price']);
    expect(p.dayNo).toBe(4);
  });

  it('reads set sequence numbers and clips', () => {
    expect(parseCaption('chapli 2')).toMatchObject({ subject: 'chapli', sequence: 2 });
    expect(parseCaption('karahi clip 1')).toMatchObject({ subject: 'karahi', sequence: 1, isClip: true });
    expect(parseCaption('team photo #day11')).toMatchObject({ subject: 'team photo', dayNo: 11 });
  });

  it('reads a review header', () => {
    const p = parseCaption('review -- AB');
    expect(p.isReview).toBe(true);
    expect(p.reviewerInitials).toBe('AB');
  });

  it('copes with an empty caption', () => {
    expect(parseCaption(undefined)).toMatchObject({ subject: '', tags: [], dayNo: null });
  });
});
