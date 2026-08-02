import { describe, expect, it } from 'vitest';
import { calendarEntryFor } from '../../src/engines/showing/calendar';

describe('calendarEntryFor', () => {
  it('is deterministic for the same game day', () => {
    expect(calendarEntryFor(30, 30)).toEqual(calendarEntryFor(30, 30));
  });

  it('the same venue recurs at the same point every year (12 shows later, at 30-day intervals)', () => {
    const first = calendarEntryFor(30, 30);
    const nextYear = calendarEntryFor(30 + 12 * 30, 30);
    expect(nextYear.venue).toBe(first.venue);
    expect(nextYear.name).not.toBe(first.name); // "Year 1" vs "Year 2"
  });

  it('twelve consecutive shows visit twelve different venues', () => {
    const venues = new Set<string>();
    for (let i = 1; i <= 12; i++) venues.add(calendarEntryFor(i * 30, 30).venue);
    expect(venues.size).toBe(12);
  });

  it('the assembled name includes the venue and a year number', () => {
    const entry = calendarEntryFor(30, 30);
    expect(entry.name).toContain(entry.venue);
    expect(entry.name).toContain('Year 1');
  });
});
