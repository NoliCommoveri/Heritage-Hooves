import { describe, expect, it } from 'vitest';
import { agePerformanceModifier, type AgeModifierConfig } from '../../src/engines/ageing/performance';

// Slice 0014 §4.1/migrations/0076_config_age_decline.sql - the seeded numbers.
const CONFIG: AgeModifierConfig = {
  age_decline_start_game_days: 5760,
  age_decline_floor_game_days: 9000,
  age_modifier_floor: 0.85,
  game_days_per_year: 360,
};

function daysForYears(years: number): number {
  return years * CONFIG.game_days_per_year;
}

describe('agePerformanceModifier', () => {
  // Test 1: the curve is flat before the start.
  it('is exactly 1.0 and phase prime for every age from 0 up to the start day', () => {
    for (const days of [0, 1, 1000, 5000, 5759, 5760]) {
      const result = agePerformanceModifier(days, CONFIG);
      if (days < CONFIG.age_decline_start_game_days) {
        expect(result.modifier).toBe(1);
        expect(result.phase).toBe('prime');
      }
    }
    // Exactly at the start day the ramp has begun (distance 0 -> modifier still 1, phase past_peak).
    const atStart = agePerformanceModifier(CONFIG.age_decline_start_game_days, CONFIG);
    expect(atStart.modifier).toBe(1);
  });

  // Test 2: the worked examples in §4.1, to three decimal places.
  it.each([
    [15, 1.0],
    [18, 0.967],
    [20, 0.933],
    [23, 0.883],
    [25, 0.85],
    [30, 0.85],
  ])('%s game years -> modifier %s', (years, expected) => {
    const result = agePerformanceModifier(daysForYears(years), CONFIG);
    expect(result.modifier).toBeCloseTo(expected, 3);
  });

  // Test 3: age decline never reads the failing state - it is a pure function of age in days, full
  // stop. §2.2's whole argument, as an assertion.
  it('is a function of age in days alone - remaining lifespan never enters it', () => {
    // agePerformanceModifier's signature does not even accept a lifespan or a frailty window, so
    // two "horses" of the same age necessarily produce the same modifier - there is nothing else to
    // pass in. This is the test that would fail to compile if a future edit smuggled ageState in.
    const a = agePerformanceModifier(daysForYears(13), CONFIG);
    const b = agePerformanceModifier(daysForYears(13), CONFIG);
    expect(a.modifier).toBe(b.modifier);
    // A thirteen-year-old, whatever its lifespan roll, is below the decline's start day and reads
    // exactly 1.0.
    expect(a.modifier).toBe(1);
    expect(a.phase).toBe('prime');
  });

  // Test 4: a degenerate config does not throw.
  it('does not throw when floorDay <= start, or when the floor is above 1.0, or when both are zero', () => {
    expect(() => agePerformanceModifier(1000, { ...CONFIG, age_decline_floor_game_days: CONFIG.age_decline_start_game_days })).not.toThrow();
    expect(() => agePerformanceModifier(1000, { ...CONFIG, age_decline_floor_game_days: CONFIG.age_decline_start_game_days - 100 })).not.toThrow();
    expect(() => agePerformanceModifier(1000, { ...CONFIG, age_modifier_floor: 1.2 })).not.toThrow();
    expect(() => agePerformanceModifier(0, { age_decline_start_game_days: 0, age_decline_floor_game_days: 0, age_modifier_floor: 0.85, game_days_per_year: 360 })).not.toThrow();

    // floorDay <= start: any age at or past start reads as the floor, never divides by zero.
    const degenerate = agePerformanceModifier(daysForYears(20), { ...CONFIG, age_decline_floor_game_days: CONFIG.age_decline_start_game_days });
    expect(degenerate.modifier).toBe(CONFIG.age_modifier_floor);
    expect(degenerate.phase).toBe('floor');
    expect(Number.isFinite(degenerate.modifier)).toBe(true);
  });

  it('is exactly the floor at and beyond the floor day', () => {
    const atFloor = agePerformanceModifier(CONFIG.age_decline_floor_game_days, CONFIG);
    expect(atFloor.modifier).toBe(CONFIG.age_modifier_floor);
    expect(atFloor.phase).toBe('floor');
    const pastFloor = agePerformanceModifier(CONFIG.age_decline_floor_game_days + 5000, CONFIG);
    expect(pastFloor.modifier).toBe(CONFIG.age_modifier_floor);
    expect(pastFloor.phase).toBe('floor');
  });
});
