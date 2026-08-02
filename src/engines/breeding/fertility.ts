// Conception chance and the fertility trait. Slice 0003 §4. Pure - no database access; the caller
// (the tick's covering-resolution stage, or the breeding screen's estimate) supplies every input.
//
// Two very different callers read this file, and mixing them up is the trap §5 warns about:
//   - fertilityPotential() reads a horse's actual genotype. It is TRUTH, and slice 0003 §5 says it
//     may only ever be called from the conception roll - the world resolving physics, not anything
//     that shows a player (or an NPC) a number derived from a genotype they haven't paid to learn.
//   - conceptionChance() itself takes plain factors, not a genotype. The breeding screen's
//     *estimate* calls it with mareFertilityFactor/stallionFertilityFactor fixed at 1.0 (unknown-
//     average) because the viewer only knows what they know; the tick's conception roll calls it
//     with the real fertilityPotential() values. Same function, different truthfulness of its inputs
//     - see slice 0003 §5's "the displayed number is therefore not the number rolled".

import { makeRng, deriveSeed } from '../../lib/rng';
import { potential, LOCI_PER_TRAIT } from '../genetics/polygenic';
import type { Genotype } from '../genetics/genotype';

const FERTILITY_TRAIT_LOCI = LOCI_PER_TRAIT; // 10 loci, 20 alleles, same shape as every polygenic trait.

/**
 * Linear interpolation between knots (sorted by x is not assumed - callers store knots already in
 * ascending order, per slice 0003 §4.2's config shape). Flat outside the ends: no extrapolation.
 */
export function interpolateKnots(knots: readonly (readonly [number, number])[], x: number): number {
  if (knots.length === 0) throw new Error('interpolateKnots: no knots');
  if (x <= knots[0][0]) return knots[0][1];
  const last = knots[knots.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < knots.length - 1; i++) {
    const [x0, y0] = knots[i];
    const [x1, y1] = knots[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * A horse's fertility trait, as a genuine draw when it has one, or a stable reproducible stand-in
 * derived from its own rng_seed when it predates the trait (slice 0003 §4.3's "trap"). Never call
 * getPolygenicString('fertility', ...) directly - go through this function so both paths are
 * covered in one place.
 */
export function fertilityPotential(horse: { genotype: Genotype; rng_seed: number }, geneMin: number, geneMax: number): number {
  const hasTrait = horse.genotype.polygenic['fertility'] !== undefined;
  const score = hasTrait ? potential(horse.genotype, 'fertility') : legacyFertilityScore(horse.rng_seed);
  return geneMin + (score / (FERTILITY_TRAIT_LOCI * 2)) * (geneMax - geneMin);
}

function legacyFertilityScore(rngSeed: number): number {
  const rng = makeRng(deriveSeed(rngSeed, 'fertility_legacy'));
  let count = 0;
  for (let i = 0; i < FERTILITY_TRAIT_LOCI * 2; i++) {
    if (rng.int(2) === 1) count++;
  }
  return count;
}

export interface ConceptionInputs {
  mareAgeYears: number;
  stallionAgeYears: number;
  /** 1.0 means "unknown, treat as average" - the honest default for a display estimate. */
  mareFertilityFactor: number;
  stallionFertilityFactor: number;
  /** Always 1.0 in this slice - care/health don't exist yet (slice 0003 §4.4). */
  conditionFactor: number;
  /** Always 1.0 in this slice - every covering is a live cover (slice 0003 §4.5). */
  methodFactor: number;
  foalCoi: number;
}

export interface FertilityConfig {
  conception_base: number;
  conception_min: number;
  conception_max: number;
  mare_fertility_age_knots: readonly (readonly [number, number])[];
  stallion_fertility_age_knots: readonly (readonly [number, number])[];
  inbreeding_fertility_penalty: number;
}

export interface ConceptionBreakdown {
  mareAgeFactor: number;
  stallionAgeFactor: number;
  mareFertilityFactor: number;
  stallionFertilityFactor: number;
  conditionFactor: number;
  methodFactor: number;
  inbreedingFactor: number;
  /** The final, clamped conception chance in [conception_min, conception_max]. */
  p: number;
}

export function conceptionChance(inputs: ConceptionInputs, config: FertilityConfig): ConceptionBreakdown {
  const mareAgeFactor = interpolateKnots(config.mare_fertility_age_knots, inputs.mareAgeYears);
  const stallionAgeFactor = interpolateKnots(config.stallion_fertility_age_knots, inputs.stallionAgeYears);
  const inbreedingFactor = 1 - config.inbreeding_fertility_penalty * inputs.foalCoi;

  const raw =
    config.conception_base *
    mareAgeFactor *
    stallionAgeFactor *
    inputs.mareFertilityFactor *
    inputs.stallionFertilityFactor *
    inputs.conditionFactor *
    inputs.methodFactor *
    inbreedingFactor;

  const p = Math.min(config.conception_max, Math.max(config.conception_min, raw));

  return {
    mareAgeFactor,
    stallionAgeFactor,
    mareFertilityFactor: inputs.mareFertilityFactor,
    stallionFertilityFactor: inputs.stallionFertilityFactor,
    conditionFactor: inputs.conditionFactor,
    methodFactor: inputs.methodFactor,
    inbreedingFactor,
    p,
  };
}
