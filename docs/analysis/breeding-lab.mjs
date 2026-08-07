#!/usr/bin/env node
//
// BREEDING LAB — a bench for the proposed conformation genetics, driven from the command line.
// Written alongside docs/slices/0028-conformation-genetics.md, so the operator can run in an
// afternoon the experiments that would take months of real play: mint a founding batch, look at
// what a player would see AND the numbers underneath it, pick two horses, roll five foals, then
// breed those foals onward.
//
// ===========================================================================================
//  THIS IS NOT THE GAME. It is a simulation of a system that has not been built.
//  Same standing rules as population-sim.mjs / stable-timeline.mjs / training-effect.mjs /
//  analysis tool, not game code, not a vitest test; own PRNG, own
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
//             [--prenatal [n]]        Buy mare prenatal care on this covering: each foal's WORST
//                                     TRAIT moves n rungs (default 1) toward the breed standard.
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
//   --coax <n>            MARE PRENATAL CARE (2026-08-07, DECIDED): a covering may be bought care,
//                         which moves the foal's WORST TRAIT n rungs TOWARD its breed standard at
//                         birth, once for life. Never away, so breed type cannot erode. Costs money
//                         and a turn in the game; 0 = not bought, which is the honest default since
//                         a real player will not buy it on every covering. See
//                         docs/slices/0028-conformation-genetics.md §2.7.
//   --coax-mode <mode>    shown | allele — DECIDED 'shown': move the worst TRAIT, whatever that
//                         costs in alleles (one step on a heterozygote, two on a homozygote), so
//                         the purchase is ALWAYS visible. 'allele' moves a single allele and is
//                         retained only as the evidence for that decision — under it roughly half
//                         of all purchases are silently invisible (§3.1). Not a mode the game offers.
//   --coax-policy <mode>  worst | finish — DECIDED 'worst': the allele furthest from standard, which
//                         is the one the horse shows. 'finish' spends it on the allele already
//                         closest to standard (what a tested player would choose, if the game let
//                         them — it does not; the mechanic picks, §3.1).
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
// ^ outstanding: 90 against FALLOFF 2 means "within 5 points of standard". That width is a DIAL,
// and it turns out to be a load-bearing one: if it is wider than half a rung, a heterozygote
// showing the midpoint reads Outstanding exactly like a homozygote, and the label stops telling a
// player anything about what the horse will pass on. --outstanding-within sets it in points.
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

// --- PROPOSED engine — docs/slices/0028-conformation-genetics.md §2 -------------
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
// Defaults reproduce THE DECIDED DESIGN — docs/slices/0028-conformation-genetics.md §2.
// Change them on the command line, not here.
const PROP = {
  rungBase: 2,                               // §4.2 — the allele ladder starts at 2
  rungStep: 8,                               // §4.2 — a rung every 8 points: 2, 10, 18, ... 98
  reachPoints: 24,                           // §4.4 — 3 rungs at step 8. THE BREED-TYPE GUARANTEE.
  modifierStep: 0.10,                        // DECIDED — conformation_modifier_step 0.75 -> 0.10
  noiseSd: 0.5,                              // DECIDED — conformation_noise_sd 6 -> 0.5
  abilityOneChance: { low: 0.42, mid: 0.50, high: 0.58 },   // §9/0177 — TODAY'S values, unchanged
  concentration: { low: 0.35, mid: 0.55, high: 0.75 },      // §4.4 — P(allele is the target rung)

  // --- the founding-quality dials -------------------------------------------------------------
  // 'peak' is the fix document's pool: most mass ON the breed target, falling away from there.
  // 'ring' is the operator's proposal (2026-08-07): a HOLE around the target, so a founding horse
  // is close to right but almost never exactly right, with a small escape chance so the target
  // allele still exists in the game at all. That escape is not optional — see cmdSweep's
  // "barn is missing the allele" column and §14 of the fix document.
  // 'quota' is the operator's proposal (2026-08-07) and is not a probability distribution at all:
  // a founding horse is DEALT a fixed number of alleles in each label bucket. At step 4 with 2
  // rungs per band and reach 6 rungs the buckets and the words coincide exactly —
  //   0-1 rungs out = Outstanding, 2-3 = Good, 4-5 = Acceptable, 6 = Weak
  // — so the founding rule is stated in the same vocabulary a child reads off the horse page:
  // "at the low band a founding horse gets 2 Outstanding alleles, 2 Weak, and 6 in between."
  // Nothing needs re-tuning when the pool shape changes, because there is no pool shape.
  foundingMode: 'peak',      // 'peak' | 'ring' | 'quota'

  // Alleles per bucket, in label order [Outstanding, Good, Acceptable, Weak]. Each row sums to the
  // horse's ten conformation alleles. The high band is the operator's own example: no Weak allele
  // at all, and six Outstanding.
  quota: { low: [2, 3, 3, 2], mid: [4, 3, 2, 1], high: [6, 3, 1, 0] },
  quotaSpread: true,         // spread same-bucket alleles across DIFFERENT traits where possible

  // 'pairs' pins the deal one step further: not just how many alleles of each bucket, but which
  // two share a trait. Every founding horse then has the same STRUCTURE - one trait carrying an
  // Outstanding-over-Good pair, one carrying Acceptable-over-Weak, and so on - and differs only in
  // WHICH trait is which. That is the operator's actual goal (2026-08-07): the children keep three
  // founders each, and one child drawing great horses while another draws duds is the bug. Variety
  // is supposed to arrive through the consignment barn, where every child can reach it equally.
  // Bucket indices are label order: 0 Outstanding, 1 Good, 2 Acceptable, 3 Weak.
  quotaPairs: {
    low:  [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3]],   // O2 G3 A3 W2
    mid:  [[0, 0], [0, 1], [0, 1], [1, 2], [2, 3]],   // O4 G3 A2 W1
    high: [[0, 0], [0, 0], [0, 1], [0, 1], [1, 2]],   // O6 G3 A1 W0
  },

  // The specialist assigned round-robin across a founding BATCH rather than drawn per horse. With
  // twelve founders and five traits an independent draw leaves some trait with no exact-target
  // allele anywhere in the barn about a third of the time - a trait that child can never breed
  // right. Round-robin makes coverage a certainty, and costs nothing else.
  specialistRoundRobin: false,
  mateRule: 'best',          // 'best' | 'spread' — see cmdDynasty
  ringTargetChance: 0.06,    // ring only: P(an allele IS exactly the target rung)
  ringHoleSuppression: 0,    // ring only: weight multiplier for alleles inside the hole (0 = hard hole)
  ringHoleRungs: 1,          // ring only: rungs either side of target also excluded (0 = target only)

  // Proposal 1 (2026-08-07): an inherited allele may move one rung. Solves "the target allele is
  // not in the game" without a ring escape, at the cost of the exact Punnett square. 0 = off.
  driftChance: 0,
  driftClamped: true,        // keep drifted alleles inside reachPoints of the breed standard

  // DECIDED 2026-08-07: inbreeding depression comes OFF conformation expression and onto fitness
  // (slice 0018, 0028-conformation-genetics.md §4 rule 2). Pass `--inbreeding 1` to measure the old way.
  inbreedingFactor: 0,                   // --inbreeding; 0 = COI depression off

  // §7.3's reframed slice 0019 conformation specialist.
  //   'fixed'   one trait homozygous at the breed target — the fix document as written
  //   'carrier' one target allele, the other drawn from the pool — good but not finished
  //   'none'    no conformation specialist at all
  specialist: 'fixed',

  // Mare prenatal care (see coaxGenotype). 0 = not bought, which is the honest default: in real
  // play it is a paid decision per covering, so a run with `--coax 1` is the upper bound, not the
  // expectation. DECIDED 2026-08-07: one step, worst-TRAIT mode, mechanic picks the trait.
  coaxSteps: 0,
  // What share of coverings actually buy care. 1 = every one (the upper bound the slice measured);
  // a real child pays 500 and a turn, so the honest question is what rate a line needs, not what
  // it does at 100%. Drawn from the foal's own seed, never Math.random.
  coaxChance: 1,
  coaxPolicy: 'worst',       // DECIDED — the allele furthest from standard ('finish' = the tested player's choice)
  coaxMode: 'shown',         // DECIDED — move the worst TRAIT one rung ('allele' loses ~half of purchases silently)

  // EXPRESSION RULE (asked 2026-08-07). How the two graded alleles become one shape.
  //   'average'  the fix document as written: the mean of the two, co-dominant.
  //   'random'   the horse EXPRESSES ONE OF ITS TWO ALLELES, drawn once at birth from its own
  //              seed and fixed for life; the twenty-allele modifier and noise then adjust that
  //              number. Mendelian dominance with the dominant allele picked per horse rather
  //              than per allele. Nothing about inheritance changes — only what a horse shows.
  //   'worst'    the horse shows whichever of its two alleles is FURTHER from its breed standard.
  //              Faults dominant, quality recessive. Added 2026-08-07: it is the only rule under
  //              which the shown number is both a real allele AND deterministic, so a horse reading
  //              Outstanding is necessarily homozygous at the standard — a child can identify a
  //              finished trait by looking, and cannot fake one.
  //   'best'     the horse shows whichever allele is CLOSER to the standard. Quality dominant —
  //              the mirror, and the same shape as the game's existing disease carriers: every
  //              good-looking horse may be hiding a fault, and only a test says which.
  // DECIDED 2026-08-07: 'worst'. This REVERSES the random pull taken earlier in conversation —
  // 'random' met the operator's "must be a real value" constraint but measured WORSE than averaging
  // (-4.0 vs -3.3), because a child selecting on looks is selecting on a coin flip.
  expression: 'worst',

  // Hard ceiling on how many of its five conformation traits a FOUNDING horse may read Outstanding
  // on. null = no ceiling. Operator's instruction, 2026-08-07: 4 at the low band, so the first
  // all-five horse in the game is always one somebody bred.
  founderMaxOutstanding: null,
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
// The proposed type gene — docs/slices/0028-conformation-genetics.md §2.2/§2.4
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
    if (ring && Math.abs(r - targetRung) <= PROP.ringHoleRungs) {
      // A SOFT hole (ringHoleSuppression > 0) keeps the near-target alleles rare rather than
      // absent. That distinction is load-bearing: a hard hole deletes them from the gene pool
      // for good, so a line climbing toward the standard has no intermediate rung to stand on
      // and must jump the whole gap in one lucky draw. Soft keeps the climb gradual and visible.
      w[r] = fallawayAt(d) * PROP.ringHoleSuppression;
      continue;
    }
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
/**
 * The label buckets, expressed in rungs of distance from the breed's own target. Bucket j covers
 * rungs [j*k, (j+1)*k - 1] where k is --rungs-per-band, and the last bucket is truncated by reach.
 * This is the SAME partition derivedLabelMins() uses, so a bucket and a word are one thing.
 */
function alleleBuckets() {
  const k = Math.max(1, PROP.rungsPerBand ?? 1);
  const R = reachRungs();
  const out = [];
  for (let lo = 0; lo <= R; lo += k) out.push([lo, Math.min(R, lo + k - 1)]);
  return out;
}

/**
 * QUOTA DEAL (operator, 2026-08-07). Deal exactly `quota[j]` alleles from bucket j into the ten
 * conformation slots, rather than drawing ten times from a distribution and hoping.
 *
 * Two details that matter and are easy to get wrong:
 *  - SIDE. A bucket is a distance; each allele still has to pick a side of the standard. For a
 *    breed whose target sits near an end of the 1-99 scale (Arabian head_profile, target 10) the
 *    far side does not exist, so the choice is forced inward rather than clamped onto the target -
 *    clamping would quietly manufacture correct alleles the quota never granted.
 *  - SPREAD. Two alleles from the same bucket landing on the same trait wastes the pairing: under
 *    random expression that trait shows the bucket either way, and a second trait shows nothing of
 *    it. quotaSpread deals each bucket across distinct traits first, which is what makes the ten
 *    alleles turn into five legible words instead of clumping.
 */
function dealQuota(breedCode, band, rng) {
  const buckets = alleleBuckets();
  const want = (PROP.quota[band] ?? PROP.quota.low).slice(0, buckets.length);
  const nSlots = CONF_TRAITS.length * 2;

  // One entry per allele: which bucket it came from.
  const bag = [];
  want.forEach((n, j) => { for (let i = 0; i < n; i++) bag.push(j); });
  while (bag.length < nSlots) bag.push(want.length - 1);
  bag.length = nSlots;

  // Slot order: trait 0 slot A, trait 1 slot A, ... then trait 0 slot B, ... so a bucket dealt in
  // sequence lands on five different traits before it ever doubles up on one.
  const slots = [];
  for (let half = 0; half < 2; half++) for (let t = 0; t < CONF_TRAITS.length; t++) slots.push([t, half]);
  if (!PROP.quotaSpread) for (let i = slots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (let i = bag.length - 1; i > 0; i--) { const j = rng.int(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }

  const g = {};
  for (const t of CONF_TRAITS) g[t] = [];
  slots.forEach(([ti, ], idx) => {
    const trait = CONF_TRAITS[ti];
    const [lo, hi] = buckets[bag[idx]];
    const target = nearestRung(BREEDS[breedCode].ideal[trait][0]);
    const dist = lo + rng.int(hi - lo + 1);
    const up = target + dist, down = target - dist;
    const okUp = up < rungCount(), okDown = down >= 0;
    const r = dist === 0 ? target
      : okUp && okDown ? (rng() < 0.5 ? up : down)
      : okUp ? up : okDown ? down : target;
    g[trait].push(r);
  });
  for (const t of CONF_TRAITS) g[t].sort((a, b) => a - b);
  return g;
}

/**
 * The pair deal. Five pair-specs, shuffled onto the five traits, each spec naming the two buckets
 * that trait's alleles come from. Every founding horse has the same shape; only the assignment of
 * shape to trait varies. `rungFor` picks the exact rung inside a bucket and the side of the
 * standard, forced inward where the far side would fall off the 1-99 scale.
 */
function dealPairs(breedCode, band, rng) {
  const buckets = alleleBuckets();
  const specs = (PROP.quotaPairs[band] ?? PROP.quotaPairs.low).map((p) => [...p]);
  for (let i = specs.length - 1; i > 0; i--) { const j = rng.int(i + 1); [specs[i], specs[j]] = [specs[j], specs[i]]; }

  const rungFor = (trait, bucketIdx) => {
    const [lo, hi] = buckets[Math.min(bucketIdx, buckets.length - 1)];
    const target = nearestRung(BREEDS[breedCode].ideal[trait][0]);
    const dist = lo + rng.int(hi - lo + 1);
    if (dist === 0) return target;
    const up = target + dist, down = target - dist;
    const okUp = up < rungCount(), okDown = down >= 0;
    return okUp && okDown ? (rng() < 0.5 ? up : down) : okUp ? up : okDown ? down : target;
  };

  const g = {};
  CONF_TRAITS.forEach((t, i) => {
    g[t] = [rungFor(t, specs[i][0]), rungFor(t, specs[i][1])].sort((a, b) => a - b);
  });
  return g;
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

function mintFounder(state, seed, mintIndex = null) {
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
    if (PROP.foundingMode === 'pairs') {
      g.type = dealPairs(state.breed, band, typeRng);
    } else if (PROP.foundingMode === 'quota') {
      g.type = dealQuota(state.breed, band, typeRng);
    } else {
      for (const t of CONF_TRAITS) {
        const pool = poolForTarget(nearestRung(breed.ideal[t][0]), band);
        g.type[t] = [drawFrom(pool, typeRng), drawFrom(pool, typeRng)].sort((a, b) => a - b);
      }
    }
  }

  // Slice 0019 Part A, reframed per §7.3: one conformation trait is set homozygous at the breed's
  // target rung, so a founding horse is not merely good at one thing but BREEDS ON for it.
  const cRng = streamFor(seed, 'specialist_choice_conformation');
  let cSpec = PROP.specialist === 'none' && state.engine === 'proposed' ? null
    : (PROP.specialistRoundRobin && mintIndex != null) ? CONF_TRAITS[mintIndex % CONF_TRAITS.length]
    : cRng.pick(CONF_TRAITS);
  if (state.engine === 'proposed') {
    if (cSpec !== null && (PROP.foundingMode === 'quota' || PROP.foundingMode === 'pairs')) {
      // The operator's own rule: do not hand the horse a correct allele out of nowhere — UPGRADE one
      // of the alleles it was already dealt in the closest bucket. The quota is the whole budget,
      // and the specialist spends it rather than adding to it. If the deal left nothing in the
      // closest bucket (a band whose quota grants none), the horse simply has no specialist.
      const [, hi] = alleleBuckets()[0];
      const cands = [];
      // Round-robin pins WHICH trait; without it, any allele already in the closest bucket is fair
      // game. Either way the upgrade spends an allele the deal already granted.
      const scope = PROP.specialistRoundRobin && mintIndex != null ? [cSpec] : CONF_TRAITS;
      for (const t of scope) {
        const target = nearestRung(breed.ideal[t][0]);
        g.type[t].forEach((r, i) => { if (Math.abs(r - target) <= hi) cands.push([t, i]); });
      }
      // Round-robin must not silently skip a trait: if its dealt pair holds nothing near enough to
      // upgrade, take the closer of the two anyway. Barn coverage is the whole point of the rule.
      if (!cands.length && PROP.specialistRoundRobin && mintIndex != null) {
        const target = nearestRung(breed.ideal[cSpec][0]);
        const i = Math.abs(g.type[cSpec][0] - target) <= Math.abs(g.type[cSpec][1] - target) ? 0 : 1;
        cands.push([cSpec, i]);
      }
      if (cands.length) {
        const [t, i] = cands[cRng.int(cands.length)];
        g.type[t][i] = nearestRung(breed.ideal[t][0]);
        g.type[t].sort((a, b) => a - b);
        cSpec = t;
      } else cSpec = null;
    } else if (cSpec !== null) {
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

  // CEILING ON A FOUNDING MINT (operator, 2026-08-07). A founding horse may read Outstanding on at
  // most `founderMaxOutstanding` of its five conformation traits. This is a hard floor under "there
  // is room to breed up" that does not go through the pool shape at all: whatever the pool is doing,
  // no child is handed a finished horse on day one, and the first all-five horse in the game must
  // be BRED. The specialist trait is never the one demoted — slice 0019's gift stands.
  const capN = PROP.founderMaxOutstanding;
  if (state.engine === 'proposed' && capN != null && capN < CONF_TRAITS.length) {
    const stub = { breed: state.breed, genotype: g, seed, coi: 0, ageYears: MATURITY_YEARS };
    const capRng = streamFor(seed, 'founder_outstanding_cap');
    const isOut = (t) => onTarget(confParts(state, stub, t).score);
    let over = CONF_TRAITS.filter(isOut);
    // Demote non-specialist traits first, in a seed-derived order, until the horse is under the cap.
    const order = CONF_TRAITS.filter((t) => t !== cSpec).sort(() => capRng() - 0.5);
    for (const t of order) {
      if (over.length <= capN) break;
      if (!isOut(t)) continue;
      const pool = poolForTarget(nearestRung(breed.ideal[t][0]), band);
      const before = g.type[t];
      for (let tries = 0; tries < 200 && isOut(t); tries++) {
        g.type[t] = [drawFrom(pool, capRng), drawFrom(pool, capRng)].sort((a, b) => a - b);
      }
      if (isOut(t)) g.type[t] = before;   // pool cannot produce a non-Outstanding draw; leave it
      over = CONF_TRAITS.filter(isOut);
    }
  }

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

/**
 * MARE PRENATAL CARE (operator, 2026-08-07). The operator's own framing, and it is a better one than
 * the young-horse programme this dial was first written for:
 *
 *   "running it doesn't change the mare's genes; it means that the baby foal's worst gene is moved
 *    towards standard"
 *
 * It attaches to the PREGNANCY, not to a horse, which is what makes it fit the game rather than sit
 * beside it:
 *
 *   - `pregnancies` already exists, already carries its own `rng_seed` and its own snapshotted
 *     gestation length (CLAUDE.md §5.5), and is already the thing the tick walks. One more
 *     snapshotted column on that row is the whole storage cost.
 *   - the decision is committed BEFORE the foal exists, so it can never be an undo on a bad roll.
 *     The player pays blind, which is a real decision rather than a correction.
 *   - it is capped at one per foal by construction. No lifetime counter to track, no way to stack.
 *   - the mare's own genotype is untouched. Nothing is inherited that she did not already carry;
 *     what changed is one allele in one foal, once, at the moment that foal was formed.
 *
 * The genetic rule is unchanged from the first draft and is what keeps it safe: the allele moves ONE
 * RUNG TOWARD the foal's own breed standard, never away and never past it. Breed type therefore
 * strictly improves and can never erode — the objection that sank random drift
 * (0028-conformation-genetics.md §2.7) — and an NPC stable that never buys it never moves.
 * It is directed and visible, so the breeding preview's Punnett square stays exact.
 *
 * `coaxPolicy` is which allele the money buys:
 *   'worst'   the allele furthest from the standard. THE OPERATOR'S SPECIFICATION, and under the
 *             `worst` expression rule it is also the allele the foal SHOWS — so the purchase is
 *             visibly rewarded on the foal's own card, every time, with no die roll.
 *   'finish'  the allele already CLOSEST to the standard without being on it — converts a trait the
 *             horse merely carries into one it breeds true for. What a tested player would prefer if
 *             the game let them choose.
 * The gap between the two is the argument for whether the player picks the trait or the mechanic does.
 */
function coaxGenotype(state, genotype, breedCode, steps, policy) {
  if (state.engine !== 'proposed' || steps <= 0) return genotype;
  for (let s = 0; s < steps; s++) {
    if (PROP.coaxMode === 'shown') { if (!coaxShownStep(genotype, breedCode)) break; continue; }
    let best = null;
    for (const t of CONF_TRAITS) {
      const target = nearestRung(BREEDS[breedCode].ideal[t][0]);
      genotype.type[t].forEach((r, i) => {
        const d = Math.abs(r - target);
        if (d === 0) return;                       // already correct; nothing to buy
        if (best === null || (policy === 'worst' ? d > best.d : d < best.d)) best = { t, i, d, target };
      });
    }
    if (best === null) break;                      // every allele already on standard
    const pair = genotype.type[best.t];
    pair[best.i] += pair[best.i] < best.target ? 1 : -1;
    pair.sort((a, b) => a - b);
  }
  return genotype;
}

/**
 * `coaxMode: 'shown'` — move the foal's WORST TRAIT one rung, whatever that costs in alleles.
 *
 * Added 2026-08-07 after the 'allele' mode was demonstrated failing in a way a child would
 * experience as pure bad luck: a foal that inherits the same bad allele from BOTH parents has one
 * copy improved and goes on showing the other, so the purchase is invisible. Roughly half of all
 * purchases, at random, with nothing on screen to explain it.
 *
 * This mode reads the operator's sentence the way a player would — "the baby foal's worst gene is
 * moved towards standard" means the weakest thing about the foal gets better — and is therefore
 * ALWAYS visible under the `worst` expression rule. On a heterozygote it costs one allele step; on a
 * homozygote it costs two, which is the honest price of the guarantee and is worth knowing about,
 * because it means the mechanic does twice as much genetic work in exactly the case a line is most
 * stuck. Measured against 'allele' in docs/slices/0028-conformation-genetics.md §2.7.
 */
function coaxShownStep(genotype, breedCode) {
  let worst = null;
  for (const t of CONF_TRAITS) {
    const target = nearestRung(BREEDS[breedCode].ideal[t][0]);
    const shownIdx = genotype.type[t][0] === genotype.type[t][1] ? 0
      : (Math.abs(genotype.type[t][0] - target) > Math.abs(genotype.type[t][1] - target) ? 0 : 1);
    const d = Math.abs(genotype.type[t][shownIdx] - target);
    if (d === 0) continue;
    if (worst === null || d > worst.d) worst = { t, d, target };
  }
  if (worst === null) return false;
  const pair = genotype.type[worst.t];
  // Move every copy that is currently the worst-placed one, so the shown value really does change.
  const far = Math.max(...pair.map((r) => Math.abs(r - worst.target)));
  pair.forEach((r, i) => { if (Math.abs(r - worst.target) === far) pair[i] += r < worst.target ? 1 : -1; });
  pair.sort((a, b) => a - b);
  return true;
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

/**
 * Which of a horse's two graded alleles it shows, under `expression: 'random'`. Drawn once from
 * the horse's OWN seed, so it is the same answer every time this is called — a horse does not
 * change shape between two renders of its own card.
 */
const expressedSide = (seed, trait) => streamFor(seed, `type_expression_${trait}`).int(2);

/**
 * Which of the two allele VALUES the horse shows, for the deterministic rules. `worst` and `best`
 * are measured against the horse's own breed standard, so the same pair reads differently for two
 * breeds — which is correct: an allele is only a fault relative to the standard it is judged by.
 */
function dominantValue(values, target, rule) {
  const [a, b] = values;
  const far = Math.abs(a - target) >= Math.abs(b - target);
  return rule === 'worst' ? (far ? a : b) : (far ? b : a);
}

/** The full arithmetic for one conformation trait, kept as data so the card can print every step. */
function confParts(state, horse, trait) {
  const g = horse.genotype;
  const noise = noiseFor(state, horse.seed)[trait];
  let typeValue = null, typeAlleles = null, modifier;
  if (state.engine === 'proposed') {
    typeAlleles = g.type[trait].map(rungValue);
    typeValue = PROP.expression === 'random'
      ? typeAlleles[expressedSide(horse.seed, trait)]
      : PROP.expression === 'worst' || PROP.expression === 'best'
        ? dominantValue(typeAlleles, targetFor(state, horse.breed, trait), PROP.expression)
        : (typeAlleles[0] + typeAlleles[1]) / 2;
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
      if (PROP.expression === 'random') {
        // The foal takes a from one parent and b from the other, then shows one of them, 50/50.
        m.set(rungValue(a), (m.get(rungValue(a)) ?? 0) + 0.125);
        m.set(rungValue(b), (m.get(rungValue(b)) ?? 0) + 0.125);
      } else if (PROP.expression === 'worst' || PROP.expression === 'best') {
        const v = dominantValue([rungValue(a), rungValue(b)], target, PROP.expression);
        m.set(v, (m.get(v) ?? 0) + 0.25);
      } else {
        const v = (rungValue(a) + rungValue(b)) / 2;
        m.set(v, (m.get(v) ?? 0) + 0.25);
      }
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
  'hole-suppression': ['ringHoleSuppression', Number],
  'mate': ['mateRule', String],
  'round-robin': ['specialistRoundRobin', (v) => v !== 'false' && v !== '0'],
  'quota-spread': ['quotaSpread', (v) => v !== 'false' && v !== '0'],
  'drift': ['driftChance', Number],
  'inbreeding': ['inbreedingFactor', Number],
  'drift-clamped': ['driftClamped', (v) => v !== 'false' && v !== '0'],
  'specialist': ['specialist', String],
  'coax': ['coaxSteps', Number],
  'coax-chance': ['coaxChance', Number],
  'coax-policy': ['coaxPolicy', String],
  'coax-mode': ['coaxMode', String],
  'expression': ['expression', String],
  'outstanding-within': ['outstandingWithin', Number],
  'labels': ['labels', String],
  'rungs-per-band': ['rungsPerBand', Number],
  'founder-max-outstanding': ['founderMaxOutstanding', Number],
};
function tuningFromFlags(flags) {
  const t = {};
  for (const [flag, [key, cast]] of Object.entries(TUNABLE)) {
    if (flags[flag] !== undefined) t[key] = cast(flags[flag]);
  }
  for (const b of ['low', 'mid', 'high']) {
    const v = flags[`quota-${b}`] ?? flags.quota;
    if (v !== undefined) { t.quota = { ...(t.quota ?? PROP.quota), [b]: String(v).split(',').map(Number) }; }
    const pv = flags[`pairs-${b}`] ?? flags.pairs;
    if (pv !== undefined) {
      t.quotaPairs = { ...(t.quotaPairs ?? PROP.quotaPairs),
        [b]: String(pv).split(',').map((x) => x.split('-').map(Number)) };
    }
  }
  if (flags.concentration !== undefined) {
    t.concentration = { low: Number(flags.concentration), mid: Number(flags.concentration), high: Number(flags.concentration) };
  }
  return t;
}
/**
 * The achievable distances from standard, in points, that the TYPE GENES ALONE can produce —
 * before the modifier and noise touch anything. Under 'average' a horse sits on a half-rung grid
 * (hom at target = 0, one correct allele = half a rung, and so on); under 'random' it can only ever
 * sit on a whole rung. This set is the real vocabulary of the system.
 */
function achievableDistances() {
  const step = PROP.expression === 'average' ? PROP.rungStep / 2 : PROP.rungStep;
  const out = [];
  for (let d = 0; d <= PROP.reachPoints * 2 + 1e-9; d += step) out.push(d);
  return out;
}
/**
 * Band edges placed at the MIDPOINTS between achievable distances, so each label names exactly one
 * genetic outcome rather than a range inherited from the old continuous scale. This is the
 * operator's own instruction (2026-08-07): the numbers should be re-derived from what is possible.
 */
function derivedLabelMins() {
  const d = achievableDistances();
  const k = Math.max(1, PROP.rungsPerBand ?? 1);
  // Each word covers k achievable steps; the edge sits between the last one it covers and the
  // first one it does not. With k > 1 the label deliberately SATURATES before the genes do —
  // a horse can read Outstanding and still have real distance left to breed out, which the show
  // score (continuous in distance) goes on rewarding after the word has stopped moving.
  const edge = (j) => {
    const lo = d[(j + 1) * k - 1], hi = d[(j + 1) * k];
    if (lo == null) return 0;
    if (hi == null) return 100 - lo * FALLOFF;
    return 100 - ((lo + hi) / 2) * FALLOFF;
  };
  return { outstanding: edge(0), good: edge(1), acceptable: edge(2), weak: edge(3) };
}

function applyTuning(tuning) {
  for (const [k, v] of Object.entries(tuning ?? {})) PROP[k] = v;
  if (PROP.labels === 'derived') Object.assign(LABEL_MIN, derivedLabelMins());
  if (PROP.outstandingWithin != null) LABEL_MIN.outstanding = 100 - PROP.outstandingWithin * FALLOFF;
  if (!['peak', 'ring', 'quota', 'pairs'].includes(PROP.foundingMode)) { console.error('--founding-mode must be "peak", "ring", "quota" or "pairs"'); process.exit(1); }
  if (!['fixed', 'carrier', 'none'].includes(PROP.specialist)) { console.error('--specialist must be "fixed", "carrier" or "none"'); process.exit(1); }
  if (!['average', 'random', 'worst', 'best'].includes(PROP.expression)) { console.error('--expression must be "average", "random", "worst" or "best"'); process.exit(1); }
  if (!['finish', 'worst'].includes(PROP.coaxPolicy)) { console.error('--coax-policy must be "finish" or "worst"'); process.exit(1); }
  if (!['allele', 'shown'].includes(PROP.coaxMode)) { console.error('--coax-mode must be "allele" or "shown"'); process.exit(1); }
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
    const { genotype, ageYears, specialists } = mintFounder(state, s, i);
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

function cmdBreed(state, path, a, b, foals, prenatal = 0) {
  const sire = state.horses[a - 1], dam = state.horses[b - 1];
  if (!sire || !dam) { console.error('Both ids must exist.'); process.exit(1); }
  const coi = kinship(state, a, b);
  console.log(`#${a} ${sire.name} x #${b} ${dam.name} — ${foals} foals   (COI ${(coi * 100).toFixed(1)}%)`);
  if (prenatal > 0) console.log(`  Mare prenatal care bought on this covering: each foal's worst trait moves ${prenatal} rung(s) toward standard.`);
  if (coi > 0 && PROP.inbreedingFactor > 0) console.log(`  Inbreeding depression is live: realization x ${(1 - coi * PROP.inbreedingFactor).toFixed(3)}, pulling every trait toward 50.`);
  else if (coi > 0) console.log(`  Inbreeding depression is OFF (--inbreeding 0). COI ${(coi * 100).toFixed(1)}% costs this foal nothing.`);
  console.log('');

  const made = [];
  for (let i = 0; i < foals; i++) {
    const s = deriveSeed(deriveSeed(state.seed, `foal_${a}_${b}_${state.horses.length}_${i}`), 'foal');
    const genotype = coaxGenotype(state, makeFoal(state, sire.genotype, dam.genotype, s),
      state.breed, prenatal, PROP.coaxPolicy);
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
    const { genotype, ageYears, specialists } = mintFounder(state, s, i);
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
  // The mirror of `blind`: traits holding a correct allele that do NOT read Outstanding — a good
  // gene a child cannot see and would cull. Under 'average' a het horse shows half its good allele;
  // under 'random' it shows either all of it or none of it.
  let hidden = 0, hiddenOf = 0;
  // The word census (2026-08-07). What FIVE WORDS does a founding horse actually show? This is the
  // band stated in the child's own vocabulary, and it is the only way to check a band rule written
  // as "always gets a Weak trait" actually delivers one. `worstSeen` is the floor the whole system
  // can reach: if Poor never appears, the word is unreachable and should be said to be.
  const words = { Outstanding: 0, Good: 0, Acceptable: 0, Weak: 0, Poor: 0 };
  let withWeakOrWorse = 0, maxDist = 0;
  const scoreList = [];
  for (const h of horses) {
    const parts = CONF_TRAITS.map((t) => confParts(state, h, t));
    // The false signal, measured: traits that READ Outstanding while carrying no correct allele.
    // A child selecting on looks breeds these and gets scatter. The finer the ladder, the more
    // allele pairs average to the right answer without either allele being right.
    if (state.engine === 'proposed') {
      for (const p of parts) {
        const holds = h.genotype.type[p.trait].includes(nearestRung(BREEDS[h.breed].ideal[p.trait][0]));
        if (onTarget(p.score)) { blindOf++; if (!holds) blind++; }
        if (holds) { hiddenOf++; if (!onTarget(p.score)) hidden++; }
      }
    }
    for (const p of parts) { words[label(p.score)]++; if (p.dist > maxDist) maxDist = p.dist; }
    if (parts.some((p) => label(p.score) === 'Weak' || label(p.score) === 'Poor')) withWeakOrWorse++;
    scoreList.push(conformationScore(state, h));
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
  return { n, score: score / n, on: on / n, fixed: fixed / n, carries: carries / n, dev: dev / n, wrongBreed: wrongBreed / n,
    blind: blindOf ? blind / blindOf : 0, hidden: hiddenOf ? hidden / hiddenOf : 0,
    words: Object.fromEntries(Object.entries(words).map(([k, v]) => [k, v / n])), withWeak: withWeakOrWorse / n, maxDist,
    scores: scoreList.sort((a, b) => a - b) };
}

/**
 * The dead-end risk, and the reason a ring pool needs an escape hatch: if a child's whole starting
 * barn holds no copy of the correct allele for some trait, that trait can never be bred right —
 * Mendelian inheritance shuffles alleles, it never invents one. Drift is the other way out.
 */
function barnMissRate(state, barnSize, trials, seedBase) {
  let anyMissing = 0, totalTraitsMissing = 0, anyStranded = 0;
  for (let k = 0; k < trials; k++) {
    const barn = mintPopulation(state, barnSize, deriveSeed(seedBase, `barn_${k}`));
    let missing = 0, stranded = 0;
    for (const t of CONF_TRAITS) {
      const target = nearestRung(BREEDS[state.breed].ideal[t][0]);
      const copies = barn.reduce((a, h) => a + h.genotype.type[t].filter((x) => x === target).length, 0);
      if (copies === 0) missing++;
      // STRANDED, added 2026-08-07 for the step-4 ladder. "No exact allele" is the wrong dead end
      // once mare prenatal care exists (§2.7): care moves an allele ONE RUNG toward the standard,
      // so a barn holding a one-rung-off allele can manufacture the exact one in a single covering.
      // A barn is only genuinely stuck on a trait when it holds nothing within one rung — which is
      // the number that should be read at step 4, where a rung is 4 points rather than 8.
      const near = barn.reduce((a, h) => a + h.genotype.type[t].filter((x) => Math.abs(x - target) <= 1).length, 0);
      if (near === 0) stranded++;
    }
    if (missing > 0) anyMissing++;
    if (stranded > 0) anyStranded++;
    totalTraitsMissing += missing;
  }
  return { any: anyMissing / trials, perBarn: totalTraitsMissing / trials, stranded: anyStranded / trials };
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
  console.log('  breed             band | score  on target  FIXED  carries | mean dev  wrong-breed  looks-right   carries-');
  console.log('                         |                                  |                       carries-      but-looks-');
  console.log('                         |                                  |                       nothing       wrong');
  console.log('  ----------------- ---- | -----  ---------  -----  ------- | --------  -----------  -----------   ----------');
  const wordRows = [];
  for (const breed of breeds) {
    for (const band of bands) {
      const state = { engine, breed, band, seed, horses: [] };
      const s = statsFor(state, mintPopulation(state, n, deriveSeed(seed, `${breed}_${band}`)));
      const miss = engine === 'proposed'
        ? barnMissRate(state, barn, 400, deriveSeed(seed, `miss_${breed}_${band}`))
        : { any: NaN, perBarn: NaN };
      console.log(`  ${pad(BREEDS[breed].name, 17)} ${pad(band, 4)} | ${padL(s.score.toFixed(1), 5)}  ${padL(s.on.toFixed(2), 4)} of 5  ${padL(s.fixed.toFixed(2), 5)}  ${padL(s.carries.toFixed(2), 7)} | ${padL(s.dev.toFixed(1), 8)}  ${padL((s.wrongBreed * 100).toFixed(1) + '%', 11)}  ${padL((s.blind * 100).toFixed(1) + '%', 11)}   ${padL((s.hidden * 100).toFixed(1) + '%', 10)}  [barn missing: ${engine === 'proposed' ? `${(miss.any * 100).toFixed(0)}% exact, ${(miss.stranded * 100).toFixed(0)}% stranded` : 'n/a'}]`);
      wordRows.push([`${pad(BREEDS[breed].name, 17)} ${pad(band, 4)}`, s]);
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
  console.log('');
  console.log('  THE SPREAD — how far apart the horses of one band actually are. The tails are the mean of');
  console.log('  the worst fifth and the best fifth, which is what a child comparing two barns sees.');
  console.log('');
  console.log('  breed             band | worst 20%    mean   best 20% | spread   worst   best');
  console.log('  ----------------- ---- | ---------  ------  --------- | ------  ------  -----');
  for (const [key, s] of wordRows) {
    const q = s.scores, k = Math.max(1, Math.round(q.length * 0.2));
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const lo = mean(q.slice(0, k)), hi = mean(q.slice(-k));
    console.log(`  ${pad(key, 22)} | ${padL(lo.toFixed(1), 9)}  ${padL(mean(q).toFixed(1), 6)}  ${padL(hi.toFixed(1), 9)} | ${padL((hi - lo).toFixed(1), 6)}  ${padL(q[0].toFixed(1), 6)}  ${padL(q[q.length - 1].toFixed(1), 5)}`);
  }
  console.log('');
  console.log('  THE WORD CENSUS — the five words a founding horse actually shows, averaged per horse.');
  console.log('  This is the band restated in the vocabulary a child reads, and the check on a band rule');
  console.log('  written as "always gets a Weak trait".');
  console.log('');
  console.log('  breed             band | Outstndg  Good  Accept   Weak   Poor | has a Weak+  worst seen');
  console.log('  ----------------- ---- | --------  ----  ------  -----  ----- | -----------  ----------');
  for (const [key, s] of wordRows) {
    console.log(`  ${pad(key, 22)} | ${padL(s.words.Outstanding.toFixed(2), 8)}  ${padL(s.words.Good.toFixed(2), 4)}  ${padL(s.words.Acceptable.toFixed(2), 6)}  ${padL(s.words.Weak.toFixed(2), 5)}  ${padL(s.words.Poor.toFixed(2), 5)} | ${padL((s.withWeak * 100).toFixed(0) + '%', 11)}  ${padL(s.maxDist.toFixed(0) + ' pts off', 10)}`);
  }
  console.log('');
  console.log('  stranded    share of starting barns holding nothing within ONE RUNG of the standard for');
  console.log('              some trait - the real dead end once prenatal care can walk an allele in.');
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
 * and it is much larger than anyone expected — see docs/slices/0028-conformation-genetics.md §3.
 */
function targetAlleleCount(h) {
  return CONF_TRAITS.reduce((a, t) => {
    const target = nearestRung(BREEDS[h.breed].ideal[t][0]);
    return a + h.genotype.type[t].filter((x) => x === target).length;
  }, 0);
}
/**
 * Total distance, in rungs, of all ten conformation alleles from their own breed's standard. This
 * is what a player who has BOUGHT THE TEST actually knows, and on a fine ladder it is a far better
 * signal than counting exact hits: at step 4 most horses carry zero exact alleles, so
 * targetAlleleCount cannot tell a horse one rung out from one six rungs out. Lower is better.
 */
function alleleDistance(h) {
  return CONF_TRAITS.reduce((a, t) => {
    const target = nearestRung(BREEDS[h.breed].ideal[t][0]);
    return a + h.genotype.type[t].reduce((b, x) => b + Math.abs(x - target), 0);
  }, 0);
}
function rankerFor(state, mode) {
  if (mode === 'tested' && state.engine === 'proposed') {
    return (a, b) => (alleleDistance(a) - alleleDistance(b)) || (conformationScore(state, b) - conformationScore(state, a));
  }
  return (a, b) => conformationScore(state, b) - conformationScore(state, a);
}

// The word index a label carries: 0 Outstanding .. 4 Poor, so "lower is better" sorts correctly
// and a bucket index from quotaPairs is the same number as the word it produces.
const WORD_ORDER = ['Outstanding', 'Good', 'Acceptable', 'Weak', 'Poor'];
const wordIndex = (w) => WORD_ORDER.indexOf(w);

/** A horse's five words as indices, best first - the thing a child compares between two horses. */
function wordProfile(state, h) {
  return CONF_TRAITS.map((t) => wordIndex(label(confParts(state, h, t).score))).sort((a, b) => a - b);
}

/**
 * The word profile a band DEALS, best first. Under the faults-dominant rule a pair shows its worse
 * allele, so a pair-spec's word is simply the higher of its two bucket indices - which is why the
 * band table can be read straight off quotaPairs with no simulation at all.
 */
function bandProfile(band) {
  return (PROP.quotaPairs[band] ?? PROP.quotaPairs.low).map((p) => Math.max(p[0], p[1])).sort((a, b) => a - b);
}

/**
 * "Is this foal a mid-band horse?" - true when its words are at least as good as that band's dealt
 * profile TRAIT FOR TRAIT, not on average. A horse with three Outstanding and two Weak does not
 * clear mid, and should not: the band is a shape, and the whole point of dealing it rather than
 * drawing it was that every horse of a band is the same shape.
 */
function meetsBand(state, h, band) {
  const mine = wordProfile(state, h), want = bandProfile(band);
  return mine.every((w, i) => w <= want[i]);
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
        const fg = coaxGenotype(state, makeFoal(state, sire.genotype, dam.genotype, fs), breed, PROP.coaxSteps, PROP.coaxPolicy);
        made.push(addHorse(state, { genotype: fg, ageYears: MATURITY_YEARS, sire: sire.id, dam: dam.id, seed: fs }));
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

/**
 * LEGIBILITY — added 2026-08-07 for the expression-rule question.
 *
 * The fix document's own headline test (§5.2): take two UNRELATED horses that both read Outstanding
 * on all five traits, roll foals, and ask how often the foal matches them. This is the number that
 * says whether a child can reason about a pairing from what they can see. COI is 0 throughout
 * (unrelated founders), so nothing here is inbreeding depression.
 */
function cmdLegibility(flags) {
  const engine = flags.engine ?? 'proposed';
  const breed = (flags.breed ?? 'AR').toUpperCase();
  const band = flags.band ?? 'low';
  const pairs = Number(flags.pairs ?? 300);
  const foals = Number(flags.foals ?? 20);
  const seed = Number(flags.seed ?? 7171);
  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  const state = { engine, breed, band, seed, horses: [] };
  const mature = (h) => ({ ...h, ageYears: MATURITY_YEARS, coi: 0 });

  // Mint until we have enough parents reading Outstanding on all five.
  const elite = [];
  for (let i = 0; elite.length < pairs * 2 && i < 400000; i++) {
    const s = deriveSeed(seed, `elite_${i}`);
    const f = mintFounder(state, s, i);
    const h = mature({ id: i + 1, breed, gen: 1, sire: null, dam: null, seed: s, genotype: f.genotype, specialists: f.specialists });
    if (CONF_TRAITS.every((t) => onTarget(confParts(state, h, t).score))) elite.push(h);
  }
  if (elite.length < 2) { console.error('Not enough Outstanding-on-all-five founders to form a pair.'); process.exit(1); }

  let allFive = 0, nFoals = 0, sumOn = 0, sumScore = 0;
  const perTrait = CONF_TRAITS.map(() => ({ on: 0, sumSq: 0, sum: 0, n: 0 }));
  const pairSds = [];
  for (let p = 0; p + 1 < elite.length && p / 2 < pairs; p += 2) {
    const sire = elite[p], dam = elite[p + 1];
    const vals = CONF_TRAITS.map(() => []);
    for (let i = 0; i < foals; i++) {
      const fs = deriveSeed(deriveSeed(seed, `leg_${p}_${i}`), 'foal');
      const foal = mature({ id: 0, breed, gen: 2, sire: 1, dam: 2, seed: fs, genotype: makeFoal(state, sire.genotype, dam.genotype, fs) });
      const parts = CONF_TRAITS.map((t) => confParts(state, foal, t));
      const on = parts.filter((q) => onTarget(q.score)).length;
      nFoals++; sumOn += on; sumScore += conformationScore(state, foal);
      if (on === CONF_TRAITS.length) allFive++;
      parts.forEach((q, k) => {
        if (onTarget(q.score)) perTrait[k].on++;
        perTrait[k].sum += q.mature; perTrait[k].sumSq += q.mature * q.mature; perTrait[k].n++;
        vals[k].push(q.mature);
      });
    }
    // Within-pairing SD: the spread of foals from ONE cross, which is what a player experiences.
    for (const v of vals) {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      pairSds.push(Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length));
    }
  }

  console.log(`LEGIBILITY — ${BREEDS[breed].name}, band ${band}, engine ${engine} | ${tuningNote(tuning)}`);
  if (engine === 'proposed') console.log(`Ladder: ${rungCount()} alleles, step ${PROP.rungStep}, reach +/-${PROP.reachPoints}, expression ${PROP.expression}`);
  console.log(`Both parents read Outstanding on all five. Unrelated, COI 0. ${nFoals} foals from ${Math.floor(nFoals / foals)} pairings.\n`);
  console.log(`  Foal matches both parents on ALL FIVE traits : ${(allFive / nFoals * 100).toFixed(1)}%`);
  console.log(`  Mean traits on target in a foal              : ${(sumOn / nFoals).toFixed(2)} of 5   (parents: 5.00)`);
  console.log(`  Mean conformation score of a foal            : ${(sumScore / nFoals).toFixed(1)}`);
  console.log(`  Within-pairing SD of a trait's mature value  : ${(pairSds.reduce((a, b) => a + b, 0) / pairSds.length).toFixed(1)} points  (show noise SD is ${SHOW_NOISE_SD})`);
  console.log('');
  console.log('  trait            P(foal Outstanding)');
  CONF_TRAITS.forEach((t, k) => console.log(`  ${pad(t, 16)} ${padL((perTrait[k].on / perTrait[k].n * 100).toFixed(1) + '%', 8)}`));
}

/**
 * DYNASTY — added 2026-08-07. "How many generations to the first genuinely good horse?"
 *
 * Unlike `programme`, this one has SEX and a LIFETIME BREEDING CAP, because both bind hard on the
 * answer: eight mares capped at four foats each is the real ceiling on how many rolls of the dice a
 * child gets, and no amount of selection pressure buys more of them.
 *
 * One round = one breeding cycle. Every broodmare with allowance left throws one foal; the foals
 * grow up and compete for a place in next round's herd. A round is a pedigree generation, not a
 * game year — a founding mare with allowance left can still breed in round 4.
 *
 * TWO finish lines are reported, and the gap between them is the whole point of the type gene:
 *   LOOKS   one horse reading Outstanding on all five traits. What a child sees and celebrates.
 *   FIXED   one horse homozygous at the standard on all five. It breeds on; the other may not.
 */
function cmdDynasty(flags) {
  const engine = flags.engine ?? 'proposed';
  const breed = (flags.breed ?? 'AR').toUpperCase();
  const band = flags.band ?? 'low';
  const nMares = Number(flags.mares ?? 8);
  const nStuds = Number(flags.studs ?? 4);
  const cap = Number(flags.cap ?? 4);
  const rounds = Number(flags.rounds ?? 12);
  const runs = Number(flags.runs ?? 400);
  const outcross = Number(flags.outcross ?? 0);
  const select = flags.select ?? 'score';
  if (!['score', 'tested', 'mixed'].includes(select)) { console.error('--select must be "score", "tested" or "mixed"'); process.exit(1); }
  // 'mixed' (operator, 2026-08-07): the honest middle. A child does not test every horse every
  // year - they buy the conformation panel now and then and breed on looks the rest of the time.
  // One round in `informedEvery` ranks on the genotype; the others rank on what the horse shows.
  const informedEvery = Number(flags['informed-every'] ?? 4);
  // Buy a replacement only WHEN SHORT, rather than a fixed number every round: with a breeding cap
  // a herd runs out of eligible mares on its own, and what a player actually does at that moment is
  // go to the market. --outcross (a fixed intake every round) is the older, blunter dial; the two
  // are independent and can both be on.
  const restock = flags.restock !== undefined && flags.restock !== 'false' && flags.restock !== '0';
  const buyBand = flags['buy-band'] ?? 'low';
  const goal = flags.goal ?? 'mid';
  const herd = Number(flags.herd ?? 0);          // 0 = keep every horse ever bred (the old behaviour)
  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  const isAllOutstanding = (state, h) => CONF_TRAITS.every((t) => onTarget(confParts(state, h, t).score));
  const isFixed = (h) => fixedCount(h) === CONF_TRAITS.length;

  const looksAt = new Array(rounds + 1).fill(0);   // runs whose FIRST looks-finished horse is round r
  const fixedAt = new Array(rounds + 1).fill(0);
  const goalAt = new Array(rounds + 1).fill(0);    // ... whose first foal meeting `goal` is round r
  let looksNever = 0, fixedNever = 0, goalNever = 0, totalFoals = 0, totalBought = 0, totalCare = 0;
  // Per-generation ledger: what the parents were worth, what the foals came out at, and the gap.
  // The mid-parent figure is the average of the ACTUAL sire and dam of each foal, not the herd
  // average, so "gain" is the honest answer to "did this mating move the line forward".
  const gen = Array.from({ length: rounds + 1 }, () => ({ n: 0, foal: 0, mid: 0, on: 0, fixed: 0, coi: 0, best: 0, runs: 0 }));

  for (let run = 0; run < runs; run++) {
    const state = { engine, breed, band, seed: Number(flags.seed ?? 31337), horses: [] };
    const memo = new Map();
    let firstLooks = null, firstFixed = null, firstGoal = null;

    const enrol = (h, sex) => { h.sex = sex; h.births = 0; return h; };
    for (let i = 0; i < nMares + nStuds; i++) {
      const s = deriveSeed(deriveSeed(state.seed, `dyn_run_${run}`), `founder_${i}`);
      const f = mintFounder(state, s, i);
      enrol(addHorse(state, { genotype: f.genotype, ageYears: MATURITY_YEARS, specialists: f.specialists, seed: s }),
        i < nMares ? 'F' : 'M');
    }
    {   // Generation F: the founding batch stands as its own parent-less row.
      const e = gen[0];
      for (const h of state.horses) {
        e.n++; e.foal += conformationScore(state, h); e.mid += conformationScore(state, h);
        e.on += CONF_TRAITS.filter((t) => onTarget(confParts(state, h, t).score)).length;
        e.fixed += fixedCount(h);
      }
      e.runs++; e.best += Math.max(...state.horses.map((h) => conformationScore(state, h)));
    }
    for (const h of state.horses) {
      if (firstLooks === null && isAllOutstanding(state, h)) firstLooks = 0;
      if (firstFixed === null && engine === 'proposed' && isFixed(h)) firstFixed = 0;
    }

    for (let r = 1; r <= rounds; r++) {
      // The ranker is chosen PER ROUND, not once for the run: under 'mixed' this round's culling
      // and mating either sees the genotype or does not, and which one it is decides the whole
      // round's decisions together, the way buying a panel in one season would.
      const rank = rankerFor(state, select === 'mixed' ? (r % informedEvery === 0 ? 'tested' : 'score') : select);
      // Restocking happens BEFORE selection, so a horse bought this round can be bred this round -
      // a purchase is a grown horse off the market, not a foal.
      if (restock) {
        const eligibleF = state.horses.filter((h) => !h.sold && h.sex === 'F' && h.births < cap).length;
        const eligibleM = state.horses.filter((h) => !h.sold && h.sex === 'M').length;
        const need = Math.max(0, nMares - eligibleF) + Math.max(0, nStuds - eligibleM);
        for (let i = 0; i < need; i++) {
          const bs = deriveSeed(deriveSeed(state.seed, `dyn_restock_${run}_${r}`), `${i}`);
          const savedBand = state.band;
          state.band = buyBand;
          const f = mintFounder(state, bs);
          state.band = savedBand;
          enrol(addHorse(state, { genotype: f.genotype, ageYears: MATURITY_YEARS, specialists: f.specialists, seed: bs }),
            i < Math.max(0, nMares - eligibleF) ? 'F' : 'M');
          totalBought++;
        }
      }
      const mares = state.horses.filter((h) => !h.sold && h.sex === 'F' && h.births < cap).sort(rank).slice(0, nMares);
      const studs = state.horses.filter((h) => !h.sold && h.sex === 'M').sort(rank).slice(0, nStuds);
      if (!mares.length || !studs.length) break;

      const made = [];
      mares.forEach((mare, mi) => {
        // 'best'   every mare to the highest-ranked stallion she is not closely related to. This is
        //          what a player optimising each mating does, and it concentrates the whole
        //          generation behind one sire - which inflates the mid-parent average and so makes
        //          regression to the mean look like a defect in the genetics.
        // 'spread' mares dealt round-robin across the available stallions. Same herd, far less
        //          selection intensity on the sire side; the difference between the two rows is
        //          how much of the parent-to-foal deficit is simply selection working.
        const k = studs.map((s) => kinship(state, mare.id, s.id, memo));
        let pick;
        if (PROP.mateRule === 'spread') {
          pick = mi % studs.length;
          if (k[pick] > 0.125) { const alt = studs.findIndex((_, i) => k[i] <= 0.125); if (alt >= 0) pick = alt; }
        } else {
          pick = studs.findIndex((_, i) => k[i] <= 0.125);
          if (pick < 0) pick = k.indexOf(Math.min(...k));
        }
        const stud = studs[pick];

        const fs = deriveSeed(deriveSeed(state.seed, `dyn_${run}_${r}_${mare.id}`), 'foal');
        // Coaxing is applied at birth and only to home-bred foals: a founding horse arrives already
        // grown (4-8y), past the window a young-horse programme could ever have reached.
        const boughtCare = PROP.coaxChance >= 1 || streamFor(fs, 'coax_bought')() < PROP.coaxChance;
        const foalG = coaxGenotype(state, makeFoal(state, stud.genotype, mare.genotype, fs),
          state.breed, boughtCare ? PROP.coaxSteps : 0, PROP.coaxPolicy);
        if (boughtCare && PROP.coaxSteps > 0) totalCare++;
        const foal = addHorse(state, { genotype: foalG,
          ageYears: MATURITY_YEARS, sire: stud.id, dam: mare.id, seed: fs });
        enrol(foal, streamFor(fs, 'sex')() < 0.5 ? 'F' : 'M');
        mare.births++;
        made.push(foal);
        totalFoals++;

        const e = gen[r];
        e.n++;
        e.foal += conformationScore(state, foal);
        e.mid += (conformationScore(state, stud) + conformationScore(state, mare)) / 2;
        e.on += CONF_TRAITS.filter((t) => onTarget(confParts(state, foal, t).score)).length;
        e.fixed += fixedCount(foal);
        e.coi += foal.coi;
      });
      for (let i = 0; i < outcross; i++) {
        const bs = deriveSeed(deriveSeed(state.seed, `dyn_buy_${run}_${r}`), `${i}`);
        const f = mintFounder(state, bs);
        enrol(addHorse(state, { genotype: f.genotype, ageYears: MATURITY_YEARS, specialists: f.specialists, seed: bs }),
          i % 2 === 0 ? 'F' : 'M');
      }
      for (const h of made) {
        if (firstLooks === null && isAllOutstanding(state, h)) firstLooks = r;
        if (firstFixed === null && engine === 'proposed' && isFixed(h)) firstFixed = r;
        if (firstGoal === null && engine === 'proposed' && meetsBand(state, h, goal)) firstGoal = r;
      }
      if (made.length) { gen[r].runs++; gen[r].best += Math.max(...made.map((h) => conformationScore(state, h))); }
      // STALLS (operator, 2026-08-07). Without this the herd keeps every foal it ever bred, so by
      // generation 8 a "5-horse barn" is selecting the best 3 mares out of twenty - which is not
      // the barn that was described, and it is the difference between never needing the market and
      // depending on it. Culling is done with the SAME ranker the round used, so on a blind round a
      // child sells the horse that looks worst, hidden good allele and all.
      if (herd > 0 && state.horses.length > herd) {
        const keep = new Set(state.horses.slice().sort(rank).slice(0, herd).map((h) => h.id));
        // Kinship reads the pedigree by id, so a culled horse is marked rather than spliced out.
        for (const h of state.horses) h.sold = !keep.has(h.id);
      }
      // NOTE: no early break. The per-generation ledger needs every round run to the end, and
      // stopping at the first finished horse would silently truncate the later rows.
    }

    if (firstLooks === null) looksNever++; else looksAt[firstLooks]++;
    if (firstFixed === null) fixedNever++; else fixedAt[firstFixed]++;
    if (firstGoal === null) goalNever++; else goalAt[firstGoal]++;
  }

  const quantile = (at, never, q) => {
    let c = 0;
    for (let r = 0; r < at.length; r++) { c += at[r]; if (c / runs >= q) return `${r}`; }
    return `>${rounds}`;
  };

  console.log(`DYNASTY — ${BREEDS[breed].name}, band ${band}, engine ${engine} | ${tuningNote(tuning)}`);
  if (engine === 'proposed') console.log(`Ladder: ${rungCount()} alleles, step ${PROP.rungStep}, expression ${PROP.expression}, specialist ${PROP.specialist}`);
  console.log(`${nMares} founding mares + ${nStuds} founding stallions. Each mare may be bred ${cap} times in her life.`);
  console.log(`One foal per broodmare per round, best ${nMares} mares and best ${nStuds} stallions kept, ` +
    `${herd ? `${herd} stalls` : 'unlimited stalls'}, ` +
    `${outcross ? `${outcross} bought in per round` : restock ? `a ${buyBand}-band horse bought whenever the breeding set is short` : 'closed herd, nothing bought in'}.`);
  if (PROP.coaxSteps > 0) console.log(`Mare prenatal care: ${PROP.coaxSteps} rung(s) on ${(PROP.coaxChance * 100).toFixed(0)}% of coverings.`);
  console.log(select === 'tested' ? 'Selection is on TESTED genotype.'
    : select === 'mixed' ? `Selection reads the genotype 1 round in ${informedEvery}; on the others it reads only what a horse shows.`
    : 'Selection is on visible score — a child who has not tested cannot see genes.');
  console.log(`${runs} runs, ${rounds} rounds each, ${(totalFoals / runs).toFixed(0)} foals bred per run on average.\n`);

  console.log('  gen |  parents   foals    gain | on target  FIXED   best foal   COI');
  console.log('  --- |  -------   -----    ---- | ---------  -----   ---------   ---');
  for (let r = 0; r <= rounds; r++) {
    const e = gen[r];
    if (!e.n) continue;
    const mid = e.mid / e.n, foal = e.foal / e.n, g = foal - mid;
    console.log(`  ${padL(r === 0 ? 'F' : r, 3)} | ${padL(mid.toFixed(1), 8)} ${padL(foal.toFixed(1), 7)} ` +
      `${padL((g >= 0 ? '+' : '') + g.toFixed(1), 7)} | ${padL((e.on / e.n).toFixed(2), 6)} of 5 ` +
      `${padL((e.fixed / e.n).toFixed(2), 6)}  ${padL((e.best / e.runs).toFixed(1), 9)}   ${padL(((e.coi / e.n) * 100).toFixed(1) + '%', 5)}`);
  }
  console.log('\n  "parents" is the mean of each foal\'s own sire and dam, so "gain" is what the mating');
  console.log('  actually bought over the two horses that went into it. Row F is the founding batch.\n');
  console.log('  gen | first horse Outstanding on all 5 | first horse FIXED on all 5');
  console.log('      |  this gen    cumulative          |  this gen    cumulative');
  console.log('  --- | ---------    ----------          | ---------    ----------');
  let cl = 0, cf = 0;
  for (let r = 0; r <= rounds; r++) {
    cl += looksAt[r]; cf += fixedAt[r];
    const tag = r === 0 ? '  F' : padL(r, 3);
    console.log(`  ${tag} | ${padL((looksAt[r] / runs * 100).toFixed(1) + '%', 8)}    ${padL((cl / runs * 100).toFixed(1) + '%', 8)}           | ${padL((fixedAt[r] / runs * 100).toFixed(1) + '%', 8)}    ${padL((cf / runs * 100).toFixed(1) + '%', 8)}`);
  }
  console.log('');
  console.log(`  Outstanding on all 5 — earliest 10% of runs: gen ${quantile(looksAt, looksNever, 0.10)}, median gen ${quantile(looksAt, looksNever, 0.50)}, 90% of runs by gen ${quantile(looksAt, looksNever, 0.90)}`);
  if (engine === 'proposed') {
    console.log(`  FIXED on all 5       — earliest 10% of runs: gen ${quantile(fixedAt, fixedNever, 0.10)}, median gen ${quantile(fixedAt, fixedNever, 0.50)}, 90% of runs by gen ${quantile(fixedAt, fixedNever, 0.90)}`);
  }
  console.log(`  Runs that never got there in ${rounds} generations: ${(looksNever / runs * 100).toFixed(1)}% (looks), ${(fixedNever / runs * 100).toFixed(1)}% (fixed)`);
  if (engine === 'proposed') {
    const words = bandProfile(goal).map((w) => WORD_ORDER[w]).join(', ');
    let cg = 0;
    console.log(`\n  A "${goal}-band" FOAL — words at least as good as ${words}, trait for trait.\n`);
    console.log('  gen | this gen   cumulative');
    console.log('  --- | --------   ----------');
    for (let r = 1; r <= rounds; r++) {
      cg += goalAt[r];
      console.log(`  ${padL(r, 3)} | ${padL((goalAt[r] / runs * 100).toFixed(1) + '%', 8)}   ${padL((cg / runs * 100).toFixed(1) + '%', 8)}`);
    }
    console.log(`\n  First ${goal}-band foal — earliest 10% of runs: gen ${quantile(goalAt, goalNever, 0.10)}, median gen ${quantile(goalAt, goalNever, 0.50)}, 90% of runs by gen ${quantile(goalAt, goalNever, 0.90)}`);
    console.log(`  Runs with no ${goal}-band foal in ${rounds} generations: ${(goalNever / runs * 100).toFixed(1)}%`);
    console.log(`  Horses bought in: ${(totalBought / runs).toFixed(1)} per run, ${(totalFoals / runs).toFixed(1)} foals bred per run, ` +
      `prenatal care bought ${(totalCare / runs).toFixed(1)} times per run.`);
  }
  console.log('\n  "F" is the founding batch itself — a run scoring there was handed a finished horse on day one.');
}

/**
 * BANDS — added 2026-08-07 on the operator's instruction that the label thresholds be re-derived
 * from what the new system can actually produce, rather than carried over from the old scale.
 *
 * Prints the vocabulary: what each achievable distance from standard MEANS genetically, what word
 * it gets, and then the thing that decides whether the word is trustworthy — how often the modifier
 * and birth noise together push a horse into the wrong band. A label that names a genotype is only
 * worth having if it names it reliably.
 */
function cmdBands(flags) {
  const breed = (flags.breed ?? 'AR').toUpperCase();
  const band = flags.band ?? 'low';
  const n = Number(flags.n ?? 20000);
  const seed = Number(flags.seed ?? 8080);
  const tuning = { labels: 'derived', ...tuningFromFlags(flags) };
  applyTuning(tuning);

  const state = { engine: 'proposed', breed, band, seed, horses: [] };
  const d = achievableDistances();

  console.log(`LABEL BANDS — ${BREEDS[breed].name}, band ${band} | ${tuningNote(tuning)}`);
  console.log(`Ladder: step ${PROP.rungStep}, expression ${PROP.expression}, modifier +/-${(LOCI_PER_TRAIT * PROP.modifierStep).toFixed(2)}, noise SD ${PROP.noiseSd}\n`);

  const k = Math.max(1, PROP.rungsPerBand ?? 1);
  const unit = PROP.expression === 'average' ? 'half-rung' : 'rung';
  console.log(`  Each word covers ${k} ${unit}${k > 1 ? 's' : ''} of distance from the standard.\n`);
  console.log('  distance      what the horse is showing                     word');
  console.log('  ------------  -------------------------------------------   -----------');
  const words = ['Outstanding', 'Good', 'Acceptable', 'Weak'];
  for (let j = 0; j < 4; j++) {
    const lo = j * k, hi = (j + 1) * k - 1;
    if (d[lo] == null) break;
    const span = k === 1 ? `${d[lo]} pts` : `${d[lo]}-${d[hi] ?? '+'} pts`;
    const steps = k === 1 ? `${lo} ${unit}s out` : `${lo}-${hi} ${unit}s out`;
    console.log(`  ${pad(span, 12)}  ${pad(steps + (lo === 0 ? ' (0 = the standard allele itself)' : ''), 43)}   ${words[j]}`);
  }
  console.log(`  ${pad('further', 12)}  ${pad('beyond that', 43)}   Poor`);
  console.log(`\n  Derived thresholds: Outstanding >=${LABEL_MIN.outstanding.toFixed(1)}, Good >=${LABEL_MIN.good.toFixed(1)}, ` +
    `Acceptable >=${LABEL_MIN.acceptable.toFixed(1)}, Weak >=${LABEL_MIN.weak.toFixed(1)}`);
  console.log(`  A horse crosses a boundary if modifier + noise moves it more than ${((d[1] - d[0]) / 2).toFixed(1)} points.\n`);

  // How often does the word a player reads match the word the type genes alone deserve?
  const purity = (modStep, noiseSd) => {
    const savedM = PROP.modifierStep, savedN = PROP.noiseSd;
    PROP.modifierStep = modStep; PROP.noiseSd = noiseSd;
    let right = 0, total = 0, outstandingHom = 0, outstandingAll = 0;
    for (const h of mintPopulation(state, n, deriveSeed(seed, `p_${modStep}_${noiseSd}`))) {
      for (const t of CONF_TRAITS) {
        const p = confParts(state, h, t);
        const pureDist = Math.abs(p.typeValue - p.target);
        const pureLabel = label(Math.max(0, 100 - pureDist * FALLOFF));
        const shown = label(p.score);
        total++; if (shown === pureLabel) right++;
        if (shown === 'Outstanding') {
          outstandingAll++;
          const tg = nearestRung(BREEDS[h.breed].ideal[t][0]);
          if (h.genotype.type[t][0] === tg && h.genotype.type[t][1] === tg) outstandingHom++;
        }
      }
    }
    PROP.modifierStep = savedM; PROP.noiseSd = savedN;
    return { agree: right / total, homGivenOutstanding: outstandingAll ? outstandingHom / outstandingAll : 0 };
  };

  console.log('  How often does the word match what the genes alone deserve, and does "Outstanding"');
  console.log('  really mean homozygous-at-standard? (rows: modifier range; columns: noise SD)\n');
  const mods = (flags.mods ?? '0.10,0.15,0.25,0.40,0.75').split(',').map(Number);
  const noises = (flags.noises ?? '0.5,1,2,3').split(',').map(Number);
  console.log('    modifier  |' + noises.map((s) => padL(`sd ${s}`, 16)).join(''));
  console.log('    --------- |' + noises.map(() => '  --------------').join(''));
  for (const m of mods) {
    const cells = noises.map((s) => {
      const r = purity(m, s);
      return padL(`${(r.agree * 100).toFixed(0)}% / ${(r.homGivenOutstanding * 100).toFixed(0)}%`, 16);
    });
    console.log(`    +/-${padL((LOCI_PER_TRAIT * m).toFixed(2), 6)} |` + cells.join(''));
  }
  console.log('\n    first number  = word matches the genotype it should name');
  console.log('    second number = share of Outstanding traits that really are homozygous at standard');
  console.log('                    (this is the number a child\'s breeding decisions rest on)');
}

/**
 * FAIRNESS — added 2026-08-07, and it is the measurement the whole quota/pair design exists for.
 *
 * The operator's report: the children keep three founders each out of a shared batch, and one child
 * keeps drawing great horses while another draws duds. That is not a flavour complaint - it decides
 * who can compete for the next year of real play. So the number to minimise is not the spread of
 * ALL founders, it is the gap between the luckiest child and the unluckiest one.
 */
function cmdFairness(flags) {
  const engine = flags.engine ?? 'proposed';
  const breed = (flags.breed ?? 'AR').toUpperCase();
  const band = flags.band ?? 'low';
  const kids = Number(flags.kids ?? 4);
  const each = Number(flags.each ?? 3);
  const batches = Number(flags.batches ?? 3000);
  const seed = Number(flags.seed ?? 606);
  const tuning = tuningFromFlags(flags);
  applyTuning(tuning);

  const state = { engine, breed, band, seed, horses: [] };
  let gapScore = 0, gapOn = 0, sd = 0, worst = 0, best = 0;
  for (let b = 0; b < batches; b++) {
    const herd = mintPopulation(state, kids * each, deriveSeed(seed, `batch_${b}`))
      .map((h) => ({ ...h, ageYears: MATURITY_YEARS, coi: 0 }));
    const scores = herd.map((h) => conformationScore(state, h));
    const ons = herd.map((h) => CONF_TRAITS.filter((t) => onTarget(confParts(state, h, t).score)).length);
    const mean = scores.reduce((a, x) => a + x, 0) / scores.length;
    sd += Math.sqrt(scores.reduce((a, x) => a + (x - mean) ** 2, 0) / scores.length);

    const idx = [...herd.keys()];
    const r = streamFor(deriveSeed(seed, `split_${b}`), 'split');
    for (let i = idx.length - 1; i > 0; i--) { const j = r.int(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const perKid = [];
    for (let k = 0; k < kids; k++) {
      const mine = idx.slice(k * each, (k + 1) * each);
      perKid.push([mine.reduce((a, i) => a + scores[i], 0) / each, mine.reduce((a, i) => a + ons[i], 0) / each]);
    }
    const s = perKid.map((x) => x[0]), o = perKid.map((x) => x[1]);
    gapScore += Math.max(...s) - Math.min(...s);
    gapOn += Math.max(...o) - Math.min(...o);
    best += Math.max(...s); worst += Math.min(...s);
  }

  console.log(`FAIRNESS — ${BREEDS[breed].name}, band ${band} | ${tuningNote(tuning)}`);
  console.log(`${kids} children keeping ${each} founders each from a shared batch of ${kids * each}, over ${batches} batches.\n`);
  console.log(`  SD of a single founder's score          : ${(sd / batches).toFixed(2)} points`);
  console.log(`  Luckiest child's 3 average              : ${(best / batches).toFixed(1)}`);
  console.log(`  Unluckiest child's 3 average            : ${(worst / batches).toFixed(1)}`);
  console.log(`  GAP between them                        : ${(gapScore / batches).toFixed(1)} points  (show noise SD is ${SHOW_NOISE_SD})`);
  console.log(`  GAP in traits on target                 : ${(gapOn / batches).toFixed(2)} of 5`);
  console.log('\n  The gap is the number that decides whether two children can compete with each other.');
  console.log(`  A gap under about ${SHOW_NOISE_SD} points is smaller than the luck in a single show.`);
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
    // Dials passed on `breed` override the ones stored by `new`, so a single covering can be run
    // under a different rule without rebuilding the lab. Without this they were silently ignored.
    applyTuning(tuningFromFlags(flags));
    cmdBreed(state, statePath, Number(positional[0]), Number(positional[1]), Number(flags.foals ?? 5),
      flags.prenatal === undefined ? 0 : (flags.prenatal === true ? 1 : Number(flags.prenatal)));
    break;
  }
  case 'pedigree': cmdPedigree(loadState(statePath), Number(positional[0])); break;
  case 'summary': cmdSummary(loadState(statePath)); break;
  case 'sweep': cmdSweep(flags); break;
  case 'programme': case 'program': cmdProgramme(flags); break;
  case 'legibility': cmdLegibility(flags); break;
  case 'dynasty': cmdDynasty(flags); break;
  case 'bands': cmdBands(flags); break;
  case 'fairness': cmdFairness(flags); break;
  case 'reset':
    if (existsSync(statePath)) { unlinkSync(statePath); console.log(`Deleted ${statePath}.`); }
    else console.log('Nothing to delete.');
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 48).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
