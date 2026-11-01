import { describe, expect, it } from 'vitest';
import { resolveAnswer, type Question } from '../src/pipeline/questions.js';

const question = (field: string, options: Question['options']): Question => ({
  id: 1, row_id: null, job_id: 1, field, question: '?', options, answer: null, answered_via: null, asked_at: new Date(), answered_at: null, telegram_message_id: null,
});

const quality = question('quality', [{ key: 'use', label: 'Use this one', value: 'use' }, { key: 'resend', label: "I'll resend as a File", value: 'resend' }]);
const match = question('match', [
  { key: 'r12', label: 'Day 5 · Beef Seekh', value: '12' },
  { key: 'r13', label: 'Day 6 · Chicken Karahi', value: '13' },
  { key: 'unscheduled', label: 'Unscheduled', value: 'unscheduled' },
]);

describe('typed answers to questions', () => {
  it('reads a button key, a value or a label', () => {
    expect(resolveAnswer(quality, 'use')).toBe('use');
    expect(resolveAnswer(quality, 'resend')).toBe('resend');
    expect(resolveAnswer(quality, 'Use this one')).toBe('use');
    expect(resolveAnswer(match, 'r13')).toBe('13');
  });

  it('understands the ways the owner says "go ahead" on a photo warning', () => {
    for (const t of ['use current', 'Use the current one', 'keep it', 'ok', 'yes', 'fine, go ahead', 'use it anyway']) expect(resolveAnswer(quality, t), t).toBe('use');
    for (const t of ["I'll resend", 'resend as file', 'let me take another']) expect(resolveAnswer(quality, t), t).toBe('resend');
  });

  it('reads a day from a typed reply to "Which day is this for?"', () => {
    expect(resolveAnswer(match, 'Day 5')).toBe('12');
    expect(resolveAnswer(match, '#day6')).toBe('13');
    expect(resolveAnswer(match, '6')).toBe('13');
    expect(resolveAnswer(match, 'day 9')).toBe('day 9'); // not among the buttons: the stage looks the day up
    expect(resolveAnswer(match, 'chicken karahi')).toBe('13');
    expect(resolveAnswer(match, 'not scheduled')).toBe('unscheduled');
  });

  it('keeps free text that fits nothing', () => {
    expect(resolveAnswer(quality, 'hmm, what do you think?')).toBe('hmm, what do you think?');
    expect(resolveAnswer(question('wording', []), 'Smoky. Spiced. Ours.')).toBe('Smoky. Spiced. Ours.');
  });
});
