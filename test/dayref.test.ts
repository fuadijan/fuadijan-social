import { describe, expect, it } from 'vitest';
import { parseDayRef, rowByDishWords } from '../src/messaging/dayref.js';

describe('naming a day in a command', () => {
  it('reads a leading number, "#day 101", "#day101" and "day 101", and leaves the note', () => {
    expect(parseDayRef(['101', 'shorter', 'caption'])).toEqual({ dayNo: 101, rest: ['shorter', 'caption'] });
    expect(parseDayRef(['Beef', 'Seekh', '#day', '101'])).toEqual({ dayNo: 101, rest: ['Beef', 'Seekh'] });
    expect(parseDayRef(['#day101', 'poster'])).toEqual({ dayNo: 101, rest: ['poster'] });
    expect(parseDayRef(['Day', '5'])).toEqual({ dayNo: 5, rest: [] });
    // A leading number wins over a "day 5" mentioned in the note.
    expect(parseDayRef(['101', 'like', 'day', '5'])).toEqual({ dayNo: 101, rest: ['like', 'day', '5'] });
    expect(parseDayRef(['Beef', 'Seekh', 'shorter'])).toEqual({ dayNo: null, rest: ['Beef', 'Seekh', 'shorter'] });
    expect(parseDayRef(['2026-11-12', '7pm'])).toEqual({ dayNo: null, rest: ['2026-11-12', '7pm'] });
  });

  it('finds a day by its dish, preferring the started one nearest today, then the custom post', () => {
    const rows = [
      { day_no: 3, dish: 'Seekh Kebab', status: 'planned', date: '2026-11-04' },
      { day_no: 5, dish: 'Beef Seekh', status: 'planned', date: '2026-11-06' },
      { day_no: 101, dish: 'Beef Seekh', status: 'ready', date: '2026-11-03' },
      { day_no: 12, dish: 'Chicken Karahi', status: 'planned', date: '2026-11-13' },
      { day_no: 21, dish: 'Chicken Karahi', status: 'planned', date: '2026-11-22' },
    ];
    expect(rowByDishWords(rows, ['Beef', 'Seekh', 'shorter', 'caption'], '2026-11-02')).toMatchObject({ row: { day_no: 101 }, rest: ['shorter', 'caption'] });
    expect(rowByDishWords(rows, ['beef', 'seekh'], '2026-11-02')).toMatchObject({ row: { day_no: 101 }, rest: [] });
    expect(rowByDishWords(rows, ['Chicken', 'Karahi', 'poster'], '2026-11-20')).toMatchObject({ row: { day_no: 21 }, rest: ['poster'] });
    expect(rowByDishWords(rows, ['Seekh', 'Kebab'], '2026-11-02')).toMatchObject({ row: { day_no: 3 } });
    expect(rowByDishWords(rows, ['Lamb', 'Chops'], '2026-11-02')).toBeNull();
  });
});
