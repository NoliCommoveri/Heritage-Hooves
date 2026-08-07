// Potential -> genetic value -> realization -> expressed value. Slice 0006 §4. Pure, no database
// access (CLAUDE.md §5.1) - the caller reads the horse, calls these, and either stores the result
// (environmental noise, at birth) or renders it (everything else, on every read - §2.4).
//
// Naming debt, accepted deliberately (slice 0012 §7.1): this file also holds ability-trait
// expression (abilityValues, below), which its name and path (engines/conformation/) do not
// suggest - traits.ts:44's own comment anticipated exactly this ("a later slice displaying ability
// traits needs no new expression function, only this lookup"). A rename to engines/traits/model.ts
// would touch a dozen imports for no behavioural change, so it stays here. Flagged so the next
// session finds it stated rather than surprising.

import { makeRng, deriveSeed, type Rng } from '../../lib/rng';
import { potential, TRAITS, type TraitCode } from '../genetics/polygenic';
import { getMendelianPair, type Genotype } from '../genetics/genotype';
import { anchorFor, CONFORMATION_TRAITS, ABILITY_TRAITS } from './traits';
import { TYPE_LOCUS_CODE, shownValueFor, meanValueFor } from './typeGene';
import type { IdealVector } from '../showing/score';

export type NoiseByTrait = Record<TraitCode, number>;

// Frozen for horses born before this slice (§2.5) - deliberately NOT read from config, so a legacy
// horse's numbers stay stable forever regardless of what conformation_noise_sd is retuned to later.
// This is the same value as that setting's starting default; that is a coincidence of tuning, not a
// dependency - never replace this with a read of the live config.
const LEGACY_NOISE_SD = 6;

function drawNoise(rng: Rng, sd: number): NoiseByTrait {
  const out = {} as NoiseByTrait;
  for (const trait of TRAITS) out[trait] = Math.round(rng.normal(0, sd));
  return out;
}

/** Rolled once at birth, from the horse's own seed, one draw per trait in TRAITS order (§4.2). The
 * caller stores the result on horses.environmental_noise via serializeNoise. */
export function rollEnvironmentalNoise(rngSeed: number, noiseSd: number): NoiseByTrait {
  return drawNoise(makeRng(deriveSeed(rngSeed, 'birth_noise')), noiseSd);
}

/** §2.5's fallback for a horse with no stored noise: the same draw, off the same seed and label, but
 * against the frozen LEGACY_NOISE_SD rather than the live config value. */
export function legacyEnvironmentalNoise(rngSeed: number): NoiseByTrait {
  return drawNoise(makeRng(deriveSeed(rngSeed, 'birth_noise')), LEGACY_NOISE_SD);
}

interface StoredNoise {
  v: number;
  noise: Partial<Record<TraitCode, number>>;
}

export function serializeNoise(noise: NoiseByTrait): string {
  return JSON.stringify({ v: 1, noise });
}

/** Reads horses.environmental_noise (§5.2), or derives the §2.5 legacy fallback when it's null -
 * the only two ways a horse's noise is ever obtained. */
export function noiseFor(rngSeed: number, storedJson: string | null): NoiseByTrait {
  if (storedJson === null) return legacyEnvironmentalNoise(rngSeed);
  const parsed = JSON.parse(storedJson) as StoredNoise;
  const out = {} as NoiseByTrait;
  for (const trait of TRAITS) out[trait] = parsed.noise[trait] ?? 0;
  return out;
}

/** §4.1. Ability traits only, from slice 0028 §4 rule 1 onward - conformation has its own version
 * below (conformationGeneticValue), split rather than branched, so ability's `potential * 5 + noise`
 * is untouched by anything this slice does to conformation's expression. Clamped to 1..99 so the
 * display bar never pins flush against a label. */
export function geneticValue(genotype: Genotype, trait: TraitCode, noise: number): number {
  const raw = potential(genotype, trait) * 5 + noise;
  return Math.min(99, Math.max(1, raw));
}

function clamp1to99(raw: number): number {
  return Math.min(99, Math.max(1, Math.round(raw)));
}

/**
 * Slice 0028 §2.3: a conformation trait's expressed value reads the horse's own type-gene pair
 * (loci.ts's NL/SA/BL/HS/HP, one per trait) rather than the old anchor-50 polygenic potential -
 * `expressed = worseAllele(pair, target) + (alleleCount - 10) * modifierStep + noise`. The 20-bit
 * polygenic block (`potential`, unchanged in shape and RNG draw order - slice 0028 §2.3/rule 5) is
 * demoted to a small +/-1.0 tie-breaker, no longer the whole story.
 *
 * `target` is read from the horse's own breed's LIVE ideal_vector, never the ideal_vector
 * snapshotted onto a show_classes row (§2.3's "which standard?") - judging (scoreEntry,
 * src/engines/showing/score.ts) measures distance against the class's own snapshot separately; this
 * is what the horse SHOWS, not what it is scored against, and the two are deliberately different
 * reads of breeds.ideal_vector that will disagree the moment either one is retuned.
 *
 * `useMean` is §2.8's one exception: an NPC stable's own opinion of a horse it has (fictionally)
 * conformation-panel-tested reads the mean of both alleles rather than the worse-of-pair a look
 * alone tells you - the same information a tested player has. Defaults to false (the shown value)
 * everywhere else; npcBreeding.ts's expressedFor is the only caller that ever passes true.
 */
export function conformationGeneticValue(genotype: Genotype, trait: TraitCode, noise: number, target: number, modifierStep: number, useMean = false): number {
  const pair = getMendelianPair(genotype, TYPE_LOCUS_CODE[trait]);
  const shown = useMean ? meanValueFor(pair) : shownValueFor(pair, target);
  const modifier = (potential(genotype, trait) - 10) * modifierStep;
  return clamp1to99(shown + modifier + noise);
}

export interface RealizationConfig {
  conformation_maturity_years: number;
  conformation_realization_at_birth: number;
  inbreeding_depression_factor: number;
  /** Slice 0028 §2.3/rule 6. Ability-only now (conformation no longer calls realization() at all -
   * see conformationValues below), but kept on this one shared interface rather than split, since
   * abilityValues is the only remaining caller of realization() and this interface is its config. */
  conformation_modifier_step: number;
}

/** §4.3. trainingFactor/careFactor default to 1.0 - not built yet (§3), wired in without changing
 * this function's shape once they are. */
export function realization(ageYears: number, coi: number, config: RealizationConfig, trainingFactor = 1.0, careFactor = 1.0): number {
  const atBirth = config.conformation_realization_at_birth;
  const base = Math.min(1, atBirth + (1 - atBirth) * (ageYears / config.conformation_maturity_years));
  return base * (1 - coi * config.inbreeding_depression_factor) * trainingFactor * careFactor;
}

/** §4.4. anchor is 50 for a bidirectional trait, 0 for a unidirectional one (anchorFor, traits.ts). */
export function expressedValue(geneticVal: number, realizationVal: number, anchor: number): number {
  return Math.round(anchor + (geneticVal - anchor) * realizationVal);
}

export interface ConformationValue {
  code: TraitCode;
  /** The value at this horse's current age - and, since slice 0028 §2.4, at every OTHER age too.
   * ageYears/coi are no longer inputs to this number at all (see conformationValues below); the
   * parameter stays on this file's other functions only because abilityValues still needs it. */
  expressed: number;
  /** Slice 0028 §2.4: identical to `expressed`, always - conformation is no longer realized by age,
   * so there is nothing left for "will mature to" to say that isn't already said. Kept as a field
   * (rather than removed) only so render/horses.ts's existing ConformationDisplayRow shape does not
   * need a second change; the horse page's "will mature to" line itself is dropped. */
  matureExpressed: number;
}

/**
 * Slice 0028 §2.4: "conformation is not realized by age at all" - a horse's conformation is §2.3's
 * formula at every age, from birth, which is what makes §2.3's fault-dominant guarantee actually
 * true for a foal and not just a mature horse. There is deliberately no ageYears/coi parameter here
 * any more (unlike abilityValues, which still needs both) - do not add one back in and wire it into
 * realization(); slice 0028 §4 rule 2 is explicit that both of the obvious ways to do that are
 * defects. Every call site that used to pass an age/coi pair here simply drops them.
 *
 * `ideal` is the horse's own breed's live ideal_vector (parseIdealVector'd by the caller), never the
 * class snapshot. A trait absent from `ideal` - the breed has no target for it, or has no
 * ideal_vector at all - is skipped rather than shown against a fabricated anchor of 50, which is
 * exactly the breed-blind defect (§1) this slice exists to close; such a horse is "not judged" (§7
 * test 11) and now correctly shows nothing for that trait either.
 */
export function conformationValues(
  genotype: Genotype,
  noise: NoiseByTrait,
  config: RealizationConfig,
  ideal: IdealVector | null,
  useMean = false
): ConformationValue[] {
  if (!ideal) return [];
  return CONFORMATION_TRAITS.filter((trait) => ideal[trait] !== undefined).map((trait) => {
    const target = ideal[trait]!.target;
    const expressed = conformationGeneticValue(genotype, trait, noise[trait], target, config.conformation_modifier_step, useMean);
    return { code: trait, expressed, matureExpressed: expressed };
  });
}

export interface AbilityValue {
  code: TraitCode;
  /** The value right now, at this horse's current age and COI. No matureExpressed here (unlike
   * ConformationValue) - ability values are never displayed (§2.3), only scored, so there is
   * nothing that needs a "will mature to" figure. */
  expressed: number;
}

/** Slice 0012 §7.1: the five ability values a discipline scorer reads, computed through the exact
 * same potential -> geneticValue -> realization -> expressedValue pipeline conformationValues
 * uses, with anchorFor's 0 for a higher_better trait doing the real work: expressed = geneticValue
 * x realization, so a young horse is straightforwardly worse rather than pulled toward a midpoint
 * the way a bidirectional conformation trait is. Never asked for CONFORMATION_TRAITS or fertility -
 * see ABILITY_TRAITS. */
export function abilityValues(genotype: Genotype, noise: NoiseByTrait, ageYears: number, coi: number, config: RealizationConfig): AbilityValue[] {
  const realizationVal = realization(ageYears, coi, config);
  return ABILITY_TRAITS.map((trait) => {
    const gv = geneticValue(genotype, trait, noise[trait]);
    return { code: trait, expressed: expressedValue(gv, realizationVal, anchorFor(trait)) };
  });
}

export interface ConformationDisplayRow {
  code: TraitCode;
  name: string;
  lowLabel: string;
  highLabel: string;
  expressed: number;
  matureExpressed: number;
}

interface TraitInfoLike {
  code: string;
  name: string;
  low_label: string | null;
  high_label: string | null;
}

/** Zips computed values with the display metadata a render function needs (name, the two extreme
 * labels) - takes plain data in and returns plain data out, so it stays a pure function even though
 * the caller's `traitInfo` usually came from the quantitative_traits table. */
export function conformationDisplayRows(values: ConformationValue[], traitInfo: TraitInfoLike[]): ConformationDisplayRow[] {
  return values.map((v) => {
    const info = traitInfo.find((t) => t.code === v.code);
    return {
      code: v.code,
      name: info?.name ?? v.code,
      lowLabel: info?.low_label ?? '',
      highLabel: info?.high_label ?? '',
      expressed: v.expressed,
      matureExpressed: v.matureExpressed,
    };
  });
}
