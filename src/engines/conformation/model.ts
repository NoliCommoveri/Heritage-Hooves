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
import type { Genotype } from '../genetics/genotype';
import { anchorFor, CONFORMATION_TRAITS, ABILITY_TRAITS } from './traits';

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

/** §4.1. Clamped to 1..99 so the display bar never pins flush against a label. */
export function geneticValue(genotype: Genotype, trait: TraitCode, noise: number): number {
  const raw = potential(genotype, trait) * 5 + noise;
  return Math.min(99, Math.max(1, raw));
}

export interface RealizationConfig {
  conformation_maturity_years: number;
  conformation_realization_at_birth: number;
  inbreeding_depression_factor: number;
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
  /** The value right now, at this horse's current age and COI. */
  expressed: number;
  /** The value once fully grown, at this horse's own COI - "will mature to", never a moving target
   * once the horse actually reaches conformation_maturity_years. */
  matureExpressed: number;
}

/** The four displayed measurements (§2.1) for one horse, given its genotype, its stored-or-legacy
 * noise, its age and its COI. Ability and hidden traits are expressed by the same underlying
 * functions but are never asked for here - see CONFORMATION_TRAITS. */
export function conformationValues(genotype: Genotype, noise: NoiseByTrait, ageYears: number, coi: number, config: RealizationConfig): ConformationValue[] {
  const matureRealization = realization(config.conformation_maturity_years, coi, config);
  return CONFORMATION_TRAITS.map((trait) => {
    const gv = geneticValue(genotype, trait, noise[trait]);
    const anchor = anchorFor(trait);
    return {
      code: trait,
      expressed: expressedValue(gv, realization(ageYears, coi, config), anchor),
      matureExpressed: expressedValue(gv, matureRealization, anchor),
    };
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
