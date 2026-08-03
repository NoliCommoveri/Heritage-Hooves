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

describe('computeUpkeep with pastured horses (the location flag)', () => {
  it('a horse at pasture costs nothing at the default multiplier of 0', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 0, pastureHorses: 4, ratePerHorsePerGameDay: 2, pastureMultiplier: 0 });
    expect(charge.amount).toBe(0);
    // The marker still advances - a stable whose horses are all out still had those days pass.
    expect(charge.advanceMarker).toBe(true);
  });

  it('charges the barn normally and the pasture at its own multiplier', () => {
    const charge = computeUpkeep({
      daysOwed: 10,
      aliveHorses: 3,
      pastureHorses: 2,
      ratePerHorsePerGameDay: 2,
      feedMultiplier: 1,
      pastureMultiplier: 0.5,
    });
    // 3 x 10 x 2 x 1 = 60 in the barn, 2 x 10 x 2 x 0.5 = 20 at grass.
    expect(charge.amount).toBe(-80);
  });

  it('feed multiplies the barn only - a pastured horse eats grass, not the feed the barn buys', () => {
    const charge = computeUpkeep({
      daysOwed: 10,
      aliveHorses: 1,
      pastureHorses: 1,
      ratePerHorsePerGameDay: 2,
      feedMultiplier: 2,
      pastureMultiplier: 1,
    });
    // Premium doubles the barn horse (40) and leaves the pastured one at base rate (20).
    expect(charge.amount).toBe(-60);
  });

  it('omitting the pasture parameters is byte-for-byte what it charged before the flag existed', () => {
    const before = computeUpkeep({ daysOwed: 10, aliveHorses: 4, ratePerHorsePerGameDay: 2, feedMultiplier: 1 });
    const after = computeUpkeep({ daysOwed: 10, aliveHorses: 4, pastureHorses: 0, ratePerHorsePerGameDay: 2, feedMultiplier: 1, pastureMultiplier: 0 });
    expect(after).toEqual(before);
    expect(after.amount).toBe(-80);
  });

  it('a stable with every horse at grass charges 0, not -0', () => {
    const charge = computeUpkeep({ daysOwed: 10, aliveHorses: 0, pastureHorses: 6, ratePerHorsePerGameDay: 2, pastureMultiplier: 0 });
    expect(Object.is(charge.amount, -0)).toBe(false);
  });
});
