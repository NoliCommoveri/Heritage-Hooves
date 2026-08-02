import { describe, expect, it } from 'vitest';
import { dayOfYear, isInBreedingSeason, nextSeasonStartGameDay } from '../../src/engines/breeding/season';

const START = 30;
const LENGTH = 180;
const YEAR = 360;

describe('dayOfYear', () => {
  it('wraps at the year boundary', () => {
    expect(dayOfYear(0, YEAR)).toBe(0);
    expect(dayOfYear(359, YEAR)).toBe(359);
    expect(dayOfYear(360, YEAR)).toBe(0);
    expect(dayOfYear(720 + 15, YEAR)).toBe(15);
  });
});

describe('isInBreedingSeason', () => {
  it('is false before the season opens', () => {
    expect(isInBreedingSeason(10, START, LENGTH, YEAR)).toBe(false);
  });

  it('is true at the season boundary and inside it', () => {
    expect(isInBreedingSeason(30, START, LENGTH, YEAR)).toBe(true);
    expect(isInBreedingSeason(150, START, LENGTH, YEAR)).toBe(true);
    expect(isInBreedingSeason(209, START, LENGTH, YEAR)).toBe(true);
  });

  it('is false on and after the season closes', () => {
    expect(isInBreedingSeason(210, START, LENGTH, YEAR)).toBe(false);
    expect(isInBreedingSeason(300, START, LENGTH, YEAR)).toBe(false);
  });

  it('holds across a year boundary', () => {
    expect(isInBreedingSeason(360 + 30, START, LENGTH, YEAR)).toBe(true);
    expect(isInBreedingSeason(360 + 10, START, LENGTH, YEAR)).toBe(false);
  });
});

describe('nextSeasonStartGameDay', () => {
  it('returns null when the season is open right now', () => {
    expect(nextSeasonStartGameDay(100, START, LENGTH, YEAR)).toBeNull();
  });

  it('returns this year\'s start when still before it', () => {
    expect(nextSeasonStartGameDay(10, START, LENGTH, YEAR)).toBe(30);
  });

  it("returns next year's start once this year's season has closed", () => {
    expect(nextSeasonStartGameDay(250, START, LENGTH, YEAR)).toBe(360 + 30);
  });
});
