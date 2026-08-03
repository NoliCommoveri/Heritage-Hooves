// The eight quantitative traits, ten loci each, and their inheritance. Slice 0002 §4.3, §5.2.
//
// Nothing displays these yet (§2.7) - the polygenic slice, two slices out, is expression and
// display only, because every horse born here already has real heritable values.
//
// Environmental noise is NOT stored anywhere in this slice. The design applies noise at birth,
// but noise only matters at expression, which is two slices away, and the horse's rng_seed is
// already stored - so the noise can be derived whenever it's first needed, deterministically, via
// deriveSeed(horse.rng_seed, "birth_noise"). That label is reserved here for whichever slice
// implements expression of potential; do not draw birth noise any other way.

import type { Rng } from '../../lib/rng';
import { getPolygenicString, type Genotype } from './genotype';

export const TRAITS = [
  'neck_length',
  'shoulder_angle',
  'back_length',
  'hock_set',
  'stamina',
  'jump_scope',
  'speed',
  'trainability',
  // Added in slice 0003 §4.3. A horse born before this trait existed has no 'fertility' key and
  // must NOT be read via getPolygenicString/potential() for it - that reads missing traits as all
  // zeros (the bottom of the range), which is right for a conformation trait and would make every
  // pre-existing horse read as very nearly sterile here. Use fertilityPotential() in
  // src/engines/breeding/fertility.ts instead, which gives legacy horses a stable, well-distributed
  // score derived from their own rng_seed rather than a guess.
  'fertility',
  // Added in slice 0012 §4.1, appended (not grouped with the other ability traits above) so every
  // draw before it keeps reproducing the same horses. This list is append-ordered, not
  // category-ordered - fertility already broke the tidy grouping for the same reason, and that
  // visible oddness is deliberate: it is what tells the next session that inserting into the
  // middle of this list is never safe, only appending to the end. Slice 0012 shipped alongside a
  // full world reset, so no legacy horse is missing this key the way fertilityPotential() had to
  // work around above - if a future trait is ever added WITHOUT a reset, it needs its own
  // "*Potential()" stand-in before anything reads it, not a silent zero.
  'agility',
  // Added in slice 0014 §2.6/§2.7. Appended, like fertility and agility before them, so every
  // earlier trait's RNG draw sequence is untouched. Nothing reads these yet - they exist because
  // TRAITS is append-only and a genotype is written once at birth, so a heritable trait added after
  // a horse is born can never be given to that horse. See slice 0014 §2.6 before removing them.
  'foot_robustness',
  'joint_robustness',
  'ligament_robustness',
] as const;

export type TraitCode = (typeof TRAITS)[number];

/** Loci per trait. Each locus is two characters ('0'/'1') in the stored string, so each trait's
 * stored string is LOCI_PER_TRAIT * 2 characters long. */
export const LOCI_PER_TRAIT = 10;
const TRAIT_STRING_LENGTH = LOCI_PER_TRAIT * 2;

/** A trait's genetic potential: the count of '1' alleles across all its loci, 0-20. */
export function potential(genotype: Genotype, trait: TraitCode): number {
  const bits = getPolygenicString(genotype, trait, TRAIT_STRING_LENGTH);
  let count = 0;
  for (const ch of bits) if (ch === '1') count++;
  return count;
}

/**
 * Founder generation: every allele at every locus of every trait drawn independently at 50/50.
 * Not quality bands, not breed-weighted - that is the founding-stock generator's job (a later
 * slice), and this slice must not pre-empt it (§4.3).
 */
export function generateFounderPolygenic(rng: Rng): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trait of TRAITS) {
    let bits = '';
    for (let i = 0; i < TRAIT_STRING_LENGTH; i++) bits += rng.int(2) === 1 ? '1' : '0';
    out[trait] = bits;
  }
  return out;
}

/**
 * One parent's gamete contribution for every trait: at each of the trait's ten loci, one of the
 * parent's two alleles is drawn at 50/50. Returns one character per locus (length
 * LOCI_PER_TRAIT), not the stored two-per-locus shape - that assembly happens in inheritPolygenic.
 */
function polygenicGamete(genotype: Genotype, rng: Rng): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trait of TRAITS) {
    const bits = getPolygenicString(genotype, trait, TRAIT_STRING_LENGTH);
    let gamete = '';
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      const pair = [bits[i * 2], bits[i * 2 + 1]];
      gamete += rng.pick(pair);
    }
    out[trait] = gamete;
  }
  return out;
}

/** Combines both parents' gametes into the foal's full polygenic block, one trait at a time. */
export function inheritPolygenic(sire: Genotype, dam: Genotype, sireRng: Rng, damRng: Rng): Record<string, string> {
  const sireGamete = polygenicGamete(sire, sireRng);
  const damGamete = polygenicGamete(dam, damRng);

  const out: Record<string, string> = {};
  for (const trait of TRAITS) {
    let bits = '';
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      bits += sireGamete[trait][i] + damGamete[trait][i];
    }
    out[trait] = bits;
  }
  return out;
}
