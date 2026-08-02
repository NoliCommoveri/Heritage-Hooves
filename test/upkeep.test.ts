import { describe, expect, it } from 'vitest';
import { computeUpkeep } from '../src/lib/upkeep';

describe('computeUpkeep', () => {
  it('4 horses x 10 days x rate 2 = 80', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2 });
    expect(charge.amount).toBe(-80);
    expect(charge.advanceMarker).toBe(true);
  });

  it('daysOwed of 0 charges nothing and does not move the marker', () => {
    const charge = computeUpkeep({ daysOwed: 0, aliveHorses: 4, ratePerHorsePerGameDay: 2 });
    expect(charge.amount).toBe(0);
    expect(charge.advanceMarker).toBe(false);
  });

  it('a 30-day gap charges 30 days, not one tick worth - the missed-tick catch-up', () => {
    const charge = computeUpkeep({ daysOwed: 30, aliveHorses: 2, ratePerHorsePerGameDay: 2 });
    expect(charge.amount).toBe(-(2 * 30 * 2));
  });

  it('0 horses charges nothing but still reports that the marker must move', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 0, ratePerHorsePerGameDay: 2 });
    expect(charge.amount).toBe(0);
    expect(charge.advanceMarker).toBe(true);
  });
});
