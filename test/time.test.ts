import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, daysBetween, formatDay, sydneyDate, sydneyTime, weekday } from '../src/time.js';

describe('Sydney time', () => {
  it('turns a UTC instant into the Sydney date and time', () => {
    // 2026-11-02 22:30 UTC is 2026-11-03 09:30 AEDT (UTC+11 in November).
    const t = new Date('2026-11-02T22:30:00Z');
    expect(sydneyDate(t)).toBe('2026-11-03');
    expect(sydneyTime(t)).toBe('09:30');
  });

  it('does date arithmetic on the date part only', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02');
    expect(addDays('2026-11-03', -2)).toBe('2026-11-01');
    expect(daysBetween('2026-11-03', '2026-12-02')).toBe(29);
  });

  it('formats like the brief', () => {
    expect(formatDay('2026-11-03')).toBe('Tue 3 Nov');
    expect(weekday('2026-11-08')).toBe('Sun');
    expect(dayOfWeek('2026-11-08')).toBe(0);
  });
});
