// A discipline score: a weighted mean of a horse's expressed ability values, finished by the same
// modifier line scoreEntry uses. Slice 0012 §2.5/§7. Pure, no database access (CLAUDE.md §5.1) -
// the caller reads the horse and the class row, calls abilityValues (engines/conformation/model.ts)
// to get expressed values, and hands them here.
//
// A separate function from scoreEntry, not a generalised one with a mode flag: the two formulas
// are genuinely different (distance-from-target-through-a-falloff vs. a weighted mean of
// unidirectional values), and CLAUDE.md §5.1 wants an engine a future session can hold entirely in
// view.

import { ABILITY_TRAITS } from '../conformation/traits';
import type { TraitCode } from '../genetics/polygenic';

/** A missing trait key reads as 0 (§5.1) - the opposite of scoreEntry's judgeWeights, where a
 * missing key reads as 1.0. A discipline's missing key means "does not care about this ability at
 * all", not "no opinion". */
export type AbilityWeights = Partial<Record<TraitCode, number>>;

interface StoredAbilityWeights {
  v: number;
  traits: AbilityWeights;
}

export function parseAbilityWeights(json: string): AbilityWeights {
  return (JSON.parse(json) as StoredAbilityWeights).traits;
}

export interface AbilityTraitBreakdown {
  code: TraitCode;
  expressed: number;
  weight: number;
  contribution: number;
}

export interface AbilityScoreResult {
  traits: AbilityTraitBreakdown[];
  weightSum: number;
  rawScore: number;
  noise: number;
  finalScore: number;
}

export interface ScoreAbilityEntryParams {
  /** The horse's expressed ability values, exactly as abilityValues computes them - never
   * re-implemented here (mirrors scoreEntry's own rule, §4.1). */
  expressed: Partial<Record<TraitCode, number>>;
  weights: AbilityWeights;
  /** Slice 0024 §3: a discipline judge's own opinion, layered onto the discipline's weight exactly
   * the way scoreEntry's judgeWeights layers onto ideal.weight - a missing key here reads as 1.0
   * ("no opinion"), the opposite of `weights` above where a missing key means "does not care about
   * this ability at all". Defaults to {} so every caller that predates this slice (NPC valuation,
   * existing tests) keeps producing exactly today's number. */
  judgeWeights?: AbilityWeights;
  noise: number;
  /** Not built yet (§2.4/§3.1/§3.6) - pinned at 1.0 until care, tack and training exist, the same
   * way scoreEntry's careModifier/tackModifier and realization()'s trainingFactor/careFactor are
   * carried ahead of anything setting them. */
  careModifier?: number;
  tackModifier?: number;
  trainingFactor?: number;
  /** Slice 0014 §2.3/§4.3: a horse's age-based decline. Same reasoning as scoreEntry's own
   * ageModifier - a separate parameter, not folded into careModifier, defaulting to 1.0. */
  ageModifier?: number;
}

/**
 * §7's formula (slice 0014 §4.3 appends ageModifier as a fourth multiplier; slice 0024 §3 folds a
 * discipline judge's own weight into weight_t exactly as scoreEntry folds judgeWeight into
 * ideal.weight, so a discipline class finally has judge variance the way a breed class always has):
 *   weight_t   = discipline_weight_t * judge_weight_t
 *   rawScore   = Sum(weight_t * expressed_t) / Sum(weight_t)
 *   finalScore = rawScore * careModifier * tackModifier * trainingFactor * ageModifier + noise
 *
 * Iterates ABILITY_TRAITS, never Object.keys(weights) - the same discipline scoreEntry applies to
 * CONFORMATION_TRAITS, so a result's breakdown always reads in a stable order regardless of how
 * the weights JSON was written.
 */
export function scoreAbilityEntry(params: ScoreAbilityEntryParams): AbilityScoreResult {
  const careModifier = params.careModifier ?? 1.0;
  const tackModifier = params.tackModifier ?? 1.0;
  const trainingFactor = params.trainingFactor ?? 1.0;
  const ageModifier = params.ageModifier ?? 1.0;
  const judgeWeights = params.judgeWeights ?? {};

  const traits: AbilityTraitBreakdown[] = [];
  let weightedSum = 0;
  let weightSum = 0;

  for (const code of ABILITY_TRAITS) {
    const disciplineWeight = params.weights[code] ?? 0;
    const judgeWeight = judgeWeights[code] ?? 1.0;
    const weight = disciplineWeight * judgeWeight;
    const expressed = params.expressed[code] ?? 0;
    const contribution = weight * expressed;

    traits.push({ code, expressed, weight, contribution });
    weightedSum += contribution;
    weightSum += weight;
  }

  const rawScore = weightSum > 0 ? weightedSum / weightSum : 0;
  const finalScore = rawScore * careModifier * tackModifier * trainingFactor * ageModifier + params.noise;

  return { traits, weightSum, rawScore, noise: params.noise, finalScore };
}
