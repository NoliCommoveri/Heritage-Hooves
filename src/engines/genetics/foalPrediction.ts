// What a pairing is actually likely to throw, per conformation trait. 2026-08-05, operator feedback:
// "they still say it's too random whether babies born are good or not ... getting 3 subpar foals in
// a row from a pair that COULD throw a good baby but isn't is frustrating them."
//
// The operator's decision was to fix the EXPECTATION rather than the maths: the genetics are
// unchanged, and this file exists so the breeding preview can say honestly how wide the outcome
// really is before a child spends a turn and eleven game months on it. Pure, no database access
// (CLAUDE.md §5.1), and no RNG at all - this is an exact calculation, not a simulation.
//
// How the distribution is built, in the same order the real birth pipeline builds one horse:
//
//  1. **Potential.** At each of a trait's ten loci the foal takes one allele from each parent,
//     uniformly. That makes the foal's potential (its count of '1' alleles, 0-20) the sum of twenty
//     independent Bernoulli draws whose probabilities are read straight off the parents' own
//     genotypes - a Poisson-binomial, convolved exactly here rather than approximated. Twenty terms
//     over twenty-one buckets is nothing; there is no reason to reach for a normal approximation.
//  2. **Environmental noise**, Normal(0, conformation_noise_sd), rounded to a whole number exactly
//     as rollEnvironmentalNoise rounds it. Enumerated over a grid rather than sampled.
//  3. **Expression**, through the same geneticValue -> realization -> expressedValue chain
//     conformationValues uses, at maturity and at the pairing's own COI.
//
// The result is a probability distribution over expressed values, which the caller turns into a
// range of labels. That last step matters and is easy to get wrong: a trait's label is NOT monotonic
// in its expressed value - being well above the breed's target is as bad as being well below it - so
// a range of values maps to a SET of labels, and the honest summary is the best and worst word in
// that set, not the words at its two ends.

import { getPolygenicString, type Genotype } from './genotype';
import { LOCI_PER_TRAIT, type TraitCode } from './polygenic';
import { expressedValue, realization, type RealizationConfig } from '../conformation/model';
import { anchorFor } from '../conformation/traits';

const TRAIT_STRING_LENGTH = LOCI_PER_TRAIT * 2;
const MAX_POTENTIAL = LOCI_PER_TRAIT * 2;

/** How far out the noise grid runs, in standard deviations. Beyond 3.5 sd each tail holds well under
 * one foal in a thousand - far outside any band this file is asked to report. */
const NOISE_SD_RANGE = 3.5;

/** Standard normal CDF, Abramowitz & Stegun 7.1.26 for erf. Accurate to ~1.5e-7, which is several
 * orders of magnitude finer than the percentile edges it is used to find. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * The per-allele probabilities a parent contributes at each of a trait's loci: 0, 0.5 or 1,
 * depending on whether the parent carries zero, one or two '1' alleles there.
 */
function parentAlleleProbabilities(genotype: Genotype, trait: TraitCode): number[] {
  const bits = getPolygenicString(genotype, trait, TRAIT_STRING_LENGTH);
  const out: number[] = [];
  for (let locus = 0; locus < LOCI_PER_TRAIT; locus++) {
    const a = bits[locus * 2] === '1' ? 1 : 0;
    const b = bits[locus * 2 + 1] === '1' ? 1 : 0;
    out.push((a + b) / 2);
  }
  return out;
}

/**
 * The exact distribution of a foal's potential for one trait: index = potential (0..20), value =
 * probability. Convolution of twenty independent Bernoulli draws, ten from each parent.
 */
export function foalPotentialDistribution(sire: Genotype, dam: Genotype, trait: TraitCode): number[] {
  const probabilities = [...parentAlleleProbabilities(sire, trait), ...parentAlleleProbabilities(dam, trait)];

  let distribution = new Array<number>(MAX_POTENTIAL + 1).fill(0);
  distribution[0] = 1;
  let reached = 0;

  for (const p of probabilities) {
    const next = new Array<number>(MAX_POTENTIAL + 1).fill(0);
    for (let k = 0; k <= reached; k++) {
      const weight = distribution[k];
      if (weight === 0) continue;
      next[k] += weight * (1 - p);
      next[k + 1] += weight * p;
    }
    distribution = next;
    reached++;
  }
  return distribution;
}

/** The rounded-noise grid and its weights, matching rollEnvironmentalNoise's own Math.round. */
function noiseGrid(sd: number): { noise: number; weight: number }[] {
  if (sd <= 0) return [{ noise: 0, weight: 1 }];
  const limit = Math.ceil(sd * NOISE_SD_RANGE);
  const out: { noise: number; weight: number }[] = [];
  let total = 0;
  for (let n = -limit; n <= limit; n++) {
    const weight = normalCdf((n + 0.5) / sd) - normalCdf((n - 0.5) / sd);
    out.push({ noise: n, weight });
    total += weight;
  }
  // Renormalise so the truncated tails don't quietly shrink the distribution's mass.
  for (const entry of out) entry.weight /= total;
  return out;
}

export interface FoalTraitPredictionInput {
  sire: Genotype;
  dam: Genotype;
  trait: TraitCode;
  /** The pairing's own COI, the same number the breeding preview already computes and shows. */
  coi: number;
  noiseSd: number;
  config: RealizationConfig;
}

/** Expressed value -> probability, at maturity, for a foal of this pairing. */
export function foalExpressedDistribution(input: FoalTraitPredictionInput): Map<number, number> {
  const potentials = foalPotentialDistribution(input.sire, input.dam, input.trait);
  const grid = noiseGrid(input.noiseSd);
  const matureRealization = realization(input.config.conformation_maturity_years, input.coi, input.config);
  const anchor = anchorFor(input.trait);

  const out = new Map<number, number>();
  for (let potential = 0; potential <= MAX_POTENTIAL; potential++) {
    const potentialWeight = potentials[potential];
    if (potentialWeight === 0) continue;
    for (const { noise, weight } of grid) {
      const combined = potentialWeight * weight;
      if (combined === 0) continue;
      // geneticValue takes a genotype only so it can count alleles; the foal has none yet, so the
      // same arithmetic (potential * 5 + noise, clamped to 1..99) is applied directly here. Kept in
      // step with model.ts by a test that asserts the two agree for every potential.
      const gv = Math.min(99, Math.max(1, potential * 5 + noise));
      const expressed = expressedValue(gv, matureRealization, anchor);
      out.set(expressed, (out.get(expressed) ?? 0) + combined);
    }
  }
  return out;
}

/**
 * The central `coverage` share of the distribution, as an inclusive [low, high] band of expressed
 * values. Widened outward from the median rather than cut at the two tails, so the band always
 * contains the most likely outcome even for a lopsided distribution.
 */
export function centralInterval(distribution: Map<number, number>, coverage: number): { low: number; high: number } {
  const values = [...distribution.keys()].sort((a, b) => a - b);
  if (values.length === 0) return { low: 0, high: 0 };

  const tail = (1 - coverage) / 2;
  let cumulative = 0;
  let low = values[0];
  let high = values[values.length - 1];

  for (const value of values) {
    cumulative += distribution.get(value) ?? 0;
    if (cumulative > tail) {
      low = value;
      break;
    }
  }
  cumulative = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    cumulative += distribution.get(values[i]) ?? 0;
    if (cumulative > tail) {
      high = values[i];
      break;
    }
  }
  return low <= high ? { low, high } : { low, high: low };
}

/** Verifiable sanity check for the tests, and occasionally useful in a comment: the mean potential
 * of a pairing is just the average of the parents' own potentials. */
export function expectedFoalPotential(sire: Genotype, dam: Genotype, trait: TraitCode): number {
  const probabilities = [...parentAlleleProbabilities(sire, trait), ...parentAlleleProbabilities(dam, trait)];
  return probabilities.reduce((sum, p) => sum + p, 0);
}
