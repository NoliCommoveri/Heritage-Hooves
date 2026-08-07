// The conformation type gene: one Mendelian locus per conformation trait, 25 alleles each, a rung
// every 4 points. Slice 0028 §2.1-§2.7. Pure, no database access (CLAUDE.md §5.1) - everything here
// is a function of a genotype/pair, a breed's ideal vector, and (where noted) a seeded Rng.
//
// Build order §5 step 2: "Everything imports it; nothing restates it." Every place in the codebase
// that deals a founding pair, reads a shown value, or moves an allele toward standard calls into
// this module rather than re-deriving the ladder.

import type { Rng } from '../../lib/rng';
import { TYPE_GENE_RUNG_BASE, TYPE_GENE_RUNG_STEP, TYPE_GENE_RUNG_COUNT } from '../genetics/loci';
import type { AllelePair } from '../genetics/genotype';
import { CONFORMATION_TRAITS } from './traits';
import type { TraitCode } from '../genetics/polygenic';
import type { IdealVector } from '../showing/score';

export const RUNG_BASE = TYPE_GENE_RUNG_BASE;
export const RUNG_STEP = TYPE_GENE_RUNG_STEP;
export const RUNG_COUNT = TYPE_GENE_RUNG_COUNT;
/** §2.2: an allele may sit at most 6 rungs (24 points) from its breed's own standard. THE
 * BREED-TYPE GUARANTEE - never widen this to tune quality (§2.2's own warning); quality is tuned by
 * the band deal below instead, which changes what a horse is dealt inside this reach. */
export const REACH_RUNGS = 6;

/** §2.5: alleles are dealt in buckets of this many rungs - bucket 0 is "the closest bucket" the
 * founding specialist upgrades into, and the label edges (migration 0180) line up with bucket
 * boundaries by construction. */
export const RUNGS_PER_BAND = 2;

/** slice 0028 §2.1: which Mendelian locus (loci.ts) carries which conformation trait's type gene. */
export const TYPE_LOCUS_CODE: Record<TraitCode, string> = {
  neck_length: 'NL',
  shoulder_angle: 'SA',
  back_length: 'BL',
  hock_set: 'HS',
  head_profile: 'HP',
} as Record<TraitCode, string>;

/** A band name ('low'/'mid'/'high' today) is just a string key into config's quality_bands - kept as
 * a named alias for readability, not a union, since the set of bands is config data
 * (founding_quality_band, consignment_quality_band, npc_show_barn_rank_plan's own band field), not a
 * fixed enum in code. */
export type QualityBand = string;

export interface QualityBandPairSpec {
  pairs: [number, number][];
  /** Migration 0178: the ability polygenic-one-chance for this band, split out from what used to be
   * one shared number (see generate.ts's own comment on abilityOneChance for why). */
  abilityOneChance: number;
}

/** §2.5's five pair-specs per band - bucket indices for the two alleles of one trait's pair. This is
 * the DEFAULT/seed shape (migration 0178 writes these numbers into config.values.quality_bands,
 * which is what dealForBand below actually reads at call time - a live tunable, not a structural
 * constant, so the operator can retune a band's word profile from /admin/config with no deploy).
 * Kept here too as the one place the numbers are stated in code, for the migration and its test to
 * read rather than re-type. Identical for all eight breeds by construction. */
export const DEFAULT_PAIR_SPECS: Record<'low' | 'mid' | 'high', [number, number][]> = {
  low: [
    [0, 0],
    [1, 1],
    [1, 2],
    [2, 2],
    [3, 3],
  ],
  mid: [
    [0, 0],
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  high: [
    [0, 0],
    [0, 0],
    [0, 0],
    [1, 1],
    [2, 2],
  ],
};

export function rungValue(rung: number): number {
  return RUNG_BASE + rung * RUNG_STEP;
}

export function alleleForRung(rung: number): string {
  return String(rungValue(rung));
}

export function rungForAllele(allele: string): number {
  return Math.round((Number(allele) - RUNG_BASE) / RUNG_STEP);
}

function clampRung(rung: number): number {
  return Math.max(0, Math.min(RUNG_COUNT - 1, rung));
}

/** §2.2's snap: the nearest rung to a raw 1-99 value. Used to re-seed breeds.ideal_vector onto the
 * ladder (migration 0177) and to read a breed's own target back off it at generation/expression
 * time - the same function both directions, so a target can never drift off-rung. */
export function nearestRung(rawValue: number): number {
  return clampRung(Math.round((rawValue - RUNG_BASE) / RUNG_STEP));
}

/** The bucket boundaries in rungs-of-distance, e.g. at RUNGS_PER_BAND=2/REACH_RUNGS=6:
 * [[0,1],[2,3],[4,5],[6,6]]. Bucket 0 is "the closest bucket" (§2.5/§2.6); the last bucket is
 * truncated by REACH_RUNGS, which is what makes the reach absolute regardless of band. */
export function alleleBuckets(): [number, number][] {
  const buckets: [number, number][] = [];
  for (let lo = 0; lo <= REACH_RUNGS; lo += RUNGS_PER_BAND) {
    buckets.push([lo, Math.min(REACH_RUNGS, lo + RUNGS_PER_BAND - 1)]);
  }
  return buckets;
}

/**
 * §2.3: a horse's displayed value for a trait is whichever of its two alleles is FURTHER from its
 * own breed standard - faults dominant, quality recessive. Returns the raw allele value (not yet
 * combined with the polygenic modifier or noise - see conformationGeneticValue, model.ts).
 *
 * A genuine tie (both alleles equidistant from target, on opposite sides) scores identically either
 * way under traitScoreFor's abs-distance formula, so which one is "shown" here is an arbitrary but
 * stable choice (the lower value) rather than something that needs a seeded draw - nothing
 * observable depends on which side of a symmetric pair gets named.
 */
export function shownValueFor(pair: AllelePair, target: number): number {
  const a = Number(pair[0]);
  const b = Number(pair[1]);
  const da = Math.abs(a - target);
  const db = Math.abs(b - target);
  if (da === db) return Math.min(a, b);
  return da > db ? a : b;
}

/** §2.8: what a TESTED horse's own value is scored from - the mean of both alleles rather than the
 * worse-of-pair a look alone tells you (shownValueFor above). Used only by an NPC stable's own
 * mate-selection/market-ranking (npcBreeding.ts's expressedFor) for the share of its stock treated
 * as panel-tested (config's npc_tested_share) - the same information a tested player has paid to
 * see, computed by the same underlying conformationGeneticValue (model.ts) with no second formula. */
export function meanValueFor(pair: AllelePair): number {
  return (Number(pair[0]) + Number(pair[1])) / 2;
}

function rungAtBucketDistance(targetRung: number, bucketIdx: number, rng: Rng): number {
  const buckets = alleleBuckets();
  const [lo, hi] = buckets[Math.min(bucketIdx, buckets.length - 1)];
  const dist = lo + rng.int(hi - lo + 1);
  if (dist === 0) return targetRung;
  const up = targetRung + dist;
  const down = targetRung - dist;
  const okUp = up < RUNG_COUNT;
  const okDown = down >= 0;
  if (okUp && okDown) return rng.next() < 0.5 ? up : down;
  if (okUp) return up;
  if (okDown) return down;
  return targetRung; // reach wider than the ladder itself - cannot happen at RUNG_COUNT=25/REACH_RUNGS=6, kept as a safe fallback
}

export type TypeGenePairs = Partial<Record<TraitCode, AllelePair>>;

/**
 * §2.5: deals a founding horse's five type-gene pairs from a band's fixed profile of pair-specs
 * (`pairSpecs` - read by the caller from live config.values.quality_bands[band].pairs, or
 * DEFAULT_PAIR_SPECS for a caller with no config handy, e.g. a test), shuffled across the five
 * traits so every founding horse has the same SHAPE (word profile) and only which trait is which
 * varies. A trait absent from `ideal` (the breed has no target for it, or no ideal vector at all) is
 * left out of the result entirely - the caller leaves that locus unset in the genotype, and the
 * missing-locus rule (genotype.ts's getMendelianPair) reads it as homozygous-wildType (the middle
 * rung), exactly the "still generates, not judged" rule §7 test 11 asks for.
 *
 * Where a breed's target sits near an end of the 1-99 scale, rungAtBucketDistance forces the draw
 * inward rather than clamping onto the target - clamping would quietly manufacture correct alleles
 * the deal never granted (§2.5's own "SIDE" warning).
 */
export function dealForBand(pairSpecs: [number, number][], ideal: IdealVector | null, rng: Rng): TypeGenePairs {
  const out: TypeGenePairs = {};
  if (!ideal) return out;

  const specs = rng.shuffle(pairSpecs.map((s) => [...s] as [number, number]));
  CONFORMATION_TRAITS.forEach((trait, i) => {
    const idealTrait = ideal[trait];
    if (!idealTrait) return;
    const targetRung = nearestRung(idealTrait.target);
    const spec = specs[i];
    const a = rungAtBucketDistance(targetRung, spec[0], rng);
    const b = rungAtBucketDistance(targetRung, spec[1], rng);
    const pair: [number, number] = a <= b ? [a, b] : [b, a];
    out[trait] = [alleleForRung(pair[0]), alleleForRung(pair[1])];
  });
  return out;
}

/**
 * §2.6: the founding specialist, reframed as an UPGRADE of an allele the deal already granted
 * rather than a gift out of nowhere - the quota is the whole budget. `assignedTrait` is the
 * round-robin slot (mintIndex % 5, chosen by the caller across a founding batch - §2.6's own
 * "must be assigned round-robin, not drawn per horse"). Mutates `pairs` in place and returns the
 * trait upgraded, or null if that trait has no target in `ideal` (skipped entirely, per §2.6: "if
 * the deal left nothing... the horse simply has no specialist" - here read as "no target to upgrade
 * toward" since a trait absent from `ideal` was never dealt a pair in the first place).
 *
 * Coverage is mandatory (§2.6: round-robin must not silently skip a trait): if neither of the two
 * dealt alleles for the assigned trait already sits in the closest bucket, the closer of the two is
 * upgraded anyway. This is what takes barn dead-ends to 0% at the 4-point ladder's narrower reach.
 */
export function applySpecialistUpgrade(pairs: TypeGenePairs, ideal: IdealVector | null, assignedTrait: TraitCode): TraitCode | null {
  const idealTrait = ideal?.[assignedTrait];
  const pair = pairs[assignedTrait];
  if (!idealTrait || !pair) return null;

  const targetRung = nearestRung(idealTrait.target);
  const rungs: [number, number] = [rungForAllele(pair[0]), rungForAllele(pair[1])];
  const distances: [number, number] = [Math.abs(rungs[0] - targetRung), Math.abs(rungs[1] - targetRung)];
  const idx = distances[0] <= distances[1] ? 0 : 1;

  const upgraded: [number, number] = [...rungs];
  upgraded[idx] = targetRung;
  upgraded.sort((x, y) => x - y);
  pairs[assignedTrait] = [alleleForRung(upgraded[0]), alleleForRung(upgraded[1])];
  return assignedTrait;
}

interface TraitDistance {
  trait: TraitCode;
  distanceRungs: number;
}

function traitDistances(pairs: TypeGenePairs, ideal: IdealVector): TraitDistance[] {
  const out: TraitDistance[] = [];
  for (const trait of CONFORMATION_TRAITS) {
    const idealTrait = ideal[trait];
    const pair = pairs[trait];
    if (!idealTrait || !pair) continue;
    const targetRung = nearestRung(idealTrait.target);
    // shownValueFor works in raw allele VALUES (e.g. 34), not rung INDICES (e.g. 8) - both the
    // target passed in and the value it returns have to be converted at this boundary, or a
    // homozygous on-target pair reads as wildly off (caught by test/conformation/typeGene.test.ts).
    const shownValue = shownValueFor(pair, rungValue(targetRung));
    const shownRung = rungForAllele(String(shownValue));
    out.push({ trait, distanceRungs: Math.abs(shownRung - targetRung) });
  }
  return out;
}

/** Moves whichever allele(s) of a pair sit furthest from the target one rung closer - both, on a
 * homozygote (the "costs two alleles on a homozygote" case §2.7 names as the honest price of the
 * shown-value guarantee), otherwise just the worse-placed one. Never overshoots: a pair already on
 * target for both copies is left untouched. */
function moveOneRungTowardTarget(rungs: [number, number], targetRung: number): [number, number] {
  const distances: [number, number] = [Math.abs(rungs[0] - targetRung), Math.abs(rungs[1] - targetRung)];
  const maxDist = Math.max(...distances);
  if (maxDist === 0) return rungs;
  const moved: [number, number] = [
    distances[0] === maxDist ? rungs[0] + (rungs[0] < targetRung ? 1 : -1) : rungs[0],
    distances[1] === maxDist ? rungs[1] + (rungs[1] < targetRung ? 1 : -1) : rungs[1],
  ];
  return moved.sort((a, b) => a - b) as [number, number];
}

function moveTraitOneRung(pairs: TypeGenePairs, ideal: IdealVector, trait: TraitCode): void {
  const idealTrait = ideal[trait];
  const pair = pairs[trait];
  if (!idealTrait || !pair) return;
  const targetRung = nearestRung(idealTrait.target);
  const rungs: [number, number] = [rungForAllele(pair[0]), rungForAllele(pair[1])];
  const moved = moveOneRungTowardTarget(rungs, targetRung);
  pairs[trait] = [alleleForRung(moved[0]), alleleForRung(moved[1])];
}

/**
 * The generational ratchet (operator decision, 2026-08-07, replacing §2.7's original "prenatal care
 * moves the worst trait 2 rungs" mechanic): every BRED foal (never founding stock, which keeps
 * §2.5's dealt band unchanged) has its single worst-placed gene - the conformation trait furthest
 * from its own breed's standard - moved one rung closer, on top of whatever ordinary Mendelian
 * inheritance produced. Ties (more than one trait equally worst) are broken by the foal's own seeded
 * rng, never Math.random() (CLAUDE.md §5.2). A foal already on target for every trait is left alone.
 *
 * This is the BASELINE, applied when mare prenatal care was NOT bought on the covering - see
 * applyCareRatchet below for the paid alternative, which replaces this call rather than stacking on
 * top of it.
 */
export function applyBaselineRatchet(pairs: TypeGenePairs, ideal: IdealVector, rng: Rng): TraitCode | null {
  const distances = traitDistances(pairs, ideal).filter((d) => d.distanceRungs > 0);
  if (distances.length === 0) return null;
  const maxDist = Math.max(...distances.map((d) => d.distanceRungs));
  const worst = distances.filter((d) => d.distanceRungs === maxDist);
  const chosen = worst[rng.int(worst.length)].trait;
  moveTraitOneRung(pairs, ideal, chosen);
  return chosen;
}

/**
 * Mare prenatal care's effect (operator decision, 2026-08-07, replacing §2.7's original wording):
 * REPLACES the baseline one-gene ratchet above with three rungs of improvement spread across three
 * DISTINCT genes - the three traits currently furthest from standard, ranked once up front (not
 * re-evaluated after each move, so the same trait is never touched twice) and ties broken by the
 * same seeded rng. Fewer than three traits still off-target simply get fewer moves - never revisits
 * a trait that has already reached its standard.
 *
 * Committed on the covering before the foal exists (§2.7's "the mechanic picks the trait; the
 * player never chooses" - unchanged by this replacement, only how many genes and how far moved).
 */
export function applyCareRatchet(pairs: TypeGenePairs, ideal: IdealVector, rng: Rng): TraitCode[] {
  const distances = traitDistances(pairs, ideal).filter((d) => d.distanceRungs > 0);
  if (distances.length === 0) return [];
  const shuffled = rng.shuffle(distances);
  shuffled.sort((a, b) => b.distanceRungs - a.distanceRungs); // stable sort: ties keep the shuffle's random order
  const chosen = shuffled.slice(0, 3);
  for (const { trait } of chosen) moveTraitOneRung(pairs, ideal, trait);
  return chosen.map((c) => c.trait);
}
