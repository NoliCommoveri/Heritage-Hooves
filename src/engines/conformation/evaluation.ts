// The paid conformation evaluation, 2026-08-05. Operator feedback: a foal cannot show, so a child
// has no way to tell a good one from a bad one and no basis for deciding whether to keep feeding it.
// Pure, no database access (CLAUDE.md §5.1).
//
// Not a second opinion about a horse (CLAUDE.md §13's no-parallel-scoring rule): the verdict is read
// off exactly the labels a shown horse already displays - conformationLabelFor, which is itself read
// off the judge's own traitScoreFor. What this file adds is *uncertainty*, and only uncertainty.
//
// Three properties, in order of how much they matter:
//
//  1. **It never lies.** The true label is always inside the range returned. A wide answer is vague,
//     never wrong - "Weak to Outstanding" on a weanling is honest, and the child learns nothing
//     false from it.
//  2. **It is not averageable.** The offset is derived once from the horse's own rng_seed
//     (CLAUDE.md §5.2), not drawn per purchase, so buying five evaluations on the same foal on the
//     same day returns the same words five times. Independent noise per purchase would let a player
//     average it away and read the exact answer off a young foal for the price of a few tests.
//  3. **It sharpens with age, smoothly.** The same underlying offset is scaled by the shrinking
//     spread, so successive evaluations close in on the truth rather than jumping around it.
//
// The horse is judged at MATURITY, not at its current age. A four-month-old's conformation has
// barely realised (realization() is near conformation_realization_at_birth), so its expressed value
// today says almost nothing; the question a child is actually asking is "is this foal worth keeping",
// which is a question about what it will become.

import { conformationLabelFor, type ConformationLabel, type ConformationLabelBands } from './labels';
import type { IdealVector } from '../showing/score';
import type { TraitCode } from '../genetics/polygenic';
import { makeRng, deriveSeed } from '../../lib/rng';

/** poor .. outstanding, in order. 'unknown' is deliberately not a member: it is the absence of a
 * verdict, not a step on the scale, and mixing it in would let a range span it. */
const LABEL_SCALE: ConformationLabel[] = ['poor', 'weak', 'acceptable', 'good', 'outstanding'];

export interface EvaluationVerdict {
  low: ConformationLabel;
  high: ConformationLabel;
}

/** The stored shape of horse_evaluations.verdicts (migration 0155). */
export interface StoredEvaluation {
  v: 1;
  traits: Partial<Record<TraitCode, EvaluationVerdict>>;
}

export interface EvaluationConfig {
  /** conformation_certain_age is expressed in years to match how an operator thinks about a horse. */
  evaluation_max_spread_bands: number;
  evaluation_certain_age_years: number;
}

function clampIndex(i: number): number {
  return Math.min(LABEL_SCALE.length - 1, Math.max(0, i));
}

/**
 * How many label steps either side the evaluator hedges by, at this age. Linear from
 * evaluation_max_spread_bands at birth to 0 at evaluation_certain_age_years, and 0 for any horse at
 * or past that age - at which point an evaluation returns a single word, the same one the horse
 * would earn for free by starting in one show.
 */
export function evaluationSpreadBands(ageYears: number, config: EvaluationConfig): number {
  const certainAt = config.evaluation_certain_age_years;
  if (certainAt <= 0) return 0;
  const maxSpread = Math.max(0, Math.round(config.evaluation_max_spread_bands));
  const remaining = 1 - Math.min(1, Math.max(0, ageYears / certainAt));
  return Math.min(maxSpread, Math.max(0, Math.round(maxSpread * remaining)));
}

/**
 * One trait's verdict. `offsetUnit` is a stable -1..1 number belonging to this horse and trait
 * (see evaluationOffsets below); scaling it by the spread rather than redrawing is what makes
 * successive evaluations converge.
 *
 * The truth is always inside the returned range: |trueIndex - centre| <= spread before clamping, and
 * clamping the centre into a range that already contains the truth cannot increase that distance.
 */
export function verdictFor(trueLabel: ConformationLabel, spread: number, offsetUnit: number): EvaluationVerdict {
  const trueIndex = LABEL_SCALE.indexOf(trueLabel);
  if (trueIndex < 0) return { low: 'poor', high: 'outstanding' };
  if (spread <= 0) return { low: trueLabel, high: trueLabel };

  const centre = clampIndex(trueIndex + Math.round(offsetUnit * spread));
  return {
    low: LABEL_SCALE[clampIndex(centre - spread)],
    high: LABEL_SCALE[clampIndex(centre + spread)],
  };
}

/**
 * The per-trait offsets for one horse, each in -1..1, derived from its own seed and fixed for its
 * whole life. Property 2 above lives here: this is a function of the horse, never of the purchase,
 * so nothing about buying an evaluation twice produces a second draw to average against the first.
 */
export function evaluationOffsets(rngSeed: number, traits: TraitCode[]): Map<TraitCode, number> {
  const out = new Map<TraitCode, number>();
  for (const trait of traits) {
    const rng = makeRng(deriveSeed(rngSeed, `evaluation_${trait}`));
    out.set(trait, rng.next() * 2 - 1);
  }
  return out;
}

export interface EvaluationInput {
  rngSeed: number;
  /** The horse's conformation as it will read at maturity - see this file's opening note. */
  matureConformation: { code: TraitCode; expressed: number }[];
  ideal: IdealVector | null;
  falloff: number;
  bands: ConformationLabelBands;
  ageYears: number;
}

/**
 * A whole horse's evaluation. Returns null when there is nothing honest to say - a breed with no
 * ideal_vector has no standard to be judged against, and an evaluator who cannot judge should not
 * take the money. The caller refuses the purchase rather than charging for a page of Unknowns.
 */
export function evaluateHorse(input: EvaluationInput, config: EvaluationConfig): StoredEvaluation | null {
  if (input.ideal === null) return null;

  const spread = evaluationSpreadBands(input.ageYears, config);
  const offsets = evaluationOffsets(
    input.rngSeed,
    input.matureConformation.map((row) => row.code)
  );

  const traits: Partial<Record<TraitCode, EvaluationVerdict>> = {};
  for (const row of input.matureConformation) {
    const ideal = input.ideal[row.code];
    if (ideal === undefined) continue;
    const trueLabel = conformationLabelFor(row.expressed, ideal.target, input.falloff, input.bands, true);
    traits[row.code] = verdictFor(trueLabel, spread, offsets.get(row.code) ?? 0);
  }

  if (Object.keys(traits).length === 0) return null;
  return { v: 1, traits };
}

export function parseStoredEvaluation(json: string): StoredEvaluation {
  return JSON.parse(json) as StoredEvaluation;
}

/** Whether a fresh purchase today would say anything the stored one didn't. Used to talk a player
 * out of paying twice for the same words - the spread only moves when the horse ages, so an
 * evaluation bought at the same spread is identical, to the letter. */
export function wouldSharpen(storedAtAgeYears: number, currentAgeYears: number, config: EvaluationConfig): boolean {
  return evaluationSpreadBands(currentAgeYears, config) < evaluationSpreadBands(storedAtAgeYears, config);
}
