// Two pieces of breed identity that live on the `breeds` row and are read by two different engines:
// `ability_bias` (migrations 0141/0142) by the founding generator, `discipline_aptitudes`
// (migrations 0143/0144) by the discipline scorer. Pure, no database access (CLAUDE.md §5.1) - the
// caller reads the breed row and hands the JSON here.
//
// Why this file exists rather than putting each parser next to its consumer: both are answers to
// the same question ("what does this breed's name actually mean, mechanically?"), both are parsed
// from a `breeds` column, and both need the same neutral-default discipline applied consistently.
// Splitting them would put half the answer in engines/founding and half in engines/showing, and the
// next session tuning breed balance would have to find both.
//
// Before 2026-08-04 the answer to that question was "nothing, for ability" - breed affected the
// Mendelian allele pool (colour, gait, disease) and the conformation ideal vector, and touched
// ability traits at no point at all. See docs/breed-ability-and-aptitude.md.

import { ABILITY_TRAITS } from '../conformation/traits';
import type { TraitCode } from '../genetics/polygenic';

// ---------------------------------------------------------------------------
// ability_bias - what a breed is born leaning towards
// ---------------------------------------------------------------------------

/** Offsets to the quality band's polygenic_one_chance, per ability trait. A missing key is 0 ("no
 * leaning"), never a penalty. */
export type AbilityBias = Partial<Record<TraitCode, number>>;

interface StoredAbilityBias {
  v: number;
  traits: Record<string, number>;
}

/**
 * Safety rails on the resulting draw chance. A bias is a tendency, not a switch: even stacked on
 * top of the widest quality band these keep every trait genuinely random rather than collapsing it
 * to all-zeros or all-ones. Today's widest case is the high band (0.58) plus the largest seeded
 * offset (0.06) = 0.64, nowhere near either rail - these exist so a future retune at /admin cannot
 * quietly produce a trait with no variation left in it.
 */
export const ABILITY_BIAS_CHANCE_MIN = 0.15;
export const ABILITY_BIAS_CHANCE_MAX = 0.85;

/**
 * Reads breeds.ability_bias. Null (no leaning decided for this breed) returns {}, which every
 * consumer treats as exactly today's pre-0141 behaviour.
 *
 * **Filters to ABILITY_TRAITS.** A conformation or robustness key in the JSON is dropped rather
 * than honoured: conformation already differs by breed through ideal_vector, which moves the target
 * rather than the draw, and applying a bias there too would double-count breed identity in a way
 * nothing downstream would make visible. Robustness is drawn at its own fixed chance for a reason
 * (slice 0014 §2.8) that a breed leaning has no business overriding. Dropping is deliberate over
 * throwing - a bad key in an operator-edited JSON blob should not break horse generation.
 */
export function parseAbilityBias(json: string | null): AbilityBias {
  if (json === null) return {};
  const parsed = JSON.parse(json) as StoredAbilityBias;
  const out: AbilityBias = {};
  for (const trait of ABILITY_TRAITS) {
    const value = parsed.traits[trait];
    if (typeof value === 'number' && Number.isFinite(value)) out[trait] = value;
  }
  return out;
}

/**
 * The draw chance for one trait: the quality band's own chance, plus this breed's offset, clamped.
 * A trait with no offset returns `base` unchanged, so a conformation trait, a robustness trait, or
 * any breed with a null ability_bias all follow exactly the path they followed before this existed.
 */
export function biasedOneChance(base: number, bias: AbilityBias, trait: TraitCode): number {
  const offset = bias[trait] ?? 0;
  if (offset === 0) return base;
  return Math.min(ABILITY_BIAS_CHANCE_MAX, Math.max(ABILITY_BIAS_CHANCE_MIN, base + offset));
}

// ---------------------------------------------------------------------------
// discipline_aptitudes - what a breed is suited to today
// ---------------------------------------------------------------------------

/** Multipliers keyed by disciplines.code. Centred on 1.0. */
export type DisciplineAptitudes = Record<string, number>;

interface StoredDisciplineAptitudes {
  v: number;
  disciplines: Record<string, number>;
}

/** No opinion. Returned for a crossbred horse, a horse with no breed, a breed with no aptitudes
 * decided, or a discipline the breed's JSON does not mention. Deliberately 1.0 and not 0 - this
 * follows scoreAbilityEntry's `judgeWeights` rule ("no opinion"), not its `weights` rule ("does not
 * count at all"), and confusing the two would score an unmodified horse at nothing. */
export const NEUTRAL_APTITUDE = 1.0;

export function parseDisciplineAptitudes(json: string | null): DisciplineAptitudes {
  if (json === null) return {};
  return (JSON.parse(json) as StoredDisciplineAptitudes).disciplines;
}

/**
 * The multiplier for one horse in one discipline class.
 *
 * A crossbred horse always reads NEUTRAL_APTITUDE regardless of what breed_id it carries. That is
 * a real decision, not a fallback: `horses.breed_id` on a cross names the registry it competes
 * under (a Paint's breed_id IS the Quarter Horse's - overview §4a, and checkEligibility leans on
 * exactly that), so honouring it here would hand a half-Warmblood cross the full Quarter Horse
 * barrel bonus. A cross has no single breed to be suited to, and 1.0 says so.
 */
export function aptitudeFor(aptitudes: DisciplineAptitudes, disciplineCode: string | null, isCross: boolean): number {
  if (isCross || disciplineCode === null) return NEUTRAL_APTITUDE;
  const value = aptitudes[disciplineCode];
  return typeof value === 'number' && Number.isFinite(value) ? value : NEUTRAL_APTITUDE;
}
