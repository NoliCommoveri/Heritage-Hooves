#!/usr/bin/env node
//
// Population-genetics simulation of the live conformation/showing formulas.
// Run with:  node docs/analysis/population-sim.mjs
//
// WHY THIS EXISTS
// ---------------
// The question "does selective breeding actually get anywhere in this game?" cannot be answered by
// playing, because the answer takes ~2 real years to arrive. This script answers it in a second by
// running the real formulas over a simulated closed population, and it is the evidence behind
// `docs/slices/0018-genetic-progress-and-inbreeding.md`.
//
// It is an ANALYSIS TOOL, not a test and not game code:
//   - It lives in docs/, not src/ and not test/, on purpose. It is not picked up by `vitest run`
//     (that only collects *.test.ts), and nothing in src/ imports it.
//   - It uses its own PRNG rather than src/lib/rng. CLAUDE.md §5.2's "no Math.random(), ever" rule
//     is about the GAME being reproducible from stored seeds; this file is seeded too (so a run is
//     repeatable) but deliberately keeps no dependency on the game's own modules, so it cannot
//     break a deploy and does not need updating when rng.ts changes.
//
// KEEPING IT HONEST
// -----------------
// Every constant in the CONSTANTS block below is copied from a migration or an engine, with the
// source named. If you retune any of those, retune them here too and re-run — a drifted copy is
// worse than no simulation at all. The formulas in `expressedTrait` and `rawScore` mirror
// src/engines/conformation/model.ts and src/engines/showing/score.ts; if either changes shape,
// this file is wrong until it is updated to match.
//
// WHAT IT DELIBERATELY SIMPLIFIES
// ------------------------------
//   - Discrete generations. The real game has overlapping ones; this overstates the speed of
//     response per generation but not the plateau it arrives at, which is the thing being measured.
//   - Conformation traits only. Ability traits, fertility, health, care, age decline and the market
//     are all absent — this measures the conformation-show selection loop in isolation.
//   - Every mare conceives. Fertility (including its own COI penalty) is not modelled, so the real
//     game's inbreeding cost is UNDERSTATED here, not overstated.

// ---------------------------------------------------------------------------
// CONSTANTS — each copied from the live source named beside it
// ---------------------------------------------------------------------------

// migrations/0035_seed_qh_ideal_vector.sql
const IDEAL = {
  neck_length:    { target: 55, weight: 1.0 },
  shoulder_angle: { target: 70, weight: 1.2 },
  back_length:    { target: 35, weight: 1.1 },
  hock_set:       { target: 50, weight: 0.9 },
};
const TRAITS = Object.keys(IDEAL);

const LOCI_PER_TRAIT = 10;   // src/engines/genetics/polygenic.ts
const PEDIGREE_DEPTH = 6;    // src/engines/genetics/loci.ts
const FALLOFF = 2.0;         // show_ideal_falloff,  migrations/0041_config_shows.sql
const SHOW_NOISE_SD = 5;     // show_noise_sd,       migrations/0041_config_shows.sql

// Defaults, overridable per scenario below.
const DEFAULT_NOISE_SD = 6;          // conformation_noise_sd,          migrations/0031
const DEFAULT_INBREEDING_FACTOR = 1; // inbreeding_depression_factor,   migrations/0031

// The potential (count of '1' alleles out of 20) that lands each trait exactly on its target,
// since geneticValue = potential * 5. This is the "genetically perfect Quarter Horse".
const PERFECT = {};
for (const tr of TRAITS) PERFECT[tr] = IDEAL[tr].target / 5;

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — every scenario is reproducible from its seed.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(1);
function normal(mean, sd) {
  const u = Math.max(1e-12, rnd()), v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// The live formulas
// ---------------------------------------------------------------------------

let NOISE_SD = DEFAULT_NOISE_SD;
let INBREEDING_FACTOR = DEFAULT_INBREEDING_FACTOR;

function potentialOf(horse, trait) {
  const alleles = horse.poly[trait];
  let count = 0;
  for (let i = 0; i < alleles.length; i++) count += alleles[i];
  return count;
}

/** src/engines/conformation/model.ts — realization() at full maturity, geneticValue(),
 *  expressedValue() with the bidirectional anchor of 50. */
function expressedTrait(horse, trait) {
  const geneticValue = Math.min(99, Math.max(1, potentialOf(horse, trait) * 5 + horse.noise[trait]));
  const realization = 1 - horse.coi * INBREEDING_FACTOR;
  return 50 + (geneticValue - 50) * realization;
}

/** src/engines/showing/score.ts — scoreEntry()'s rawScore, judge weights held at 1.0. */
function rawScore(horse) {
  let weighted = 0, weightSum = 0;
  for (const trait of TRAITS) {
    const distance = Math.abs(expressedTrait(horse, trait) - IDEAL[trait].target);
    weighted += IDEAL[trait].weight * Math.max(0, 100 - distance * FALLOFF);
    weightSum += IDEAL[trait].weight;
  }
  return weighted / weightSum;
}

// ---------------------------------------------------------------------------
// Horses
// ---------------------------------------------------------------------------

let nextId = 1;
function drawNoise() {
  const noise = {};
  for (const trait of TRAITS) noise[trait] = Math.round(normal(0, NOISE_SD));
  return noise;
}

/** src/engines/founding/generate.ts — every allele drawn independently at the band's chance. */
function makeFounder(oneChance, sex) {
  const poly = {};
  for (const trait of TRAITS) {
    const alleles = new Uint8Array(LOCI_PER_TRAIT * 2);
    for (let i = 0; i < alleles.length; i++) alleles[i] = rnd() < oneChance ? 1 : 0;
    poly[trait] = alleles;
  }
  return { id: nextId++, sire: null, dam: null, sex, poly, noise: drawNoise(), coi: 0 };
}

/** src/engines/genetics/polygenic.ts — inheritPolygenic(): one allele per locus from each parent. */
function breed(sire, dam, sex, coi) {
  const poly = {};
  for (const trait of TRAITS) {
    const s = sire.poly[trait], d = dam.poly[trait];
    const alleles = new Uint8Array(LOCI_PER_TRAIT * 2);
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      alleles[i * 2]     = rnd() < 0.5 ? s[i * 2] : s[i * 2 + 1];
      alleles[i * 2 + 1] = rnd() < 0.5 ? d[i * 2] : d[i * 2 + 1];
    }
    poly[trait] = alleles;
  }
  return { id: nextId++, sire: sire.id, dam: dam.id, sex, poly, noise: drawNoise(), coi };
}

// ---------------------------------------------------------------------------
// COI — src/engines/genetics/pedigree.ts's tabular kinship, with the same
// PEDIGREE_DEPTH truncation loadPedigreeContext() imposes in practice.
// ---------------------------------------------------------------------------

function ancestorsWithin(id, all, depth) {
  const seen = new Set();
  let frontier = [id];
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next = [];
    for (const x of frontier) {
      if (x == null || seen.has(x)) continue;
      seen.add(x);
      const h = all.get(x);
      if (h) { if (h.sire) next.push(h.sire); if (h.dam) next.push(h.dam); }
    }
    frontier = next;
  }
  return seen;
}

function coiOf(sire, dam, all) {
  const visible = new Set([
    ...ancestorsWithin(sire.id, all, PEDIGREE_DEPTH),
    ...ancestorsWithin(dam.id, all, PEDIGREE_DEPTH),
  ]);
  const memo = new Map();
  function f(x, y) {
    if (!x || !y || !visible.has(x) || !visible.has(y)) return 0;
    const key = x <= y ? `${x}:${y}` : `${y}:${x}`;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (x === y) {
      const h = all.get(x);
      result = 0.5 * (1 + (h ? h.coi : 0));
    } else {
      const younger = all.get(Math.max(x, y));
      const older = Math.min(x, y);
      if (!younger) result = 0;
      else result = 0.5 * ((younger.sire ? f(older, younger.sire) : 0) + (younger.dam ? f(older, younger.dam) : 0));
    }
    memo.set(key, result);
    return result;
  }
  return f(sire.id, dam.id);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

function runScenario(opts) {
  const {
    label,
    stables = 5,
    keepMares = 6,
    keepStallions = 2,
    foalsPerMare = 2,
    generations = 50,
    openStud = false,        // false = same-stable breeding, as the game enforces today
    inflowPerGen = 0,        // unrelated horses added to each barn's selection pool each generation
    inflowBand = 0.5,        // quality_bands.mid — migrations/0025_config_founding.sql
    inbreedingFactor = DEFAULT_INBREEDING_FACTOR,
    noiseSd = DEFAULT_NOISE_SD,
    seed = 7,
  } = opts;

  rnd = mulberry32(seed);
  INBREEDING_FACTOR = inbreedingFactor;
  NOISE_SD = noiseSd;

  const all = new Map();
  const barns = [];
  for (let s = 0; s < stables; s++) {
    const barn = { mares: [], stallions: [] };
    for (let i = 0; i < keepMares; i++) { const h = makeFounder(0.5, 'mare'); all.set(h.id, h); barn.mares.push(h); }
    for (let i = 0; i < keepStallions; i++) { const h = makeFounder(0.5, 'stallion'); all.set(h.id, h); barn.stallions.push(h); }
    barns.push(barn);
  }

  const rows = [];
  for (let g = 0; g <= generations; g++) {
    const pop = barns.flatMap((b) => [...b.mares, ...b.stallions]);
    const scores = pop.map(rawScore);
    const mean = scores.reduce((a, c) => a + c, 0) / scores.length;
    const best = Math.max(...scores);
    const meanCoi = pop.reduce((a, c) => a + c.coi, 0) / pop.length;

    // Genetic SD of potential, averaged over traits: the raw material selection still has to work
    // with. When this goes to zero the population is fixed and no further progress is possible.
    let geneticSd = 0;
    for (const trait of TRAITS) {
      const ks = pop.map((h) => potentialOf(h, trait));
      const m = ks.reduce((a, c) => a + c, 0) / ks.length;
      geneticSd += Math.sqrt(ks.reduce((a, c) => a + (c - m) ** 2, 0) / ks.length);
    }
    geneticSd /= TRAITS.length;

    rows.push({ g, mean, best, meanCoi, geneticSd });
    if (g === generations) break;

    for (const barn of barns) {
      const foals = [];
      const sirePool = openStud ? barns.flatMap((b) => b.stallions) : barn.stallions;

      for (const mare of barn.mares) {
        for (let f = 0; f < foalsPerMare; f++) {
          // The decision a player actually makes on the breeding screen: pick the sire with the
          // best expected result, discounting his merit by the COI the pairing would produce.
          let chosen = sirePool[0], bestValue = -Infinity;
          for (const stallion of sirePool) {
            const coi = coiOf(stallion, mare, all);
            const value = rawScore(stallion) * (1 - coi * inbreedingFactor);
            if (value > bestValue) { bestValue = value; chosen = stallion; }
          }
          const coi = coiOf(chosen, mare, all);
          const foal = breed(chosen, mare, rnd() < 0.5 ? 'mare' : 'stallion', coi);
          all.set(foal.id, foal);
          foals.push(foal);
        }
      }

      for (let i = 0; i < inflowPerGen; i++) {
        const h = makeFounder(inflowBand, rnd() < 0.5 ? 'mare' : 'stallion');
        all.set(h.id, h);
        foals.push(h);
      }

      // Truncation selection on what a player can actually see: the show score, with show noise.
      const rank = (h) => rawScore(h) + normal(0, SHOW_NOISE_SD);
      const ranked = (sex, keep) => foals.filter((h) => h.sex === sex)
        .map((h) => [h, rank(h)]).sort((a, b) => b[1] - a[1]).slice(0, keep).map((r) => r[0]);

      // Overlapping generations only where the alternative is an empty barn: a stallion does not
      // cease to exist because no colt was born this year.
      const newMares = ranked('mare', keepMares);
      const newStallions = ranked('stallion', keepStallions);
      barn.mares = newMares.length >= 2 ? newMares : [...newMares, ...barn.mares].slice(0, keepMares);
      barn.stallions = newStallions.length >= 1 ? newStallions : barn.stallions;
    }
  }

  return { label, rows };
}

function printScenario(result) {
  console.log('\n' + result.label);
  console.log('  gen   mean score   best   mean COI   genetic SD');
  for (const r of result.rows) {
    if (r.g > 5 && r.g % 5 !== 0) continue;
    console.log(
      '  ' + String(r.g).padStart(3) +
      r.mean.toFixed(1).padStart(13) +
      r.best.toFixed(1).padStart(7) +
      ((r.meanCoi * 100).toFixed(1) + '%').padStart(11) +
      r.geneticSd.toFixed(2).padStart(13)
    );
  }
}

// ---------------------------------------------------------------------------
// The packaging experiment: merit held constant, only zygosity varied.
// ---------------------------------------------------------------------------

/** 10 loci holding exactly `ones` '1' alleles, packaged as heterozygously as possible. */
function maxHeterozygous(ones) {
  const hets = Math.min(ones, 20 - ones, LOCI_PER_TRAIT);
  const loci = [];
  let remaining = ones - hets;
  for (let i = 0; i < hets; i++) loci.push([1, 0]);
  for (let i = hets; i < LOCI_PER_TRAIT; i++) {
    if (remaining >= 2) { loci.push([1, 1]); remaining -= 2; } else loci.push([0, 0]);
  }
  return loci;
}

/** The same count of '1' alleles, packaged as homozygously as possible. */
function maxHomozygous(ones) {
  const loci = [];
  let remaining = ones;
  for (let i = 0; i < LOCI_PER_TRAIT; i++) {
    if (remaining >= 2) { loci.push([1, 1]); remaining -= 2; }
    else if (remaining === 1) { loci.push([1, 0]); remaining = 0; }
    else loci.push([0, 0]);
  }
  return loci;
}

function gamete(loci) {
  let ones = 0;
  for (const [a, b] of loci) ones += rnd() < 0.5 ? a : b;
  return ones;
}

function packagingExperiment(noiseSd, build, samples = 30000) {
  NOISE_SD = noiseSd;
  INBREEDING_FACTOR = 0;
  const scores = [];
  let hetLoci = 0;
  for (let i = 0; i < samples; i++) {
    const poly = {};
    for (const trait of TRAITS) {
      const loci = build(PERFECT[trait]);
      if (i === 0) hetLoci += loci.filter(([a, b]) => a !== b).length;
      const alleles = new Uint8Array(LOCI_PER_TRAIT * 2);
      // Both parents are this same genotype; the foal draws one gamete from each.
      const total = gamete(loci) + gamete(loci);
      for (let j = 0; j < total; j++) alleles[j] = 1;
      poly[trait] = alleles;
    }
    scores.push(rawScore({ poly, noise: drawNoise(), coi: 0 }));
  }
  const mean = scores.reduce((a, c) => a + c, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, c) => a + (c - mean) ** 2, 0) / scores.length);
  return { hetLoci: hetLoci / TRAITS.length, mean, sd, pct90: scores.filter((s) => s >= 90).length / scores.length };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

console.log('='.repeat(78));
console.log('HERITAGE HOOVES — closed-population selection simulation');
console.log('Formulas as at migration 0098. See docs/slices/0018-genetic-progress-and-inbreeding.md');
console.log('='.repeat(78));

console.log('\n\n--- 1. DOES SELECTION GET ANYWHERE? -------------------------------------');
printScenario(runScenario({ label: 'A. As built: same-stable breeding, no outcross inflow' }));
printScenario(runScenario({ label: 'B. As built + 2 mid-band consignment horses per barn per generation', inflowPerGen: 2 }));
printScenario(runScenario({ label: 'C. Stud services (any sire in the game), no inflow', openStud: true }));
printScenario(runScenario({ label: 'D. Stud services + mid-band inflow', openStud: true, inflowPerGen: 2 }));

console.log('\n\n--- 2. WHERE DOES RELIABILITY COME FROM? --------------------------------');
console.log('\nFoals from two parents whose potential is EXACTLY on the QH ideal (11/14/7/10).');
console.log('Parental merit is identical in every row. Only the packaging of the alleles differs.\n');
console.log('  packaging                het loci/trait   noise SD   foal mean   foal SD   P(foal >= 90)');
for (const [name, build] of [['maximally heterozygous', maxHeterozygous], ['maximally homozygous', maxHomozygous]]) {
  for (const noiseSd of [6, 3]) {
    const r = packagingExperiment(noiseSd, build);
    console.log(
      '  ' + name.padEnd(25) +
      r.hetLoci.toFixed(1).padStart(10) +
      String(noiseSd).padStart(11) +
      r.mean.toFixed(1).padStart(12) +
      r.sd.toFixed(1).padStart(10) +
      ((r.pct90 * 100).toFixed(1) + '%').padStart(15)
    );
  }
}

console.log('\n\n--- 3. THE COI TAX -------------------------------------------------------');
console.log('\nBecause realization shrinks expression toward the anchor of 50, an inbred horse needs a');
console.log('more extreme genotype to hit the same target. Potential required (maximum available: 20):\n');
console.log('  COI      neck (55)   shoulder (70)   back (35)   hock (50)');
for (const coi of [0, 0.1, 0.25, 0.4, 0.5, 0.6]) {
  const realization = 1 - coi * 1.0;
  const need = (trait) => {
    const p = (50 + (IDEAL[trait].target - 50) / realization) / 5;
    return p < 0 || p > 20 ? 'impossible' : p.toFixed(1);
  };
  console.log(
    '  ' + ((coi * 100).toFixed(0) + '%').padStart(4) +
    need('neck_length').padStart(12) +
    need('shoulder_angle').padStart(16) +
    need('back_length').padStart(12) +
    need('hock_set').padStart(12)
  );
}
console.log('\nAt COI 60% a correct Quarter Horse shoulder requires 20 of 20 alleles — the ceiling.');
console.log('Scenario A above reaches and stays at COI ~60%.\n');
