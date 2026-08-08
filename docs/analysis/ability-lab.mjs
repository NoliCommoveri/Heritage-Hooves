#!/usr/bin/env node
//
// ABILITY LAB — a bench for the proposed ability genetics (docs/slices/0029-ability-genetics.md),
// the counterpart to breeding-lab.mjs. Answers the three questions the operator asked on
// 2026-08-08: does breed finally separate, are the breed bounds real, and do foals reliably come
// out at or above their parents.
//
// ===========================================================================================
//  THIS IS NOT THE GAME. It is a simulation of a system that has not been built.
//  Same standing rules as breeding-lab.mjs / population-sim.mjs / stable-timeline.mjs: analysis
//  tool, not game code, not a vitest test; own PRNG, own copy of the game's constants, and THAT
//  COPY CAN DRIFT. Every constant below names its source. Nothing reads or writes the database.
// ===========================================================================================
//
// Unlike breeding-lab.mjs this tool keeps NO state file. Every command mints its own population
// and reports; nothing persists. That is deliberate — the questions here are distributional
// ("what does a breed look like"), not "what happens if I breed THIS horse to THAT one".
//
// COMMANDS
//   sweep      [--n 2000] [--band low|mid|high] [--engine today|proposed|both]
//              Mint n founders per breed and characterise the distribution per trait.
//   separation [--n 2000]
//              The headline test: does a breed's own trait separate from another breed's?
//   bands      [--n 2000]
//              low vs mid vs high within one breed — "what does a high band horse look like".
//   foals      [--runs 4000]
//              Foal vs midparent, with and without mare prenatal care. Complaint 3.
//   programme  [--gens 8] [--runs 300] [--foals 4] [--care]
//              A breeding programme: select the best foal each generation, climb, and see when
//              it crosses the champion band.
//   all        Run everything at the defaults.
//
// FLAGS
//   --ratchet <rungs>   ability_ratchet_rungs. Default 2 (slice 0029 §9.3, undecided).
//   --noise <sd>        ability_noise_sd for the PROPOSED engine. Default 1 (§3).
//   --seed <n>          Base seed. Default 20260808.

import { argv } from 'node:process';

// ===========================================================================================
// Constants — every one names its source.
// ===========================================================================================

const ABILITY = { stamina: 'Stamina', jump_scope: 'Jump scope', speed: 'Speed', trainability: 'Trainability', agility: 'Agility' };
const ABILITY_TRAITS = Object.keys(ABILITY);

// --- ladder: reused from conformation, slice 0029 §2.2 -------------------------------------
const RUNG_BASE = 2;                 // TYPE_GENE_RUNG_BASE,  loci.ts
const RUNG_STEP = 4;                 // TYPE_GENE_RUNG_STEP,  loci.ts
const LOCI_PER_ABILITY = 2;          // slice 0029 §2.3 — two loci, four alleles
const ALLELES_PER_TRAIT = LOCI_PER_ABILITY * 2;
const RUNGS_PER_BUCKET = 3;          // slice 0029 §2.4

// --- today's engine ------------------------------------------------------------------------
const POLY_ALLELES = 20;             // polygenic.ts LOCI_PER_TRAIT * 2
const TODAY_ALLELE_STEP = 5;         // geneticValue = potential * 5 + noise
const TODAY_NOISE_SD = 6;            // ability_noise_sd, migration 0179
const TODAY_ONE_CHANCE = { low: 0.42, mid: 0.50, high: 0.58 };  // quality_bands, migration 0178
const ABILITY_SPECIALIST_POTENTIAL = 15;                        // migration 0101
const SPECIALIST_OFFSETS = [-1, 0, 1];                          // generate.ts, slice 0019 §7
const SPECIALIZABLE_TODAY = ABILITY_TRAITS.filter((t) => t !== 'jump_scope');  // slice 0019 §4.2
const BIAS_CHANCE_MIN = 0.15, BIAS_CHANCE_MAX = 0.85;           // identity.ts

// --- proposed engine — slice 0029 §2 -------------------------------------------------------
const PROPOSED_NOISE_SD_DEFAULT = 1;      // §3, down from 6
const ABILITY_MODIFIER_STEP = 0.1;        // §2.3, the demoted 20-bit tie-breaker (+/-1.0)
const RATCHET_RUNGS_DEFAULT = 2;          // §9.3, undecided
const RATCHET_ELIGIBLE_COUNT = 3;         // §2.5, operator decision 2026-08-08

// slice 0029 §2.4 — four bucket indices per trait, five specs per band, shuffled across traits.
const ABILITY_SPECS = {
  high: [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 1], [1, 1, 1, 2], [1, 2, 2, 3]],
  mid:  [[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 2, 2], [1, 2, 2, 3], [2, 3, 3, 3]],
  low:  [[0, 1, 1, 2], [1, 2, 2, 2], [2, 2, 3, 3], [2, 3, 3, 3], [3, 3, 3, 3]],
};

// --- breeds --------------------------------------------------------------------------------
// `bias` is migration 0142 (today's engine only — slice 0029 §2.2 retires it).
// `ranges` is slice 0029 §4, floor/ceiling per trait. Every value is ≡ 2 mod 4.
const BREEDS = {
  QH: {
    name: 'Quarter Horse',
    bias: { speed: 0.06, stamina: -0.06, jump_scope: -0.06, trainability: 0.0, agility: 0.06 },
    ranges: { stamina: [18, 58], jump_scope: [14, 54], speed: [54, 94], trainability: [34, 74], agility: [50, 90] },
  },
  AR: {
    name: 'Arabian',
    bias: { speed: -0.02, stamina: 0.06, jump_scope: -0.06, trainability: 0.02, agility: 0.0 },
    ranges: { stamina: [54, 94], jump_scope: [10, 50], speed: [30, 70], trainability: [42, 82], agility: [34, 74] },
  },
  TB: {
    name: 'Thoroughbred',
    bias: { speed: 0.06, stamina: 0.04, jump_scope: 0.02, trainability: -0.06, agility: -0.06 },
    ranges: { stamina: [46, 86], jump_scope: [38, 78], speed: [54, 94], trainability: [14, 54], agility: [18, 58] },
  },
  GW: {
    name: 'German Warmblood',
    bias: { speed: -0.06, stamina: -0.06, jump_scope: 0.06, trainability: 0.05, agility: 0.01 },
    ranges: { stamina: [18, 58], jump_scope: [54, 94], speed: [14, 54], trainability: [50, 90], agility: [38, 78] },
  },
  FR: {
    name: 'Friesian',
    bias: { speed: -0.06, stamina: -0.02, jump_scope: 0.0, trainability: 0.06, agility: 0.02 },
    ranges: { stamina: [26, 66], jump_scope: [30, 70], speed: [10, 50], trainability: [54, 94], agility: [34, 74] },
  },
  PF: {
    name: 'Paso Fino',
    bias: { speed: 0.0, stamina: -0.04, jump_scope: -0.06, trainability: 0.04, agility: 0.06 },
    ranges: { stamina: [22, 62], jump_scope: [6, 46], speed: [26, 66], trainability: [46, 86], agility: [54, 94] },
  },
  IC: {
    name: 'Icelandic',
    bias: { speed: -0.06, stamina: 0.06, jump_scope: -0.06, trainability: 0.02, agility: 0.04 },
    ranges: { stamina: [50, 90], jump_scope: [10, 50], speed: [6, 46], trainability: [34, 74], agility: [46, 86] },
  },
  NOK: {
    name: 'Nokota',
    bias: { speed: 0.0, stamina: 0.04, jump_scope: -0.04, trainability: -0.02, agility: 0.02 },
    ranges: { stamina: [42, 82], jump_scope: [26, 66], speed: [34, 74], trainability: [30, 70], agility: [38, 78] },
  },
};
const BREED_CODES = Object.keys(BREEDS);

// ===========================================================================================
// PRNG — mulberry32, same as breeding-lab.mjs. Seeded everywhere, never Math.random().
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
function rngFrom(seed) {
  const r = mulberry32(seed);
  r.normal = (sd) => {
    const u = Math.max(1e-12, r()), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
  };
  r.int = (n) => Math.floor(r() * n);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = r.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  return r;
}

// ===========================================================================================
// Statistics
// ===========================================================================================

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (sorted, q) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** The operator's own framing (2026-08-08): not just the average, but what the bottom fifth and
 *  the top fifth of a rolled batch actually look like. */
function quintiles(values) {
  const s = [...values].sort((a, b) => a - b);
  const cut = Math.max(1, Math.round(s.length / 5));
  return {
    n: s.length,
    min: s[0],
    bottom20: mean(s.slice(0, cut)),
    p20: quantile(s, 0.2),
    median: quantile(s, 0.5),
    p80: quantile(s, 0.8),
    top20: mean(s.slice(-cut)),
    max: s[s.length - 1],
    mean: mean(s),
    sd: Math.sqrt(mean(s.map((x) => (x - mean(s)) ** 2))),
  };
}

// ===========================================================================================
// The proposed engine — slice 0029 §2
// ===========================================================================================

const rungValue = (r) => RUNG_BASE + r * RUNG_STEP;
const rungOf = (v) => Math.round((v - RUNG_BASE) / RUNG_STEP);

function windowFor(breedCode, trait) {
  const [floor, ceiling] = BREEDS[breedCode].ranges[trait];
  return { floor, ceiling, floorRung: rungOf(floor), ceilingRung: rungOf(ceiling) };
}

/** §2.5 — the breed's top three traits by ceiling. Sorted descending, tie-broken by ABILITY_TRAITS
 *  order. Stable and RNG-free by construction: it defines what a breed can improve at, forever. */
function ratchetEligibleTraits(breedCode) {
  return [...ABILITY_TRAITS]
    .map((t, i) => ({ t, ceiling: BREEDS[breedCode].ranges[t][1], i }))
    .sort((a, b) => (b.ceiling - a.ceiling) || (a.i - b.i))
    .slice(0, RATCHET_ELIGIBLE_COUNT)
    .map((x) => x.t);
}

/** §2.4 — buckets measured DOWNWARD from the ceiling, three rungs each, truncated at the floor. */
function bucketsFor(win) {
  const height = win.ceilingRung - win.floorRung;
  const out = [];
  for (let lo = 0; lo <= height; lo += RUNGS_PER_BUCKET) {
    out.push([lo, Math.min(height, lo + RUNGS_PER_BUCKET - 1)]);
  }
  return out;
}

function alleleAtBucket(win, bucketIdx, rng) {
  const buckets = bucketsFor(win);
  const [lo, hi] = buckets[Math.min(bucketIdx, buckets.length - 1)];
  const below = lo + rng.int(hi - lo + 1);
  return Math.max(win.floorRung, win.ceilingRung - below);
}

/** §2.4 — deal all five traits' four alleles from a band's five specs, shuffled across traits so
 *  every horse of a band has the same SHAPE and only which trait is which varies. */
function dealAbilityForBand(breedCode, band, rng) {
  const specs = rng.shuffle(ABILITY_SPECS[band]);
  const out = {};
  ABILITY_TRAITS.forEach((trait, i) => {
    const win = windowFor(breedCode, trait);
    out[trait] = specs[i].map((b) => alleleAtBucket(win, b, rng)).sort((a, b) => a - b);
  });
  return out;
}

/** §2.6 — the specialist is an UPGRADE of a dealt allele to bucket 0, not an absolute overwrite,
 *  and it is round-robin across the breed's three eligible traits. */
function applyAbilitySpecialist(alleles, breedCode, mintIndex, rng) {
  const eligible = ratchetEligibleTraits(breedCode);
  const trait = eligible[mintIndex % eligible.length];
  const win = windowFor(breedCode, trait);
  const upgraded = alleleAtBucket(win, 0, rng);
  const a = [...alleles[trait]];
  // upgrade the allele already closest to the ceiling, never below what it already was
  a[a.length - 1] = Math.max(a[a.length - 1], upgraded);
  alleles[trait] = a.sort((x, y) => x - y);
  return trait;
}

/** §2.3 — expressed = mean of four alleles + demoted polygenic tie-breaker + noise, clamped to
 *  the breed window. The clamp is the guarantee (§2.2): it holds regardless of breeding path. */
function proposedExpressed(horse, trait, noiseSd, seedRng) {
  const win = windowFor(horse.breed, trait);
  const raw = mean(horse.alleles[trait].map(rungValue));
  const modifier = (horse.poly[trait] - 10) * ABILITY_MODIFIER_STEP;
  const noise = seedRng.normal(noiseSd);
  return Math.min(win.ceiling, Math.max(win.floor, Math.round(raw + modifier + noise)));
}

/** §2.5 — move the WORST of the four alleles `rungs` closer to the ceiling. Never overshoots.
 *  Which allele moves makes no difference to THIS horse (any move is worth RUNG_STEP/4 = 1 point);
 *  it matters for what the horse passes on, which is the point. */
function ratchetTrait(alleles, breedCode, trait, rungs) {
  const win = windowFor(breedCode, trait);
  const a = [...alleles[trait]];
  if (a[0] >= win.ceilingRung) return false;
  a[0] = Math.min(win.ceilingRung, a[0] + rungs);
  alleles[trait] = a.sort((x, y) => x - y);
  return true;
}

function applyRatchet(alleles, breedCode, care, rungs, rng) {
  const eligible = ratchetEligibleTraits(breedCode);
  if (care) {
    for (const t of eligible) ratchetTrait(alleles, breedCode, t, rungs);
    return eligible;
  }
  const t = eligible[rng.int(eligible.length)];   // operator decision: random, not chosen
  ratchetTrait(alleles, breedCode, t, rungs);
  return [t];
}

function inheritAbility(sire, dam, rng) {
  const out = {};
  for (const trait of ABILITY_TRAITS) {
    const s = sire.alleles[trait], d = dam.alleles[trait];
    // two loci: locus 1 is alleles [0,1], locus 2 is [2,3]. One allele from each parent per locus.
    const foal = [
      rng() < 0.5 ? s[0] : s[1],
      rng() < 0.5 ? d[0] : d[1],
      rng() < 0.5 ? s[2] : s[3],
      rng() < 0.5 ? d[2] : d[3],
    ];
    out[trait] = foal.sort((a, b) => a - b);
  }
  return out;
}

// ===========================================================================================
// Today's engine — for the like-for-like comparison
// ===========================================================================================

const countOnes = (bits) => bits.reduce((a, b) => a + b, 0);

function biasedOneChance(base, bias) {
  if (!bias) return base;
  return Math.min(BIAS_CHANCE_MAX, Math.max(BIAS_CHANCE_MIN, base + bias));
}

function mintTodayFounder(breedCode, band, rng) {
  const breed = BREEDS[breedCode];
  const poly = {};
  for (const trait of ABILITY_TRAITS) {
    const chance = biasedOneChance(TODAY_ONE_CHANCE[band], breed.bias[trait] ?? 0);
    const bits = [];
    for (let i = 0; i < POLY_ALLELES; i++) bits.push(rng() < chance ? 1 : 0);
    poly[trait] = countOnes(bits);
  }
  // the breed-blind specialist OVERWRITE — slice 0029 §1.1, the cause of the operator's report
  const trait = SPECIALIZABLE_TODAY[rng.int(SPECIALIZABLE_TODAY.length)];
  const offset = SPECIALIST_OFFSETS[rng.int(SPECIALIST_OFFSETS.length)];
  poly[trait] = Math.max(0, Math.min(POLY_ALLELES, ABILITY_SPECIALIST_POTENTIAL + offset));
  return { breed: breedCode, poly, specialist: trait };
}

function todayExpressed(horse, trait, rng) {
  const gv = horse.poly[trait] * TODAY_ALLELE_STEP + rng.normal(TODAY_NOISE_SD);
  return Math.min(99, Math.max(1, Math.round(gv)));
}

// ===========================================================================================
// Proposed founder mint
// ===========================================================================================

function mintProposedFounder(breedCode, band, mintIndex, rng) {
  const alleles = dealAbilityForBand(breedCode, band, rng);
  const poly = {};
  for (const trait of ABILITY_TRAITS) {
    let ones = 0;
    for (let i = 0; i < POLY_ALLELES; i++) if (rng() < 0.5) ones++;
    poly[trait] = ones;
  }
  const specialist = applyAbilitySpecialist(alleles, breedCode, mintIndex, rng);
  return { breed: breedCode, alleles, poly, specialist };
}

// ===========================================================================================
// Reporting helpers
// ===========================================================================================

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const f1 = (x) => x.toFixed(1);

function quintileRow(labelText, q, width = 20) {
  return `  ${pad(labelText, width)} ${padL(q.min, 4)} ${padL(f1(q.bottom20), 7)} ${padL(f1(q.median), 7)} ${padL(f1(q.top20), 7)} ${padL(q.max, 5)} ${padL(f1(q.sd), 6)}`;
}
const QUINTILE_HEAD = (w = 20) => `  ${pad('', w)} ${padL('min', 4)} ${padL('bot20%', 7)} ${padL('median', 7)} ${padL('top20%', 7)} ${padL('max', 5)} ${padL('sd', 6)}`;

function hr(char = '-') { console.log(char.repeat(78)); }
function title(t) { console.log(''); hr('='); console.log(t); hr('='); }

// ===========================================================================================
// Commands
// ===========================================================================================

function cmdSweep(opts) {
  title(`SWEEP — ${opts.n} founders per breed, band=${opts.band}`);
  for (const engine of opts.engines) {
    console.log('');
    console.log(`### ${engine.toUpperCase()} ENGINE`);
    for (const code of BREED_CODES) {
      const eligible = ratchetEligibleTraits(code);
      console.log('');
      console.log(`${BREEDS[code].name} (${code})   ratchet-eligible: ${eligible.map((t) => ABILITY[t]).join(', ')}`);
      console.log(QUINTILE_HEAD());
      for (const trait of ABILITY_TRAITS) {
        const vals = [];
        for (let i = 0; i < opts.n; i++) {
          const rng = rngFrom(opts.seed + i * 7919 + code.charCodeAt(0) * 131);
          if (engine === 'today') {
            vals.push(todayExpressed(mintTodayFounder(code, opts.band, rng), trait, rng));
          } else {
            vals.push(proposedExpressed(mintProposedFounder(code, opts.band, i, rng), trait, opts.noise, rng));
          }
        }
        const q = quintiles(vals);
        const win = windowFor(code, trait);
        const star = eligible.includes(trait) ? '*' : ' ';
        const winText = engine === 'proposed' ? `  [${win.floor}-${win.ceiling}]` : '';
        console.log(quintileRow(`${star}${ABILITY[trait]}`, q) + winText);
      }
    }
  }
}

function cmdSeparation(opts) {
  title(`SEPARATION — does breed actually show? ${opts.n} founders per breed, band=mid`);
  console.log('');
  console.log('The operator\'s own test: mint a batch of each breed and compare the SAME trait.');
  console.log('"the best stamina on Arabian was identical to best stamina on quarter horse"');

  const pairs = [
    ['stamina', 'AR', 'QH'],
    ['speed', 'QH', 'AR'],
    ['jump_scope', 'GW', 'QH'],
    ['agility', 'PF', 'TB'],
    ['trainability', 'FR', 'TB'],
  ];

  for (const engine of opts.engines) {
    console.log('');
    console.log(`### ${engine.toUpperCase()} ENGINE`);
    console.log(`  ${pad('trait', 14)} ${pad('breed', 18)} ${padL('bot20%', 7)} ${padL('median', 7)} ${padL('top20%', 7)} ${padL('max', 5)}`);
    for (const [trait, good, bad] of pairs) {
      const rows = [];
      for (const code of [good, bad]) {
        const vals = [];
        for (let i = 0; i < opts.n; i++) {
          const rng = rngFrom(opts.seed + i * 7919 + code.charCodeAt(0) * 131 + trait.length * 17);
          if (engine === 'today') {
            vals.push(todayExpressed(mintTodayFounder(code, 'mid', rng), trait, rng));
          } else {
            vals.push(proposedExpressed(mintProposedFounder(code, 'mid', i, rng), trait, opts.noise, rng));
          }
        }
        rows.push({ code, q: quintiles(vals) });
      }
      for (const [i, r] of rows.entries()) {
        console.log(`  ${pad(i === 0 ? ABILITY[trait] : '', 14)} ${pad(BREEDS[r.code].name, 18)} ${padL(f1(r.q.bottom20), 7)} ${padL(f1(r.q.median), 7)} ${padL(f1(r.q.top20), 7)} ${padL(r.q.max, 5)}`);
      }
      const [a, b] = rows;
      const overlap = b.q.top20 >= a.q.bottom20;
      const gapBest = a.q.max - b.q.max;
      console.log(`  ${pad('', 14)} ${pad('-> gap in best-of-batch', 18)} ${padL(gapBest >= 0 ? '+' + gapBest : gapBest, 7)}   ${overlap ? 'top of weak breed still reaches bottom of strong breed' : 'CLEAN SEPARATION'}`);
    }
  }
}

function cmdBands(opts) {
  title(`BANDS — what does a high-band horse look like? ${opts.n} per band`);
  console.log('');
  console.log('This is the number the champion classes are built on. The show barn mints its');
  console.log('champion tier at band=high and its novice tier at band=low (migrations 0173/0176),');
  console.log('so the low->high gap here IS the gap a child is breeding to close.');

  for (const code of ['QH', 'AR', 'GW']) {
    const eligible = ratchetEligibleTraits(code);
    console.log('');
    console.log(`${BREEDS[code].name} (${code})`);
    for (const engine of opts.engines) {
      console.log(`  ${engine} engine:`);
      console.log(`  ${QUINTILE_HEAD(22)}`);
      for (const band of ['low', 'mid', 'high']) {
        // the horse's BEST eligible trait — what a discipline class actually weights
        const vals = [];
        for (let i = 0; i < opts.n; i++) {
          const rng = rngFrom(opts.seed + i * 7919 + band.length * 977 + code.charCodeAt(1) * 31);
          const h = engine === 'today' ? mintTodayFounder(code, band, rng) : mintProposedFounder(code, band, i, rng);
          const scores = eligible.map((t) => (engine === 'today' ? todayExpressed(h, t, rng) : proposedExpressed(h, t, opts.noise, rng)));
          vals.push(Math.max(...scores));
        }
        console.log(`  ${quintileRow(`${band} band, best trait`, quintiles(vals), 22)}`);
      }
    }
  }
}

function cmdFoals(opts) {
  title(`FOALS — do foals come out at or above their parents? ${opts.runs} pairings`);
  console.log('');
  console.log('Complaint 3: "breeding 5 in a row from good parents is unacceptable."');
  console.log('Measured on the trait the pairing is being bred FOR (the parents\' shared best');
  console.log('eligible trait), against MIDPARENT — the honest bar, since a foal\'s expected value');
  console.log('is exactly the midparent under both engines.');

  for (const engine of opts.engines) {
    console.log('');
    console.log(`### ${engine.toUpperCase()} ENGINE`);
    const modes = engine === 'today' ? [['(no ratchet exists)', false]] : [['no mare care', false], ['with mare care', true]];
    console.log(`  ${pad('', 22)} ${padL('>= midpar', 10)} ${padL('mean gain', 10)} ${padL('sd', 7)} ${padL('5 in a row worse', 17)}`);
    for (const [modeName, care] of modes) {
      let atOrAbove = 0, total = 0;
      const gains = [];
      for (let run = 0; run < opts.runs; run++) {
        const code = BREED_CODES[run % BREED_CODES.length];
        const rng = rngFrom(opts.seed + run * 104729);
        const eligible = ratchetEligibleTraits(code);
        const trait = eligible[0];

        let sire, dam, sireV, damV;
        if (engine === 'today') {
          sire = mintTodayFounder(code, 'mid', rng); dam = mintTodayFounder(code, 'mid', rng);
          sireV = todayExpressed(sire, trait, rng); damV = todayExpressed(dam, trait, rng);
        } else {
          sire = mintProposedFounder(code, 'mid', run, rng); dam = mintProposedFounder(code, 'mid', run + 1, rng);
          sireV = proposedExpressed(sire, trait, opts.noise, rng); damV = proposedExpressed(dam, trait, opts.noise, rng);
        }
        const midparent = (sireV + damV) / 2;

        let foalV;
        if (engine === 'today') {
          // today: 10 independent loci segregating, gamete per locus at 50/50
          const foalOnes = Math.round((sire.poly[trait] + dam.poly[trait]) / 2);
          let ones = 0;
          for (let i = 0; i < POLY_ALLELES / 2; i++) ones += rng() < sire.poly[trait] / POLY_ALLELES ? 1 : 0;
          for (let i = 0; i < POLY_ALLELES / 2; i++) ones += rng() < dam.poly[trait] / POLY_ALLELES ? 1 : 0;
          foalV = todayExpressed({ poly: { [trait]: ones } }, trait, rng);
          void foalOnes;
        } else {
          const alleles = inheritAbility(sire, dam, rng);
          applyRatchet(alleles, code, care, opts.ratchet, rng);
          const poly = {}; for (const t of ABILITY_TRAITS) poly[t] = 10;
          foalV = proposedExpressed({ breed: code, alleles, poly }, trait, opts.noise, rng);
        }

        total++;
        if (foalV >= midparent) atOrAbove++;
        gains.push(foalV - midparent);
      }
      const p = atOrAbove / total;
      const g = quintiles(gains);
      const streak = Math.pow(1 - p, 5);
      console.log(`  ${pad(modeName, 22)} ${padL((p * 100).toFixed(1) + '%', 10)} ${padL(f1(g.mean), 10)} ${padL(f1(g.sd), 7)} ${padL((streak * 100).toFixed(2) + '%', 17)}`);
    }
  }
}

function cmdProgramme(opts) {
  title(`PROGRAMME — ${opts.gens} generations, ${opts.runs} runs, ${opts.foals} foals/gen, care=${opts.care}`);
  console.log('');
  console.log('A child\'s actual loop: start with a low-band founding pair, roll foals, keep the');
  console.log('best, breed it back to the best of the rest. Measured on the breed\'s top trait.');
  console.log('The champion bar is a high-band show-barn horse\'s best trait (from `bands`).');

  for (const engine of opts.engines) {
    console.log('');
    console.log(`### ${engine.toUpperCase()} ENGINE`);

    // the bar: a high-band horse's best eligible trait, averaged over breeds
    const barVals = [];
    for (const code of BREED_CODES) {
      const eligible = ratchetEligibleTraits(code);
      for (let i = 0; i < 400; i++) {
        const rng = rngFrom(opts.seed + i * 31337 + code.charCodeAt(0));
        const h = engine === 'today' ? mintTodayFounder(code, 'high', rng) : mintProposedFounder(code, 'high', i, rng);
        barVals.push(Math.max(...eligible.map((t) => (engine === 'today' ? todayExpressed(h, t, rng) : proposedExpressed(h, t, opts.noise, rng)))));
      }
    }
    const bar = quintiles(barVals);
    console.log(`  champion bar (high band, best trait): median ${f1(bar.median)}, bot20% ${f1(bar.bottom20)}, top20% ${f1(bar.top20)}`);
    console.log('');
    console.log(`  ${pad('gen', 5)} ${QUINTILE_HEAD(0).slice(2)}  ${padL('>= bar', 8)}`);

    const perGen = Array.from({ length: opts.gens + 1 }, () => []);
    for (let run = 0; run < opts.runs; run++) {
      const code = BREED_CODES[run % BREED_CODES.length];
      const rng = rngFrom(opts.seed + run * 2654435761);
      const trait = ratchetEligibleTraits(code)[0];
      const score = (h) => (engine === 'today' ? todayExpressed(h, trait, rng) : proposedExpressed(h, trait, opts.noise, rng));

      let sire, dam;
      if (engine === 'today') { sire = mintTodayFounder(code, 'low', rng); dam = mintTodayFounder(code, 'low', rng); }
      else { sire = mintProposedFounder(code, 'low', run, rng); dam = mintProposedFounder(code, 'low', run + 1, rng); }
      perGen[0].push(Math.max(score(sire), score(dam)));

      for (let gen = 1; gen <= opts.gens; gen++) {
        const foals = [];
        for (let f = 0; f < opts.foals; f++) {
          let h;
          if (engine === 'today') {
            let ones = 0;
            for (let i = 0; i < POLY_ALLELES / 2; i++) ones += rng() < sire.poly[trait] / POLY_ALLELES ? 1 : 0;
            for (let i = 0; i < POLY_ALLELES / 2; i++) ones += rng() < dam.poly[trait] / POLY_ALLELES ? 1 : 0;
            const poly = { ...sire.poly }; poly[trait] = ones;
            h = { breed: code, poly };
          } else {
            const alleles = inheritAbility(sire, dam, rng);
            applyRatchet(alleles, code, opts.care, opts.ratchet, rng);
            const poly = {}; for (const t of ABILITY_TRAITS) poly[t] = 10;
            h = { breed: code, alleles, poly };
          }
          foals.push({ h, v: score(h) });
        }
        foals.sort((a, b) => b.v - a.v);
        perGen[gen].push(foals[0].v);
        // keep the best two as the next pair — the child's actual behaviour
        sire = foals[0].h;
        dam = foals[Math.min(1, foals.length - 1)].h;
      }
    }

    for (let gen = 0; gen <= opts.gens; gen++) {
      const q = quintiles(perGen[gen]);
      const share = perGen[gen].filter((v) => v >= bar.median).length / perGen[gen].length;
      console.log(`  ${pad(gen, 5)} ${padL(q.min, 4)} ${padL(f1(q.bottom20), 7)} ${padL(f1(q.median), 7)} ${padL(f1(q.top20), 7)} ${padL(q.max, 5)} ${padL(f1(q.sd), 6)}  ${padL((share * 100).toFixed(1) + '%', 8)}`);
    }
  }
}

// ===========================================================================================
// CLI
// ===========================================================================================

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = argv.slice(2);
const cmd = args[0] ?? 'all';
const flags = parseFlags(args);

const engineFlag = flags.engine ?? 'both';
const opts = {
  n: Number(flags.n ?? 2000),
  runs: Number(flags.runs ?? 4000),
  gens: Number(flags.gens ?? 8),
  foals: Number(flags.foals ?? 4),
  band: flags.band ?? 'mid',
  care: flags.care === true || flags.care === 'true',
  ratchet: Number(flags.ratchet ?? RATCHET_RUNGS_DEFAULT),
  noise: Number(flags.noise ?? PROPOSED_NOISE_SD_DEFAULT),
  seed: Number(flags.seed ?? 20260808),
  engines: engineFlag === 'both' ? ['today', 'proposed'] : [engineFlag],
};

console.log(`ability-lab — ratchet=${opts.ratchet} rungs, proposed noise sd=${opts.noise}, seed=${opts.seed}`);
console.log('NOT THE GAME. A simulation of docs/slices/0029-ability-genetics.md.');

switch (cmd) {
  case 'sweep': cmdSweep(opts); break;
  case 'separation': cmdSeparation(opts); break;
  case 'bands': cmdBands(opts); break;
  case 'foals': cmdFoals(opts); break;
  case 'programme': cmdProgramme(opts); break;
  case 'all':
    cmdSeparation(opts);
    cmdBands(opts);
    cmdFoals(opts);
    cmdProgramme({ ...opts, runs: 300 });
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}
