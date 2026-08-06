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
//   reset                             Delete the state file.
//
//   --state <path>   Use a different state file, so two labs can run side by side — e.g. one at
//                    --engine proposed and one at --engine today, for a like-for-like comparison.
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
const PROP = {
  rungStep: 8, rungBase: 2, rungCount: 13,   // §4.2 — the allele ladder: 2, 10, 18, ... 98
  modifierStep: 0.75,                        // §4.3 — the demoted twenty-allele block
  noiseSd: 2,                                // §7.1 — conformation_noise_sd 6 -> 2
  abilityOneChance: { low: 0.42, mid: 0.50, high: 0.58 },   // §9/0177 — TODAY'S values, unchanged
  concentration: { low: 0.35, mid: 0.55, high: 0.75 },      // §4.4 — P(allele is the target rung)
  fallaway: [0.45, 0.18, 0.06],                             // §4.4 — by rungs from target
};

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
const nearestRung = (v) => Math.max(0, Math.min(PROP.rungCount - 1, Math.round((v - PROP.rungBase) / PROP.rungStep)));

/** §4.6: every breed target is re-seeded onto a rung. Each moves by at most 4 points. */
function snappedTarget(breedCode, trait) {
  return rungValue(nearestRung(BREEDS[breedCode].ideal[trait][0]));
}
function targetFor(state, breedCode, trait) {
  return state.engine === 'proposed' ? snappedTarget(breedCode, trait) : BREEDS[breedCode].ideal[trait][0];
}

/** §4.4: derived from the breed's own target and the band — never hand-written per breed. */
function poolForTarget(targetRung, band) {
  const w = new Array(PROP.rungCount).fill(0);
  w[targetRung] = PROP.concentration[band];
  for (let d = 1; d <= PROP.fallaway.length; d++) {
    for (const r of [targetRung - d, targetRung + d]) {
      if (r >= 0 && r < PROP.rungCount) w[r] = PROP.fallaway[d - 1] * (1 - PROP.concentration[band]);
    }
  }
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
  const cSpec = cRng.pick(CONF_TRAITS);
  if (state.engine === 'proposed') {
    const r = nearestRung(breed.ideal[cSpec][0]);
    g.type[cSpec] = [r, r];
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

function makeFoal(state, sireG, damG, seed) {
  const g = { type: {}, poly: {} };
  const tRng = streamFor(seed, 'type_meiosis');
  const pRng = streamFor(seed, 'polygenic_meiosis');
  if (state.engine === 'proposed') {
    for (const t of CONF_TRAITS) {
      g.type[t] = [sireG.type[t][tRng.int(2)], damG.type[t][tRng.int(2)]].sort((a, b) => a - b);
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
  Math.min(1, REALIZATION_AT_BIRTH + (1 - REALIZATION_AT_BIRTH) * (ageYears / MATURITY_YEARS)) * (1 - coi * INBREEDING_FACTOR);
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
function loadState(path) {
  if (!existsSync(path)) { console.error(`No lab at ${path}. Run "new" first.`); process.exit(1); }
  return JSON.parse(readFileSync(path, 'utf8'));
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

  const state = { engine, breed, band, seed, horses: [] };
  for (let i = 0; i < n; i++) {
    const s = deriveSeed(seed, `founder_${i}`);
    const { genotype, ageYears, specialists } = mintFounder(state, s);
    addHorse(state, { genotype, ageYears, specialists, seed: s });
  }
  saveState(path, state);

  console.log(`Lab started: ${n} ${BREEDS[breed].name}s, engine "${engine}", band "${band}", seed ${seed}.`);
  console.log(`No sex — any horse can be crossed with any other, including itself.`);
  if (engine === 'proposed') {
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
  if (coi > 0) console.log(`  Inbreeding depression is live: realization x ${(1 - coi * INBREEDING_FACTOR).toFixed(3)}, pulling every trait toward 50.`);
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

function cmdPedigree(state, id) {
  const h = state.horses[id - 1];
  if (!h) { console.error(`No horse #${id}.`); process.exit(1); }
  const walk = (x, depth, prefix) => {
    if (!x || depth > 4) return;
    console.log(`${prefix}#${x.id} ${x.name} (gen ${x.gen}${x.coi > 0 ? `, COI ${(x.coi * 100).toFixed(1)}%` : ''})`);
    if (x.sire) { walk(state.horses[x.sire - 1], depth + 1, prefix + '  |- '); walk(state.horses[x.dam - 1], depth + 1, prefix + '  |- '); }
  };
  walk(h, 0, '  ');
  console.log(`\n  Inbreeding coefficient: ${(h.coi * 100).toFixed(2)}%  ->  realization x ${(1 - h.coi * INBREEDING_FACTOR).toFixed(3)}`);
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
  case 'reset':
    if (existsSync(statePath)) { unlinkSync(statePath); console.log(`Deleted ${statePath}.`); }
    else console.log('Nothing to delete.');
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 48).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
