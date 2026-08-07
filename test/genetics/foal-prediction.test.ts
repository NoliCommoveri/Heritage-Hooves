/**
 * The breeding preview's honest foal range, 2026-08-05. This is the piece the operator asked for
 * INSTEAD of changing the genetics ("they still say it's too random whether babies born are good or
 * not"), so its only job is to be right - a prediction that flatters a pairing would make the
 * frustration worse, not better.
 *
 * The load-bearing check is the last one: the exact convolution has to agree with what the real
 * birth pipeline actually produces, or the preview is describing a different game.
 */
import { describe, expect, it } from 'vitest';
import { foalPotentialDistribution, expectedFoalPotential, foalExpressedDistribution, centralInterval } from '../../src/engines/genetics/foalPrediction';
import { makeEmptyGenotype, type Genotype } from '../../src/engines/genetics/genotype';
import { potential, TRAITS, LOCI_PER_TRAIT, type TraitCode } from '../../src/engines/genetics/polygenic';
import { makeRng } from '../../src/lib/rng';

const TRAIT: TraitCode = 'neck_length';
const LENGTH = LOCI_PER_TRAIT * 2;

/** A genotype whose every trait carries the given allele string. */
function horseWith(bits: string): Genotype {
  const genotype = makeEmptyGenotype();
  for (const trait of TRAITS) genotype.polygenic[trait] = bits;
  return genotype;
}

const ALL_ONES = horseWith('1'.repeat(LENGTH));
const ALL_ZEROS = horseWith('0'.repeat(LENGTH));
const ALL_HETEROZYGOUS = horseWith('10'.repeat(LOCI_PER_TRAIT));

function sum(distribution: number[]): number {
  return distribution.reduce((a, b) => a + b, 0);
}

describe('foalPotentialDistribution', () => {
  it('always sums to 1', () => {
    for (const pair of [
      [ALL_ONES, ALL_ZEROS],
      [ALL_HETEROZYGOUS, ALL_HETEROZYGOUS],
      [ALL_ONES, ALL_HETEROZYGOUS],
    ]) {
      expect(sum(foalPotentialDistribution(pair[0], pair[1], TRAIT))).toBeCloseTo(1, 10);
    }
  });

  it('two fixed parents give one certain answer - no spread where there is no choice', () => {
    const distribution = foalPotentialDistribution(ALL_ONES, ALL_ZEROS, TRAIT);
    // Every locus: a '1' from the sire and a '0' from the dam. Exactly ten '1' alleles, always.
    expect(distribution[10]).toBeCloseTo(1, 10);
  });

  it('the best possible pairing can only produce the best possible foal', () => {
    const distribution = foalPotentialDistribution(ALL_ONES, ALL_ONES, TRAIT);
    expect(distribution[20]).toBeCloseTo(1, 10);
  });

  it('the mean is the average of the parents\' own potentials', () => {
    for (const pair of [
      [ALL_ONES, ALL_ZEROS],
      [ALL_HETEROZYGOUS, ALL_ONES],
      [ALL_HETEROZYGOUS, ALL_HETEROZYGOUS],
    ]) {
      const expected = (potential(pair[0], TRAIT) + potential(pair[1], TRAIT)) / 2;
      expect(expectedFoalPotential(pair[0], pair[1], TRAIT)).toBeCloseTo(expected, 10);

      const distribution = foalPotentialDistribution(pair[0], pair[1], TRAIT);
      const mean = distribution.reduce((acc, p, k) => acc + p * k, 0);
      expect(mean).toBeCloseTo(expected, 10);
    }
  });

  /**
   * The check that matters: the exact distribution has to match what actually drawing foals off the
   * same parents produces. A simulation here rather than in the engine - the engine must stay pure
   * and RNG-free (CLAUDE.md §5.1/§5.2), and this is the test's job, not its.
   */
  it('agrees with drawing ten thousand foals the way inheritance actually works', () => {
    const rng = makeRng(20260805);
    const sireBits = '1100101110'.split('').flatMap((c) => [c, c === '1' ? '0' : '1']).join('');
    const damBits = '1011001101'.split('').flatMap((c) => [c, '1']).join('');
    const sire = horseWith(sireBits);
    const dam = horseWith(damBits);

    const counts = new Array<number>(21).fill(0);
    const draws = 10_000;
    for (let i = 0; i < draws; i++) {
      let ones = 0;
      for (let locus = 0; locus < LOCI_PER_TRAIT; locus++) {
        const fromSire = sireBits[locus * 2 + rng.int(2)];
        const fromDam = damBits[locus * 2 + rng.int(2)];
        if (fromSire === '1') ones++;
        if (fromDam === '1') ones++;
      }
      counts[ones]++;
    }

    const predicted = foalPotentialDistribution(sire, dam, TRAIT);
    for (let k = 0; k <= 20; k++) {
      expect(Math.abs(counts[k] / draws - predicted[k]), `potential ${String(k)}`).toBeLessThan(0.02);
    }
  });
});

// Slice 0028 §2.3/§5 step 12: foalExpressedDistribution now reads a type-gene pair
// (genotype.mendelian.NL) alongside the polygenic modifier block - horseWith() above only sets
// .polygenic, so these tests build their own genotypes with both.
function horseWithType(bits: string, typePair: [string, string]): Genotype {
  const genotype = horseWith(bits);
  genotype.mendelian.NL = typePair;
  return genotype;
}

const TARGET = 50;
const MODIFIER_STEP = 0.1;

describe('foalExpressedDistribution and centralInterval', () => {
  it('sums to 1 and stays inside the clamped 1..99 expressed range', () => {
    const sire = horseWithType('10'.repeat(LOCI_PER_TRAIT), ['42', '58']);
    const dam = horseWithType('10'.repeat(LOCI_PER_TRAIT), ['46', '54']);
    const distribution = foalExpressedDistribution({ sire, dam, trait: TRAIT, target: TARGET, modifierStep: MODIFIER_STEP, noiseSd: 0.5 });
    let total = 0;
    for (const [value, probability] of distribution) {
      total += probability;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(99);
    }
    expect(total).toBeCloseTo(1, 6);
  });

  it('a fixed pairing (both parents homozygous at the same rung) with no noise collapses to a single value', () => {
    const sire = horseWithType('1'.repeat(LOCI_PER_TRAIT * 2), ['50', '50']);
    const dam = horseWithType('1'.repeat(LOCI_PER_TRAIT * 2), ['50', '50']);
    const distribution = foalExpressedDistribution({ sire, dam, trait: TRAIT, target: TARGET, modifierStep: MODIFIER_STEP, noiseSd: 0 });
    expect(distribution.size).toBe(1);
    // potential 20 -> modifier (20-10)*0.1 = 1.0, shown 50 (on target) -> 51.
    expect([...distribution.keys()][0]).toBe(51);
  });

  it('faults dominant: the foal always shows the allele FURTHER from target, never the closer one', () => {
    // Sire homozygous 42 (8 off), dam homozygous 58 (8 off too) - every possible foal pair is
    // (42, 58), which is a tie in distance either way (both 8 off), so the shown value is always
    // one of {42, 58} via shownValueFor's stable tie-break (the lower value), never 50.
    const sire = horseWithType('0'.repeat(LOCI_PER_TRAIT * 2), ['42', '42']);
    const dam = horseWithType('0'.repeat(LOCI_PER_TRAIT * 2), ['58', '58']);
    const distribution = foalExpressedDistribution({ sire, dam, trait: TRAIT, target: TARGET, modifierStep: MODIFIER_STEP, noiseSd: 0 });
    // potential 0 -> modifier (0-10)*0.1 = -1.0, shown 42 (the tie-break) -> 41.
    expect(distribution.size).toBe(1);
    expect([...distribution.keys()][0]).toBe(41);
  });

  it('the central interval covers at least the coverage asked for, and widens with noise', () => {
    const sire = horseWithType('10'.repeat(LOCI_PER_TRAIT), ['30', '70']);
    const dam = horseWithType('10'.repeat(LOCI_PER_TRAIT), ['34', '66']);
    const tight = foalExpressedDistribution({ sire, dam, trait: TRAIT, target: TARGET, modifierStep: MODIFIER_STEP, noiseSd: 0.5 });
    const loose = foalExpressedDistribution({ sire, dam, trait: TRAIT, target: TARGET, modifierStep: MODIFIER_STEP, noiseSd: 6 });

    const tightBand = centralInterval(tight, 0.8);
    const looseBand = centralInterval(loose, 0.8);
    expect(looseBand.high - looseBand.low).toBeGreaterThan(tightBand.high - tightBand.low);

    let covered = 0;
    for (const [value, probability] of tight) if (value >= tightBand.low && value <= tightBand.high) covered += probability;
    expect(covered).toBeGreaterThanOrEqual(0.8);
  });

  it('an empty distribution does not crash the interval', () => {
    expect(centralInterval(new Map(), 0.8)).toEqual({ low: 0, high: 0 });
  });
});
