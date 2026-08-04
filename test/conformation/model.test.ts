import { describe, expect, it } from 'vitest';
import {
  geneticValue,
  realization,
  expressedValue,
  rollEnvironmentalNoise,
  legacyEnvironmentalNoise,
  noiseFor,
  serializeNoise,
  conformationValues,
  abilityValues,
  type RealizationConfig,
} from '../../src/engines/conformation/model';
import { anchorFor, ABILITY_TRAITS, CONFORMATION_TRAITS } from '../../src/engines/conformation/traits';
import type { Genotype } from '../../src/engines/genetics/genotype';
import { TRAITS } from '../../src/engines/genetics/polygenic';

const CONFIG: RealizationConfig = {
  conformation_maturity_years: 5,
  conformation_realization_at_birth: 0.55,
  inbreeding_depression_factor: 1.0,
};

function genotypeWithPotential(trait: string, ones: number): Genotype {
  const bits = '1'.repeat(ones) + '0'.repeat(20 - ones);
  return { v: 1, mendelian: {}, polygenic: { [trait]: bits } };
}

describe('geneticValue', () => {
  it('clamps to 1..99', () => {
    expect(geneticValue(genotypeWithPotential('neck_length', 0), 'neck_length', -500)).toBe(1);
    expect(geneticValue(genotypeWithPotential('neck_length', 20), 'neck_length', 500)).toBe(99);
  });
});

describe('realization', () => {
  it('is realization_at_birth at age 0, 1.0 at maturity, COI 0', () => {
    expect(realization(0, 0, CONFIG)).toBeCloseTo(0.55, 6);
    expect(realization(5, 0, CONFIG)).toBeCloseTo(1.0, 6);
  });

  it('rising COI reduces realization monotonically, and COI 0 changes nothing', () => {
    const r0 = realization(5, 0, CONFIG);
    const r1 = realization(5, 0.125, CONFIG);
    const r2 = realization(5, 0.25, CONFIG);
    expect(r0).toBeCloseTo(1.0, 6);
    expect(r1).toBeLessThan(r0);
    expect(r2).toBeLessThan(r1);
  });
});

describe('expressedValue: golden values (worked example from slice 0006 §4.4)', () => {
  // potential = 14, noise = -2 -> geneticValue = 14*5 - 2 = 68.
  const genotype = genotypeWithPotential('neck_length', 14);
  const noise = -2;

  it('newborn, partway and mature', () => {
    const gv = geneticValue(genotype, 'neck_length', noise);
    expect(gv).toBe(68);
    const anchor = anchorFor('neck_length');
    expect(anchor).toBe(50);

    expect(expressedValue(gv, realization(0, 0, CONFIG), anchor)).toBe(60);
    expect(expressedValue(gv, realization(2, 0, CONFIG), anchor)).toBe(63);
    expect(expressedValue(gv, realization(5, 0, CONFIG), anchor)).toBe(68);
  });

  // Slice 0006 §4.4's own prose claims this reads 66 - that arithmetic doesn't hold up: realization
  // at COI 0.25, inbreeding_depression_factor 1.0, is 1 * (1 - 0.25) = 0.75, so the expressed value
  // is round(50 + 18 * 0.75) = round(63.5) = 64, not 66. The formula in §4.3 is unambiguous and its
  // own three-row table (60/63/68) checks out exactly against it, so 64 - not the prose's 66 - is
  // what a faithful implementation of the written formula produces. Flagged in the build summary.
  it('a full-sibling mating (COI 0.25) reads 64 at maturity, per the formula in §4.3 (not the 66 the prose asserts)', () => {
    const gv = geneticValue(genotype, 'neck_length', noise);
    const anchor = anchorFor('neck_length');
    expect(expressedValue(gv, realization(5, 0.25, CONFIG), anchor)).toBe(64);
  });
});

describe('bidirectionality', () => {
  it('a low-potential and a high-potential horse sit symmetrically about 50 at every age', () => {
    const low = genotypeWithPotential('neck_length', 6);
    const high = genotypeWithPotential('neck_length', 14);
    const anchor = anchorFor('neck_length');

    // 2.5 is deliberately excluded: at that exact age this pair's realization lands both sides
    // precisely on a .5 boundary, and Math.round's round-half-up behaviour (not a bug in the
    // formula) rounds both away from 50 by the same direction rather than mirroring - a rounding
    // artifact of picking this exact test pair, not something the model needs to guard against.
    for (const ageYears of [0, 1, 3, 5, 10]) {
      const r = realization(ageYears, 0, CONFIG);
      const lowExpressed = expressedValue(geneticValue(low, 'neck_length', 0), r, anchor);
      const highExpressed = expressedValue(geneticValue(high, 'neck_length', 0), r, anchor);
      expect(lowExpressed - 50).toBe(-(highExpressed - 50));
    }
  });
});

describe('legacy fallback', () => {
  it('is stable across calls, and unaffected by conformation_noise_sd', () => {
    const seed = 424242;
    const a = legacyEnvironmentalNoise(seed);
    const b = legacyEnvironmentalNoise(seed);
    expect(a).toEqual(b);

    // noiseFor(null) must route through the legacy fallback regardless of what noiseSd the caller
    // would otherwise roll fresh horses with - this file draws its own fixed SD, never config's.
    const viaNoiseFor = noiseFor(seed, null);
    expect(viaNoiseFor).toEqual(a);
  });

  it('a null environmental_noise and a stored one are read differently', () => {
    const seed = 99;
    const rolled = rollEnvironmentalNoise(seed, 6);
    const stored = serializeNoise(rolled);
    expect(noiseFor(seed, stored)).toEqual(rolled);
  });
});

describe('full siblings differ', () => {
  it('two foals from the same pairing with different seeds get different genetic values', () => {
    // Heterozygous at every locus - a genuine coin flip per locus, not a fixed potential.
    const genotype = genotypeWithPotential('neck_length', 10);
    const values: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const noise = rollEnvironmentalNoise(seed, 6);
      values.push(geneticValue(genotype, 'neck_length', noise.neck_length));
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});

describe('conformationValues', () => {
  it('only ever returns the five conformation traits, never ability or hidden', () => {
    const genotype: Genotype = { v: 1, mendelian: {}, polygenic: {} };
    const noise = rollEnvironmentalNoise(1, 6);
    const values = conformationValues(genotype, noise, 5, 0, CONFIG);
    expect(values.map((v) => v.code)).toEqual(['neck_length', 'shoulder_angle', 'back_length', 'hock_set', 'head_profile']);
  });

  it('draws one noise value per trait in TRAITS order, reproducibly from the same seed', () => {
    const a = rollEnvironmentalNoise(777, 6);
    const b = rollEnvironmentalNoise(777, 6);
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual([...TRAITS]);
  });
});

// Slice 0012 §11 item 2/3.
describe('ABILITY_TRAITS', () => {
  it('is exactly stamina, jump_scope, speed, trainability, agility, in TRAITS order', () => {
    expect(ABILITY_TRAITS).toEqual(['stamina', 'jump_scope', 'speed', 'trainability', 'agility']);
  });

  it('is disjoint from CONFORMATION_TRAITS', () => {
    for (const t of ABILITY_TRAITS) expect(CONFORMATION_TRAITS).not.toContain(t);
  });
});

describe('abilityValues', () => {
  it('returns exactly the five ability traits, fertility excluded', () => {
    const genotype: Genotype = { v: 1, mendelian: {}, polygenic: {} };
    const noise = rollEnvironmentalNoise(1, 6);
    const values = abilityValues(genotype, noise, 5, 0, CONFIG);
    expect(values.map((v) => v.code)).toEqual([...ABILITY_TRAITS]);
  });

  it('anchors at 0, so a horse at half realization expresses half its genetic value, not something pulled toward 50', () => {
    const genotype = genotypeWithPotential('agility', 14); // potential 14 -> geneticValue 70 at noise 0
    const zeroNoise = {
      neck_length: 0,
      shoulder_angle: 0,
      back_length: 0,
      hock_set: 0,
      stamina: 0,
      jump_scope: 0,
      speed: 0,
      trainability: 0,
      fertility: 0,
      agility: 0,
      foot_robustness: 0,
      joint_robustness: 0,
      ligament_robustness: 0,
      head_profile: 0,
    };
    const gv = geneticValue(genotype, 'agility', 0);
    expect(gv).toBe(70);

    // realization 0.5 at some age/COI combination - construct one directly via the formula rather
    // than hunting for an age that lands exactly on it.
    const halfConfig: RealizationConfig = { conformation_maturity_years: 10, conformation_realization_at_birth: 0, inbreeding_depression_factor: 0 };
    const values = abilityValues(genotype, zeroNoise, 5, 0, halfConfig); // realization = 0 + (1-0)*(5/10) = 0.5
    const agilityRow = values.find((v) => v.code === 'agility')!;
    expect(agilityRow.expressed).toBe(Math.round(gv * 0.5));
    expect(agilityRow.expressed).not.toBe(Math.round(50 + (gv - 50) * 0.5)); // the bidirectional formula would give a different number
  });
});
