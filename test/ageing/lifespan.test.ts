import { describe, expect, it } from 'vitest';
import { rollLifespanGameDays, type LifespanRollConfig } from '../../src/engines/ageing/lifespan';
import { makeRng, deriveSeed } from '../../src/lib/rng';

// The starting numbers from slice 0011 §4.2/migrations/0060_config_ageing.sql.
const CONFIG: LifespanRollConfig = {
  lifespan_mean_game_days: 8280,
  lifespan_sd_game_days: 1260,
  lifespan_min_game_days: 5040,
  lifespan_max_game_days: 11880,
};

const GAME_DAYS_PER_YEAR = 360;

function sample(n: number, config: LifespanRollConfig = CONFIG): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rollLifespanGameDays(makeRng(deriveSeed(i + 1, 'lifespan_test')), config));
  }
  return out;
}

describe('rollLifespanGameDays', () => {
  it('every draw lands inside the clamps, always', () => {
    for (const days of sample(3000)) {
      expect(days).toBeGreaterThanOrEqual(CONFIG.lifespan_min_game_days);
      expect(days).toBeLessThanOrEqual(CONFIG.lifespan_max_game_days);
    }
  });

  it('rounds to a whole day', () => {
    for (const days of sample(500)) {
      expect(Number.isInteger(days)).toBe(true);
    }
  });

  it("a large sample's mean and standard deviation land close to the configured ones", () => {
    const days = sample(20000);
    const mean = days.reduce((a, b) => a + b, 0) / days.length;
    const variance = days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length;
    const sd = Math.sqrt(variance);

    expect(mean).toBeGreaterThan(CONFIG.lifespan_mean_game_days - 100);
    expect(mean).toBeLessThan(CONFIG.lifespan_mean_game_days + 100);
    // The clamps trim the tails, so the observed sd is a little below the configured one - allow
    // for that rather than expecting an exact match.
    expect(sd).toBeGreaterThan(CONFIG.lifespan_sd_game_days - 250);
    expect(sd).toBeLessThan(CONFIG.lifespan_sd_game_days + 100);
  });

  it("the proportion under eighteen years and over twenty-seven years match §2.4's stated shape - about one in thirteen, and about one in eight", () => {
    const days = sample(30000);
    const under18 = days.filter((d) => d < 18 * GAME_DAYS_PER_YEAR).length / days.length;
    const over27 = days.filter((d) => d > 27 * GAME_DAYS_PER_YEAR).length / days.length;

    expect(under18).toBeGreaterThan(0.04);
    expect(under18).toBeLessThan(0.12);
    expect(over27).toBeGreaterThan(0.08);
    expect(over27).toBeLessThan(0.17);
  });

  it('the same seed produces the same lifespan, twice', () => {
    const first = rollLifespanGameDays(makeRng(deriveSeed(777, 'lifespan')), CONFIG);
    const second = rollLifespanGameDays(makeRng(deriveSeed(777, 'lifespan')), CONFIG);
    expect(first).toBe(second);
  });

  it('a configuration with min == max produces exactly that value and does not loop or throw', () => {
    const degenerate: LifespanRollConfig = {
      lifespan_mean_game_days: 8280,
      lifespan_sd_game_days: 1260,
      lifespan_min_game_days: 9000,
      lifespan_max_game_days: 9000,
    };
    for (const days of sample(50, degenerate)) {
      expect(days).toBe(9000);
    }
  });
});
