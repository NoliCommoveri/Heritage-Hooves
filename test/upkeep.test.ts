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

  // Slice 0013 §7.1/§10.8: feed multiplies the existing charge rather than creating a second one.
  it('a feedMultiplier of 2.0 charges exactly double', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2, feedMultiplier: 2.0 });
    expect(charge.amount).toBe(-160);
  });

  it('a feedMultiplier of 0.6 charges exactly 60%, rounded to an integer', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2, feedMultiplier: 0.6 });
    expect(charge.amount).toBe(-Math.round(80 * 0.6));
  });

  it('a feedMultiplier of 1.0, or an omitted one, charges byte-for-byte what it charged before this slice', () => {
    const withMultiplier = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2, feedMultiplier: 1.0 });
    const withoutMultiplier = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2 });
    expect(withMultiplier.amount).toBe(-80);
    expect(withoutMultiplier.amount).toBe(-80);
  });

  it('the zero-horses case still returns amount 0 with a feedMultiplier applied - the -0 guard survives the multiplication', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 0, ratePerHorsePerGameDay: 2, feedMultiplier: 0.6 });
    expect(charge.amount).toBe(0);
    expect(Object.is(charge.amount, -0)).toBe(false);
    expect(charge.advanceMarker).toBe(true);
  });
});
