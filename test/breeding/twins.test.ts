import { describe, expect, it } from 'vitest';
import { rollTwins, type TwinConfig } from '../../src/engines/breeding/twins';
import { makeRng, deriveSeed } from '../../src/lib/rng';
import type { Rng } from '../../src/lib/rng';

const CONFIG: TwinConfig = { twin_double_ovulation_rate: 0.15, twin_both_continue_rate: 0.02 };

function fixedRng(value: number): Rng {
  return {
    next: () => value,
    int: () => 0,
    pick: (items) => items[0],
    shuffle: (items) => items.slice(),
    normal: () => 0,
  };
}

describe('rollTwins', () => {
  it('no twins when double ovulation fails, regardless of the continue roll', () => {
    expect(rollTwins(fixedRng(0.99), fixedRng(0), CONFIG)).toBe(false);
  });

  it('twins when double ovulation succeeds and both continue', () => {
    expect(rollTwins(fixedRng(0), fixedRng(0), CONFIG)).toBe(true);
  });

  it('no twins when double ovulation succeeds but the reduction takes one', () => {
    expect(rollTwins(fixedRng(0), fixedRng(0.99), CONFIG)).toBe(false);
  });

  it('never consumes the continue roll when double ovulation fails (so the two rolls stay independently tunable)', () => {
    let continueRngCalled = false;
    const watchedRng: Rng = { ...fixedRng(0), next: () => ((continueRngCalled = true), 0) };
    rollTwins(fixedRng(0.99), watchedRng, CONFIG);
    expect(continueRngCalled).toBe(false);
  });

  it('over many independent covering seeds, twins happen at roughly the expected net rate (~1 in 330)', () => {
    let twinCount = 0;
    const trials = 20_000;
    for (let seed = 1; seed <= trials; seed++) {
      const doubleOvulationRng = makeRng(deriveSeed(seed, 'double_ovulation'));
      const continueRng = makeRng(deriveSeed(seed, 'twin_continue'));
      if (rollTwins(doubleOvulationRng, continueRng, CONFIG)) twinCount++;
    }
    const rate = twinCount / trials;
    // Expected rate is 0.15 * 0.02 = 0.003 (~1 in 333).
    expect(rate).toBeGreaterThan(0.0015);
    expect(rate).toBeLessThan(0.005);
  });
});
