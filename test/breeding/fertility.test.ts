import { describe, expect, it } from 'vitest';
import { interpolateKnots, conceptionChance, fertilityPotential, type FertilityConfig } from '../../src/engines/breeding/fertility';
import type { Genotype } from '../../src/engines/genetics/genotype';

describe('interpolateKnots', () => {
  const knots: [number, number][] = [
    [3, 0.85],
    [4, 1.0],
    [10, 1.0],
    [17, 0.75],
  ];

  it('is flat before the first knot', () => {
    expect(interpolateKnots(knots, 0)).toBe(0.85);
    expect(interpolateKnots(knots, 3)).toBe(0.85);
  });

  it('is flat after the last knot', () => {
    expect(interpolateKnots(knots, 30)).toBe(0.75);
  });

  it('interpolates linearly between two knots', () => {
    // Halfway between age 10 (1.0) and age 17 (0.75).
    expect(interpolateKnots(knots, 13.5)).toBeCloseTo(0.875, 10);
  });

  it('returns the exact knot value when x lands on a knot', () => {
    expect(interpolateKnots(knots, 4)).toBe(1.0);
  });
});

const CONFIG: FertilityConfig = {
  conception_base: 0.68,
  conception_min: 0.05,
  conception_max: 0.9,
  mare_fertility_age_knots: [
    [3, 0.85],
    [4, 1.0],
    [10, 1.0],
    [17, 0.75],
  ],
  stallion_fertility_age_knots: [
    [3, 0.9],
    [4, 1.0],
    [15, 1.0],
  ],
  inbreeding_fertility_penalty: 0.5,
};

describe('conceptionChance', () => {
  it('at every factor 1.0, p equals the base rate', () => {
    const result = conceptionChance(
      { mareAgeYears: 6, stallionAgeYears: 6, mareFertilityFactor: 1, stallionFertilityFactor: 1, conditionFactor: 1, methodFactor: 1, foalCoi: 0 },
      CONFIG
    );
    expect(result.p).toBeCloseTo(0.68, 10);
  });

  it('an old mare lowers the chance via mareAgeFactor', () => {
    const young = conceptionChance(
      { mareAgeYears: 6, stallionAgeYears: 6, mareFertilityFactor: 1, stallionFertilityFactor: 1, conditionFactor: 1, methodFactor: 1, foalCoi: 0 },
      CONFIG
    );
    const old = conceptionChance(
      { mareAgeYears: 17, stallionAgeYears: 6, mareFertilityFactor: 1, stallionFertilityFactor: 1, conditionFactor: 1, methodFactor: 1, foalCoi: 0 },
      CONFIG
    );
    expect(old.p).toBeLessThan(young.p);
    expect(old.mareAgeFactor).toBeCloseTo(0.75, 10);
  });

  it('a 25% COI pairing loses about 12.5% of its conception chance via the inbreeding factor', () => {
    const result = conceptionChance(
      { mareAgeYears: 6, stallionAgeYears: 6, mareFertilityFactor: 1, stallionFertilityFactor: 1, conditionFactor: 1, methodFactor: 1, foalCoi: 0.25 },
      CONFIG
    );
    expect(result.inbreedingFactor).toBeCloseTo(1 - 0.5 * 0.25, 10);
  });

  it('clamps to conception_max even when every factor would push it higher', () => {
    const result = conceptionChance(
      { mareAgeYears: 6, stallionAgeYears: 6, mareFertilityFactor: 1.5, stallionFertilityFactor: 1.5, conditionFactor: 1, methodFactor: 1, foalCoi: 0 },
      CONFIG
    );
    expect(result.p).toBe(CONFIG.conception_max);
  });

  it('clamps to conception_min even when every factor would push it lower', () => {
    const result = conceptionChance(
      { mareAgeYears: 25, stallionAgeYears: 6, mareFertilityFactor: 0.1, stallionFertilityFactor: 0.1, conditionFactor: 1, methodFactor: 1, foalCoi: 0.4 },
      CONFIG
    );
    expect(result.p).toBe(CONFIG.conception_min);
  });
});

function genotypeWithFertility(bits: string | undefined): Genotype {
  return { v: 1, mendelian: {}, polygenic: bits === undefined ? {} : { fertility: bits } };
}

describe('fertilityPotential', () => {
  it('a horse with the trait at its floor (all zeros) maps to geneMin', () => {
    const horse = { genotype: genotypeWithFertility('0'.repeat(20)), rng_seed: 1 };
    expect(fertilityPotential(horse, 0.75, 1.1)).toBeCloseTo(0.75, 10);
  });

  it('a horse with the trait at its ceiling (all ones) maps to geneMax', () => {
    const horse = { genotype: genotypeWithFertility('1'.repeat(20)), rng_seed: 1 };
    expect(fertilityPotential(horse, 0.75, 1.1)).toBeCloseTo(1.1, 10);
  });

  it("a legacy horse with no fertility key does NOT read as the floor - it's derived from rng_seed instead", () => {
    const horse = { genotype: genotypeWithFertility(undefined), rng_seed: 12345 };
    const value = fertilityPotential(horse, 0.75, 1.1);
    expect(value).toBeGreaterThan(0.75);
    expect(value).toBeLessThanOrEqual(1.1);
  });

  it('the legacy derivation is deterministic and reproducible from the same seed', () => {
    const a = fertilityPotential({ genotype: genotypeWithFertility(undefined), rng_seed: 777 }, 0.75, 1.1);
    const b = fertilityPotential({ genotype: genotypeWithFertility(undefined), rng_seed: 777 }, 0.75, 1.1);
    expect(a).toBe(b);
  });

  it('legacy scores are well-distributed across many seeds, not clustered at one end', () => {
    const values: number[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      values.push(fertilityPotential({ genotype: genotypeWithFertility(undefined), rng_seed: seed }, 0.75, 1.1));
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // Midpoint of [0.75, 1.10] is 0.925.
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(0.95);
    expect(new Set(values).size).toBeGreaterThan(10);
  });
});
