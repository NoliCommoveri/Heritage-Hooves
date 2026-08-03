import { describe, expect, it } from 'vitest';
import { careModifierForHorse, careCardViewFor, careStartGameDay } from '../../src/db/care';
import type { ConfigValues } from '../../src/lib/config-cache';

// A trimmed slice of ConfigValues carrying only what src/db/care.ts reads - this file has no D1
// mock (CLAUDE.md's own testing philosophy, per test/upkeep.test.ts and friends), and every
// function under test here is pure, so a real config row is unnecessary.
const CFG = {
  care_start_age_game_days: 1080,
  farrier_interval_game_days: 45,
  farrier_overdue_game_days: 135,
  farrier_bonus: 0.01,
  farrier_penalty: 0.03,
  farrier_cost: 30,
  vet_wellness_interval_game_days: 180,
  vet_wellness_overdue_game_days: 540,
  vet_wellness_bonus: 0.01,
  vet_wellness_penalty: 0.02,
  vet_wellness_cost: 90,
  feed_levels: {
    v: 1,
    levels: {
      poor: { name: 'Poor', upkeep_multiplier: 0.6, care_delta: -0.02 },
      standard: { name: 'Standard', upkeep_multiplier: 1.0, care_delta: 0.0 },
      premium: { name: 'Premium', upkeep_multiplier: 2.0, care_delta: 0.02 },
    },
  },
  care_modifier_min: 0.95,
  care_modifier_max: 1.05,
} as unknown as ConfigValues;

describe('careStartGameDay', () => {
  it('is born_game_day plus the configured age', () => {
    expect(careStartGameDay(5000, CFG)).toBe(5000 + 1080);
  });
});

describe('careModifierForHorse', () => {
  it('a horse never called, already past care-start age, reads overdue on both timers', () => {
    const horse = { born_game_day: 0, last_farrier_game_day: null, last_vet_game_day: null };
    const result = careModifierForHorse(horse, 'standard', CFG, 2000);
    expect(result.farrier.status).toBe('overdue');
    expect(result.wellness.status).toBe('overdue');
  });

  it('a foal below care-start age is not_yet on both timers and carries no penalty', () => {
    const horse = { born_game_day: 1000, last_farrier_game_day: null, last_vet_game_day: null };
    const result = careModifierForHorse(horse, 'standard', CFG, 1050);
    expect(result.farrier.status).toBe('not_yet');
    expect(result.wellness.status).toBe('not_yet');
    expect(result.modifier).toBe(1);
  });

  it('feed shifts the modifier by exactly its own care_delta when both timers are neutral', () => {
    const horse = { born_game_day: 0, last_farrier_game_day: 1000, last_vet_game_day: 1000 };
    const standard = careModifierForHorse(horse, 'standard', CFG, 1000 + 90); // mid-ramp on both, but same for both feeds
    const poor = careModifierForHorse(horse, 'poor', CFG, 1000 + 90);
    expect(poor.unclampedModifier).toBeCloseTo(standard.unclampedModifier - 0.02, 10);
  });

  it('an unrecognised feed level reads as standard rather than throwing', () => {
    const horse = { born_game_day: 0, last_farrier_game_day: 1000, last_vet_game_day: 1000 };
    expect(() => careModifierForHorse(horse, 'deluxe', CFG, 1000)).not.toThrow();
    const deluxe = careModifierForHorse(horse, 'deluxe', CFG, 1000);
    const standard = careModifierForHorse(horse, 'standard', CFG, 1000);
    expect(deluxe.modifier).toBe(standard.modifier);
  });
});

describe('careCardViewFor', () => {
  it('tooYoung mirrors the farrier timer\'s own not_yet status', () => {
    const youngHorse = { born_game_day: 1000, last_farrier_game_day: null, last_vet_game_day: null };
    const oldHorse = { born_game_day: 0, last_farrier_game_day: null, last_vet_game_day: null };
    expect(careCardViewFor(youngHorse, 'standard', CFG, 1050).tooYoung).toBe(true);
    expect(careCardViewFor(oldHorse, 'standard', CFG, 5000).tooYoung).toBe(false);
  });

  it('needsFarrier/needsWellness match each timer\'s own needsCall', () => {
    const horse = { born_game_day: 0, last_farrier_game_day: 1000, last_vet_game_day: 1000 };
    const fresh = careCardViewFor(horse, 'standard', CFG, 1000);
    expect(fresh.needsFarrier).toBe(false);
    expect(fresh.needsWellness).toBe(false);

    const overdue = careCardViewFor(horse, 'standard', CFG, 1000 + 200);
    expect(overdue.needsFarrier).toBe(true);
    // Wellness (interval 180) is still exactly due, not yet overdue, at day 200 - both count as
    // "needs a call" per the engine's own needsCall rule.
    expect(overdue.needsWellness).toBe(true);
  });
});
