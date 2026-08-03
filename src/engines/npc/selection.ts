// An NPC stable's breeding decision: rank its own mares and stallions the way a judge would, then
// pair the best it can find - with noise standing in for an imperfect eye, and an occasional
// sentimental retention. Slice 0015 §2.2/§2.3/§4.1. Pure, no database access (CLAUDE.md §5.1) -
// the caller reads horses, resolves the active ceiling and the COI-excluded pairs, and hands
// everything here already computed.
//
// Deliberately reuses scoreEntry/scoreAbilityEntry rather than inventing a second "how good is
// this horse" formula (§2.2) - a retune of a judge's weights, a breed's ideal vector or a
// discipline's ability weights flows straight through to NPC selection because it is the same
// function, not a second one that can drift.

import { scoreEntry, type IdealVector, type JudgeWeights, type ScoreResult } from '../showing/score';
import { scoreAbilityEntry, type AbilityWeights, type AbilityScoreResult } from '../showing/abilityScore';
import type { TraitCode } from '../genetics/polygenic';
import { makeRng, deriveSeed } from '../../lib/rng';

export interface BreedingCandidate {
  horseId: number;
  /** Already-expressed trait values, exactly as conformationValues/abilityValues compute them for
   * display - this engine never reads a genotype or calls the expression model itself. */
  expressed: Partial<Record<TraitCode, number>>;
}

export interface SelectionTarget {
  /** breeds.ideal_vector (parsed) for a conformation personality, or disciplines.ability_weights
   * (parsed) for a discipline personality. The caller resolves which; this engine just scores. */
  kind: 'conformation' | 'ability';
  ideal?: IdealVector; // kind === 'conformation'
  weights?: AbilityWeights; // kind === 'ability'
  falloff?: number; // kind === 'conformation', mirrors show_ideal_falloff
  judgeWeights?: JudgeWeights; // kind === 'conformation'; {} - no judge involved, so every
  // trait takes scoreEntry's own 1.0 default
}

export interface SelectionPolicyParams {
  mares: BreedingCandidate[];
  stallions: BreedingCandidate[];
  target: SelectionTarget;
  /** §2.4's clamp. Whichever of the two applies is chosen by target.kind; the caller passes the
   * one it needs, read from the active npc_ceiling_schedule row. */
  ceiling: number;
  selectionNoiseSd: number;
  retentionBias: number; // 0..1
  maxPairs: number;
  /** Pairs ruled out on COI grounds - `${mareId}:${stallionId}` keyed, built by the caller (§4.2
   * step 7). The engine stays pure: it consumes a precomputed set rather than walking pedigrees. */
  coiExceeded: Set<string>;
  seed: number;
}

export interface SelectionResult {
  pairs: { mareId: number; stallionId: number }[];
}

/**
 * §2.4's re-aggregation, exported so it can be asserted directly (slice 0015 §9 test 3) rather
 * than only through a pairing outcome. Clamps each trait's own quality - traitScore (closeness to
 * target) for conformation, expressed value for ability - before re-weighting, using the weights
 * the scorer itself already computed. weightSum of zero (no ideal vector / no weights at all)
 * scores 0, the same guard both scorers already have.
 */
export function clampedScore(result: ScoreResult, ceiling: number, kind: 'conformation'): number;
export function clampedScore(result: AbilityScoreResult, ceiling: number, kind: 'ability'): number;
export function clampedScore(result: ScoreResult | AbilityScoreResult, ceiling: number, kind: 'conformation' | 'ability'): number {
  if (result.weightSum <= 0) return 0;
  let weightedSum = 0;
  for (const trait of result.traits) {
    const quality = kind === 'conformation' ? (trait as ScoreResult['traits'][number]).traitScore : trait.expressed;
    weightedSum += trait.weight * Math.min(quality, ceiling);
  }
  return weightedSum / result.weightSum;
}

/** The per-horse ranking score: clamped quality against the personality's target, plus a
 * perturbation drawn from N(0, selectionNoiseSd) (§10d's "imperfect selection"). The sub-seed is
 * keyed on the horse rather than on iteration order, so the ranking doesn't depend on what order
 * the caller happened to list candidates in. */
function scoreCandidate(candidate: BreedingCandidate, target: SelectionTarget, ceiling: number, selectionNoiseSd: number, seed: number): number {
  const clamped =
    target.kind === 'conformation'
      ? clampedScore(
          scoreEntry({
            expressed: candidate.expressed,
            ideal: target.ideal ?? {},
            judgeWeights: target.judgeWeights ?? {},
            falloff: target.falloff ?? 0,
            noise: 0,
          }),
          ceiling,
          'conformation'
        )
      : clampedScore(
          scoreAbilityEntry({
            expressed: candidate.expressed,
            weights: target.weights ?? {},
            noise: 0,
          }),
          ceiling,
          'ability'
        );
  const noise = makeRng(deriveSeed(seed, `npc_selection_noise_${candidate.horseId}`)).normal(0, selectionNoiseSd);
  return clamped + noise;
}

/** §2.3 step 3: at this horse's rank, skip it for the cycle with probability retentionBias. A
 * roll of 1.0 skips unconditionally - Rng.next() is always < 1, never >=, so every horse is
 * skipped, not just very likely to be (slice 0015 §9 test 2). */
function isRetainedThisCycle(horseId: number, retentionBias: number, seed: number): boolean {
  const roll = makeRng(deriveSeed(seed, `npc_retention_${horseId}`)).next();
  return roll >= retentionBias;
}

/** Ranks one sex, highest score first, with retained-this-cycle horses dropped entirely - they
 * never occupy a rank position or a stallion's rotation slot. */
function rankSex(candidates: BreedingCandidate[], target: SelectionTarget, ceiling: number, selectionNoiseSd: number, retentionBias: number, seed: number): BreedingCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, target, ceiling, selectionNoiseSd, seed) }))
    .sort((a, b) => b.score - a.score)
    .map((ranked) => ranked.candidate)
    .filter((candidate) => isRetainedThisCycle(candidate.horseId, retentionBias, seed));
}

/**
 * §2.3's five steps: score, perturb, sort, apply retention, then pair mares against a round-robin
 * rotation of stallions. The i-th ranked mare's default partner is the stallion at rank
 * `i % stallions.length` - not strict rank-for-rank pairing, because a mare is used at most once
 * per cycle but a stallion can cover many (§2.3's "why round-robin" explains the alternative was
 * rejected). A COI-excluded pairing tries the next stallion in the rotation instead of dropping
 * the mare outright; only once every stallion has been tried for her does she sit the cycle out.
 */
export function selectBreedingPairs(params: SelectionPolicyParams): SelectionResult {
  const mares = rankSex(params.mares, params.target, params.ceiling, params.selectionNoiseSd, params.retentionBias, params.seed);
  const stallions = rankSex(params.stallions, params.target, params.ceiling, params.selectionNoiseSd, params.retentionBias, params.seed);

  const pairs: { mareId: number; stallionId: number }[] = [];
  if (stallions.length === 0) return { pairs };

  for (let i = 0; i < mares.length && pairs.length < params.maxPairs; i++) {
    const mare = mares[i];
    for (let offset = 0; offset < stallions.length; offset++) {
      const stallion = stallions[(i + offset) % stallions.length];
      if (params.coiExceeded.has(`${mare.horseId}:${stallion.horseId}`)) continue;
      pairs.push({ mareId: mare.horseId, stallionId: stallion.horseId });
      break;
    }
  }

  return { pairs };
}
