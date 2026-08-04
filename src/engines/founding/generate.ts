// Pool + quality band + seed -> one founding candidate's genotype and age. Pure, no database
// access (CLAUDE.md §5.1). Slice 0005 §3.

import { makeRng, deriveSeed, type Rng } from '../../lib/rng';
import { LOCI, type Locus } from '../genetics/loci';
import { sortAllelePair, GENOTYPE_VERSION, type Genotype, type AllelePair } from '../genetics/genotype';
import { TRAITS, LOCI_PER_TRAIT, type TraitCode } from '../genetics/polygenic';
import { ROBUSTNESS_TRAITS, CONFORMATION_TRAITS } from '../conformation/traits';
import type { IdealVector } from '../showing/score';
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
  /** Slice 0019 Part A: the breed's ideal vector, already parsed by the caller from
   * breeds.ideal_vector. Undefined or null skips Part A entirely - true for seven of the eight
   * breeds today (no seeded ideal_vector), so that is the common path, not an edge case (§10). */
  breedIdealVector?: IdealVector | null;
  /** Slice 0019 Part B: ability traits with a nonzero weight in at least one *enabled* discipline
   * (src/db/disciplines.ts's getSpecializableAbilityTraits) - never all of ABILITY_TRAITS, since a
   * specialist in a trait no running discipline scores would be a dead gift (§4.2). Undefined or
   * empty skips Part B entirely. */
  eligibleAbilityTraits?: TraitCode[];
  /** Slice 0019 §4.1: config's founding_ability_specialist_potential - the ability specialist's
   * potential before its own +/-1 offset. Required whenever eligibleAbilityTraits is non-empty; a
   * missing value there throws rather than silently picking a number, the same reasoning
   * robustnessOneChance's own comment gives for not defaulting a live tunable. */
  abilitySpecialistPotential?: number;
}

export interface GeneratedCandidate {
  genotype: Genotype;
  ageGameDays: number;
  /** Slice 0019 §10: which trait (if any) was overwritten as this candidate's specialist on each
   * side - null when that side's Part was skipped (no ideal vector / no eligible ability trait).
   * Exists so determinism and "only one trait moved" are both directly testable rather than
   * inferred by re-deriving expected potentials from the genotype. */
  specialistTraits: {
    conformation: TraitCode | null;
    ability: TraitCode | null;
  };
}

const SPECIALIST_OFFSETS = [-1, 0, 1];

function clampPotential(value: number): number {
  return Math.max(0, Math.min(TRAIT_STRING_LENGTH, value));
}

/** Slice 0019 §7: the specialist's alleles land at random positions among the twenty, never
 * grouped into homozygous pairs - controlling zygosity here would hand a child the game's best
 * long-term breeding reward (0018 §1.1) in the founding grant itself. */
function specialistBits(rng: Rng, potentialValue: number): string {
  const positions = rng.shuffle(Array.from({ length: TRAIT_STRING_LENGTH }, (_, i) => i));
  const ones = new Set(positions.slice(0, potentialValue));
  let bits = '';
  for (let i = 0; i < TRAIT_STRING_LENGTH; i++) bits += ones.has(i) ? '1' : '0';
  return bits;
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

  // Slice 0019 Parts A/B: every founding horse arrives genuinely good at one thing. This runs
  // strictly after the loop above, from its own fresh streams (never-before-used labels), and
  // overwrites rather than resamples - per §7, the polygenic loop must draw exactly the same 20
  // bits per trait regardless of whether a specialist is chosen afterwards, or every trait after
  // it would shift and the same seed would stop producing the same horse.
  let conformationSpecialist: TraitCode | null = null;
  if (input.breedIdealVector) {
    const idealVector = input.breedIdealVector;
    const available = CONFORMATION_TRAITS.filter((t) => idealVector[t] !== undefined);
    if (available.length > 0) {
      const choiceRng = makeRng(deriveSeed(input.seed, 'specialist_choice_conformation'));
      conformationSpecialist = available[choiceRng.int(available.length)];
      const target = idealVector[conformationSpecialist]!.target;
      const offset = SPECIALIST_OFFSETS[choiceRng.int(SPECIALIST_OFFSETS.length)];
      const potentialValue = clampPotential(Math.round(target / 5) + offset);
      const allelesRng = makeRng(deriveSeed(input.seed, 'specialist_alleles_conformation'));
      polygenic[conformationSpecialist] = specialistBits(allelesRng, potentialValue);
    }
  }

  let abilitySpecialist: TraitCode | null = null;
  if (input.eligibleAbilityTraits && input.eligibleAbilityTraits.length > 0) {
    if (input.abilitySpecialistPotential === undefined) {
      throw new Error('generateCandidate: abilitySpecialistPotential is required when eligibleAbilityTraits is non-empty');
    }
    const choiceRng = makeRng(deriveSeed(input.seed, 'specialist_choice_ability'));
    abilitySpecialist = input.eligibleAbilityTraits[choiceRng.int(input.eligibleAbilityTraits.length)];
    const offset = SPECIALIST_OFFSETS[choiceRng.int(SPECIALIST_OFFSETS.length)];
    const potentialValue = clampPotential(input.abilitySpecialistPotential + offset);
    const allelesRng = makeRng(deriveSeed(input.seed, 'specialist_alleles_ability'));
    polygenic[abilitySpecialist] = specialistBits(allelesRng, potentialValue);
  }

  return {
    genotype: { v: GENOTYPE_VERSION, mendelian, polygenic },
    ageGameDays,
    specialistTraits: { conformation: conformationSpecialist, ability: abilitySpecialist },
  };
}
