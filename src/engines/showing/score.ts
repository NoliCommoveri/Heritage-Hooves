// Score = a weighted comparison of a horse's expressed conformation against a breed's ideal,
// filtered through a judge's own opinion of what matters, plus noise standing in for the judge
// having an ordinary human day. Slice 0008 §4. Pure, no database access (CLAUDE.md §5.1) - the
// caller reads the horse and the class row, calls conformationValues (slice 0006) to get expressed
// values, and hands them here.

import { CONFORMATION_TRAITS } from '../conformation/traits';
import type { TraitCode } from '../genetics/polygenic';

export interface IdealTrait {
  target: number;
  weight: number;
}

/** Only ever populated for the conformation traits (§4.2, five since slice 0021 §3) - a Partial because a breed with no
 * ideal vector at all is represented as breeds.ideal_vector being null, not as an empty object. */
export type IdealVector = Partial<Record<TraitCode, IdealTrait>>;

/** A missing trait key reads as 1.0 (§4.3) - handled in scoreEntry below, not here. */
export type JudgeWeights = Partial<Record<TraitCode, number>>;

interface StoredIdealVector {
  v: number;
  traits: IdealVector;
}

interface StoredJudgeWeights {
  v: number;
  traits: JudgeWeights;
}

export function parseIdealVector(json: string): IdealVector {
  return (JSON.parse(json) as StoredIdealVector).traits;
}

export function parseJudgeWeights(json: string): JudgeWeights {
  return (JSON.parse(json) as StoredJudgeWeights).traits;
}

export interface TraitScoreBreakdown {
  code: TraitCode;
  expressed: number;
  target: number;
  weight: number;
  traitScore: number;
}

export interface ScoreResult {
  traits: TraitScoreBreakdown[];
  weightSum: number;
  rawScore: number;
  noise: number;
  finalScore: number;
}

export interface ScoreEntryParams {
  /** The horse's expressed conformation values, exactly as slice 0006 computes them for display -
   * never re-implemented here (§4.1). */
  expressed: Partial<Record<TraitCode, number>>;
  ideal: IdealVector;
  judgeWeights: JudgeWeights;
  falloff: number;
  noise: number;
  /** Not built yet (§3/§4.5) - pinned at 1.0 until the care/tack stage wires them in, the same way
   * slice 0006's realization() carries trainingFactor/careFactor ahead of anything setting them. */
  careModifier?: number;
  tackModifier?: number;
  /** Slice 0014 §2.3/§4.3: a horse's age-based decline. A separate multiplier from careModifier on
   * purpose - the care clamp would otherwise eat it (§2.3.1) - defaulting to 1.0 exactly like the
   * other two so a caller that predates this slice keeps producing today's number. */
  ageModifier?: number;
}

/**
 * §4.4/§4.5's formula, exactly. Iterates CONFORMATION_TRAITS' own order, never
 * Object.keys(ideal) - the same discipline LOCI and TRAITS enforce elsewhere (CLAUDE.md §11), so a
 * result's trait breakdown is always in a stable, predictable order regardless of how the ideal
 * vector's JSON happened to be written.
 */
export function scoreEntry(params: ScoreEntryParams): ScoreResult {
  const careModifier = params.careModifier ?? 1.0;
  const tackModifier = params.tackModifier ?? 1.0;
  const ageModifier = params.ageModifier ?? 1.0;

  const traits: TraitScoreBreakdown[] = [];
  let weightedSum = 0;
  let weightSum = 0;

  for (const code of CONFORMATION_TRAITS) {
    const ideal = params.ideal[code];
    if (!ideal) continue;
    const expressed = params.expressed[code] ?? 0;
    const distance = Math.abs(expressed - ideal.target);
    const traitScore = Math.max(0, 100 - distance * params.falloff);
    const judgeWeight = params.judgeWeights[code] ?? 1.0;
    const weight = ideal.weight * judgeWeight;

    traits.push({ code, expressed, target: ideal.target, weight, traitScore });
    weightedSum += weight * traitScore;
    weightSum += weight;
  }

  const rawScore = weightSum > 0 ? weightedSum / weightSum : 0;
  const finalScore = rawScore * careModifier * tackModifier * ageModifier + params.noise;

  return { traits, weightSum, rawScore, noise: params.noise, finalScore };
}
