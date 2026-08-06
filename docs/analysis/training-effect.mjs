#!/usr/bin/env node
//
// How much does training actually change who wins a class?
// Run with:  node docs/analysis/training-effect.mjs
//
// Written 2026-08-06 alongside docs/slices/0027-training.md, to answer the question that slice's
// §11 names as the one to watch: training tops out at +6% of a horse's raw score, against show
// noise at an SD of 5 points on a score of roughly 78 — so is a training level a nudge, or is it
// the thing that decides the class? A specification cannot answer that by reasoning. This measures
// it before anything is built, so the numbers can be moved on paper rather than after the children
// have played six real months against them.
//
// Same standing rules as population-sim.mjs and stable-timeline.mjs, and for the same reasons —
// read either file's header. In short: analysis tool, not game code, not a vitest test; own PRNG,
// own copy of the game's constants, and THAT COPY CAN DRIFT. Every constant below names its
// source. If you retune one in the game, retune it here or delete the file.
//
// WHAT IT MODELS
//   The live conformation scoring pipeline exactly: potential -> geneticValue -> expressed ->
//   traitScoreFor -> the judge-weighted mean -> the multiplier line -> additive noise. Five
//   traits, the real Quarter Horse ideal vector, the three real conformation judges, the real
//   falloff and noise SD.
//
// WHAT IT SIMPLIFIES
//   Every horse is mature (age >= conformation_maturity_years) and unrelated (COI 0), so
//   realization is exactly 1.0 and expressed value equals genetic value. That is deliberate: it
//   isolates training from age decline and inbreeding depression, both of which are larger effects
//   and would swamp the thing being measured. Care and tack are held at 1.0 for the same reason.
//   Real fields are noisier than this in the player's favour and the field's alike.

// ---------------------------------------------------------------------------
// CONSTANTS — each copied from the live source named beside it
// ---------------------------------------------------------------------------

// migration 0035 + migration 0111 — the Quarter Horse's ideal vector, all five conformation traits.
const IDEAL = {
  neck_length:    { target: 55, weight: 1.0 },
  shoulder_angle: { target: 70, weight: 1.2 },
  back_length:    { target: 35, weight: 1.1 },
  hock_set:       { target: 50, weight: 0.9 },
  head_profile:   { target: 35, weight: 0.8 },
};
const TRAITS = Object.keys(IDEAL);

// migration 0033 + migration 0112 — the three seeded conformation judges.
const JUDGES = [
  { name: 'Balanced',  w: { neck_length: 1.0, shoulder_angle: 1.0, back_length: 1.0, hock_set: 1.0, head_profile: 1.0 } },
  { name: 'Front end', w: { neck_length: 1.1, shoulder_angle: 1.6, back_length: 0.8, hock_set: 0.7, head_profile: 0.8 } },
  { name: 'Hind end',  w: { neck_length: 0.8, shoulder_angle: 0.8, back_length: 1.5, hock_set: 1.3, head_profile: 1.2 } },
];

const FALLOFF = 2.0;             // show_ideal_falloff,            migration 0041
const SHOW_NOISE_SD = 5;         // show_noise_sd,                 migration 0041
const FIELD_SIZE = 8;            // show_target_field_size,        migration 0041
const CONF_NOISE_SD = 6;         // conformation_noise_sd,         migration 0031
const LOCI_PER_TRAIT = 10;       // polygenic.ts — 20 alleles per trait
const ANCHOR = 50;               // anchorFor(), bidirectional trait

// quality_bands, migration 0025 — polygenic_one_chance, the per-allele probability of a '1'.
const BAND = { low: 0.42, mid: 0.50, high: 0.58 };

// PROPOSED, slice 0027 §2.2 — the numbers this script exists to test. Not in the game.
const TRAINING = [
  { level: 0, word: 'Untrained', factor: 1.000 },
  { level: 1, word: 'Started',   factor: 1.020 },
  { level: 2, word: 'Working',   factor: 1.035 },
  { level: 3, word: 'Schooled',  factor: 1.050 },
  { level: 4, word: 'Polished',  factor: 1.060 },
];
const NPC_LEVEL = 2;             // npc_training_level, slice 0027 §4

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
let rand = mulberry32(20260806);
function normal(mean, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// THE LIVE FORMULAS
// ---------------------------------------------------------------------------

/** polygenic.ts potential(): count of '1' alleles across 2 x LOCI_PER_TRAIT draws. */
function drawPotential(p) {
  let n = 0;
  for (let i = 0; i < LOCI_PER_TRAIT * 2; i++) if (rand() < p) n++;
  return n;
}

/** conformation/model.ts geneticValue(): potential x 5 + birth noise, clamped 1..99. */
function geneticValue(pot) {
  return Math.min(99, Math.max(1, pot * 5 + Math.round(normal(0, CONF_NOISE_SD))));
}

/** conformation/model.ts expressedValue() at realization 1.0 — mature, COI 0 (see header). */
function drawHorse(band) {
  const expressed = {};
  for (const t of TRAITS) expressed[t] = Math.round(ANCHOR + (geneticValue(drawPotential(band)) - ANCHOR) * 1.0);
  return expressed;
}

/**
 * A BRED horse: `specialists` of its five traits sit within +/-1 allele of the breed's own target,
 * the rest are drawn from the band as usual.
 *
 * This is how the game actually makes a good conformation horse — slice 0019's founding
 * specialists, and what selective breeding converges on. It is NOT the quality band, and scenario 3
 * shows why that distinction matters: a conformation trait is a bidirectional measurement with an
 * intermediate target (slice 0006 §2.2's correction to overview §2b), so raising a horse's allele
 * count moves it towards targets above 50 and away from targets below it. The high band is not a
 * better horse; it is a different-shaped one.
 */
function drawBredHorse(band, specialists) {
  const expressed = {};
  const order = [...TRAITS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((t, idx) => {
    if (idx < specialists) {
      // Slice 0019 §4.1: potential set so the genetic value lands on the target, +/-1 allele.
      const onTarget = Math.round(IDEAL[t].target / 5);
      const pot = Math.max(0, Math.min(20, onTarget + (rand() < 0.5 ? -1 : 1) * (rand() < 0.5 ? 0 : 1)));
      expressed[t] = Math.round(ANCHOR + (geneticValue(pot) - ANCHOR) * 1.0);
    } else {
      expressed[t] = Math.round(ANCHOR + (geneticValue(drawPotential(band)) - ANCHOR) * 1.0);
    }
  });
  return expressed;
}

/** showing/score.ts traitScoreFor(). */
function traitScoreFor(expressed, target) {
  return Math.max(0, 100 - Math.abs(expressed - target) * FALLOFF);
}

/** showing/score.ts scoreEntry(), through to finalScore. */
function rawScore(expressed, judge) {
  let weighted = 0, weightSum = 0;
  for (const t of TRAITS) {
    const w = IDEAL[t].weight * judge.w[t];
    weighted += w * traitScoreFor(expressed[t], IDEAL[t].target);
    weightSum += w;
  }
  return weighted / weightSum;
}
function finalScore(raw, trainingFactor) {
  // care, tack and age all 1.0 (see header). Noise is ADDITIVE, in score points.
  return raw * trainingFactor + normal(0, SHOW_NOISE_SD);
}

const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const factorOf = (lvl) => TRAINING[lvl].factor;
const wordOf = (lvl) => TRAINING[lvl].word;

// ---------------------------------------------------------------------------
// SCENARIO 1 — the same horse against itself
// ---------------------------------------------------------------------------
// The cleanest possible read: identical genetics, identical judge, one horse trained and one not.
// Any win rate above 50% is training and nothing else.

function scenario1(runs = 200000) {
  console.log('\n=== 1. The same horse against itself ===');
  console.log('Identical genetics and judge. The only difference is training.\n');
  console.log('  Player horse   vs Untrained   win rate   avg margin');

  for (const lvl of [1, 2, 3, 4]) {
    let wins = 0, marginSum = 0;
    rand = mulberry32(1000 + lvl);
    for (let i = 0; i < runs; i++) {
      const horse = drawHorse(BAND.mid);
      const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
      const raw = rawScore(horse, judge);
      const trained = finalScore(raw, factorOf(lvl));
      const untrained = finalScore(raw, 1.0);
      if (trained > untrained) wins++;
      marginSum += trained - untrained;
    }
    const label = `${wordOf(lvl)} (level ${lvl})`.padEnd(15);
    console.log(`  ${label}                ${pct(wins, runs).padStart(6)}     ${(marginSum / runs).toFixed(2)} pts`);
  }
  console.log('\n  A coin flip is 50.0%. Show noise (SD 5) is drawn independently for each entry,');
  console.log('  so a 2-3 point edge on a ~78-point score moves the needle without owning it.');
}

// ---------------------------------------------------------------------------
// SCENARIO 2 — a real field
// ---------------------------------------------------------------------------
// Eight horses: seven NPC-owned at npc_training_level, one player horse. All drawn from the same
// mid quality band, so genetics are equal on average and training is the only systematic
// difference. This is the number that decides whether the Training card feels worth pressing.

function scenario2(runs = 200000) {
  console.log('\n=== 2. One player horse in a field of eight ===');
  console.log(`Seven NPC horses at ${wordOf(NPC_LEVEL)} (npc_training_level = ${NPC_LEVEL}).`);
  console.log('Every horse drawn from the mid band, so genetics are equal on average.\n');
  console.log('  Player horse           wins    top 3    last');

  for (const lvl of [0, 1, 2, 3, 4]) {
    let wins = 0, top3 = 0, last = 0;
    rand = mulberry32(2000 + lvl);
    for (let i = 0; i < runs; i++) {
      const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
      const scores = [finalScore(rawScore(drawHorse(BAND.mid), judge), factorOf(lvl))];
      for (let j = 1; j < FIELD_SIZE; j++) {
        scores.push(finalScore(rawScore(drawHorse(BAND.mid), judge), factorOf(NPC_LEVEL)));
      }
      const mine = scores[0];
      let better = 0;
      for (let j = 1; j < scores.length; j++) if (scores[j] > mine) better++;
      if (better === 0) wins++;
      if (better < 3) top3++;
      if (better === FIELD_SIZE - 1) last++;
    }
    const label = `${wordOf(lvl)} (level ${lvl})`.padEnd(20);
    console.log(`  ${label} ${pct(wins, runs).padStart(6)}  ${pct(top3, runs).padStart(6)}  ${pct(last, runs).padStart(6)}`);
  }
  console.log(`\n  A field of ${FIELD_SIZE} with nothing to separate them wins ${pct(1, FIELD_SIZE)} and places top 3 ${pct(3, FIELD_SIZE)}.`);
}

// ---------------------------------------------------------------------------
// SCENARIO 3 — what training is worth in genetics
// ---------------------------------------------------------------------------
// The equity question. If a training level substitutes for real breeding progress, breeding stops
// being the game (overview §8a's named failure mode). Measure the training gain in raw-score
// points, and set it against how far apart the quality bands actually are.

function scenario3(runs = 200000) {
  console.log('\n=== 3. What a training level is worth, in breeding terms ===\n');

  // First: the quality band does almost nothing for conformation. Worth printing, because it is
  // counter-intuitive and it is why the comparison below uses specialists instead.
  console.log('  Raw score by founding quality band (balanced judge, untrained, no noise):');
  for (const [name, p] of Object.entries(BAND)) {
    rand = mulberry32(3000 + name.length);
    let sum = 0;
    for (let i = 0; i < runs; i++) sum += rawScore(drawHorse(p), JUDGES[0]);
    console.log(`    ${name.padEnd(5)} band   mean ${(sum / runs).toFixed(1)}`);
  }
  console.log('    ^ the band barely moves conformation at all — see drawBredHorse()\'s comment.');

  // Second: real breeding progress, measured as traits brought onto the breed's target.
  console.log('\n  Raw score by breeding progress (traits within +/-1 allele of target):');
  const bred = [];
  for (let k = 0; k <= 5; k++) {
    rand = mulberry32(3100 + k);
    let sum = 0, sumSq = 0;
    for (let i = 0; i < runs; i++) {
      const r = rawScore(drawBredHorse(BAND.mid, k), JUDGES[0]);
      sum += r;
      sumSq += r * r;
    }
    const mean = sum / runs;
    bred.push({ k, mean, sd: Math.sqrt(sumSq / runs - mean * mean) });
    // NB: k is the number of traits FORCED onto target. The remaining traits land on target by
    // luck a further ~30% of the time (scenario 7), so a horse's true count is higher than k --
    // "1 forced" measures 2.2 of 5 actually right. Compare like with like before quoting these.
    const label = k === 0 ? 'unselected' : `${k} forced on target`;
    console.log(`    ${label.padEnd(18)} mean ${mean.toFixed(1)}   SD ${sd(bred, k).toFixed(1)}`);
  }

  const base = bred[1];  // a founding horse: one conformation specialist (slice 0019)
  const perStep = (bred[5].mean - bred[1].mean) / 4;
  console.log(`\n  One trait brought onto target is worth ${perStep.toFixed(2)} raw points on average.`);
  console.log(`  Population SD among founding-grade horses is ${base.sd.toFixed(1)} points.`);

  console.log('\n  A training level, on a founding-grade horse:');
  for (const t of TRAINING.slice(1)) {
    const gain = base.mean * (t.factor - 1);
    console.log(
      `    ${t.word.padEnd(10)} +${gain.toFixed(2)} pts` +
      `   = ${(gain / base.sd).toFixed(2)} population SD` +
      `   = ${(gain / perStep).toFixed(2)} traits' worth of breeding`
    );
  }
  console.log(`\n  Show noise SD is ${SHOW_NOISE_SD.toFixed(1)} points — the yardstick everything above is measured against.`);
}

function sd(list, k) {
  return list.find((e) => e.k === k).sd;
}

// ---------------------------------------------------------------------------
// SCENARIO 4 — the one slice 0027 §11 actually worries about
// ---------------------------------------------------------------------------
// "If a Polished ordinary horse beats an Untrained good one more often than feels right, that is
// the number to cut." Here it is, measured, head to head and in a real field.

function scenario4(runs = 200000) {
  console.log('\n=== 4. Does spending beat breeding? ===');
  console.log('A founding-grade horse (1 of 5 traits on target), trained, against a better-bred');
  console.log('horse with no training at all. This is slice 0027 §11\'s actual worry.\n');
  console.log('  Trained founding horse beats an untrained horse with...');
  console.log('                    2 on target   3 on target   5 on target');

  for (const lvl of [0, 2, 4]) {
    const cells = [];
    for (const k of [2, 3, 5]) {
      let wins = 0;
      rand = mulberry32(4000 + lvl * 10 + k);
      for (let i = 0; i < runs; i++) {
        const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
        const mine = finalScore(rawScore(drawBredHorse(BAND.mid, 1), judge), factorOf(lvl));
        const theirs = finalScore(rawScore(drawBredHorse(BAND.mid, k), judge), 1.0);
        if (mine > theirs) wins++;
      }
      cells.push(pct(wins, runs).padStart(11));
    }
    console.log(`  ${wordOf(lvl).padEnd(16)}${cells.join('   ')}`);
  }
  console.log('\n  Read the drop across each row: that is breeding still winning.');
  console.log('  Read the rise down each column: that is what training buys.');
}

// ---------------------------------------------------------------------------
// SCENARIO 5 — the untrained player against a trained field
// ---------------------------------------------------------------------------
// npc_training_level is the dial slice 0027 §4 calls invisible until a child notices they cannot
// win. This is what it costs a player who never opens the Training card.

function scenario5(runs = 200000) {
  console.log('\n=== 5. What npc_training_level costs a player who never trains ===');
  console.log('Untrained mid-band player horse, field of eight, NPCs at each level.\n');
  console.log('  NPC level            player wins   top 3');

  for (const npc of [0, 1, 2, 3, 4]) {
    let wins = 0, top3 = 0;
    rand = mulberry32(5000 + npc);
    for (let i = 0; i < runs; i++) {
      const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
      const mine = finalScore(rawScore(drawHorse(BAND.mid), judge), 1.0);
      let better = 0;
      for (let j = 1; j < FIELD_SIZE; j++) {
        if (finalScore(rawScore(drawHorse(BAND.mid), judge), factorOf(npc)) > mine) better++;
      }
      if (better === 0) wins++;
      if (better < 3) top3++;
    }
    const label = `${wordOf(npc)} (level ${npc})`.padEnd(20);
    console.log(`  ${label} ${pct(wins, runs).padStart(6)}  ${pct(top3, runs).padStart(6)}`);
  }
  console.log(`\n  Level 0 is the no-NPC-training baseline: ${pct(1, FIELD_SIZE)} wins is a fair field.`);
}

// ---------------------------------------------------------------------------
// SCENARIO 6 — a side finding, not about training
// ---------------------------------------------------------------------------
// Scenario 3 turned up something unexpected: the founding QUALITY BAND barely moves a horse's
// conformation score, and for the Quarter Horse the mid band actually beats the high one. That is
// not noise and it is not a bug in this script — it falls straight out of slice 0006 §2.2. A
// conformation trait is a bidirectional measurement against an intermediate target, so the band
// that scores best for a breed is the one whose genetic value lands on that breed's own
// weight-averaged target. Raising the allele count past it makes a horse worse, not better.
//
// The band is only monotonic for ABILITY traits, which are higher_better with no target at all.
//
// migrations 0035, 0107, 0111 — all eight breeds' ideal vectors, five traits each.
const ALL_BREEDS = {
  QH:  { neck_length: [55, 1.0], shoulder_angle: [70, 1.2], back_length: [35, 1.1], hock_set: [50, 0.9], head_profile: [35, 0.8] },
  AR:  { neck_length: [75, 1.4], shoulder_angle: [72, 1.1], back_length: [28, 1.2], hock_set: [48, 0.8], head_profile: [8, 1.3] },
  TB:  { neck_length: [65, 1.0], shoulder_angle: [80, 1.5], back_length: [50, 0.9], hock_set: [55, 1.0], head_profile: [48, 0.7] },
  GW:  { neck_length: [72, 1.2], shoulder_angle: [78, 1.3], back_length: [52, 0.9], hock_set: [62, 1.2], head_profile: [50, 0.8] },
  FR:  { neck_length: [82, 1.5], shoulder_angle: [68, 1.0], back_length: [40, 1.0], hock_set: [62, 1.1], head_profile: [70, 1.2] },
  PF:  { neck_length: [68, 1.2], shoulder_angle: [60, 1.0], back_length: [30, 1.3], hock_set: [45, 1.1], head_profile: [62, 0.9] },
  IC:  { neck_length: [40, 0.9], shoulder_angle: [35, 1.2], back_length: [42, 1.0], hock_set: [36, 1.1], head_profile: [57, 0.6] },
  NOK: { neck_length: [40, 1.0], shoulder_angle: [45, 0.9], back_length: [58, 1.1], hock_set: [36, 1.0], head_profile: [66, 0.8] },
};

function scenario6() {
  console.log('\n=== 6. Side finding: what the founding quality band is actually worth ===');
  console.log('The band that suits a breed is the one landing on its weight-averaged target.');
  console.log('A mid-band horse averages a genetic value of 50.0.\n');
  console.log('  Breed   weighted-avg target   best band is...');

  for (const [code, vec] of Object.entries(ALL_BREEDS)) {
    let wt = 0, ws = 0;
    for (const [, [target, weight]] of Object.entries(vec)) {
      wt += target * weight;
      ws += weight;
    }
    const avg = wt / ws;
    // A band's polygenic_one_chance p gives mean potential 20p, mean genetic value 100p.
    const idealP = avg / 100;
    const nearest = Object.entries(BAND).reduce((a, b) => (Math.abs(b[1] - idealP) < Math.abs(a[1] - idealP) ? b : a));
    const flag = Math.abs(avg - 50) < 3 ? '  <- mid band is optimal' : '';
    console.log(
      `  ${code.padEnd(6)}  ${avg.toFixed(1).padStart(17)}   ` +
      `p=${idealP.toFixed(2)} (nearest seeded band: ${nearest[0]})${flag}`
    );
  }
  console.log('\n  This is not a training question, but it changes how scenario 3 reads, and it');
  console.log('  affects the consignment dealer\'s mid band and the show barn\'s rank plan alike.');
}

// ---------------------------------------------------------------------------
// SCENARIO 7 — the quality band against what it was meant to mean
// ---------------------------------------------------------------------------
// Operator, 2026-08-06: "mid was supposed to mean that a horse was on target for a conformation
// trait 50% of the time."
//
// That is not what the band does. `polygenicOneChance` (generate.ts) is the flat chance that any
// single allele is a '1', applied identically to every trait, and it never reads the breed's ideal
// vector. "On target" here uses the game's own definition of the phrase — slice 0019's specialist
// rule, potential within +/-1 allele of round(target / 5).
//
// Computed exactly from the binomial PMF, not simulated.

function binomPmf(k, n, p) {
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log((n - k + i) / i);
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(potential within +/-1 allele of the target) for one trait at one band. */
function onTargetChance(target, p) {
  const centre = Math.round(target / 5);
  let total = 0;
  for (let k = Math.max(0, centre - 1); k <= Math.min(LOCI_PER_TRAIT * 2, centre + 1); k++) {
    total += binomPmf(k, LOCI_PER_TRAIT * 2, p);
  }
  return total;
}

function scenario7() {
  console.log('\n=== 7. The quality band vs. what it was meant to mean ===');
  console.log('Intended: the band IS the chance a conformation trait lands on target.');
  console.log('Actual: the band is a flat per-allele chance, blind to the breed.\n');
  console.log('  Chance a conformation trait lands within +/-1 allele of its target:\n');
  console.log('  Breed    low band   mid band   high band     intended at mid');

  for (const [code, vec] of Object.entries(ALL_BREEDS)) {
    const cells = [];
    for (const p of [BAND.low, BAND.mid, BAND.high]) {
      let sum = 0;
      for (const [, [target]] of Object.entries(vec)) sum += onTargetChance(target, p);
      cells.push(pct(sum / 5, 1).padStart(9));
    }
    console.log(`  ${code.padEnd(7)}${cells.join('  ')}        50.0%`);
  }

  console.log('\n  Every cell should read close to its band. None of them do, and the mid');
  console.log('  column is nowhere near 50%. A breed whose targets sit far from 50 (Arabian\'s');
  console.log('  dished head at 8, Friesian\'s neck at 82) is worst served, because no single');
  console.log('  flat allele frequency can centre on two targets at once.\n');

  // What the intended semantics would do to the population's scores.
  console.log('  What the intended reading would do to Quarter Horse scores:\n');
  console.log('  Band      traits on target   mean raw score   (today)');
  const runs = 100000;
  for (const [name, p] of Object.entries(BAND)) {
    rand = mulberry32(7000 + name.length);
    let intendedSum = 0, actualSum = 0, kSum = 0;
    for (let i = 0; i < runs; i++) {
      let k = 0;
      for (let t = 0; t < 5; t++) if (rand() < p) k++;
      kSum += k;
      intendedSum += rawScore(drawBredHorse(BAND.mid, k), JUDGES[0]);
      actualSum += rawScore(drawHorse(p), JUDGES[0]);
    }
    console.log(
      `  ${name.padEnd(9)} ${(kSum / runs).toFixed(2)} of 5`.padEnd(30) +
      `${(intendedSum / runs).toFixed(1)}`.padStart(9) +
      `        ${(actualSum / runs).toFixed(1)}`
    );
  }
  console.log('\n  Fixing this raises EVERY new horse, players and NPC stables alike — it is a');
  console.log('  change to the population, not to one screen. Read it against the NPC ceiling');
  console.log('  before acting on it.');
}

// ---------------------------------------------------------------------------
// SCENARIO 8 — the proposed fix, measured
// ---------------------------------------------------------------------------
// Operator, 2026-08-06: keep slice 0019's guaranteed conformation specialist, and set the bands to
// 25 / 50 / 75 read as "the chance a conformation trait lands on target".
//
// So a horse is built: each of the five conformation traits independently lands on target with
// probability = the band, and is otherwise drawn flat (an unselected trait, chance 0.50 per allele
// — NOT the band, which no longer means an allele frequency for conformation). Then slice 0019's
// specialist overwrites one conformation trait onto target regardless, which is what makes the
// guarantee a guarantee.
//
// Expected traits on target is therefore 1 + 4 x band, not 5 x band.

const PROPOSED_BANDS = { low: 0.25, mid: 0.50, high: 0.75 };
const UNSELECTED = 0.50;   // the flat draw for a trait that did not land on target

function drawProposedHorse(onTargetChance, keepSpecialist = true) {
  const expressed = {};
  const onTarget = {};
  for (const t of TRAITS) onTarget[t] = rand() < onTargetChance;
  if (keepSpecialist) {
    // Slice 0019: one conformation trait, chosen at random, is on target no matter what.
    onTarget[TRAITS[Math.floor(rand() * TRAITS.length)]] = true;
  }
  let count = 0;
  for (const t of TRAITS) {
    let pot;
    if (onTarget[t]) {
      count++;
      const centre = Math.round(IDEAL[t].target / 5);
      pot = Math.max(0, Math.min(20, centre + (rand() < 0.5 ? -1 : 1) * (rand() < 0.5 ? 0 : 1)));
    } else {
      pot = drawPotential(UNSELECTED);
    }
    expressed[t] = Math.round(ANCHOR + (geneticValue(pot) - ANCHOR) * 1.0);
  }
  return { expressed, count };
}

function scenario8(runs = 200000) {
  console.log('\n=== 8. The proposed fix, measured ===');
  console.log('Bands read as "chance a conformation trait is on target": 25 / 50 / 75.');
  console.log('Slice 0019\'s guaranteed conformation specialist is KEPT.\n');
  console.log('  Band     on target   mean raw   SD     today');

  const out = {};
  for (const [name, p] of Object.entries(PROPOSED_BANDS)) {
    rand = mulberry32(8000 + name.length);
    let sum = 0, sumSq = 0, kSum = 0;
    for (let i = 0; i < runs; i++) {
      const h = drawProposedHorse(p);
      const r = rawScore(h.expressed, JUDGES[0]);
      sum += r; sumSq += r * r; kSum += h.count;
    }
    const mean = sum / runs;
    out[name] = { mean, sd: Math.sqrt(sumSq / runs - mean * mean), k: kSum / runs };

    rand = mulberry32(8500 + name.length);
    let todaySum = 0;
    for (let i = 0; i < runs; i++) todaySum += rawScore(drawBredHorse(BAND[name], 1), JUDGES[0]);
    console.log(
      `  ${name.padEnd(8)} ${out[name].k.toFixed(2)} of 5    ${mean.toFixed(1)}     ` +
      `${out[name].sd.toFixed(1)}    ${(todaySum / runs).toFixed(1)}`
    );
  }

  console.log('\n  Bands are now monotonic, evenly spaced, and mean the same thing for every breed.');

  // The thing to check: does the ceiling leave breeding anywhere to go?
  rand = mulberry32(8900);
  let perfect = 0;
  for (let i = 0; i < runs; i++) perfect += rawScore(drawBredHorse(BAND.mid, 5), JUDGES[0]);
  const ceiling = perfect / runs;
  console.log(`\n  Headroom check — a perfectly bred horse (5 of 5 on target) scores ${ceiling.toFixed(1)}.`);
  console.log(`    Today a mid-band founding horse starts at 73.4, leaving ${(ceiling - 73.4).toFixed(1)} points to breed for.`);
  console.log(`    Proposed, it starts at ${out.mid.mean.toFixed(1)}, leaving ${(ceiling - out.mid.mean).toFixed(1)} points.`);
  console.log(`    Show noise SD is ${SHOW_NOISE_SD.toFixed(1)}. Breeding progress worth less than that is invisible.`);

  // And what that does to a class between a founding horse and a well-bred one.
  console.log('\n  Can a founding-grade horse still be beaten by a better-bred one?\n');
  console.log('  Band     founder beats a 5-of-5 horse      (today)');
  for (const [name, p] of Object.entries(PROPOSED_BANDS)) {
    let wins = 0;
    rand = mulberry32(8100 + name.length);
    for (let i = 0; i < runs; i++) {
      const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
      const mine = finalScore(rawScore(drawProposedHorse(p).expressed, judge), 1.0);
      const theirs = finalScore(rawScore(drawBredHorse(BAND.mid, 5), judge), 1.0);
      if (mine > theirs) wins++;
    }
    let todayWins = 0;
    rand = mulberry32(8700 + name.length);
    for (let i = 0; i < runs; i++) {
      const judge = JUDGES[Math.floor(rand() * JUDGES.length)];
      const mine = finalScore(rawScore(drawBredHorse(BAND[name], 1), judge), 1.0);
      const theirs = finalScore(rawScore(drawBredHorse(BAND.mid, 5), judge), 1.0);
      if (mine > todayWins && mine > theirs) todayWins++;
      else if (mine > theirs) todayWins++;
    }
    console.log(`  ${name.padEnd(8)} ${pct(wins, runs).padStart(10)}                  ${pct(todayWins, runs).padStart(6)}`);
  }
  console.log('\n  A number climbing towards 50% means breeding has stopped mattering.');
}

console.log('Training effect on show scores — docs/slices/0027-training.md §11');
console.log('Quarter Horse conformation, five traits, three judges, 200,000 classes per row.');
scenario1();
scenario2();
scenario3();
scenario4();
scenario5();
scenario6();
scenario7();
scenario8();
console.log('');
