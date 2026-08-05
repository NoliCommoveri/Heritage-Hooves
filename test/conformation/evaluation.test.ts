/**
 * The paid conformation evaluation, 2026-08-05. Three properties, in the order they matter:
 *
 *  1. it never lies - the true label is always inside the range;
 *  2. it cannot be averaged away - buying twice at the same age returns the same words;
 *  3. it sharpens with age, reaching a single word by evaluation_certain_age_years.
 *
 * Property 1 is the one that would be a real betrayal if it broke: a child deciding whether to keep
 * feeding a foal is entitled to a vague answer, never a wrong one.
 */
import { describe, expect, it } from 'vitest';
import { verdictFor, evaluationSpreadBands, evaluateHorse, evaluationOffsets, wouldSharpen } from '../../src/engines/conformation/evaluation';
import type { ConformationLabel } from '../../src/engines/conformation/labels';
import type { IdealVector } from '../../src/engines/showing/score';
import type { TraitCode } from '../../src/engines/genetics/polygenic';

const SCALE: ConformationLabel[] = ['poor', 'weak', 'acceptable', 'good', 'outstanding'];
const CONFIG = { evaluation_max_spread_bands: 2, evaluation_certain_age_years: 3 };
const BANDS = { outstandingMin: 90, goodMin: 75, acceptableMin: 55, weakMin: 30 };

describe('evaluationSpreadBands', () => {
  it('is widest at birth and zero from the certain age onward', () => {
    expect(evaluationSpreadBands(0, CONFIG)).toBe(2);
    expect(evaluationSpreadBands(3, CONFIG)).toBe(0);
    expect(evaluationSpreadBands(8, CONFIG)).toBe(0);
  });

  it('narrows monotonically as the horse grows', () => {
    let previous = evaluationSpreadBands(0, CONFIG);
    for (let ageYears = 0; ageYears <= 4; ageYears += 0.25) {
      const spread = evaluationSpreadBands(ageYears, CONFIG);
      expect(spread).toBeLessThanOrEqual(previous);
      previous = spread;
    }
  });

  it('never returns a negative spread, even for nonsense config', () => {
    expect(evaluationSpreadBands(0, { evaluation_max_spread_bands: -5, evaluation_certain_age_years: 3 })).toBe(0);
    expect(evaluationSpreadBands(2, { evaluation_max_spread_bands: 2, evaluation_certain_age_years: 0 })).toBe(0);
  });
});

describe('verdictFor never excludes the truth', () => {
  it('holds for every true label, every spread and every offset', () => {
    for (const trueLabel of SCALE) {
      for (const spread of [0, 1, 2, 3]) {
        for (let offset = -1; offset <= 1; offset += 0.1) {
          const verdict = verdictFor(trueLabel, spread, offset);
          const low = SCALE.indexOf(verdict.low);
          const high = SCALE.indexOf(verdict.high);
          const truth = SCALE.indexOf(trueLabel);
          expect(low, `${trueLabel} spread ${String(spread)} offset ${offset.toFixed(1)}`).toBeLessThanOrEqual(truth);
          expect(high, `${trueLabel} spread ${String(spread)} offset ${offset.toFixed(1)}`).toBeGreaterThanOrEqual(truth);
        }
      }
    }
  });

  it('a spread of zero is the exact word, no hedging', () => {
    for (const trueLabel of SCALE) {
      expect(verdictFor(trueLabel, 0, 0.9)).toEqual({ low: trueLabel, high: trueLabel });
    }
  });
});

describe('evaluationOffsets', () => {
  it('is a function of the horse, not of the purchase - the same seed gives the same offsets', () => {
    const traits: TraitCode[] = ['neck_length', 'shoulder_angle', 'back_length'];
    const first = evaluationOffsets(12345, traits);
    const second = evaluationOffsets(12345, traits);
    for (const trait of traits) expect(second.get(trait)).toBe(first.get(trait));
  });

  it('different horses get different offsets, and every offset is inside -1..1', () => {
    const traits: TraitCode[] = ['neck_length'];
    const values = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const offset = evaluationOffsets(seed, traits).get('neck_length')!;
      expect(offset).toBeGreaterThanOrEqual(-1);
      expect(offset).toBeLessThanOrEqual(1);
      values.add(offset);
    }
    expect(values.size).toBeGreaterThan(40);
  });
});

describe('evaluateHorse', () => {
  const ideal: IdealVector = {
    neck_length: { target: 60, weight: 1 },
    shoulder_angle: { target: 55, weight: 1 },
  };
  const conformation = [
    { code: 'neck_length' as TraitCode, expressed: 61 },
    { code: 'shoulder_angle' as TraitCode, expressed: 40 },
  ];

  it('refuses (returns null) for a breed with no standard, rather than charging for a page of Unknowns', () => {
    expect(evaluateHorse({ rngSeed: 7, matureConformation: conformation, ideal: null, falloff: 2, bands: BANDS, ageYears: 1 }, CONFIG)).toBeNull();
  });

  it('gives a single word once the horse is old enough, and a range before that', () => {
    const grown = evaluateHorse({ rngSeed: 7, matureConformation: conformation, ideal, falloff: 2, bands: BANDS, ageYears: 4 }, CONFIG);
    expect(grown).not.toBeNull();
    for (const verdict of Object.values(grown!.traits)) expect(verdict!.low).toBe(verdict!.high);

    const foal = evaluateHorse({ rngSeed: 7, matureConformation: conformation, ideal, falloff: 2, bands: BANDS, ageYears: 0.2 }, CONFIG);
    expect(foal).not.toBeNull();
    expect(Object.values(foal!.traits).some((v) => v!.low !== v!.high)).toBe(true);
  });

  it('buying twice at the same age returns identical words - the hedging cannot be averaged away', () => {
    const input = { rngSeed: 99, matureConformation: conformation, ideal, falloff: 2, bands: BANDS, ageYears: 0.5 };
    expect(evaluateHorse(input, CONFIG)).toEqual(evaluateHorse(input, CONFIG));
  });

  it('the grown-up verdict is inside every younger verdict for the same horse', () => {
    const at = (ageYears: number) => evaluateHorse({ rngSeed: 4242, matureConformation: conformation, ideal, falloff: 2, bands: BANDS, ageYears }, CONFIG)!;
    const truth = at(4);
    for (const ageYears of [0, 0.5, 1, 1.5, 2, 2.5]) {
      const younger = at(ageYears);
      for (const code of Object.keys(truth.traits) as TraitCode[]) {
        const exact = SCALE.indexOf(truth.traits[code]!.low);
        expect(SCALE.indexOf(younger.traits[code]!.low)).toBeLessThanOrEqual(exact);
        expect(SCALE.indexOf(younger.traits[code]!.high)).toBeGreaterThanOrEqual(exact);
      }
    }
  });

  it('skips a trait the breed has no target for rather than inventing one', () => {
    const result = evaluateHorse(
      { rngSeed: 1, matureConformation: [...conformation, { code: 'head_profile' as TraitCode, expressed: 50 }], ideal, falloff: 2, bands: BANDS, ageYears: 4 },
      CONFIG
    );
    expect(Object.keys(result!.traits).sort()).toEqual(['neck_length', 'shoulder_angle']);
  });
});

describe('wouldSharpen', () => {
  it('is false while the spread has not moved, and true once it has', () => {
    expect(wouldSharpen(0.2, 0.3, CONFIG)).toBe(false);
    expect(wouldSharpen(0.2, 2.5, CONFIG)).toBe(true);
    expect(wouldSharpen(4, 5, CONFIG)).toBe(false);
  });
});
