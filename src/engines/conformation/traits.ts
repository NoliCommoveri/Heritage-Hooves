// Trait metadata the conformation engine itself needs - category and direction, which decides the
// anchor a trait's genetic value is realized towards (§4.4). Slice 0006 §5.1.
//
// TRAITS (src/engines/genetics/polygenic.ts) stays the single source of truth for iteration order
// and the RNG draw sequence - this file never reorders or restates it, only annotates it. The
// `quantitative_traits` table (migrations/0028/0029) is display metadata a player reads or an
// operator edits; this file is what the engine computes with, and test/genetics/consistency.test.ts
// checks the seed migration agrees with the maps below.

import { TRAITS, type TraitCode } from '../genetics/polygenic';

export type TraitCategory = 'conformation' | 'ability' | 'hidden';
export type TraitDirection = 'bidirectional' | 'higher_better';

export const TRAIT_CATEGORY: Record<TraitCode, TraitCategory> = {
  neck_length: 'conformation',
  shoulder_angle: 'conformation',
  back_length: 'conformation',
  hock_set: 'conformation',
  stamina: 'ability',
  jump_scope: 'ability',
  speed: 'ability',
  trainability: 'ability',
  fertility: 'hidden',
  agility: 'ability',
};

export const TRAIT_DIRECTION: Record<TraitCode, TraitDirection> = {
  neck_length: 'bidirectional',
  shoulder_angle: 'bidirectional',
  back_length: 'bidirectional',
  hock_set: 'bidirectional',
  stamina: 'higher_better',
  jump_scope: 'higher_better',
  speed: 'higher_better',
  trainability: 'higher_better',
  fertility: 'higher_better',
  agility: 'higher_better',
};

/** The four traits this slice ever displays (§2.1) - in TRAITS' own order. */
export const CONFORMATION_TRAITS: readonly TraitCode[] = TRAITS.filter((t) => TRAIT_CATEGORY[t] === 'conformation');

/** Slice 0012 §7: the five traits a discipline scorer reads - stamina, jump_scope, speed,
 * trainability, agility, in TRAITS' own order (fertility is category 'hidden' and is correctly
 * excluded). scoreAbilityEntry iterates this, never Object.keys(weights), for the same reason
 * scoreEntry iterates CONFORMATION_TRAITS rather than Object.keys(ideal) - a result's breakdown
 * always reads in the same order regardless of how the JSON was written. */
export const ABILITY_TRAITS: readonly TraitCode[] = TRAITS.filter((t) => TRAIT_CATEGORY[t] === 'ability');

const ANCHOR_BIDIRECTIONAL = 50;
const ANCHOR_UNIDIRECTIONAL = 0;

/** §4.4: 50 for a bidirectional (conformation) trait, 0 for a unidirectional (ability) one - so a
 * later slice displaying ability traits needs no new expression function, only this lookup. */
export function anchorFor(trait: TraitCode): number {
  return TRAIT_DIRECTION[trait] === 'bidirectional' ? ANCHOR_BIDIRECTIONAL : ANCHOR_UNIDIRECTIONAL;
}
