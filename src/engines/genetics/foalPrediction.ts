// What a pairing is actually likely to throw, per conformation trait. Originally built 2026-08-05
// (operator feedback: "they still say it's too random whether babies born are good or not"),
// rewritten for slice 0028 §2.3/§5 step 12: under the type-gene model a conformation trait's
// expressed value is no longer a 20-locus polygenic sum realized by age - it is one Mendelian pair
// (a real 2x2 Punnett square) plus a small polygenic modifier and noise. That collapses what used
// to be a Poisson-binomial convolution over twenty loci into a convolution over three MUCH smaller
// distributions, so this file is now the "much shorter" replacement the slice document's build
// order asked for, not a rewrite of the same shape. Pure, no database access (CLAUDE.md §5.1), and
// no RNG at all - this is an exact calculation, not a simulation.
//
// The three distributions, in the same order conformationGeneticValue (model.ts) combines them:
//
//  1. **The type-gene Punnett square.** Each parent contributes one of its two type-locus alleles,
//     uniformly - four equally likely combinations, each producing a shown value via §2.3's
//     faults-dominant rule (shownValueFor, typeGene.ts). Combinations that land on the same shown
//     value are merged, so this is a distribution over at most four values, not four separate draws.
//  2. **The polygenic modifier**, (potential - 10) * modifierStep. `potential`'s own distribution is
//     exactly what foalPotentialDistribution already computed for the old model (unchanged - the
//     20-bit block's inheritance is untouched by this slice, only what it's WORTH is demoted), so
//     that function is kept verbatim and just re-scaled here.
//  3. **Environmental noise**, Normal(0, conformation_noise_sd), rounded to a whole number exactly
//     as rollEnvironmentalNoise rounds it - enumerated over a grid rather than sampled.
//
// The result is a probability distribution over expressed values, which the caller turns into a
// range of labels. That last step matters and is easy to get wrong: a trait's label is NOT monotonic
// in its expressed value - being well above the breed's target is as bad as being well below it - so
// a range of values maps to a SET of labels, and the honest summary is the best and worst word in
// that set, not the words at its two ends.

import { getPolygenicString, type Genotype, type AllelePair } from './genotype';
import { LOCI_PER_TRAIT, type TraitCode } from './polygenic';
import { shownValueFor, TYPE_LOCUS_CODE } from '../conformation/typeGene';

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
 * depending on whether the parent carries zero, one or two '1' alleles there. Unchanged from before
 * this slice - the 20-bit polygenic block's inheritance is untouched by §2.3, only what it's worth
 * (the modifier, not the whole value) is demoted.
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
 * The exact distribution of a foal's polygenic potential for one trait: index = potential (0..20),
 * value = probability. Convolution of twenty independent Bernoulli draws, ten from each parent.
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

/**
 * §2.3's 2x2 Punnett square: each parent's two type-gene alleles combine into four equally likely
 * pairs, each read through shownValueFor (faults dominant) against the trait's breed target.
 * Combinations landing on the same shown value are merged - the return is a distribution over the
 * DISTINCT shown values, at most four entries.
 */
function typeGeneShownValueDistribution(sirePair: AllelePair, damPair: AllelePair, target: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of sirePair) {
    for (const d of damPair) {
      const shown = shownValueFor([s, d], target);
      out.set(shown, (out.get(shown) ?? 0) + 0.25);
    }
  }
  return out;
}

export interface FoalTraitPredictionInput {
  sire: Genotype;
  dam: Genotype;
  trait: TraitCode;
  /** The breed's own target for this trait (the same one conformationGeneticValue reads) - a
   * caller with no single standard to judge against (a cross-breed pairing, or an untested/unshown
   * parent) never calls this at all; there is no "unknown target" case to handle here. */
  target: number;
  modifierStep: number;
  noiseSd: number;
}

/** Expressed value -> probability, for a foal of this pairing. No age/COI input at all (slice 0028
 * §2.4: conformation is not realized by age, so there is nothing left to compute "at maturity" -
 * the foal's predicted value IS its value at any age, including the day it's born). */
export function foalExpressedDistribution(input: FoalTraitPredictionInput): Map<number, number> {
  const sirePair = input.sire.mendelian[TYPE_LOCUS_CODE[input.trait]] ?? (['50', '50'] as AllelePair);
  const damPair = input.dam.mendelian[TYPE_LOCUS_CODE[input.trait]] ?? (['50', '50'] as AllelePair);
  const shownValues = typeGeneShownValueDistribution(sirePair, damPair, input.target);

  const potentials = foalPotentialDistribution(input.sire, input.dam, input.trait);
  const grid = noiseGrid(input.noiseSd);

  const out = new Map<number, number>();
  for (const [shown, shownWeight] of shownValues) {
    for (let potential = 0; potential <= MAX_POTENTIAL; potential++) {
      const potentialWeight = potentials[potential];
      if (potentialWeight === 0) continue;
      const modifier = (potential - 10) * input.modifierStep;
      for (const { noise, weight } of grid) {
        const combined = shownWeight * potentialWeight * weight;
        if (combined === 0) continue;
        const expressed = Math.min(99, Math.max(1, Math.round(shown + modifier + noise)));
        out.set(expressed, (out.get(expressed) ?? 0) + combined);
      }
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
