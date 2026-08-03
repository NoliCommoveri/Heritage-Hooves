import { describe, expect, it } from 'vitest';
import { calendarDateFor, formatCalendarDate } from '../src/lib/calendar';

describe('calendarDateFor', () => {
  it('day 0 is Year 1, January, day 1', () => {
    expect(calendarDateFor(0, 360)).toEqual({ year: 1, month: 1, monthName: 'January', dayOfMonth: 1 });
  });

  it('day 359 is Year 1, December, day 30', () => {
    expect(calendarDateFor(359, 360)).toEqual({ year: 1, month: 12, monthName: 'December', dayOfMonth: 30 });
  });

  it('day 360 rolls over to Year 2, January, day 1', () => {
    expect(calendarDateFor(360, 360)).toEqual({ year: 2, month: 1, monthName: 'January', dayOfMonth: 1 });
  });

  it('day 214 (used in the fix doc worked example) is Year 1, August', () => {
    const d = calendarDateFor(214, 360);
    expect(d.year).toBe(1);
    expect(d.monthName).toBe('August');
  });
});

describe('formatCalendarDate', () => {
  it('renders "Month, Year N" with no day-of-month', () => {
    expect(formatCalendarDate(0, 360)).toBe('January, Year 1');
    expect(formatCalendarDate(400, 360)).toBe('February, Year 2');
  });
});
