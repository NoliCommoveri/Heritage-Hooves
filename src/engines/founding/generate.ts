// Pool + quality band + seed -> one founding candidate's genotype and age. Pure, no database
// access (CLAUDE.md §5.1). Slice 0005 §3.

import { makeRng, deriveSeed, type Rng } from '../../lib/rng';
import { LOCI, type Locus } from '../genetics/loci';
import { sortAllelePair, GENOTYPE_VERSION, type Genotype, type AllelePair } from '../genetics/genotype';
import { TRAITS, LOCI_PER_TRAIT } from '../genetics/polygenic';
import { ROBUSTNESS_TRAITS } from '../conformation/traits';
import type { AllelePool } from './pool';

const TRAIT_STRING_LENGTH = LOCI_PER_TRAIT * 2;

/**
 * Draws one allele at population frequency. Walks locus.alleles (the locus's own canonical order)
 * rather than Object.keys(freqs), so the draw does not depend on the order a pool's JSON object
 * happened to be written in - only on LOCI's own fixed order, per CLAUDE.md §11's slice-0002 entry.
 */
function drawAllele(locus: Locus, freqs: Record<string, number>, rng: Rng): string {
  const r = rng.next();
  let cumulative = 0;
  for (const allele of locus.alleles) {
    cumulative += freqs[allele] ?? 0;
    if (r < cumulative) return allele;
  }
  // Floating-point edge case: r landed on or past the running total (e.g. frequencies summing to
  // 0.9999999...). Fall back to the last allele in canonical order with a nonzero frequency.
  for (let i = locus.alleles.length - 1; i >= 0; i--) {
    if ((freqs[locus.alleles[i]] ?? 0) > 0) return locus.alleles[i];
  }
  throw new Error(`no alleles with nonzero frequency at locus ${locus.code}`);
}

/** One lethal condition's (locus, mutant allele) pair - slice 0010 §4.3's clamp. This function is
 * pure and must not know what GBED is: the caller derives this list from the conditions table's
 * severity_class = 'lethal' rows. */
export interface LethalTrigger {
  locus: string;
  mutant: string;
}

export interface GenerateCandidateInput {
  pool: AllelePool;
  /** The quality band's number - the chance any given polygenic allele is a '1'. Slice 0005 §4. */
  polygenicOneChance: number;
  /** Slice 0014 §2.8: the fixed chance for ROBUSTNESS_TRAITS, regardless of quality band - so a
   * top-band founding horse is not automatically sound as well as beautiful. Required, not optional
   * with a default: an optional field would silently fall back to the band the day a second caller
   * is added, which is exactly the failure this exists to prevent. */
  robustnessOneChance: number;
  ageMinGameDays: number;
  ageMaxGameDays: number;
  /** The candidate's own rng_seed (import_candidates.rng_seed), minted by the caller. */
  seed: number;
  /** Slice 0010 §4.3: a founding or import candidate must never be generated homozygous-affected
   * for a lethal condition, since such a horse would have died as a foal and cannot exist as an
   * adult in a batch. Defaults to none, for callers that predate this (there are none left, but the
   * signature stays optional so a future non-founding caller of this same function isn't forced to
   * supply an empty array). */
  lethalTriggers?: LethalTrigger[];
}

export interface GeneratedCandidate {
  genotype: Genotype;
  ageGameDays: number;
}

/**
 * Two independent draws per locus at population frequency (Hardy-Weinberg) - a founding horse is a
 * random sample from a gene pool, not a designed animal (slice 0005 §3.2). Every allele of every
 * polygenic trait is drawn independently at polygenicOneChance (§3.3). Age is uniform in the given
 * range (§3.4).
 */
export function generateCandidate(input: GenerateCandidateInput): GeneratedCandidate {
  const mendelianRng = makeRng(deriveSeed(input.seed, 'pool_mendelian'));
  const mendelian: Record<string, AllelePair> = {};
  for (const locus of LOCI) {
    const freqs = input.pool[locus.code];
    if (!freqs) throw new Error(`founding pool missing locus ${locus.code}`);
    const a1 = drawAllele(locus, freqs, mendelianRng);
    const a2 = drawAllele(locus, freqs, mendelianRng);
    mendelian[locus.code] = sortAllelePair(locus.code, a1, a2);
  }

  // The lethal clamp (slice 0010 §4.3): after drawing, replace one mutant allele with the wild
  // type wherever a lethal condition would otherwise read homozygous-affected. Deterministic - it
  // reads only the pair just drawn above - draws no extra RNG, and does not perturb any downstream
  // stream (a re-draw would have, since it would make the number of draws depend on their outcome).
  // Biases carrier frequency upward by a small amount; that is the trade this makes on purpose.
  for (const lethal of input.lethalTriggers ?? []) {
    const pair = mendelian[lethal.locus];
    if (!pair || pair[0] !== lethal.mutant || pair[1] !== lethal.mutant) continue;
    const locus = LOCI.find((l) => l.code === lethal.locus);
    if (!locus) throw new Error(`generateCandidate: unknown lethal locus ${lethal.locus}`);
    mendelian[lethal.locus] = sortAllelePair(lethal.locus, locus.wildType, lethal.mutant);
  }

  // pool_polygenic is deliberately not founder_polygenic (slice 0005 §8) - that label belongs to
  // the admin form's flat 50/50 draw (polygenic.ts's generateFounderPolygenic); this one is
  // band-weighted, and the two must never share a label or a horse's genetics stop being
  // reconstructible from its seed alone.
  const polygenicRng = makeRng(deriveSeed(input.seed, 'pool_polygenic'));
  const polygenic: Record<string, string> = {};
  for (const trait of TRAITS) {
    const chance = ROBUSTNESS_TRAITS.includes(trait) ? input.robustnessOneChance : input.polygenicOneChance;
    let bits = '';
    for (let i = 0; i < TRAIT_STRING_LENGTH; i++) {
      bits += polygenicRng.next() < chance ? '1' : '0';
    }
    polygenic[trait] = bits;
  }

  const ageRng = makeRng(deriveSeed(input.seed, 'founding_age'));
  const ageSpan = input.ageMaxGameDays - input.ageMinGameDays;
  const ageGameDays = input.ageMinGameDays + (ageSpan > 0 ? ageRng.int(ageSpan + 1) : 0);

  return { genotype: { v: GENOTYPE_VERSION, mendelian, polygenic }, ageGameDays };
}
