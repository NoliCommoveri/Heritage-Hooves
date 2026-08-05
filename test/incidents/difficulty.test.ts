/**
 * Per-account difficulty, 2026-08-05. Two properties carry the whole feature and both are the kind
 * that fail silently: an outcome table that stops summing to 1 (slice 0020 shipped two of those and
 * only its test caught them), and 'normal' quietly not meaning "today's game, unchanged".
 */
import { describe, expect, it } from 'vitest';
import { scaleBadOutcomes, difficultyMultipliers, NEUTRAL_DIFFICULTY, DIFFICULTY_LEVELS } from '../../src/engines/incidents/difficulty';
import { onsetProbability, rollOutcome, type IncidentRiskModel, type OutcomeTable } from '../../src/engines/incidents/risk';
import type { Rng } from '../../src/lib/rng';

const CONFIG = {
  difficulty_gentle_incident_rate: 0.35,
  difficulty_gentle_bad_outcome: 0.3,
  difficulty_normal_incident_rate: 1.0,
  difficulty_normal_bad_outcome: 1.0,
  difficulty_realistic_incident_rate: 1.35,
  difficulty_realistic_bad_outcome: 1.25,
};

const COLIC: OutcomeTable = { resolved: 0.4, manageable: 0.15, degenerative: 0.05, death: 0.4 };

function sum(table: OutcomeTable): number {
  return table.resolved + table.manageable + table.degenerative + table.death;
}

const MODEL: IncidentRiskModel = {
  v: 1,
  kind: 'acquired',
  tissue: 'gut',
  robustnessTrait: null,
  robustnessWeight: 0,
  baseRatePerGameDay: 0.001,
  careWeight: 1,
  workloadWeight: 0,
  feedWeight: 0,
  pastureMultiplier: 1,
  outcomesUntreated: COLIC,
  outcomesTreated: { resolved: 0.85, manageable: 0.08, degenerative: 0.02, death: 0.05 },
};

/** A stand-in Rng whose next() is fixed - rollOutcome reads nothing else, but the interface has
 * five members and a partial object is not one. */
function rngReturning(value: number): Rng {
  return {
    next: () => value,
    int: () => 0,
    pick: <T>(items: T[]) => items[0],
    shuffle: <T>(items: T[]) => [...items],
    normal: () => 0,
  };
}

const BASE_INPUT = {
  daysSinceLastCheck: 10,
  carePenaltyFactor: 0,
  workloadFactor: 0,
  feedRiskFactor: 0,
  location: 'barn' as const,
  robustnessPotential: null,
};

describe('difficultyMultipliers', () => {
  it('normal is exactly neutral - the baseline is today\'s game, unchanged', () => {
    expect(difficultyMultipliers('normal', CONFIG)).toEqual({ incidentRate: 1, badOutcome: 1 });
  });

  it('an NPC stable (no account) and an unrecognised value both read neutral, never throw', () => {
    expect(difficultyMultipliers(null, CONFIG)).toEqual(NEUTRAL_DIFFICULTY);
    expect(difficultyMultipliers(undefined, CONFIG)).toEqual(NEUTRAL_DIFFICULTY);
    expect(difficultyMultipliers('nonsense-a-hand-crafted-post-put-there', CONFIG)).toEqual(NEUTRAL_DIFFICULTY);
  });

  it('every named level resolves to real numbers', () => {
    for (const level of DIFFICULTY_LEVELS) {
      const m = difficultyMultipliers(level, CONFIG);
      expect(Number.isFinite(m.incidentRate)).toBe(true);
      expect(Number.isFinite(m.badOutcome)).toBe(true);
    }
  });
});

describe('scaleBadOutcomes', () => {
  it('multiplier 1 returns the table untouched, to the last decimal', () => {
    expect(scaleBadOutcomes(COLIC, 1)).toEqual(COLIC);
  });

  it('always sums to 1 - every level, treated and untreated, across both seeded tables', () => {
    for (const table of [COLIC, MODEL.outcomesTreated]) {
      for (const multiplier of [0, 0.1, 0.3, 0.5, 1, 1.25, 2, 5, 50]) {
        expect(sum(scaleBadOutcomes(table, multiplier))).toBeCloseTo(1, 10);
      }
    }
  });

  it('gentle moves probability out of death and into recovery, and never below zero', () => {
    const gentle = scaleBadOutcomes(COLIC, 0.3);
    expect(gentle.death).toBeCloseTo(0.12, 10);
    expect(gentle.degenerative).toBeCloseTo(0.015, 10);
    expect(gentle.resolved).toBeGreaterThan(COLIC.resolved);
    expect(gentle.manageable).toBeGreaterThan(COLIC.manageable);
  });

  it('a multiplier big enough to overflow clamps at all-bad rather than going negative', () => {
    const brutal = scaleBadOutcomes(COLIC, 100);
    expect(sum(brutal)).toBeCloseTo(1, 10);
    expect(brutal.resolved).toBeGreaterThanOrEqual(0);
    expect(brutal.manageable).toBeGreaterThanOrEqual(0);
    expect(brutal.death + brutal.degenerative).toBeCloseTo(1, 10);
  });

  it('preserves the ratio between death and degenerative, and between resolved and manageable', () => {
    const gentle = scaleBadOutcomes(COLIC, 0.3);
    expect(gentle.death / gentle.degenerative).toBeCloseTo(COLIC.death / COLIC.degenerative, 10);
    expect(gentle.resolved / gentle.manageable).toBeCloseTo(COLIC.resolved / COLIC.manageable, 10);
  });
});

describe('difficulty at the two call sites', () => {
  it('the onset multiplier scales risk and defaults to 1 for every pre-existing caller', () => {
    const ceiling = 1;
    const normal = onsetProbability(MODEL, BASE_INPUT, ceiling);
    const withExplicitOne = onsetProbability(MODEL, { ...BASE_INPUT, difficultyRateMultiplier: 1 }, ceiling);
    const gentle = onsetProbability(MODEL, { ...BASE_INPUT, difficultyRateMultiplier: 0.35 }, ceiling);

    expect(withExplicitOne).toBe(normal);
    expect(gentle).toBeLessThan(normal);
    expect(gentle).toBeGreaterThan(0);
  });

  it('the ceiling still binds at every difficulty - the multiplier is applied before the clamp', () => {
    const ceiling = 0.0005;
    const harsh = onsetProbability(MODEL, { ...BASE_INPUT, daysSinceLastCheck: 1, difficultyRateMultiplier: 1000 }, ceiling);
    expect(harsh).toBeLessThanOrEqual(ceiling);
  });

  it('the same roll against a kinder table gives a kinder outcome - one draw, not two', () => {
    // 0.7 lands in death against the untreated colic table (resolved .4 + manageable .15 +
    // degenerative .05 = .6, so anything at or above .6 dies) and in manageable once gentle has
    // widened the recovered/manageable shares out past it.
    const fixedRoll = rngReturning(0.7);
    expect(rollOutcome(MODEL, false, fixedRoll, 1)).toBe('death');
    expect(rollOutcome(MODEL, false, fixedRoll, 0.3)).not.toBe('death');
  });

  it('rollOutcome with no multiplier behaves exactly as it did before difficulty existed', () => {
    const roll = rngReturning;
    for (const value of [0, 0.2, 0.45, 0.58, 0.62, 0.99]) {
      expect(rollOutcome(MODEL, false, roll(value))).toBe(rollOutcome(MODEL, false, roll(value), 1));
    }
  });
});
