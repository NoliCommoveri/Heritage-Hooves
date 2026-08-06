#!/usr/bin/env node
//
// Does the conformation genetics engine actually produce horses that look like their breed, and
// can a child tell a good pairing from a bad one?
// Run with:  node docs/analysis/conformation-architecture.mjs
//
// Written 2026-08-06 alongside docs/fixes/conformation-breed-type.md, to answer three questions
// that no amount of reasoning settles:
//
//   1. How far off its own breed standard is a horse the game mints today?
//   2. If a child breeds two of their best horses together, how often is the foal as good as its
//      parents — and how many foals would it take to tell a good pairing from an unlucky one?
//   3. Does the proposed architecture (one graded, testable "type" locus per conformation trait,
//      plus the existing twenty-allele block demoted to a fine modifier) actually fix both?
//
// Same standing rules as population-sim.mjs, stable-timeline.mjs and training-effect.mjs, and for
// the same reasons — read any of their headers. In short: analysis tool, not game code, not a
// vitest test; own PRNG, own copy of the game's constants, and THAT COPY CAN DRIFT. Every constant
// below names its source. If you retune one in the game, retune it here or delete the file.
//
// WHAT IT MODELS
//   The live conformation pipeline exactly: allele count -> geneticValue -> environmental noise ->
//   expressed -> traitScoreFor -> the Poor..Outstanding band. Both founding generation (quality
//   band + slice 0019's guaranteed specialist) and real meiosis between two parents.
//
// WHAT IT SIMPLIFIES
//   Every horse is mature and unrelated, so realization is exactly 1.0 (same simplification, same
//   reason, as training-effect.mjs). Judge weights are ignored throughout: this measures a horse
//   against its breed's standard, not against a particular judge's opinion of it.

// ---------------------------------------------------------------------------
// CONSTANTS — each copied from the live source named beside it
// ---------------------------------------------------------------------------

// migrations 0035 / 0107 / 0111 — all eight breeds, all five conformation traits.
const BREEDS = {
  'Quarter Horse':    { neck_length: 55, shoulder_angle: 70, back_length: 35, hock_set: 50, head_profile: 35 },
  'Arabian':          { neck_length: 75, shoulder_angle: 72, back_length: 28, hock_set: 48, head_profile:  8 },
  'Thoroughbred':     { neck_length: 65, shoulder_angle: 80, back_length: 50, hock_set: 55, head_profile: 48 },
  'German Warmblood': { neck_length: 72, shoulder_angle: 78, back_length: 52, hock_set: 62, head_profile: 50 },
  'Friesian':         { neck_length: 82, shoulder_angle: 68, back_length: 40, hock_set: 62, head_profile: 70 },
  'Paso Fino':        { neck_length: 68, shoulder_angle: 60, back_length: 30, hock_set: 45, head_profile: 62 },
  'Icelandic':        { neck_length: 40, shoulder_angle: 35, back_length: 42, hock_set: 36, head_profile: 57 },
  'Nokota':           { neck_length: 40, shoulder_angle: 45, back_length: 58, hock_set: 36, head_profile: 66 },
};
const TRAITS = ['neck_length', 'shoulder_angle', 'back_length', 'hock_set', 'head_profile'];

const FALLOFF = 2.0;        // show_ideal_falloff,      migration 0041
const CONF_NOISE_SD = 6;    // conformation_noise_sd,   migration 0031
const LOCI_PER_TRAIT = 10;  // polygenic.ts — 20 alleles per trait
const ANCHOR = 50;          // anchorFor(), bidirectional trait
const ALLELE_STEP = 5;      // geneticValue(): potential * 5

// quality_bands, migration 0025 — polygenic_one_chance, the per-allele probability of a '1'.
const BAND = { low: 0.42, mid: 0.50, high: 0.58 };

// conformation_label_*_min, migration 0135 — traitScore at or above which each word applies.
const LABEL_MIN = { outstanding: 90, good: 75, acceptable: 55, weak: 30 };
const SPECIALIST_OFFSETS = [-1, 0, 1];   // generate.ts, slice 0019 §7

// ---------------------------------------------------------------------------
// PROPOSED — the numbers this script exists to test. Not in the game.
// docs/fixes/conformation-breed-type.md §4/§5.
// ---------------------------------------------------------------------------
const RUNG_STEP = 8;        // spacing of the type locus's allele ladder, in trait points
const RUNG_BASE = 2;        // lowest rung's value; rungs are 2, 10, 18, ... 98
const RUNG_COUNT = 13;
const MODIFIER_STEP = 0.75; // the twenty-allele block's new per-allele worth (was 5)
const NEW_NOISE_SD = 2;     // conformation_noise_sd, retuned
// Pool concentration: P(a drawn allele is exactly the breed's target rung), per quality band.
const CONC = { low: 0.35, mid: 0.55, high: 0.75 };
// How the remaining probability falls away by distance from target, before renormalising.
const FALLAWAY = [0.45, 0.18, 0.06];

// ---------------------------------------------------------------------------
// PRNG — own copy, seeded, so every run reproduces (CLAUDE.md §5.2's spirit)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20260806);
function normal(sd) {
  const u = Math.max(1e-12, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

// ---------------------------------------------------------------------------
// Shared scoring
// ---------------------------------------------------------------------------
const clamp99 = (v) => Math.min(99, Math.max(1, v));
const traitScore = (expressed, target) => Math.max(0, 100 - Math.abs(expressed - target) * FALLOFF);
function label(score) {
  if (score >= LABEL_MIN.outstanding) return 'Outstanding';
  if (score >= LABEL_MIN.good) return 'Good';
  if (score >= LABEL_MIN.acceptable) return 'Acceptable';
  if (score >= LABEL_MIN.weak) return 'Weak';
  return 'Poor';
}
const onTarget = (expressed, target) => traitScore(expressed, target) >= LABEL_MIN.outstanding;

// ===========================================================================
// TODAY'S ENGINE
// ===========================================================================

// A trait's twenty alleles, drawn independently at `chance`. generate.ts's polygenic loop.
function todayAlleles(chance) {
  const bits = [];
  for (let i = 0; i < LOCI_PER_TRAIT * 2; i++) bits.push(rnd() < chance ? 1 : 0);
  return bits;
}
const count = (bits) => bits.reduce((a, b) => a + b, 0);

// specialistBits(): `potential` ones at random positions among the twenty.
function specialistBits(potential) {
  const pos = [...Array(LOCI_PER_TRAIT * 2).keys()];
  for (let i = pos.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pos[i], pos[j]] = [pos[j], pos[i]]; }
  const ones = new Set(pos.slice(0, potential));
  return pos.map((_, i) => (ones.has(i) ? 1 : 0));
}

function todayHorse(targets, band, withSpecialist = true) {
  const g = {};
  for (const t of TRAITS) g[t] = todayAlleles(BAND[band]);
  if (withSpecialist) {
    const t = pick(TRAITS);
    const p = Math.max(0, Math.min(20, Math.round(targets[t] / ALLELE_STEP) + pick(SPECIALIST_OFFSETS)));
    g[t] = specialistBits(p);
  }
  return g;
}

function todayExpressed(g, trait) {
  return clamp99(count(g[trait]) * ALLELE_STEP + Math.round(normal(CONF_NOISE_SD)));
}

// Meiosis: one allele per locus from each parent.
function todayFoal(sire, dam) {
  const g = {};
  for (const t of TRAITS) {
    const bits = [];
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      bits.push(sire[t][i * 2 + (rnd() < 0.5 ? 0 : 1)]);
      bits.push(dam[t][i * 2 + (rnd() < 0.5 ? 0 : 1)]);
    }
    g[t] = bits;
  }
  return g;
}

// ===========================================================================
// PROPOSED ENGINE
// ===========================================================================

const rungValue = (r) => RUNG_BASE + r * RUNG_STEP;
const nearestRung = (v) => Math.max(0, Math.min(RUNG_COUNT - 1, Math.round((v - RUNG_BASE) / RUNG_STEP)));

// §5.3: every breed target is re-seeded onto a rung, so "genetically perfect" really is perfect
// rather than leaving a permanent snap-to-grid error nobody can breed away. Each target moves by at
// most half a rung (4 points) — well inside the "first guesses to be tuned by observation" the
// vectors were always described as.
const SNAPPED = Object.fromEntries(
  Object.entries(BREEDS).map(([name, t]) => [name, Object.fromEntries(TRAITS.map((k) => [k, rungValue(nearestRung(t[k]))]))])
);

// The breed's pool at one conformation locus, derived from its own target rung and the band —
// never hand-written per breed, which is what makes it monotonic for every breed automatically.
function poolFor(targetRung, band) {
  const w = new Array(RUNG_COUNT).fill(0);
  w[targetRung] = CONC[band];
  for (let d = 1; d <= FALLAWAY.length; d++) {
    for (const r of [targetRung - d, targetRung + d]) {
      if (r >= 0 && r < RUNG_COUNT) w[r] = FALLAWAY[d - 1] * (1 - CONC[band]);
    }
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}
function drawRung(pool) {
  let r = rnd(), c = 0;
  for (let i = 0; i < pool.length; i++) { c += pool[i]; if (r < c) return i; }
  return pool.length - 1;
}

function proposedHorse(targets, band) {
  const g = { type: {}, mod: {} };
  for (const t of TRAITS) {
    const pool = poolFor(nearestRung(targets[t]), band);
    g.type[t] = [drawRung(pool), drawRung(pool)];
    g.mod[t] = todayAlleles(0.5);   // the modifier block stays a flat 50/50 draw
  }
  return g;
}

function proposedExpressed(g, trait) {
  const [a, b] = g.type[trait];
  const typeValue = (rungValue(a) + rungValue(b)) / 2;
  const mod = (count(g.mod[trait]) - LOCI_PER_TRAIT) * MODIFIER_STEP;
  return clamp99(Math.round(typeValue + mod + normal(NEW_NOISE_SD)));
}

function proposedFoal(sire, dam) {
  const g = { type: {}, mod: {} };
  for (const t of TRAITS) {
    g.type[t] = [sire.type[t][rnd() < 0.5 ? 0 : 1], dam.type[t][rnd() < 0.5 ? 0 : 1]];
    const bits = [];
    for (let i = 0; i < LOCI_PER_TRAIT; i++) {
      bits.push(sire.mod[t][i * 2 + (rnd() < 0.5 ? 0 : 1)]);
      bits.push(dam.mod[t][i * 2 + (rnd() < 0.5 ? 0 : 1)]);
    }
    g.mod[t] = bits;
  }
  return g;
}

// ===========================================================================
// SCENARIOS
// ===========================================================================
const N = 20000;
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
const num = (x, d = 2) => x.toFixed(d).padStart(5);
const rule = (s) => console.log('\n' + s + '\n' + '='.repeat(s.length));

// --- 1. Is a minted horse recognisably its own breed? ----------------------
rule('1. TYPE. How far off its breed standard is a freshly minted horse?');
console.log('Mean |expressed - target| across all five traits, and the share of horses with at');
console.log('least one trait more than 25 points off (a "wrong breed" trait — Weak or Poor).\n');
console.log('Breed              | today mid  worst1  | proposed mid  worst1');
console.log('-------------------|--------------------|----------------------');
for (const [name, targets] of Object.entries(BREEDS)) {
  const snap = SNAPPED[name];
  const m = { today: [], prop: [] };
  const bad = { today: 0, prop: 0 };
  for (let i = 0; i < N; i++) {
    const a = todayHorse(targets, 'mid'), b = proposedHorse(targets, 'mid');
    let wa = 0, wb = 0;
    for (const t of TRAITS) {
      const da = Math.abs(todayExpressed(a, t) - targets[t]);
      const db = Math.abs(proposedExpressed(b, t) - snap[t]);
      m.today.push(da); m.prop.push(db);
      wa = Math.max(wa, da); wb = Math.max(wb, db);
    }
    if (wa > 25) bad.today++;
    if (wb > 25) bad.prop++;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(
    `${name.padEnd(18)} |  ${num(avg(m.today), 1)}    ${pct(bad.today / N)} |    ${num(avg(m.prop), 1)}     ${pct(bad.prop / N)}`
  );
}

// --- 2. The Arabian head, specifically ------------------------------------
rule('2. THE ARABIAN HEAD (target 8 — the operator\'s own example)');
{
  const targets = BREEDS['Arabian'];
  const buckets = (fn) => {
    const out = { dished: 0, straight: 0, roman: 0, worst: 0, best: 99 };
    for (let i = 0; i < N; i++) {
      const v = fn();
      if (v <= 25) out.dished++; else if (v <= 55) out.straight++; else out.roman++;
      out.worst = Math.max(out.worst, v); out.best = Math.min(out.best, v);
    }
    return out;
  };
  const a = buckets(() => todayExpressed(todayHorse(targets, 'mid'), 'head_profile'));
  const b = buckets(() => proposedExpressed(proposedHorse(targets, 'mid'), 'head_profile'));
  console.log('                    | dished  straight   roman | range seen');
  console.log('--------------------|--------------------------|-----------');
  console.log(`today, mid band     | ${pct(a.dished / N)} ${pct(a.straight / N)} ${pct(a.roman / N)}  | ${a.best}-${a.worst}`);
  console.log(`proposed, mid band  | ${pct(b.dished / N)} ${pct(b.straight / N)} ${pct(b.roman / N)}  | ${b.best}-${b.worst}`);
}

// --- 3. Is the quality band monotonic for every breed? --------------------
rule('3. THE BAND. Traits on target (of 5), by band — must rise for every breed');
console.log('Breed              |  today: low   mid  high |  proposed: low   mid  high');
console.log('-------------------|-------------------------|---------------------------');
for (const [name, targets] of Object.entries(BREEDS)) {
  const snap = SNAPPED[name];
  const row = [];
  for (const engine of ['today', 'prop']) {
    for (const band of ['low', 'mid', 'high']) {
      let hits = 0;
      for (let i = 0; i < N; i++) {
        const h = engine === 'today' ? todayHorse(targets, band) : proposedHorse(targets, band);
        for (const t of TRAITS) {
          const v = engine === 'today' ? todayExpressed(h, t) : proposedExpressed(h, t);
          if (onTarget(v, engine === 'today' ? targets[t] : snap[t])) hits++;
        }
      }
      row.push(hits / N);
    }
  }
  const inv = (a, b, c) => (a <= b && b <= c ? '' : '   <-- NOT MONOTONIC');
  console.log(
    `${name.padEnd(18)} |        ${num(row[0])} ${num(row[1])} ${num(row[2])} |           ${num(row[3])} ${num(row[4])} ${num(row[5])}${inv(row[0], row[1], row[2])}`
  );
}

// --- 4. Does a good pairing reliably throw a good foal? -------------------
rule('4. LEGIBILITY. Two Outstanding parents — how good is the foal?');
console.log('Quarter Horse. Parents selected until every one of their five traits is Outstanding');
console.log('(the best horse a child could realistically own), then bred. Per-trait foal outcome:\n');
{
  const qh = BREEDS['Quarter Horse'], qhSnap = SNAPPED['Quarter Horse'];
  const findGood = (mk, exp, tg) => {
    for (let tries = 0; tries < 200000; tries++) {
      const h = mk();
      if (TRAITS.every((t) => onTarget(exp(h, t), tg[t]))) return h;
    }
    return null;
  };
  for (const [tag, mk, exp, foal, targets] of [
    ['today   ', () => todayHorse(qh, 'high'), todayExpressed, todayFoal, qh],
    ['proposed', () => proposedHorse(qh, 'high'), proposedExpressed, proposedFoal, qhSnap],
  ]) {
    const tally = { Outstanding: 0, Good: 0, Acceptable: 0, Weak: 0, Poor: 0 };
    let allFive = 0, n = 0;
    for (let p = 0; p < 400; p++) {
      const sire = findGood(mk, exp, targets), dam = findGood(mk, exp, targets);
      if (!sire || !dam) continue;
      for (let f = 0; f < 50; f++) {
        const kid = foal(sire, dam);
        let five = 0;
        for (const t of TRAITS) {
          const l = label(traitScore(exp(kid, t), targets[t]));
          tally[l]++; n++;
          if (l === 'Outstanding') five++;
        }
        if (five === 5) allFive++;
      }
    }
    console.log(`${tag} | Outstanding ${pct(tally.Outstanding / n)}  Good ${pct(tally.Good / n)}  Acceptable ${pct(tally.Acceptable / n)}  Weak+Poor ${pct((tally.Weak + tally.Poor) / n)}`);
    console.log(`         | a foal matching both parents on all five traits: ${pct(allFive / (n / 5))}`);
  }
}

// --- 5. Can a child tell a good pairing from a bad one? -------------------
rule('5. LEGIBILITY. How many foals to tell a good pairing from a bad one?');
console.log('Two Quarter Horse pairings, both of whose parents look Outstanding on back_length.');
console.log('Pairing A can throw an on-target foal; pairing B cannot do better than its parents.');
console.log('How many foals before the two pairings\' results differ by more than chance?\n');
{
  const qh = BREEDS['Quarter Horse'], qhSnap = SNAPPED['Quarter Horse'];
  // Under both engines: measure the SD of one foal's back_length around the mid-parent value,
  // for parents that both express on target. That SD is exactly what a child is fighting.
  for (const [tag, mk, exp, foal, targets] of [
    ['today   ', () => todayHorse(qh, 'high'), todayExpressed, todayFoal, qh],
    ['proposed', () => proposedHorse(qh, 'high'), proposedExpressed, proposedFoal, qhSnap],
  ]) {
    const vals = [];
    let pairs = 0;
    while (pairs < 300) {
      const s = mk(), d = mk();
      if (!onTarget(exp(s, 'back_length'), targets.back_length)) continue;
      if (!onTarget(exp(d, 'back_length'), targets.back_length)) continue;
      pairs++;
      for (let f = 0; f < 60; f++) vals.push(exp(foal(s, d), 'back_length'));
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const hit = vals.filter((v) => onTarget(v, targets.back_length)).length / vals.length;
    console.log(`${tag} | one foal's spread around its parents: SD ${num(sd, 1)} points   on-target foals ${pct(hit)}`);
  }
  console.log('\n(An SD of 10+ points against an Outstanding window of +/-5 is the complaint. A pairing');
  console.log(' has to be repeated many times before its own quality shows through that much scatter.)');
}

// --- 6. Where does the ceiling sit? ---------------------------------------
rule('6. HEADROOM. Traits on target for the best horse each engine can produce');
{
  const targets = BREEDS['Paso Fino'], snap = SNAPPED['Paso Fino'];
  const perfectToday = { }; const perfectProp = { type: {}, mod: {} };
  for (const t of TRAITS) {
    perfectToday[t] = new Array(20).fill(0).map((_, i) => (i < Math.round(targets[t] / ALLELE_STEP) ? 1 : 0));
    const r = nearestRung(targets[t]);
    perfectProp.type[t] = [r, r];
    perfectProp.mod[t] = new Array(20).fill(0).map((_, i) => (i < 10 ? 1 : 0));
  }
  for (const [tag, h, exp, tg] of [['today   ', perfectToday, todayExpressed, targets], ['proposed', perfectProp, proposedExpressed, snap]]) {
    let hits = 0;
    for (let i = 0; i < N; i++) for (const t of TRAITS) if (onTarget(exp(h, t), tg[t])) hits++;
    console.log(`${tag} | a genetically perfect Paso Fino reads Outstanding on ${num(hits / N)} of 5 traits`);
  }
  console.log('\n(Below 5.0 is environmental noise alone. Today it costs almost a whole trait; that is');
  console.log(' conformation_noise_sd at 6 against an Outstanding window of +/-5.)');
}

// --- 7. What a test actually buys ------------------------------------------
rule('7. THE TEST. Two horses that look identical, and breed completely differently');
{
  const tg = SNAPPED['Arabian'].head_profile;
  const r = nearestRung(BREEDS['Arabian'].head_profile);
  const mk = (pair) => {
    const g = { type: {}, mod: {} };
    for (const t of TRAITS) { g.type[t] = pair; g.mod[t] = todayAlleles(0.5); }
    return g;
  };
  const cases = [
    ['both parents test correct   dish/dish   x dish/dish', [r, r], [r, r]],
    ['both LOOK one step long, homozygous     (B x B)', [r + 1, r + 1], [r + 1, r + 1]],
    ['both LOOK one step long, split          (A x A)', [r, r + 2], [r, r + 2]],
    ['one of each                             (A x B)', [r, r + 2], [r + 1, r + 1]],
  ];
  console.log('Arabian head. Rows 2, 3 and 4 all have parents expressing the SAME value — one rung');
  console.log('long. A child looking at those six horses cannot tell them apart. The foals differ:\n');
  console.log('pairing                                            | Outstanding   Good  Accept.  worse | breeds on');
  console.log('---------------------------------------------------|-----------------------------------|----------');
  for (const [name, a, b] of cases) {
    const tally = { Outstanding: 0, Good: 0, Acceptable: 0, worse: 0 };
    let trueBreeding = 0;
    for (let i = 0; i < N; i++) {
      const kid = proposedFoal(mk(a), mk(b));
      const l = label(traitScore(proposedExpressed(kid, 'head_profile'), tg));
      tally[l === 'Weak' || l === 'Poor' ? 'worse' : l]++;
      if (kid.type.head_profile[0] === r && kid.type.head_profile[1] === r) trueBreeding++;
    }
    console.log(`${name.padEnd(50)} |    ${pct(tally.Outstanding / N)}  ${pct(tally.Good / N)}  ${pct(tally.Acceptable / N)} ${pct(tally.worse / N)} |  ${pct(trueBreeding / N)}`);
  }
  console.log('\n"breeds on" = the foal itself carries two correct alleles, so it will pass the right head');
  console.log('to every foal it ever has. That column, not the label column, is what a breeding');
  console.log('programme is actually accumulating.\n');
  console.log('(Rows 2 and 3 are the whole point. Six parents that look identical; pairing A throws a');
  console.log(' true-breeding foal a quarter of the time and pairing B can never throw one, ever — yet');
  console.log(' B still shows an Outstanding foal 17% of the time on luck alone, which is precisely the');
  console.log(' false signal a child cannot currently see through. Under the proposal they do not have');
  console.log(' to: the pairing is testable up front, so the breeding preview can state these four rows');
  console.log(' exactly rather than leaving them to be discovered over a mare\'s whole career.)');
}

console.log('');
