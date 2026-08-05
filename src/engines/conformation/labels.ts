// Slice 0022 Part B: a plain word next to each conformation trait, once a horse has shown - Poor /
// Weak / Acceptable / Good / Outstanding. Pure, no database access (CLAUDE.md §5.1). Not a new
// opinion: the band is read off traitScoreFor, the exact per-trait formula the judge already scores
// with (src/engines/showing/score.ts) - CLAUDE.md §13's "no second scoring path" rule applied to a
// display. The gate (has this horse shown; does its breed have an ideal_vector) is a display
// decision the caller makes, not this file's concern - see ConformationLabel's own 'unknown' member.

import { traitScoreFor, type IdealVector } from '../showing/score';
import type { TraitCode } from '../genetics/polygenic';

export type ConformationLabel = 'unknown' | 'poor' | 'weak' | 'acceptable' | 'good' | 'outstanding';

export const CONFORMATION_LABEL_TEXT: Record<ConformationLabel, string> = {
  unknown: 'Unknown',
  poor: 'Poor',
  weak: 'Weak',
  acceptable: 'Acceptable',
  good: 'Good',
  outstanding: 'Outstanding',
};

export interface ConformationLabelBands {
  outstandingMin: number;
  goodMin: number;
  acceptableMin: number;
  weakMin: number;
}

/** §B2's band table, applied to one trait's own traitScore (0-100, no judge weight - a weight says
 * how much a judge cares, not how good the horse is). */
export function bandForTraitScore(traitScore: number, bands: ConformationLabelBands): ConformationLabel {
  if (traitScore >= bands.outstandingMin) return 'outstanding';
  if (traitScore >= bands.goodMin) return 'good';
  if (traitScore >= bands.acceptableMin) return 'acceptable';
  if (traitScore >= bands.weakMin) return 'weak';
  return 'poor';
}

/** §B2/§B3: the word for one trait against one breed's own ideal target, gated by whether this
 * viewer is entitled to a real answer at all - `eligible` is false for a horse with no starts
 * (§B3) or a breed with no ideal_vector (§B3's closing paragraph), and reads as 'unknown' either
 * way, since both are genuinely the same sentence from the player's side. */
export function conformationLabelFor(expressed: number, target: number, falloff: number, bands: ConformationLabelBands, eligible: boolean): ConformationLabel {
  if (!eligible) return 'unknown';
  return bandForTraitScore(traitScoreFor(expressed, target, falloff), bands);
}

/**
 * Slice 0025 stage 3 (docs/slices/0025-...md §7.4): an ability trait has no breed target - "higher
 * is better" all the way, unlike a bidirectional conformation trait - so there is no distance-from-
 * target to run through traitScoreFor first. The horse's own raw expressed ability value (already
 * 0-100-ish, geneticValue * realization) IS the traitScore, so bandForTraitScore is reused directly
 * rather than restated (CLAUDE.md §13). One vocabulary for both cards on purpose: an owner reading
 * "Outstanding" already knows what it means from the Conformation card. `eligible` is per TRAIT here,
 * not per horse - a horse that has taken a speed test but never an agility one reads Unknown for
 * agility alone, unlike conformationLabelFor's whole-horse gate (a single class judges every
 * conformation trait at once; an ability test measures exactly one).
 */
export function abilityLabelFor(expressed: number, bands: ConformationLabelBands, eligible: boolean): ConformationLabel {
  if (!eligible) return 'unknown';
  return bandForTraitScore(expressed, bands);
}

/**
 * §B3/§B5: one word per trait this horse has an expressed value for, against one breed's own ideal
 * vector - never a shared or foal's-breed vector (§B5's own warning). `eligible` is a single flag
 * for the whole horse (has it shown; does its breed have an ideal_vector), matching §B3's gate.
 */
export function conformationLabelsFor(
  values: { code: TraitCode; expressed: number }[],
  ideal: IdealVector | null,
  falloff: number,
  bands: ConformationLabelBands,
  eligible: boolean
): Map<TraitCode, ConformationLabel> {
  const map = new Map<TraitCode, ConformationLabel>();
  for (const v of values) {
    const target = ideal?.[v.code]?.target;
    map.set(v.code, target === undefined ? 'unknown' : conformationLabelFor(v.expressed, target, falloff, bands, eligible));
  }
  return map;
}
