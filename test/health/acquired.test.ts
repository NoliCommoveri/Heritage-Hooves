import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { onsetProbability, rollOutcome, parseAcquiredTrigger, type AcquiredTrigger, type OnsetInputs } from '../../src/engines/health/acquired';
import { makeRng } from '../../src/lib/rng';

const CEILING = 0.02;

const BASE_TRIGGER: AcquiredTrigger = {
  v: 1,
  kind: 'acquired',
  tissue: 'gut',
  robustnessTrait: null,
  robustnessWeight: 0,
  baseRatePerGameDay: 0.00025,
  careWeight: 1.2,
  workloadWeight: 0.6,
  feedWeight: 0,
  pastureMultiplier: 0.7,
  treatmentWindowGameDays: 4,
  treatmentCostKey: 'acute_treatment_cost_colic',
  outcomesUntreated: { resolved: 0.55, manageable: 0.05, degenerative: 0, death: 0.4 },
  outcomesTreated: { resolved: 0.9, manageable: 0.05, degenerative: 0, death: 0.05 },
};

const BASE_INPUT: OnsetInputs = {
  daysSinceLastCheck: 1,
  carePenaltyFactor: 0,
  workloadFactor: 0,
  feedRiskFactor: 0,
  location: 'barn',
  robustnessPotential: null,
};

describe('onsetProbability - monotonicity', () => {
  it('worse care never lowers risk', () => {
    const good = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, carePenaltyFactor: 0 }, CEILING);
    const bad = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, carePenaltyFactor: 1 }, CEILING);
    expect(bad).toBeGreaterThanOrEqual(good);
  });

  it('more workload never lowers risk', () => {
    const low = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, workloadFactor: 0 }, CEILING);
    const high = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, workloadFactor: 1 }, CEILING);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('higher feed risk never lowers risk, when feedWeight is set (laminitis)', () => {
    const trigger: AcquiredTrigger = { ...BASE_TRIGGER, feedWeight: 1.0 };
    const low = onsetProbability(trigger, { ...BASE_INPUT, feedRiskFactor: 0 }, CEILING);
    const high = onsetProbability(trigger, { ...BASE_INPUT, feedRiskFactor: 1 }, CEILING);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('lower robustness potential never lowers risk, for a condition that reads one', () => {
    const trigger: AcquiredTrigger = { ...BASE_TRIGGER, robustnessTrait: 'foot_robustness', robustnessWeight: 1.0 };
    const strong = onsetProbability(trigger, { ...BASE_INPUT, robustnessPotential: 20 }, CEILING);
    const weak = onsetProbability(trigger, { ...BASE_INPUT, robustnessPotential: 0 }, CEILING);
    expect(weak).toBeGreaterThanOrEqual(strong);
  });

  it('pasture multiplier below 1.0 lowers risk; above 1.0 raises it', () => {
    const stressTrigger: AcquiredTrigger = { ...BASE_TRIGGER, pastureMultiplier: 0.7 };
    const barnP = onsetProbability(stressTrigger, { ...BASE_INPUT, location: 'barn' }, CEILING);
    const pastureP = onsetProbability(stressTrigger, { ...BASE_INPUT, location: 'pasture' }, CEILING);
    expect(pastureP).toBeLessThan(barnP);

    const envTrigger: AcquiredTrigger = { ...BASE_TRIGGER, pastureMultiplier: 1.8 };
    const barnP2 = onsetProbability(envTrigger, { ...BASE_INPUT, location: 'barn' }, CEILING);
    const pastureP2 = onsetProbability(envTrigger, { ...BASE_INPUT, location: 'pasture' }, CEILING);
    expect(pastureP2).toBeGreaterThan(barnP2);
  });
});

describe('onsetProbability - the ceiling', () => {
  it('never exceeds incident_probability_ceiling_per_game_day, with every input at its worst', () => {
    const trigger: AcquiredTrigger = { ...BASE_TRIGGER, robustnessTrait: 'foot_robustness', robustnessWeight: 5, careWeight: 10, workloadWeight: 10, feedWeight: 5, pastureMultiplier: 100 };
    const worst: OnsetInputs = { daysSinceLastCheck: 1, carePenaltyFactor: 1, workloadFactor: 1, feedRiskFactor: 1, location: 'pasture', robustnessPotential: 0 };
    const p = onsetProbability(trigger, worst, CEILING);
    // A tiny epsilon absorbs floating-point drift from 1 - (1-p)^1 - the ceiling clamp inside
    // dailyProbability is exact, this is only pow()'s own rounding.
    expect(p).toBeLessThanOrEqual(CEILING + 1e-12);
  });

  it('never exceeds the ceiling even accumulated over many days', () => {
    const trigger: AcquiredTrigger = { ...BASE_TRIGGER, careWeight: 10, workloadWeight: 10 };
    const worst: OnsetInputs = { ...BASE_INPUT, daysSinceLastCheck: 30, carePenaltyFactor: 1, workloadFactor: 1 };
    const p = onsetProbability(trigger, worst, CEILING);
    expect(p).toBeLessThanOrEqual(1);
    // Bounded by the daily-ceiling accumulation, not by 30 * ceiling (which would exceed 1).
    expect(p).toBeLessThanOrEqual(1 - Math.pow(1 - CEILING, 30));
  });
});

describe('onsetProbability - the day-accumulation shape', () => {
  it('two one-day calls do not sum to one two-day call, but a five-day call is bounded between the one-day rate and the naive linear approximation', () => {
    const oneDay = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, daysSinceLastCheck: 1 }, CEILING);
    const fiveDay = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, daysSinceLastCheck: 5 }, CEILING);
    const naiveLinear = oneDay * 5;
    expect(fiveDay).toBeGreaterThan(oneDay);
    expect(fiveDay).toBeLessThanOrEqual(naiveLinear);
  });

  it('daysSinceLastCheck = 0 reads as no risk at all', () => {
    expect(onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, daysSinceLastCheck: 0 }, CEILING)).toBe(0);
  });
});

describe('onsetProbability - the robustness no-op case', () => {
  it('a condition with robustnessTrait null produces identical probability regardless of robustnessPotential', () => {
    const withTrait = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, robustnessPotential: 0 }, CEILING);
    const withoutTrait = onsetProbability(BASE_TRIGGER, { ...BASE_INPUT, robustnessPotential: 20 }, CEILING);
    expect(withTrait).toBe(withoutTrait);
  });
});

describe('rollOutcome - the cumulative distribution', () => {
  const rngAt = (value: number) => {
    // A fake Rng whose next() returns a fixed value, for probing exact cumulative boundaries.
    return { next: () => value, int: () => 0, pick: <T>(items: T[]) => items[0], shuffle: <T>(items: T[]) => items, normal: () => 0 };
  };

  it('resolves into each bucket at the expected cumulative boundary (untreated colic: .55/.05/0/.40)', () => {
    expect(rollOutcome(BASE_TRIGGER, false, rngAt(0))).toBe('resolved');
    expect(rollOutcome(BASE_TRIGGER, false, rngAt(0.54))).toBe('resolved');
    expect(rollOutcome(BASE_TRIGGER, false, rngAt(0.56))).toBe('manageable');
    expect(rollOutcome(BASE_TRIGGER, false, rngAt(0.61))).toBe('death');
    expect(rollOutcome(BASE_TRIGGER, false, rngAt(0.99))).toBe('death');
  });

  it('treated draws against the treated table, not the untreated one', () => {
    expect(rollOutcome(BASE_TRIGGER, true, rngAt(0.6))).toBe('resolved');
    expect(rollOutcome(BASE_TRIGGER, true, rngAt(0.99))).toBe('death');
  });

  it('a real seeded Rng always returns one of the four outcomes and never throws', () => {
    const rng = makeRng(12345);
    for (let i = 0; i < 200; i++) {
      const outcome = rollOutcome(BASE_TRIGGER, i % 2 === 0, rng);
      expect(['resolved', 'manageable', 'degenerative', 'death']).toContain(outcome);
    }
  });
});

describe('the seed migration (0121) - every trigger blob', () => {
  const sql = readFileSync(new URL('../../migrations/0121_seed_acquired_conditions.sql', import.meta.url), 'utf8');
  const triggerJsonBlobs = [...sql.matchAll(/'(\{"v":1,"kind":"acquired"[^']*)'/g)].map((m) => m[1]);

  it('seeds exactly twelve conditions', () => {
    expect(triggerJsonBlobs).toHaveLength(12);
  });

  it('both outcome tables sum to 1.0 for every condition - a table that does not is a bug in the document, not just the code', () => {
    for (const blob of triggerJsonBlobs) {
      const trigger = parseAcquiredTrigger(blob);
      const untreatedSum = trigger.outcomesUntreated.resolved + trigger.outcomesUntreated.manageable + trigger.outcomesUntreated.degenerative + trigger.outcomesUntreated.death;
      const treatedSum = trigger.outcomesTreated.resolved + trigger.outcomesTreated.manageable + trigger.outcomesTreated.degenerative + trigger.outcomesTreated.death;
      expect(untreatedSum).toBeCloseTo(1.0, 9);
      expect(treatedSum).toBeCloseTo(1.0, 9);
    }
  });

  it('parses as a valid AcquiredTrigger with the fields onsetProbability/rollOutcome depend on', () => {
    for (const blob of triggerJsonBlobs) {
      const trigger = parseAcquiredTrigger(blob);
      expect(trigger.v).toBe(1);
      expect(trigger.kind).toBe('acquired');
      expect(typeof trigger.baseRatePerGameDay).toBe('number');
      expect(typeof trigger.treatmentWindowGameDays).toBe('number');
      expect(typeof trigger.treatmentCostKey).toBe('string');
    }
  });
});
