import { describe, expect, it } from 'vitest';
import { cyclePhase, isInSeason, ticksUntilNextEstrus } from '../../src/engines/breeding/cycle';

describe('cyclePhase', () => {
  it('is 0 exactly on the anchor tick', () => {
    expect(cyclePhase(100, 100, 4)).toBe(0);
  });

  it('wraps around the cycle length', () => {
    expect(cyclePhase(100, 104, 4)).toBe(0);
    expect(cyclePhase(100, 107, 4)).toBe(3);
    expect(cyclePhase(100, 108, 4)).toBe(0);
  });
});

describe('isInSeason', () => {
  it('is true only for the estrus_ticks ticks right after the anchor', () => {
    const anchor = 50;
    const cycleTicks = 4;
    const estrusTicks = 1;
    const inSeason = [50, 51, 52, 53].map((t) => isInSeason(anchor, t, cycleTicks, estrusTicks));
    expect(inSeason).toEqual([true, false, false, false]);
  });

  it('supports a wider estrus window', () => {
    const anchor = 50;
    expect(isInSeason(anchor, 51, 4, 2)).toBe(true);
    expect(isInSeason(anchor, 52, 4, 2)).toBe(false);
  });

  it('does not privilege one time-of-day slot: every mare returns to season once per full cycle regardless of anchor', () => {
    for (let anchor = 0; anchor < 4; anchor++) {
      const seasons = [];
      for (let t = anchor; t < anchor + 40; t++) seasons.push(isInSeason(anchor, t, 4, 1));
      expect(seasons.filter(Boolean).length).toBe(10);
    }
  });
});

describe('ticksUntilNextEstrus', () => {
  it('is 0 when already in season', () => {
    expect(ticksUntilNextEstrus(50, 50, 4, 1)).toBe(0);
  });

  it('counts up to the next in-season tick', () => {
    expect(ticksUntilNextEstrus(50, 51, 4, 1)).toBe(3);
    expect(ticksUntilNextEstrus(50, 53, 4, 1)).toBe(1);
    expect(ticksUntilNextEstrus(50, 54, 4, 1)).toBe(0);
  });
});
