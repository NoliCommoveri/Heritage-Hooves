#!/usr/bin/env node
//
// BREEDING LAB — a bench for the proposed conformation genetics, driven from the command line.
// Written 2026-08-06 alongside docs/fixes/conformation-breed-type.md, so the operator can run in an
// afternoon the experiments that would take months of real play: mint a founding batch, look at
// what a player would see AND the numbers underneath it, pick two horses, roll five foals, then
// breed those foals onward.
//
// ===========================================================================================
//  THIS IS NOT THE GAME. It is a simulation of a system that has not been built.
//  Same standing rules as population-sim.mjs / stable-timeline.mjs / training-effect.mjs /
//  conformation-architecture.mjs: analysis tool, not game code, not a vitest test; own PRNG, own
//  copy of the game's constants, and THAT COPY CAN DRIFT. Every constant below names its source.
//  Nothing here reads or writes the real database.
// ===========================================================================================
//
// THERE IS NO SEX IN THIS TOOL, on purpose (operator's instruction, 2026-08-06). Every horse can
// be crossed with every other horse. This is a bench for testing which PAIRINGS of traits produce
// what, not a simulation of a breeding season — so mares, stallions, heat cycles, gestation,
// conception rolls and one-foal-a-year are all deliberately absent.
//
// QUICK START
//   node docs/analysis/breeding-lab.mjs new --breed AR --horses 6
//   node docs/analysis/breeding-lab.mjs show 1 2 3
//   node docs/analysis/breeding-lab.mjs predict 1 to 4
//   node docs/analysis/breeding-lab.mjs breed 1 to 4 --foals 5
//   node docs/analysis/breeding-lab.mjs breed 7 to 9            # a foal onto a foal
//   node docs/analysis/breeding-lab.mjs summary
//
// EVERY COMMAND
//   new       --breed <code> --horses <n> [--band low|mid|high] [--engine proposed|today]
//             [--seed <n>]            Start a fresh population. Wipes the state file.
//   list                              One line per horse.
//   show      <id> [<id>...]          Full card: what a player sees, then what is underneath.
//   predict   <a> to <b>              The exact foal distribution for a pairing, before rolling.
//   breed     <a> to <b> [--foals n]  Roll foals. They join the population with new ids.
//   pedigree  <id>                    Ancestry and inbreeding coefficient.
//   summary                           Population-wide: traits on target, by generation.
//   sweep     [--breed all] [--n n]   Mint thousands of founders and characterise them. No state.
//   programme [--gens 8] [--runs 40]  Run a breeding programme to generation N and watch it climb.
//   reset                             Delete the state file.
//
//   --state <path>   Use a different state file, so two labs can run side by side — e.g. one at
//                    --engine proposed and one at --engine today, for a like-for-like comparison.
//
// TUNING DIALS (added 2026-08-07 — the "make gen 1 slightly worse" question). Any of these can go
// on `new`, `sweep` or `programme`; `new` stores them on the lab so later commands replay them.
//
//   --reach <points>      how far from the breed standard an allele may sit. 24 by default.
//                         THIS AND ONLY THIS IS THE BREED-TYPE GUARANTEE. Widening it is what
//                         would let an Arabian be born with a Roman nose. Leave it alone unless
//                         that is the thing you mean to change.
//   --rung-step <n>       spacing of the allele ladder. 8 by default (13 alleles); 4 gives 25.
//   --concentration <x>   'peak' mode: relative weight on the target rung. Lower = worse gen 1.
//   --founding-mode ring  the operator's proposal: punch a hole around the target so founders are
//                         close to right but almost never exactly right.
//   --target-chance <x>   'ring' mode: the real probability an allele IS the target. The escape
//                         hatch that keeps the correct allele in existence at all.
//   --hole <rungs>        'ring' mode: rungs either side of target also excluded. 0 = target only.
//   --specialist <mode>   fixed | carrier | none — how generous slice 0019's founding gift is.
//   --drift <p>           chance an inherited allele steps one rung. Buys new alleles from nothing,
//                         at the cost of the exact foal prediction. 0 = off.
//   --inbreeding <x>      COI depression factor, 1.0 live. 0 switches it off, so a line can be
//                         judged on its genes without realization's pull toward 50 on top.
//   --noise-sd, --modifier-step    the two adjusters that sit on top of the genes.
//
// WHAT IS MODELLED
//   Conformation in full (the thing under test), ability traits compactly (they are inherited and
//   they decide discipline classes), environmental noise, realization by age, and inbreeding
//   depression through a real pedigree-derived COI.
//
// WHAT IS NOT
//   Colour, disease, fertility, robustness, care, training, tack, incidents, the market, and the
//   whole of the show calendar. Conformation scores below are the horse's own quality against its
//   breed's standard with a balanced judge and NO show noise — real placings add Normal(0, 5) on
//   top, which is worth remembering before treating a 2-point gap as real.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ===========================================================================================
// CONSTANTS — each copied from the live source named beside it
// ===========================================================================================

// migrations 0035 / 0107 / 0111 — all eight breeds, all five conformation traits.
const BREEDS = {
  QH:  { name: 'Quarter Horse',    ideal: { neck_length: [55, 1.0], shoulder_angle: [70, 1.2], back_length: [35, 1.1], hock_set: [50, 0.9], head_profile: [35, 0.8] },
         bias: { speed: 0.06, stamina: -0.06, jump_scope: -0.06, trainability: 0.0, agility: 0.06 } },
  AR:  { name: 'Arabian',          ideal: { neck_length: [75, 1.4], shoulder_angle: [72, 1.1], back_length: [28, 1.2], hock_set: [48, 0.8], head_profile: [8, 1.3] },
         bias: { speed: -0.02, stamina: 0.06, jump_scope: -0.06, trainability: 0.02, agility: 0.0 } },
  TB:  { name: 'Thoroughbred',     ideal: { neck_length: [65, 1.0], shoulder_angle: [80, 1.5], back_length: [50, 0.9], hock_set: [55, 1.0], head_profile: [48, 0.7] },
         bias: { speed: 0.06, stamina: 0.04, jump_scope: 0.02, trainability: -0.06, agility: -0.06 } },
  GW:  { name: 'German Warmblood', ideal: { neck_length: [72, 1.2], shoulder_angle: [78, 1.3], back_length: [52, 0.9], hock_set: [62, 1.2], head_profile: [50, 0.8] },
         bias: { speed: -0.06, stamina: -0.06, jump_scope: 0.06, trainability: 0.05, agility: 0.01 } },
  FR:  { name: 'Friesian',         ideal: { neck_length: [82, 1.5], shoulder_angle: [68, 1.0], back_length: [40, 1.0], hock_set: [62, 1.1], head_profile: [70, 1.2] },
         bias: { speed: -0.06, stamina: -0.02, jump_scope: 0.0, trainability: 0.06, agility: 0.02 } },
  PF:  { name: 'Paso Fino',        ideal: { neck_length: [68, 1.2], shoulder_angle: [60, 1.0], back_length: [30, 1.3], hock_set: [45, 1.1], head_profile: [62, 0.9] },
         bias: { speed: 0.0, stamina: -0.04, jump_scope: -0.06, trainability: 0.04, agility: 0.06 } },
  IC:  { name: 'Icelandic',        ideal: { neck_length: [40, 0.9], shoulder_angle: [35, 1.2], back_length: [42, 1.0], hock_set: [36, 1.1], head_profile: [57, 0.6] },
         bias: { speed: -0.06, stamina: 0.06, jump_scope: -0.06, trainability: 0.02, agility: 0.04 } },
  NOK: { name: 'Nokota',           ideal: { neck_length: [40, 1.0], shoulder_angle: [45, 0.9], back_length: [58, 1.1], hock_set: [36, 1.0], head_profile: [66, 0.8] },
         bias: { speed: 0.0, stamina: 0.04, jump_scope: -0.04, trainability: -0.02, agility: 0.02 } },
};

// migrations 0029 / 0110 — display metadata, exactly as a player reads it.
const CONF = {
  neck_length:    { name: 'Neck length',    low: 'short',    high: 'long' },
  shoulder_angle: { name: 'Shoulder angle', low: 'upright',  high: 'sloping' },
  back_length:    { name: 'Back length',    low: 'short',    high: 'long' },
  hock_set:       { name: 'Hock set',       low: 'straight', high: 'angled' },
  head_profile:   { name: 'Head profile',   low: 'dished',   high: 'Roman' },
};
const CONF_TRAITS = Object.keys(CONF);
const ABILITY = { stamina: 'Stamina', jump_scope: 'Jump scope', speed: 'Speed', trainability: 'Trainability', agility: 'Agility' };
const ABILITY_TRAITS = Object.keys(ABILITY);

const FALLOFF = 2.0;                 // show_ideal_falloff,                       migration 0041
const SHOW_NOISE_SD = 5;             // show_noise_sd,                            migration 0041
const LOCI_PER_TRAIT = 10;           // polygenic.ts — 20 alleles per trait
const ALLELE_COUNT = LOCI_PER_TRAIT * 2;
const ANCHOR_BI = 50;                // anchorFor(), bidirectional
const MATURITY_YEARS = 5;            // conformation_maturity_years,              migration 0031
const REALIZATION_AT_BIRTH = 0.55;   // conformation_realization_at_birth,        migration 0031
const INBREEDING_FACTOR = 1.0;       // inbreeding_depression_factor,             migration 0031
                                     // ^ the live default. --inbreeding overrides it; 0 switches
                                     //   COI depression off entirely, which is how you look at a
                                     //   line's GENES without realization's pull toward 50 sitting
                                     //   on top of them. It changes nothing about founding stock
                                     //   (COI is 0 there) and everything from generation 2 on.
const LABEL_MIN = { outstanding: 90, good: 75, acceptable: 55, weak: 30 };  // migration 0135
const ABILITY_SPECIALIST_POTENTIAL = 15;  // founding_ability_specialist_potential, migration 0102
const SPECIALIST_OFFSETS = [-1, 0, 1];    // generate.ts, slice 0019 §7
// Slice 0019 §4.2 — jump_scope is the one ability trait excluded from the specialist draw.
const SPECIALIZABLE = ABILITY_TRAITS.filter((t) => t !== 'jump_scope');
const FOUNDING_AGE_MIN_Y = 4, FOUNDING_AGE_MAX_Y = 8;   // founding_age_*_game_days / 360, migration 0025

// --- TODAY'S engine ---------------------------------------------------------
const TODAY = {
  band: { low: 0.42, mid: 0.50, high: 0.58 },   // quality_bands,          migration 0025
  alleleStep: 5,                                // geneticValue()
  noiseSd: 6,                                   // conformation_noise_sd,  migration 0031
};

// --- PROPOSED engine — docs/fixes/conformation-breed-type.md §4 -------------
// Not in the game. These are the numbers under test; move them here and re-run.
//
// Everything under "the founding-quality dials" was added 2026-08-07, after the operator asked
// how to make gen 1 slightly worse WITHOUT weakening the guarantee that an Arabian cannot be
// minted with a Roman nose. Those are two different dials and the whole point of this block is
// that they are now separate:
//
//   REACH decides breed type.   An allele may never sit more than `reachPoints` from its breed's
//                               own standard. That cap, and nothing else, is what makes a
//                               90-headed Arabian impossible. Do not widen it to tune quality.
//   SHAPE decides quality.      How the pool is distributed INSIDE that reach. Slacken it all the
//                               way to flat and breed type is still perfectly intact.
//
// Defaults reproduce the fix document exactly. Change them on the command line, not here.
const PROP = {
  rungBase: 2,                               // §4.2 — the allele ladder starts at 2
  rungStep: 8,                               // §4.2 — a rung every 8 points: 2, 10, 18, ... 98
  reachPoints: 24,                           // §4.4 — 3 rungs at step 8. THE BREED-TYPE GUARANTEE.
  modifierStep: 0.75,                        // §4.3 — the demoted twenty-allele block
  noiseSd: 2,                                // §7.1 — conformation_noise_sd 6 -> 2
  abilityOneChance: { low: 0.42, mid: 0.50, high: 0.58 },   // §9/0177 — TODAY'S values, unchanged
  concentration: { low: 0.35, mid: 0.55, high: 0.75 },      // §4.4 — P(allele is the target rung)

  // --- the founding-quality dials -------------------------------------------------------------
  // 'peak' is the fix document's pool: most mass ON the breed target, falling away from there.
  // 'ring' is the operator's proposal (2026-08-07): a HOLE around the target, so a founding horse
  // is close to right but almost never exactly right, with a small escape chance so the target
  // allele still exists in the game at all. That escape is not optional — see cmdSweep's
  // "barn is missing the allele" column and §14 of the fix document.
  foundingMode: 'peak',      // 'peak' | 'ring'
  ringTargetChance: 0.06,    // ring only: P(an allele IS exactly the target rung)
  ringHoleRungs: 1,          // ring only: rungs either side of target also excluded (0 = target only)

  // Proposal 1 (2026-08-07): an inherited allele may move one rung. Solves "the target allele is
  // not in the game" without a ring escape, at the cost of the exact Punnett square. 0 = off.
  driftChance: 0,
  driftClamped: true,        // keep drifted alleles inside reachPoints of the breed standard

  inbreedingFactor: INBREEDING_FACTOR,   // --inbreeding; 0 = COI depression off

  // §7.3's reframed slice 0019 conformation specialist.
  //   'fixed'   one trait homozygous at the breed target — the fix document as written
  //   'carrier' one target allele, the other drawn from the pool — good but not finished
  //   'none'    no conformation specialist at all
  specialist: 'fixed',
};

// The ladder is derived from base/step so `--rung-step 4` is a real experiment rather than an
// edit in three places. Step 8 -> 13 alleles (2..98); step 4 -> 25 alleles (2..98).
const rungCount = () => Math.floor((98 - PROP.rungBase) / PROP.rungStep) + 1;
const reachRungs = () => Math.max(1, Math.round(PROP.reachPoints / PROP.rungStep));

// §4.4's fallaway, restated as a function of DISTANCE IN POINTS rather than rungs, so the shape
// survives a change of step. The anchors are the fix document's own numbers — at step 8 this
// reproduces [0.45, 0.18, 0.06] exactly; at step 4 it interpolates between them.
const FALLAWAY_ANCHORS = [[0, 1.0], [8, 0.45], [16, 0.18], [24, 0.06]];
function fallawayAt(points) {
  if (points >= PROP.reachPoints + 1e-9) return 0;
  const a = FALLAWAY_ANCHORS;
  if (points >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 1; i < a.length; i++) {
    if (points <= a[i][0]) {
      const t = (points - a[i - 1][0]) / (a[i][0] - a[i - 1][0]);
      return a[i - 1][1] + t * (a[i][1] - a[i - 1][1]);
    }
  }
  return 0;
}

// NOTE, and it is a real open question the fix document does not settle: rollEnvironmentalNoise
// draws ONE Normal(0, sd) per trait for ALL fourteen traits from a single conformation_noise_sd.
// So dropping that number 6 -> 2 quietly shrinks ABILITY noise too — and ability is what decides
// discipline classes, the only place different breeds meet. This tool models that faithfully
// (one SD, every trait) so the effect is visible rather than hidden. If it turns out ability wants
// its own SD, that is a second config key and a change to drawNoise.

// ===========================================================================================
// PRNG — seeded per horse, per purpose, mirroring the game's deriveSeed discipline
// ===========================================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deriveSeed(seed, label) {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) h = (Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0);
  return h >>> 0;
}
function streamFor(seed, label) {
  const r = mulberry32(deriveSeed(seed, label));
  r.normal = (sd) => {
    const u = Math.max(1e-12, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
  };
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}

// ===========================================================================================
// The proposed type gene — docs/fixes/conformation-breed-type.md §4.2/§4.4
// ===========================================================================================
const rungValue = (r) => PROP.rungBase + r * PROP.rungStep;
const nearestRung = (v) => Math.max(0, Math.min(rungCount() - 1, Math.round((v - PROP.rungBase) / PROP.rungStep)));

/** §4.6: every breed target is re-seeded onto a rung. Each moves by at most 4 points. */
function snappedTarget(breedCode, trait) {
  return rungValue(nearestRung(BREEDS[breedCode].ideal[trait][0]));
}
function targetFor(state, breedCode, trait) {
  return state.engine === 'proposed' ? snappedTarget(breedCode, trait) : BREEDS[breedCode].ideal[trait][0];
}

/**
 * §4.4: derived from the breed's own target and the band — never hand-written per breed.
 *
 * Two shapes. Both obey `reachPoints` absolutely, which is why breed type survives either one:
 *
 *   'peak'  the fix document. Mass piles onto the target rung; `concentration` says how much.
 *   'ring'  the operator's 2026-08-07 proposal. A hole is punched around the target, so a
 *           founding horse arrives close to right and almost never exactly right — except for a
 *           small `ringTargetChance` escape, which is what keeps the correct allele in existence.
 */
function poolForTarget(targetRung, band) {
  const n = rungCount();
  const w = new Array(n).fill(0);
  const ring = PROP.foundingMode === 'ring';

  for (let r = 0; r < n; r++) {
    const d = Math.abs(r - targetRung) * PROP.rungStep;
    if (r === targetRung) continue;                                    // handled below, both modes
    if (ring && Math.abs(r - targetRung) <= PROP.ringHoleRungs) continue;   // the hole
    w[r] = fallawayAt(d);
  }

  const off = w.reduce((a, b) => a + b, 0);
  if (off <= 0) return w.map((_, r) => (r === targetRung ? 1 : 0));    // reach smaller than the hole

  if (ring) {
    // `ringTargetChance` is a REAL probability, not a relative weight — it is the number the
    // dead-allele question turns on, so it must mean what it says.
    const scale = (1 - PROP.ringTargetChance) / off;
    const out = w.map((x) => x * scale);
    out[targetRung] = PROP.ringTargetChance;
    return out;
  }

  // 'peak' keeps §4.4's own arithmetic verbatim, renormalise and all, so the baseline this bench
  // reports is byte-for-byte the one the fix document measured. Note that `concentration` is a
  // relative weight here, not a probability: 0.35 yields P(on target) = 0.28.
  w[targetRung] = PROP.concentration[band];
  for (let r = 0; r < n; r++) if (r !== targetRung) w[r] *= (1 - PROP.concentration[band]);
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}
function drawFrom(pool, rng) {
  let r = rng(), c = 0;
  for (let i = 0; i < pool.length; i++) { c += pool[i]; if (r < c) return i; }
  return pool.length - 1;
}

// ===========================================================================================
// Genotypes
// ===========================================================================================
const countOnes = (bits) => { let n = 0; for (const b of bits) if (b === 1) n++; return n; };

function drawBlock(rng, chance) {
  const bits = [];
  for (let i = 0; i < ALLELE_COUNT; i++) bits.push(rng() < chance ? 1 : 0);
  return bits;
}
/** specialistBits(): `potential` ones at random positions among the twenty (slice 0019 §7). */
function specialistBits(rng, potential) {
  const pos = [...Array(ALLELE_COUNT).keys()];
  for (let i = pos.length - 1; i > 0; i--) { const j = rng.int(i + 1); [pos[i], pos[j]] = [pos[j], pos[i]]; }
  const ones = new Set(pos.slice(0, Math.max(0, Math.min(ALLELE_COUNT, potential))));
  return pos.map((_, i) => (ones.has(i) ? 1 : 0));
}

function mintFounder(state, seed) {
  const breed = BREEDS[state.breed];
  const band = state.band;
  const g = { type: {}, poly: {} };

  const polyRng = streamFor(seed, 'pool_polygenic');
  const abilityChance = state.engine === 'proposed' ? PROP.abilityOneChance[band] : TODAY.band[band];
  for (const t of CONF_TRAITS) {
    g.poly[t] = drawBlock(polyRng, state.engine === 'proposed' ? 0.5 : TODAY.band[band]);
  }
  for (const t of ABILITY_TRAITS) {
    const chance = Math.max(0.05, Math.min(0.95, abilityChance + (breed.bias[t] ?? 0)));
    g.poly[t] = drawBlock(polyRng, chance);
  }

  if (state.engine === 'proposed') {
    const typeRng = streamFor(seed, 'pool_type');
    for (const t of CONF_TRAITS) {
      const pool = poolForTarget(nearestRung(breed.ideal[t][0]), band);
      g.type[t] = [drawFrom(pool, typeRng), drawFrom(pool, typeRng)].sort((a, b) => a - b);
    }
  }

  // Slice 0019 Part A, reframed per §7.3: one conformation trait is set homozygous at the breed's
  // target rung, so a founding horse is not merely good at one thing but BREEDS ON for it.
  const cRng = streamFor(seed, 'specialist_choice_conformation');
  const cSpec = PROP.specialist === 'none' && state.engine === 'proposed' ? null : cRng.pick(CONF_TRAITS);
  if (state.engine === 'proposed') {
    if (cSpec !== null) {
      const r = nearestRung(breed.ideal[cSpec][0]);
      // 'carrier' gives the horse ONE correct allele and leaves the other to the pool: it can breed
      // on for the trait, but it has not been handed the finished article.
      g.type[cSpec] = PROP.specialist === 'carrier'
        ? [r, g.type[cSpec][cRng.int(2)]].sort((a, b) => a - b)
        : [r, r];
    }
  } else {
    const off = cRng.pick(SPECIALIST_OFFSETS);
    const p = Math.max(0, Math.min(ALLELE_COUNT, Math.round(breed.ideal[cSpec][0] / TODAY.alleleStep) + off));
    g.poly[cSpec] = specialistBits(streamFor(seed, 'specialist_alleles_conformation'), p);
  }

  // Slice 0019 Part B — untouched by the proposal, identical under both engines.
  const aRng = streamFor(seed, 'specialist_choice_ability');
  const aSpec = aRng.pick(SPECIALIZABLE);
  const aOff = aRng.pick(SPECIALIST_OFFSETS);
  g.poly[aSpec] = specialistBits(streamFor(seed, 'specialist_alleles_ability'), ABILITY_SPECIALIST_POTENTIAL + aOff);

  const ageRng = streamFor(seed, 'founding_age');
  const ageYears = FOUNDING_AGE_MIN_Y + ageRng() * (FOUNDING_AGE_MAX_Y - FOUNDING_AGE_MIN_Y);

  return { genotype: g, ageYears, specialists: { conformation: cSpec, ability: aSpec } };
}

/**
 * Proposal 1 (operator, 2026-08-07): an inherited allele may step one rung. This is what lets an
 * allele that is in NO founding horse appear later — but it is also what makes the breeding
 * preview's Punnett square stop being exact, so measure both before reaching for it.
 * `driftClamped` keeps the walk inside the breed's own reach; without it, unselected NPC lines
 * wander back toward the middle of the ladder and breed type erodes from the far end.
 */
function maybeDrift(allele, breedCode, trait, rng) {
  if (PROP.driftChance <= 0 || rng() >= PROP.driftChance) return allele;
  const moved = allele + (rng() < 0.5 ? -1 : 1);
  if (moved < 0 || moved >= rungCount()) return allele;
  if (PROP.driftClamped) {
    const target = nearestRung(BREEDS[breedCode].ideal[trait][0]);
    if (Math.abs(moved - target) * PROP.rungStep > PROP.reachPoints) return allele;
  }
  return moved;
}

function makeFoal(state, sireG, damG, seed) {
  const g = { type: {}, poly: {} };
  const tRng = streamFor(seed, 'type_meiosis');
  const dRng = streamFor(seed, 'type_drift');
  const pRng = streamFor(seed, 'polygenic_meiosis');
  if (state.engine === 'proposed') {
    for (const t of CONF_TRAITS) {
      g.type[t] = [
        maybeDrift(sireG.type[t][tRng.int(2)], state.breed, t, dRng),
        maybeDrift(damG.type[t][tRng.int(2)], state.breed, t, dRng),
      ].sort((a, b) => a - b);
    }
  }
  for (const t of [...CONF_TRAITS, ...ABILITY_TRAITS]) {
    const bits = [];
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      bits.push(sireG.poly[t][i * 2 + pRng.int(2)]);
      bits.push(damG.poly[t][i * 2 + pRng.int(2)]);
    }
    g.poly[t] = bits;
  }
  return g;
}

// ===========================================================================================
// Expression — model.ts's potential -> geneticValue -> realization -> expressedValue
// ===========================================================================================
function noiseFor(state, seed) {
  const sd = state.engine === 'proposed' ? PROP.noiseSd : TODAY.noiseSd;
  const rng = streamFor(seed, 'birth_noise');
  const out = {};
  for (const t of [...CONF_TRAITS, ...ABILITY_TRAITS]) out[t] = Math.round(rng.normal(sd));
  return out;
}
const clamp99 = (v) => Math.min(99, Math.max(1, v));
const realization = (ageYears, coi) =>
  Math.min(1, REALIZATION_AT_BIRTH + (1 - REALIZATION_AT_BIRTH) * (ageYears / MATURITY_YEARS)) * (1 - coi * PROP.inbreedingFactor);
const expressedValue = (gv, real, anchor) => Math.round(anchor + (gv - anchor) * real);

/** The full arithmetic for one conformation trait, kept as data so the card can print every step. */
function confParts(state, horse, trait) {
  const g = horse.genotype;
  const noise = noiseFor(state, horse.seed)[trait];
  let typeValue = null, typeAlleles = null, modifier;
  if (state.engine === 'proposed') {
    typeAlleles = g.type[trait].map(rungValue);
    typeValue = (typeAlleles[0] + typeAlleles[1]) / 2;
    modifier = (countOnes(g.poly[trait]) - LOCI_PER_TRAIT) * PROP.modifierStep;
  } else {
    modifier = countOnes(g.poly[trait]) * TODAY.alleleStep;
  }
  const geneticVal = clamp99((typeValue ?? 0) + modifier + noise);
  const target = targetFor(state, horse.breed, trait);
  const now = clamp99(expressedValue(geneticVal, realization(horse.ageYears, horse.coi), ANCHOR_BI));
  const mature = clamp99(expressedValue(geneticVal, realization(MATURITY_YEARS, horse.coi), ANCHOR_BI));
  const score = Math.max(0, 100 - Math.abs(mature - target) * FALLOFF);
  return { trait, typeAlleles, typeValue, modifier, noise, geneticVal, now, mature, target, dist: Math.abs(mature - target), score };
}
function abilityParts(state, horse, trait) {
  const noise = noiseFor(state, horse.seed)[trait];
  const gv = clamp99(countOnes(horse.genotype.poly[trait]) * TODAY.alleleStep + noise);
  const now = clamp99(expressedValue(gv, realization(horse.ageYears, horse.coi), 0));
  const mature = clamp99(expressedValue(gv, realization(MATURITY_YEARS, horse.coi), 0));
  return { trait, alleles: countOnes(horse.genotype.poly[trait]), noise, now, mature };
}

function label(score) {
  if (score >= LABEL_MIN.outstanding) return 'Outstanding';
  if (score >= LABEL_MIN.good) return 'Good';
  if (score >= LABEL_MIN.acceptable) return 'Acceptable';
  if (score >= LABEL_MIN.weak) return 'Weak';
  return 'Poor';
}
const onTarget = (score) => score >= LABEL_MIN.outstanding;
const sideWord = (trait, value) => (value >= 50 ? CONF[trait].high : CONF[trait].low);

/** scoreEntry's weighted mean, balanced judge, no show noise. */
function conformationScore(state, horse) {
  let ws = 0, w = 0;
  for (const t of CONF_TRAITS) {
    const p = confParts(state, horse, t);
    const weight = BREEDS[horse.breed].ideal[t][1];
    ws += weight * p.score; w += weight;
  }
  return w > 0 ? ws / w : 0;
}

// ===========================================================================================
// Pedigree and COI — the standard tabular kinship recursion
// ===========================================================================================
function kinship(state, aId, bId, memo = new Map()) {
  if (aId == null || bId == null) return 0;
  const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
  if (memo.has(key)) return memo.get(key);
  const A = state.horses[aId - 1], B = state.horses[bId - 1];
  let f;
  if (aId === bId) {
    f = 0.5 * (1 + (A.sire ? kinship(state, A.sire, A.dam, memo) : 0));
  } else {
    // Recurse on whichever animal is younger (higher id), so the recursion always terminates.
    const [young, other] = A.id > B.id ? [A, B] : [B, A];
    f = young.sire == null ? 0 : 0.5 * (kinship(state, young.sire, other.id, memo) + kinship(state, young.dam, other.id, memo));
  }
  memo.set(key, f);
  return f;
}

// ===========================================================================================
// Exact foal prediction — the Punnett square the breeding preview would show (§6)
// ===========================================================================================
function poissonBinomial(ps) {
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) { next[k] += dist[k] * (1 - p); next[k + 1] += dist[k] * p; }
    dist = next;
  }
  return dist;
}
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}
function noiseGrid(sd) {
  const out = [];
  for (let n = -Math.ceil(sd * 3.5); n <= Math.ceil(sd * 3.5); n++) {
    out.push([n, normalCdf((n + 0.5) / sd) - normalCdf((n - 0.5) / sd)]);
  }
  return out;
}

/** Per trait: the exact distribution over labels, plus P(the foal itself breeds on). */
function predictTrait(state, sire, dam, trait, coi) {
  const sd = state.engine === 'proposed' ? PROP.noiseSd : TODAY.noiseSd;
  const grid = noiseGrid(sd);
  const target = targetFor(state, sire.breed, trait);
  const real = realization(MATURITY_YEARS, coi);

  const ps = [];
  for (let i = 0; i < LOCI_PER_TRAIT; i++) {
    ps.push((sire.genotype.poly[trait][i * 2] + sire.genotype.poly[trait][i * 2 + 1]) / 2);
    ps.push((dam.genotype.poly[trait][i * 2] + dam.genotype.poly[trait][i * 2 + 1]) / 2);
  }
  const modDist = poissonBinomial(ps);

  // Type outcomes: one allele from each parent, uniformly — four equally likely combinations.
  let typeOutcomes = [[0, 1.0]];
  let breedsOn = null;
  if (state.engine === 'proposed') {
    const targetRung = nearestRung(BREEDS[sire.breed].ideal[trait][0]);
    const m = new Map();
    let on = 0;
    for (const a of sire.genotype.type[trait]) for (const b of dam.genotype.type[trait]) {
      const v = (rungValue(a) + rungValue(b)) / 2;
      m.set(v, (m.get(v) ?? 0) + 0.25);
      if (a === targetRung && b === targetRung) on += 0.25;
    }
    typeOutcomes = [...m.entries()];
    breedsOn = on;
  }

  const labels = { Outstanding: 0, Good: 0, Acceptable: 0, Weak: 0, Poor: 0 };
  for (const [typeValue, tw] of typeOutcomes) {
    for (let k = 0; k < modDist.length; k++) {
      if (modDist[k] < 1e-9) continue;
      const modifier = state.engine === 'proposed' ? (k - LOCI_PER_TRAIT) * PROP.modifierStep : k * TODAY.alleleStep;
      for (const [n, nw] of grid) {
        const gv = clamp99(typeValue + modifier + n);
        const mature = clamp99(expressedValue(gv, real, ANCHOR_BI));
        labels[label(Math.max(0, 100 - Math.abs(mature - target) * FALLOFF))] += tw * modDist[k] * nw;
      }
    }
  }
  return { trait, labels, breedsOn, target };
}

// ===========================================================================================
// Rendering
// ===========================================================================================
const NAMES = ['Willow', 'Comet', 'Juniper', 'Sable', 'Pepper', 'Rowan', 'Clover', 'Dune', 'Amber', 'Flint',
  'Marigold', 'Cinder', 'Bramble', 'Echo', 'Hazel', 'Onyx', 'Poppy', 'Quill', 'Larkspur', 'Thistle',
  'Basil', 'Fern', 'Indigo', 'Wren', 'Cobalt', 'Sorrel', 'Tansy', 'Vesper', 'Aspen', 'Nimbus'];
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const pctOf = (x) => (x * 100).toFixed(1).padStart(5) + '%';

function horseHeadline(state, h) {
  const gen = h.sire ? `gen ${h.gen}, ${h.sire}x${h.dam}` : 'gen 1, founding';
  return `#${h.id} ${pad(h.name, 12)} ${BREEDS[h.breed].name}, ${h.ageYears.toFixed(1)}y   [${gen}]${h.coi > 0 ? `  COI ${(h.coi * 100).toFixed(1)}%` : ''}`;
}

function renderCard(state, h) {
  const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
  const out = [];
  out.push(horseHeadline(state, h));
  out.push('  WHAT A PLAYER SEES  (assumes the horse has started once, so labels are unlocked)');
  for (const p of parts) {
    const word = sideWord(p.trait, p.mature);
    const now = p.now === p.mature ? '' : `  (now ${p.now})`;
    out.push(`    ${pad(CONF[p.trait].name, 15)} ${padL(p.mature, 3)}  ${pad(word, 9)} ${pad(label(p.score), 12)} standard ${padL(p.target, 3)}${now}`);
  }
  const cs = conformationScore(state, h);
  const nOn = parts.filter((p) => onTarget(p.score)).length;
  out.push(`    Conformation score vs ${BREEDS[h.breed].name} standard: ${cs.toFixed(1)}   (${nOn} of 5 traits on target)`);
  const ab = ABILITY_TRAITS.map((t) => abilityParts(state, h, t));
  out.push(`    Ability: ` + ab.map((a) => `${ABILITY[a.trait]} ${label(a.mature)}`).join(', '));

  out.push('  UNDERNEATH');
  if (state.engine === 'proposed') {
    out.push('    trait            type alleles    type   modifier  noise   genetic   mature  dist  traitScore');
    for (const p of parts) {
      out.push(`    ${pad(p.trait, 16)} ${padL(p.typeAlleles[0], 3)} + ${padL(p.typeAlleles[1], 3)}    ${padL(p.typeValue.toFixed(1), 5)}  ${padL((p.modifier >= 0 ? '+' : '') + p.modifier.toFixed(2), 7)}  ${padL((p.noise >= 0 ? '+' : '') + p.noise, 5)}  ${padL(p.geneticVal.toFixed(2), 7)}   ${padL(p.mature, 5)}  ${padL(p.dist, 4)}  ${padL(p.score.toFixed(1), 6)}`);
    }
    const tr = nearestRung(0);
    out.push('    "type alleles" are the two graded alleles, printed as their own value on the 1-99 scale.');
    out.push('    A horse homozygous at its breed\'s standard passes that number to every foal it ever has:');
    out.push('      ' + CONF_TRAITS.map((t) => {
      const g = h.genotype.type[t], target = nearestRung(BREEDS[h.breed].ideal[t][0]);
      return `${t.split('_')[0]}:${g[0] === target && g[1] === target ? 'FIXED' : g.includes(target) ? 'carries' : 'no'}`;
    }).join('  '));
  } else {
    out.push('    trait            "1" alleles  x5     noise   genetic   mature  dist  traitScore');
    for (const p of parts) {
      out.push(`    ${pad(p.trait, 16)} ${padL(countOnes(h.genotype.poly[p.trait]), 6)} of 20  ${padL(p.modifier, 4)}  ${padL((p.noise >= 0 ? '+' : '') + p.noise, 5)}  ${padL(p.geneticVal, 6)}   ${padL(p.mature, 5)}  ${padL(p.dist, 4)}  ${padL(p.score.toFixed(1), 6)}`);
    }
    out.push('    (Today there is no type gene. Homozygous and heterozygous are indistinguishable —');
    out.push('     the trait is a count of twenty interchangeable alleles, which is defect 1.2.)');
  }
  out.push('    ability          "1" alleles   noise   mature');
  for (const a of ABILITY_TRAITS.map((t) => abilityParts(state, h, t))) {
    out.push(`    ${pad(a.trait, 16)} ${padL(a.alleles, 6)} of 20  ${padL((a.noise >= 0 ? '+' : '') + a.noise, 5)}  ${padL(a.mature, 6)}`);
  }
  out.push(`    seed ${h.seed}${h.specialists ? `   founding specialists: ${h.specialists.conformation} (conformation), ${h.specialists.ability} (ability)` : ''}`);
  return out.join('\n');
}

// ===========================================================================================
// State
// ===========================================================================================
/**
 * The tuning dials are read off the command line, stored on the lab, and re-applied on every
 * later command — so `breed` and `predict` run under the same rules the founders were minted
 * under, days later, without the operator having to remember which flags they used.
 */
const TUNABLE = {
  'rung-step': ['rungStep', Number],
  'reach': ['reachPoints', Number],
  'modifier-step': ['modifierStep', Number],
  'noise-sd': ['noiseSd', Number],
  'founding-mode': ['foundingMode', String],
  'target-chance': ['ringTargetChance', Number],
  'hole': ['ringHoleRungs', Number],
  'drift': ['driftChance', Number],
  'inbreeding': ['inbreedingFactor', Number],
  'drift-clamped': ['driftClamped', (v) => v !== 'false' && v !== '0'],
  'specialist': ['specialist', String],
};
function tuningFromFlags(flags) {
  const t = {};
  for (const [flag, [key, cast]] of Object.entries(TUNABLE)) {
    if (flags[flag] !== undefined) t[key] = cast(flags[flag]);
  }
  if (flags.concentration !== undefined) {
    t.concentration = { low: Number(flags.concentration), mid: Number(flags.concentration), high: Number(flags.concentration) };
  }
  return t;
}
function applyTuning(tuning) {
  for (const [k, v] of Object.entries(tuning ?? {})) PROP[k] = v;
  if (!['peak', 'ring'].includes(PROP.foundingMode)) { console.error('--founding-mode must be "peak" or "ring"'); process.exit(1); }
  if (!['fixed', 'carrier', 'none'].includes(PROP.specialist)) { console.error('--specialist must be "fixed", "carrier" or "none"'); process.exit(1); }
}
/** One line naming every dial that is NOT at its documented default, so output is self-describing. */
function tuningNote(tuning) {
  const parts = Object.entries(tuning ?? {}).map(([k, v]) =>
    `${k}=${k === 'concentration' ? v.low : JSON.stringify(v)}`);
  return parts.length ? `tuned: ${parts.join(' ')}` : 'defaults (fix document as written)';
}

function loadState(path) {
  if (!existsSync(path)) { console.error(`No lab at ${path}. Run "new" first.`); process.exit(1); }
  const state = JSON.parse(readFileSync(path, 'utf8'));
  applyTuning(state.tuning);
  return state;
}
const saveState = (path, s) => writeFileSync(path, JSON.stringify(s, null, 1));

function addHorse(state, { genotype, ageYears, sire, dam, specialists, seed }) {
  const id = state.horses.length + 1;
  const gen = sire ? Math.max(state.horses[sire - 1].gen, state.horses[dam - 1].gen) + 1 : 1;
  const h = { id, name: NAMES[(id - 1) % NAMES.length] + (id > NAMES.length ? ` ${Math.floor((id - 1) / NAMES.length) + 1}` : ''),
    breed: state.breed, gen, sire: sire ?? null, dam: dam ?? null, ageYears, seed, genotype, specialists: specialists ?? null, coi: 0 };
  state.horses.push(h);
  h.coi = sire ? kinship(state, sire, dam) : 0;
  return h;
}

// ===========================================================================================
// Commands
// ===========================================================================================
function parseArgs(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]; }
    else if (argv[i].toLowerCase() !== 'to' && argv[i].toLowerCase() !== 'x') positional.push(argv[i]);
  }
  return { flags, positional };
}

function cmdNew(path, flags) {
  const breed = (flags.breed ?? 'QH').toUpperCase();
  if (!BREEDS[breed]) { console.error(`Unknown breed "${breed}". One of: ${Object.keys(BREEDS).join(', ')}`); process.exit(1); }
  const engine = flags.engine ?? 'proposed';
  if (!['proposed', 'today'].includes(engine)) { console.error('--engine must be "proposed" or "today"'); process.exit(1); }
  const band = flags.band ?? 'low';
  if (!['low', 'mid', 'high'].includes(band)) { console.error('--band must be low, mid or high'); process.exit(1); }
  const n = Number(flags.horses ?? 6);
  const seed = Number(flags.seed ?? Math.floor(Math.random() * 1e9));

  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  const state = { engine, breed, band, seed, tuning, horses: [] };
  for (let i = 0; i < n; i++) {
    const s = deriveSeed(seed, `founder_${i}`);
    const { genotype, ageYears, specialists } = mintFounder(state, s);
    addHorse(state, { genotype, ageYears, specialists, seed: s });
  }
  saveState(path, state);

  console.log(`Lab started: ${n} ${BREEDS[breed].name}s, engine "${engine}", band "${band}", seed ${seed}.`);
  console.log(`No sex — any horse can be crossed with any other, including itself.`);
  console.log(tuningNote(tuning));
  if (engine === 'proposed') {
    console.log(`Ladder: ${rungCount()} alleles, a rung every ${PROP.rungStep} points, reach +/-${PROP.reachPoints}.`);
    console.log(`Breed standard, snapped to the allele ladder (§4.6): ` +
      CONF_TRAITS.map((t) => `${t.split('_')[0]} ${snappedTarget(breed, t)}`).join(', '));
  }
  console.log('');
  cmdList(state);
}

function cmdList(state) {
  console.log(`${state.horses.length} horses | engine ${state.engine} | ${BREEDS[state.breed].name} | band ${state.band}`);
  console.log('  id  name          gen  parents   age   score   on target   traits (mature values)');
  for (const h of state.horses) {
    const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
    const on = parts.filter((p) => onTarget(p.score)).length;
    const vals = parts.map((p) => padL(p.mature, 3)).join(' ');
    console.log(`  ${padL('#' + h.id, 3)} ${pad(h.name, 13)} ${padL(h.gen, 3)}  ${pad(h.sire ? `${h.sire}x${h.dam}` : '-', 8)} ${padL(h.ageYears.toFixed(1), 4)}  ${padL(conformationScore(state, h).toFixed(1), 5)}   ${on} of 5     ${vals}`);
  }
  console.log(`  (trait order: ${CONF_TRAITS.map((t) => t.split('_')[0]).join(' ')})`);
}

function cmdShow(state, ids) {
  for (const id of ids) {
    const h = state.horses[id - 1];
    if (!h) { console.error(`No horse #${id}.`); continue; }
    console.log(renderCard(state, h));
    console.log('');
  }
}

function cmdPredict(state, a, b) {
  const sire = state.horses[a - 1], dam = state.horses[b - 1];
  if (!sire || !dam) { console.error('Both ids must exist.'); process.exit(1); }
  const coi = kinship(state, a, b);
  console.log(`PREDICTION for #${a} ${sire.name} x #${b} ${dam.name}   (foal COI ${(coi * 100).toFixed(1)}%)`);
  console.log('Exact, not simulated — a Punnett square over the type genes crossed with the modifier');
  console.log('and noise distributions. This is what the breeding preview would show a player.\n');
  console.log('  trait            standard | Outstanding    Good  Accept.    Weak    Poor | breeds on');
  console.log('  ---------------- -------- | ----------------------------------------- | ---------');
  let expOn = 0, expBreedsOn = 0;
  for (const t of CONF_TRAITS) {
    const p = predictTrait(state, sire, dam, t, coi);
    expOn += p.labels.Outstanding;
    if (p.breedsOn != null) expBreedsOn += p.breedsOn;
    console.log(`  ${pad(t, 16)} ${padL(p.target, 8)} | ${pctOf(p.labels.Outstanding)} ${pctOf(p.labels.Good)} ${pctOf(p.labels.Acceptable)} ${pctOf(p.labels.Weak)} ${pctOf(p.labels.Poor)} |${p.breedsOn == null ? '     n/a' : '   ' + pctOf(p.breedsOn)}`);
  }
  console.log(`\n  Expected traits on target in one foal: ${expOn.toFixed(2)} of 5`);
  if (state.engine === 'proposed') {
    console.log(`  Expected traits the foal will FIX (homozygous at standard, passes to all its own foals): ${expBreedsOn.toFixed(2)} of 5`);
    console.log('  "breeds on" is the column a breeding programme actually accumulates — a foal can look');
    console.log('  Outstanding on luck and still carry nothing worth passing forward.');
  } else {
    console.log('  There is no "breeds on" column under today\'s engine: with twenty interchangeable');
    console.log('  alleles and no locus to be homozygous AT, the question cannot be asked.');
  }
}

function cmdBreed(state, path, a, b, foals) {
  const sire = state.horses[a - 1], dam = state.horses[b - 1];
  if (!sire || !dam) { console.error('Both ids must exist.'); process.exit(1); }
  const coi = kinship(state, a, b);
  console.log(`#${a} ${sire.name} x #${b} ${dam.name} — ${foals} foals   (COI ${(coi * 100).toFixed(1)}%)`);
  if (coi > 0 && PROP.inbreedingFactor > 0) console.log(`  Inbreeding depression is live: realization x ${(1 - coi * PROP.inbreedingFactor).toFixed(3)}, pulling every trait toward 50.`);
  else if (coi > 0) console.log(`  Inbreeding depression is OFF (--inbreeding 0). COI ${(coi * 100).toFixed(1)}% costs this foal nothing.`);
  console.log('');

  const made = [];
  for (let i = 0; i < foals; i++) {
    const s = deriveSeed(deriveSeed(state.seed, `foal_${a}_${b}_${state.horses.length}_${i}`), 'foal');
    const genotype = makeFoal(state, sire.genotype, dam.genotype, s);
    made.push(addHorse(state, { genotype, ageYears: 0, sire: a, dam: b, seed: s }));
  }
  saveState(path, state);

  for (const h of made) { console.log(renderCard(state, h)); console.log(''); }

  console.log('THE FIVE FOALS AGAINST THEIR PARENTS');
  const row = (h) => {
    const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
    return { on: parts.filter((p) => onTarget(p.score)).length, score: conformationScore(state, h), vals: parts.map((p) => padL(p.mature, 3)).join(' ') };
  };
  for (const [tag, h] of [[`sire #${a}`, sire], [`dam  #${b}`, dam]]) {
    const r = row(h);
    console.log(`  ${pad(tag, 10)} ${padL(r.score.toFixed(1), 5)}  ${r.on} of 5   ${r.vals}`);
  }
  console.log('  ' + '-'.repeat(46));
  let sumOn = 0;
  for (const h of made) {
    const r = row(h); sumOn += r.on;
    console.log(`  ${pad('foal #' + h.id, 10)} ${padL(r.score.toFixed(1), 5)}  ${r.on} of 5   ${r.vals}`);
  }
  console.log(`  mean traits on target across the ${foals} foals: ${(sumOn / foals).toFixed(2)} of 5`);
  console.log(`  (trait order: ${CONF_TRAITS.map((t) => t.split('_')[0]).join(' ')})`);
  console.log(`\nNew horses #${made[0].id}-#${made[made.length - 1].id}. Breed them onward with e.g.  breed ${made[0].id} to ${made[1].id}`);
}

// ===========================================================================================
// Measurement — added 2026-08-07 for the "make gen 1 slightly worse" question
// ===========================================================================================

/** Mint a throwaway population without touching the saved lab. */
function mintPopulation(state, n, seedBase) {
  const horses = [];
  for (let i = 0; i < n; i++) {
    const s = deriveSeed(seedBase, `founder_${i}`);
    const { genotype, ageYears, specialists } = mintFounder(state, s);
    horses.push({ id: i + 1, breed: state.breed, gen: 1, sire: null, dam: null, ageYears, seed: s, genotype, specialists, coi: 0 });
  }
  return horses;
}

const fixedCount = (h) => CONF_TRAITS.filter((t) => {
  const target = nearestRung(BREEDS[h.breed].ideal[t][0]);
  return h.genotype.type[t][0] === target && h.genotype.type[t][1] === target;
}).length;

function statsFor(state, horses) {
  let score = 0, on = 0, fixed = 0, dev = 0, wrongBreed = 0, carries = 0, blind = 0, blindOf = 0;
  for (const h of horses) {
    const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
    // The false signal, measured: traits that READ Outstanding while carrying no correct allele.
    // A child selecting on looks breeds these and gets scatter. The finer the ladder, the more
    // allele pairs average to the right answer without either allele being right.
    if (state.engine === 'proposed') {
      for (const p of parts) {
        if (!onTarget(p.score)) continue;
        blindOf++;
        if (!h.genotype.type[p.trait].includes(nearestRung(BREEDS[h.breed].ideal[p.trait][0]))) blind++;
      }
    }
    score += conformationScore(state, h);
    on += parts.filter((p) => onTarget(p.score)).length;
    dev += parts.reduce((a, p) => a + p.dist, 0) / CONF_TRAITS.length;
    if (parts.some((p) => p.dist > 25)) wrongBreed++;
    if (state.engine === 'proposed') {
      fixed += fixedCount(h);
      carries += CONF_TRAITS.filter((t) => h.genotype.type[t].includes(nearestRung(BREEDS[h.breed].ideal[t][0]))).length;
    }
  }
  const n = horses.length;
  return { n, score: score / n, on: on / n, fixed: fixed / n, carries: carries / n, dev: dev / n, wrongBreed: wrongBreed / n, blind: blindOf ? blind / blindOf : 0 };
}

/**
 * The dead-end risk, and the reason a ring pool needs an escape hatch: if a child's whole starting
 * barn holds no copy of the correct allele for some trait, that trait can never be bred right —
 * Mendelian inheritance shuffles alleles, it never invents one. Drift is the other way out.
 */
function barnMissRate(state, barnSize, trials, seedBase) {
  let anyMissing = 0, totalTraitsMissing = 0;
  for (let k = 0; k < trials; k++) {
    const barn = mintPopulation(state, barnSize, deriveSeed(seedBase, `barn_${k}`));
    let missing = 0;
    for (const t of CONF_TRAITS) {
      const target = nearestRung(BREEDS[state.breed].ideal[t][0]);
      const copies = barn.reduce((a, h) => a + h.genotype.type[t].filter((x) => x === target).length, 0);
      if (copies === 0) missing++;
    }
    if (missing > 0) anyMissing++;
    totalTraitsMissing += missing;
  }
  return { any: anyMissing / trials, perBarn: totalTraitsMissing / trials };
}

function cmdSweep(flags) {
  const engine = flags.engine ?? 'proposed';
  const n = Number(flags.n ?? 4000);
  const barn = Number(flags.barn ?? 6);
  const seed = Number(flags.seed ?? 424242);
  const breeds = (flags.breed ?? 'AR').toUpperCase() === 'ALL' ? Object.keys(BREEDS) : [(flags.breed ?? 'AR').toUpperCase()];
  const bands = flags.band ? [flags.band] : ['low', 'mid', 'high'];
  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  console.log(`FOUNDING STOCK, ${n} horses per row | engine ${engine} | ${tuningNote(tuning)}`);
  if (engine === 'proposed') console.log(`Ladder: ${rungCount()} alleles, step ${PROP.rungStep}, reach +/-${PROP.reachPoints}, mode ${PROP.foundingMode}, specialist ${PROP.specialist}`);
  console.log('');
  console.log('  breed             band | score  on target  FIXED  carries | mean dev  wrong-breed  looks-right-carries-nothing');
  console.log('  ----------------- ---- | -----  ---------  -----  ------- | --------  -----------  ---------------------------');
  for (const breed of breeds) {
    for (const band of bands) {
      const state = { engine, breed, band, seed, horses: [] };
      const s = statsFor(state, mintPopulation(state, n, deriveSeed(seed, `${breed}_${band}`)));
      const miss = engine === 'proposed'
        ? barnMissRate(state, barn, 400, deriveSeed(seed, `miss_${breed}_${band}`))
        : { any: NaN, perBarn: NaN };
      console.log(`  ${pad(BREEDS[breed].name, 17)} ${pad(band, 4)} | ${padL(s.score.toFixed(1), 5)}  ${padL(s.on.toFixed(2), 4)} of 5  ${padL(s.fixed.toFixed(2), 5)}  ${padL(s.carries.toFixed(2), 7)} | ${padL(s.dev.toFixed(1), 8)}  ${padL((s.wrongBreed * 100).toFixed(1) + '%', 11)}  ${padL((s.blind * 100).toFixed(1) + '%', 12)}   [barn missing: ${engine === 'proposed' ? `${(miss.any * 100).toFixed(0)}%` : 'n/a'}]`);
    }
  }
  console.log('');
  console.log('  score       conformation score against the breed standard, balanced judge, no show noise');
  console.log('  on target   traits reading Outstanding, of 5 — what a player SEES');
  console.log('  FIXED       traits homozygous at the standard — what a breeding programme ACCUMULATES');
  console.log('  carries     traits holding at least one correct allele — the raw material for FIXED');
  console.log('  mean dev    mean |expressed - standard| across the five traits (fix doc §5.1)');
  console.log('  wrong-breed share of horses with at least one trait more than 25 points off (§1.1)');
  console.log('  looks-right share of Outstanding-reading traits whose horse carries NO correct allele —');
  console.log('              the false signal a child selecting on looks cannot see through');
  console.log('  missing     share of starting barns with NO copy of the right allele for some trait,');
  console.log('              i.e. a trait that child can never breed correct without buying in.');
}

/**
 * How a player chooses which two horses to breed.
 *
 *   'score'   what a child can see: the conformation score, and nothing else. A 10/10 horse and a
 *             2/18 horse both express 10 and are INDISTINGUISHABLE, so this exerts no pressure
 *             toward homozygosity whatsoever.
 *   'tested'  the child has bought the conformation test and breeds for the genes: rank by how
 *             many correct alleles the horse carries, score as the tie-break.
 *
 * The gap between these two is the entire value of the conformation test (fix document §12.1/§12.2),
 * and it is much larger than anyone expected — see docs/fixes/conformation-founding-quality.md §3.
 */
function targetAlleleCount(h) {
  return CONF_TRAITS.reduce((a, t) => {
    const target = nearestRung(BREEDS[h.breed].ideal[t][0]);
    return a + h.genotype.type[t].filter((x) => x === target).length;
  }, 0);
}
function rankerFor(state, mode) {
  if (mode === 'tested' && state.engine === 'proposed') {
    return (a, b) => (targetAlleleCount(b) - targetAlleleCount(a)) || (conformationScore(state, b) - conformationScore(state, a));
  }
  return (a, b) => conformationScore(state, b) - conformationScore(state, a);
}

/**
 * A breeding programme, run to generation G. Selection is on what a player can SEE (conformation
 * score) unless --select tested, which is the honest simulation and the reason "carries" and
 * "FIXED" climb more slowly than "on target" does.
 */
function cmdProgramme(flags) {
  const engine = flags.engine ?? 'proposed';
  const breed = (flags.breed ?? 'AR').toUpperCase();
  const band = flags.band ?? 'low';
  const gens = Number(flags.gens ?? 8);
  const herdSize = Number(flags.barn ?? 6);
  const foals = Number(flags.foals ?? 4);
  const runs = Number(flags.runs ?? 40);
  const seed = Number(flags.seed ?? 99);
  const select = flags.select ?? 'score';
  // Fresh founders bought in each generation. This is the market and the consignment dealer, and
  // it is not optional decoration: a closed herd of six selecting on genotype line-breeds itself
  // to a COI that destroys the very phenotype it was selecting for (see the fix document §4).
  const outcross = Number(flags.outcross ?? 0);
  if (!['score', 'tested'].includes(select)) { console.error('--select must be "score" or "tested"'); process.exit(1); }
  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  const perGen = Array.from({ length: gens + 1 }, () => ({ score: 0, on: 0, fixed: 0, best: 0, done: 0, coi: 0 }));

  for (let run = 0; run < runs; run++) {
    const state = { engine, breed, band, seed, horses: [] };
    for (const h of mintPopulation(state, herdSize, deriveSeed(seed, `run_${run}`))) {
      addHorse(state, { genotype: h.genotype, ageYears: MATURITY_YEARS, specialists: h.specialists, seed: h.seed });
    }
    let herd = [...state.horses];
    const rank = rankerFor(state, select);

    for (let g = 0; g <= gens; g++) {
      const ranked = [...herd].sort(rank);
      const e = perGen[g];
      const s = statsFor(state, herd);
      e.score += s.score; e.on += s.on; e.fixed += s.fixed;
      e.best += conformationScore(state, ranked[0]);
      e.coi += herd.reduce((a, h) => a + h.coi, 0) / herd.length;
      if (engine === 'proposed' && ranked.some((h) => fixedCount(h) === CONF_TRAITS.length)) e.done++;
      if (g === gens) break;

      const [sire, dam] = [ranked[0], ranked[1] ?? ranked[0]];
      const made = [];
      for (let i = 0; i < foals; i++) {
        const fs = deriveSeed(deriveSeed(seed, `r${run}_g${g}_f${i}`), 'foal');
        made.push(addHorse(state, { genotype: makeFoal(state, sire.genotype, dam.genotype, fs), ageYears: MATURITY_YEARS, sire: sire.id, dam: dam.id, seed: fs }));
      }
      const bought = [];
      for (let i = 0; i < outcross; i++) {
        const bs = deriveSeed(seed, `buy_r${run}_g${g}_${i}`);
        const f = mintFounder(state, bs);
        bought.push(addHorse(state, { genotype: f.genotype, ageYears: MATURITY_YEARS, specialists: f.specialists, seed: bs }));
      }
      herd = [...herd, ...made, ...bought].sort(rank).slice(0, herdSize);
    }
  }

  console.log(`BREEDING PROGRAMME — ${BREEDS[breed].name}, band ${band}, engine ${engine} | ${tuningNote(tuning)}`);
  console.log(`Herd of ${herdSize}, best pair bred each generation, ${foals} foals, keep the best ${herdSize}.`);
  console.log(`${outcross ? `${outcross} fresh horse(s) bought in per generation. ` : 'Closed herd, nothing bought in. '}Averaged over ${runs} runs.`);
  console.log(select === 'tested'
    ? `Selection is on TESTED genotype: the child has paid for the conformation panel.\n`
    : `Selection is on visible score — a child who has not tested cannot see genes.\n`);
  console.log('  gen | mean score  best score  on target   FIXED   mean COI | herd holds a finished horse');
  console.log('  --- | ----------  ----------  ---------   -----   -------- | --------------------------');
  for (let g = 0; g <= gens; g++) {
    const e = perGen[g];
    console.log(`  ${padL(g === 0 ? 'F' : g, 3)} | ${padL((e.score / runs).toFixed(1), 10)}  ${padL((e.best / runs).toFixed(1), 10)}  ${padL((e.on / runs).toFixed(2), 4)} of 5  ${padL((e.fixed / runs).toFixed(2), 5)}  ${padL(((e.coi / runs) * 100).toFixed(1) + '%', 8)} | ${engine === 'proposed' ? padL((e.done / runs * 100).toFixed(0) + '%', 4) : ' n/a'}`);
  }
  console.log('\n  Generation "F" is the founding batch. "Finished" = all five traits homozygous at the');
  console.log('  standard, so every foal it ever has is correct on all five. That is the end of the');
  console.log('  type-gene game; the demoted twenty-allele modifier is what remains to chase after it.');
}

function cmdPedigree(state, id) {
  const h = state.horses[id - 1];
  if (!h) { console.error(`No horse #${id}.`); process.exit(1); }
  const walk = (x, depth, prefix) => {
    if (!x || depth > 4) return;
    console.log(`${prefix}#${x.id} ${x.name} (gen ${x.gen}${x.coi > 0 ? `, COI ${(x.coi * 100).toFixed(1)}%` : ''})`);
    if (x.sire) { walk(state.horses[x.sire - 1], depth + 1, prefix + '  |- '); walk(state.horses[x.dam - 1], depth + 1, prefix + '  |- '); }
  };
  walk(h, 0, '  ');
  console.log(`\n  Inbreeding coefficient: ${(h.coi * 100).toFixed(2)}%  ->  realization x ${(1 - h.coi * PROP.inbreedingFactor).toFixed(3)}${PROP.inbreedingFactor === 0 ? '  (depression off)' : ''}`);
}

function cmdSummary(state) {
  const byGen = new Map();
  for (const h of state.horses) {
    const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
    const e = byGen.get(h.gen) ?? { n: 0, on: 0, score: 0, fixed: 0, coi: 0 };
    e.n++; e.on += parts.filter((p) => onTarget(p.score)).length; e.score += conformationScore(state, h); e.coi += h.coi;
    if (state.engine === 'proposed') {
      for (const t of CONF_TRAITS) {
        const target = nearestRung(BREEDS[h.breed].ideal[t][0]);
        if (h.genotype.type[t][0] === target && h.genotype.type[t][1] === target) e.fixed++;
      }
    }
    byGen.set(h.gen, e);
  }
  console.log(`${BREEDS[state.breed].name} | engine ${state.engine} | band ${state.band} | ${state.horses.length} horses`);
  console.log('  gen    n   mean score   traits on target   traits FIXED at standard   mean COI');
  for (const g of [...byGen.keys()].sort((a, b) => a - b)) {
    const e = byGen.get(g);
    console.log(`  ${padL(g, 3)}  ${padL(e.n, 3)}   ${padL((e.score / e.n).toFixed(1), 10)}   ${padL((e.on / e.n).toFixed(2), 8)} of 5      ${padL(state.engine === 'proposed' ? (e.fixed / e.n).toFixed(2) + ' of 5' : 'n/a', 12)}       ${padL(((e.coi / e.n) * 100).toFixed(1) + '%', 7)}`);
  }
  console.log('\n  "FIXED at standard" = homozygous at the breed target, so the trait breeds true from here.');
  console.log('  That column is the real measure of progress; mean score can rise on luck, it cannot.');
}

// ===========================================================================================
// Entry point
// ===========================================================================================
const argv = process.argv.slice(2);
const cmd = argv[0];
const { flags, positional } = parseArgs(argv.slice(1));
const statePath = resolve(flags.state ? String(flags.state) : `${HERE}/.breeding-lab.json`);

switch (cmd) {
  case 'new': cmdNew(statePath, flags); break;
  case 'list': cmdList(loadState(statePath)); break;
  case 'show': cmdShow(loadState(statePath), positional.map(Number)); break;
  case 'predict': cmdPredict(loadState(statePath), Number(positional[0]), Number(positional[1])); break;
  case 'breed': {
    const state = loadState(statePath);
    cmdBreed(state, statePath, Number(positional[0]), Number(positional[1]), Number(flags.foals ?? 5));
    break;
  }
  case 'pedigree': cmdPedigree(loadState(statePath), Number(positional[0])); break;
  case 'summary': cmdSummary(loadState(statePath)); break;
  case 'sweep': cmdSweep(flags); break;
  case 'programme': case 'program': cmdProgramme(flags); break;
  case 'reset':
    if (existsSync(statePath)) { unlinkSync(statePath); console.log(`Deleted ${statePath}.`); }
    else console.log('Nothing to delete.');
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 48).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
