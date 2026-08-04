// Amendment 0017a §4.4, extended by slice 0021 Part D (§6.2): every colour a pairing could produce,
// computed only from what is KNOWN about each parent (a narrowed possibility set from inference.ts,
// or a single pair once a locus is tested) - never from horses.genotype. Pure, no database access
// (CLAUDE.md §5.1), no randomness beyond the pattern-penetrance expectation described below: this is
// a probability model over Mendelian segregation, not a dice roll, so it runs the same way every
// time it's asked.
//
// It reuses expressPhenotype (the real colour engine) for the base/dilution string rather than
// re-deriving base/dilution rules a second time - the same "no second colour model" reasoning slice
// 0017 §4.1 gives for reusing scoreEntry. A foal's colour at birth is read at age 0, which lands
// every grey genotype in 'foal_grey' (visibly its base colour, per expression.ts) - grey and gait are
// not "colours" this function predicts; they are the horse's own page's job (§4.5 point 2), via
// inferFromPhenotype.
//
// §6.2's CPU problem, and why this is split into THREE independent folds rather than one combined
// one: naively crossing thirteen loci as raw genotypes is 3^13, nowhere near the free-tier 10ms
// budget - the fix the slice asks for is to fold progressively over phenotype state, collapsing
// duplicates at every step. That alone still leaves a worst case (every locus heterozygous on both
// parents) with thousands of distinct (dose, dun, champagne, silver, roan, patterns) combinations,
// and naming EACH one by calling the real engine (which builds a Genotype, seeds an Rng, walks every
// locus) measured at several hundred milliseconds for that worst case - nowhere near 10ms. The named
// colour string, though, only ever depends on FIVE things (base, dose, dun, champagne, silver, roan)
// - patterns are appended as plain words afterward, never folded into the name. So the engine is
// called at most (3 base categories) x (the dilution fold's own distinct states) times - a few dozen
// - and the pattern fold (which can run into the hundreds of combinations on a maximally-marked pair
// of parents) is pure string/array bookkeeping with no engine calls at all. The two are crossed at
// the very end with cheap string concatenation.

import { expressPhenotype, type PatternCode, type PatternPenetrance, DEFAULT_PATTERN_PENETRANCE } from './expression';
import { PATTERN_LABELS } from './describe';
import { sortAllelePair, type AllelePair, type Genotype } from './genotype';

export interface UncertainColourLocus {
  locusCode: string;
  unlockedColours: string[];
  untestedParents: ('sire' | 'dam')[];
}

export interface FoalColourPossibilities {
  /** May sum to less than 1 - the remainder is exactly the probability mass covered by `uncertain`
   * (§4.4: a locus that would change the answer is never silently folded into a number here). */
  certain: { colour: string; probability: number }[];
  uncertain: UncertainColourLocus[];
}

type ColourLocus = 'E' | 'A' | 'CR' | 'D' | 'Z' | 'CH' | 'RN' | 'TO' | 'O' | 'SW1' | 'SB1' | 'LP' | 'PATN1';
const DILUTION_LOCI = new Set(['CR', 'D', 'Z', 'CH', 'RN']);

function isResolved(pairs: AllelePair[]): boolean {
  return pairs.length === 1;
}

/** Standard Mendelian segregation for one locus: each parent contributes one of its two alleles,
 * each with probability 1/2 (a homozygous parent always contributes the same allele, so its two
 * "choices" collapse into one outcome at double weight). Only called once both parents are resolved
 * to a single known pair at this locus. */
function punnett(locusCode: string, sirePair: AllelePair, damPair: AllelePair): { pair: AllelePair; prob: number }[] {
  const merged = new Map<string, { pair: AllelePair; prob: number }>();
  for (const sAllele of sirePair) {
    for (const dAllele of damPair) {
      const pair = sortAllelePair(locusCode, sAllele, dAllele);
      const key = pair.join('/');
      const existing = merged.get(key);
      if (existing) existing.prob += 0.25;
      else merged.set(key, { pair, prob: 0.25 });
    }
  }
  return [...merged.values()];
}

// --- The dilution fold (CR, D, CH, Z, RN) - the five loci that change the NAME, never more than a
// few dozen distinct states even in the worst case, so naming each one with the real engine is cheap.

interface DilutionState {
  dose: 0 | 1 | 2;
  dun: boolean;
  champagne: boolean;
  silver: boolean;
  roan: boolean;
}

const INITIAL_DILUTION: DilutionState = { dose: 0, dun: false, champagne: false, silver: false, roan: false };

type DilutionMap = Map<string, { prob: number; state: DilutionState }>;

function dilutionKey(state: DilutionState): string {
  return `${String(state.dose)}|${String(state.dun)}|${String(state.champagne)}|${String(state.silver)}|${String(state.roan)}`;
}

function mergeDilution(map: DilutionMap, state: DilutionState, prob: number): void {
  if (prob <= 0) return;
  const key = dilutionKey(state);
  const existing = map.get(key);
  if (existing) existing.prob += prob;
  else map.set(key, { prob, state });
}

interface BaseBranch {
  ePair: AllelePair;
  /** null on the chestnut branch - Agouti never resolves and never matters there (epistasis). */
  aPair: AllelePair | null;
}

// Representative genotype fragments for the three base categories, used to name a dilution state -
// only the CATEGORY (chestnut / not-chestnut+aa / not-chestnut+not-aa) affects expressPhenotype's
// baseColourOf, never the exact zygosity, so any E/e-containing pair stands in for "bay" or "black".
const CHESTNUT_BASE: BaseBranch = { ePair: ['e', 'e'], aPair: null };
const BAY_BASE: BaseBranch = { ePair: ['E', 'e'], aPair: ['A', 'a'] };
const BLACK_BASE: BaseBranch = { ePair: ['E', 'e'], aPair: ['a', 'a'] };

/** The one place a DilutionState becomes an actual colour word (no pattern suffix - see this file's
 * header for why patterns are kept out of this call entirely). Builds a synthetic genotype (missing
 * loci default to wild type per genotype.ts's own missing-locus rule) and calls the real engine. */
function composeDilutionName(base: BaseBranch, state: DilutionState, gameDaysPerYear: number): string {
  const genotype: Genotype = {
    v: 1,
    mendelian: {
      E: base.ePair,
      ...(base.aPair ? { A: base.aPair } : {}),
      CR: state.dose === 0 ? ['cr', 'cr'] : state.dose === 1 ? ['Cr', 'cr'] : ['Cr', 'Cr'],
      D: state.dun ? ['D', 'nd'] : ['nd', 'nd'],
      CH: state.champagne ? ['Ch', 'ch'] : ['ch', 'ch'],
      Z: state.silver ? ['Z', 'z'] : ['z', 'z'],
      RN: state.roan ? ['Rn', 'rn'] : ['rn', 'rn'],
    },
    polygenic: {},
  };
  return expressPhenotype(genotype, 0, gameDaysPerYear, 0).visibleColour;
}

/** Unresolved on either parent: registers uncertain and leaves the field at its default
 * (absent/undiluted) for every branch - the same "assume the plain reading, flag the open question"
 * rule §4.4 always used for CR, now applied uniformly to D/Z/CH/RN too. */
function foldDilutionModifier(
  map: DilutionMap,
  locusCode: 'CR' | 'D' | 'Z' | 'CH' | 'RN',
  sirePairs: AllelePair[],
  damPairs: AllelePair[],
  apply: (state: DilutionState, pair: AllelePair) => DilutionState,
  registerUncertain: () => void
): DilutionMap {
  if (!isResolved(sirePairs) || !isResolved(damPairs)) {
    registerUncertain();
    return map;
  }
  const next: DilutionMap = new Map();
  const branches = punnett(locusCode, sirePairs[0], damPairs[0]);
  for (const { prob, state } of map.values()) {
    for (const branch of branches) mergeDilution(next, apply(state, branch.pair), prob * branch.prob);
  }
  return next;
}

// --- The pattern fold (TO, O, SW1, SB1, LP+PATN1) - entirely independent of base/dilution, pure
// string/array bookkeeping, no engine calls. Built in LOCI order (TO, frame, splash, sabino,
// appaloosa), the same push order patternsOf itself uses, so two branches that reach the same set
// always produce the same array and merge correctly.

type PatternMap = Map<string, { prob: number; patterns: PatternCode[] }>;

function patternKey(patterns: PatternCode[]): string {
  return patterns.join(',');
}

function mergePattern(map: PatternMap, patterns: PatternCode[], prob: number): void {
  if (prob <= 0) return;
  const key = patternKey(patterns);
  const existing = map.get(key);
  if (existing) existing.prob += prob;
  else map.set(key, { prob, patterns });
}

function patternWords(patterns: PatternCode[]): string {
  return patterns.length > 0 ? patterns.map((p) => PATTERN_LABELS[p]).join(' ') : '';
}

/** Tobiano and Sabino1: fully penetrant (§5.3), so folded straight from the punnett square with no
 * probability adjustment - "not visible" is certain, not an expectation. */
function foldPatternFullPenetrance(
  map: PatternMap,
  locusCode: 'TO' | 'SB1',
  sirePairs: AllelePair[],
  damPairs: AllelePair[],
  toPatterns: (pair: AllelePair) => PatternCode[],
  registerUncertain: () => void
): PatternMap {
  if (!isResolved(sirePairs) || !isResolved(damPairs)) {
    registerUncertain();
    return map;
  }
  const next: PatternMap = new Map();
  const branches = punnett(locusCode, sirePairs[0], damPairs[0]);
  for (const { prob, patterns } of map.values()) {
    for (const branch of branches) {
      const added = toPatterns(branch.pair);
      mergePattern(next, added.length > 0 ? [...patterns, ...added] : patterns, prob * branch.prob);
    }
  }
  return next;
}

/** Frame overo and splashed white (§5.5): the dominant allele's own punnett probability is folded
 * together with the penetrance expectation - "carries but stayed cryptic" lands in the SAME bucket as
 * "doesn't carry at all" (both show nothing), while "carries and shows" is its own bucket. This is an
 * expectation over the pattern-expression roll, not a guess - the two probabilities multiply exactly
 * as segregation and penetrance are independent events. */
function foldPatternPenetrant(
  map: PatternMap,
  locusCode: 'O' | 'SW1',
  dominantAllele: 'O' | 'SW1',
  patternCode: PatternCode,
  sirePairs: AllelePair[],
  damPairs: AllelePair[],
  penetrance: number,
  registerUncertain: () => void
): PatternMap {
  if (!isResolved(sirePairs) || !isResolved(damPairs)) {
    registerUncertain();
    return map;
  }
  const next: PatternMap = new Map();
  const branches = punnett(locusCode, sirePairs[0], damPairs[0]);
  for (const { prob, patterns } of map.values()) {
    for (const branch of branches) {
      const carries = branch.pair.includes(dominantAllele);
      if (!carries) {
        mergePattern(next, patterns, prob * branch.prob);
        continue;
      }
      mergePattern(next, [...patterns, patternCode], prob * branch.prob * penetrance);
      if (penetrance < 1) mergePattern(next, patterns, prob * branch.prob * (1 - penetrance));
    }
  }
  return next;
}

/** Leopard complex (§5.4): the one two-locus interaction. Both LP and PATN1 must be resolved on both
 * parents to say anything certain about the combined pattern - if either is open, both are flagged
 * uncertain and every branch defaults to no visible spotting (the same "assume the plain reading"
 * rule every other unresolved locus here follows), which is a deliberate simplification: a fully-Lp
 * horse with an untested PATN1 still shows *some* appaloosa pattern in truth, but which one is exactly
 * the open question, so this treats the whole pair as open rather than asserting a guess. */
function foldAppaloosaPattern(
  map: PatternMap,
  sireLP: AllelePair[],
  damLP: AllelePair[],
  sirePatn1: AllelePair[],
  damPatn1: AllelePair[],
  registerLpUncertain: () => void,
  registerPatn1Uncertain: () => void
): PatternMap {
  const lpResolved = isResolved(sireLP) && isResolved(damLP);
  const patn1Resolved = isResolved(sirePatn1) && isResolved(damPatn1);
  if (!lpResolved) registerLpUncertain();
  if (!patn1Resolved) registerPatn1Uncertain();
  if (!lpResolved || !patn1Resolved) return map;

  const next: PatternMap = new Map();
  const lpBranches = punnett('LP', sireLP[0], damLP[0]);
  const patn1Branches = punnett('PATN1', sirePatn1[0], damPatn1[0]);
  for (const { prob, patterns } of map.values()) {
    for (const lpBranch of lpBranches) {
      const lpDose = lpBranch.pair.filter((a) => a === 'Lp').length;
      if (lpDose === 0) {
        mergePattern(next, patterns, prob * lpBranch.prob);
        continue;
      }
      for (const patn1Branch of patn1Branches) {
        const patn1Present = patn1Branch.pair.includes('PATN1');
        const pattern: PatternCode = lpDose === 1 ? (patn1Present ? 'appaloosa_blanket' : 'appaloosa') : patn1Present ? 'appaloosa_leopard' : 'appaloosa_fewspot';
        mergePattern(next, [...patterns, pattern], prob * lpBranch.prob * patn1Branch.prob);
      }
    }
  }
  return next;
}

function untestedParentsFor(sirePairs: AllelePair[], damPairs: AllelePair[]): ('sire' | 'dam')[] {
  const out: ('sire' | 'dam')[] = [];
  if (!isResolved(sirePairs)) out.push('sire');
  if (!isResolved(damPairs)) out.push('dam');
  return out;
}

/** The default-dilution-plus-one-locus state used only for the unlockedColours hint below - never
 * for the real probability computation, which folds every locus in properly above. */
function applyDilutionHint(locusCode: 'CR' | 'D' | 'Z' | 'CH' | 'RN', pair: AllelePair): DilutionState {
  switch (locusCode) {
    case 'CR':
      return { ...INITIAL_DILUTION, dose: pair.filter((a) => a === 'Cr').length as 0 | 1 | 2 };
    case 'D':
      return { ...INITIAL_DILUTION, dun: pair.includes('D') };
    case 'CH':
      return { ...INITIAL_DILUTION, champagne: pair.includes('Ch') };
    case 'Z':
      return { ...INITIAL_DILUTION, silver: pair.includes('Z') };
    case 'RN':
      return { ...INITIAL_DILUTION, roan: pair.includes('Rn') };
  }
}

/** The pattern-hint equivalent of applyDilutionHint above - what ONE locus's candidate allele pair
 * would add to patterns[], holding every other pattern locus at absent. */
function applyPatternHint(locusCode: 'TO' | 'O' | 'SW1' | 'SB1' | 'LP' | 'PATN1', pair: AllelePair): PatternCode[] {
  switch (locusCode) {
    case 'TO':
      return pair.includes('TO') ? ['tobiano'] : [];
    case 'O':
      return pair.includes('O') ? ['frame'] : [];
    case 'SW1':
      return pair.includes('SW1') ? ['splash'] : [];
    case 'SB1': {
      const dose = pair.filter((a) => a === 'SB1').length;
      return dose === 1 ? ['sabino'] : dose === 2 ? ['sabino_max'] : [];
    }
    case 'LP':
      return pair.includes('Lp') ? ['appaloosa'] : [];
    case 'PATN1':
      return pair.includes('PATN1') ? ['appaloosa_blanket'] : [];
  }
}

/** §4.4's teaching hint, generalised to any of the thirteen loci: what NEW colour names a test on
 * this locus could reveal, holding every other locus at the plain/absent default - an approximation,
 * not an exhaustive joint distribution, exactly as this was documented before slice 0021. E and A
 * vary `base` directly; the five dilution loci vary a DilutionState (named with the real engine);
 * the six pattern loci vary a PatternCode[] appended as words to the plain/undiluted base name. */
function composeCandidateFor(locusCode: ColourLocus, base: BaseBranch, gameDaysPerYear: number): (pair: AllelePair) => string {
  if (locusCode === 'A') {
    return (pair) => composeDilutionName({ ePair: base.ePair, aPair: pair }, INITIAL_DILUTION, gameDaysPerYear);
  }
  if (DILUTION_LOCI.has(locusCode)) {
    return (pair) => composeDilutionName(base, applyDilutionHint(locusCode as 'CR' | 'D' | 'Z' | 'CH' | 'RN', pair), gameDaysPerYear);
  }
  const plainName = composeDilutionName(base, INITIAL_DILUTION, gameDaysPerYear);
  return (pair) => {
    const words = patternWords(applyPatternHint(locusCode as 'TO' | 'O' | 'SW1' | 'SB1' | 'LP' | 'PATN1', pair));
    return words ? `${plainName} ${words}` : plainName;
  };
}

function unlockedNamesFor(
  locusCode: string,
  sirePairs: AllelePair[],
  damPairs: AllelePair[],
  composeCandidate: (pair: AllelePair) => string,
  alreadyCertain: Set<string>
): string[] {
  const found = new Set<string>();
  for (const sPair of sirePairs) {
    for (const dPair of damPairs) {
      for (const sAllele of sPair) {
        for (const dAllele of dPair) {
          const pair = sortAllelePair(locusCode, sAllele, dAllele);
          const name = composeCandidate(pair);
          if (!alreadyCertain.has(name)) found.add(name);
        }
      }
    }
  }
  return [...found];
}

/** Registers a locus as uncertain exactly once and pushes its unlockedColours hint. `base` is a
 * single representative category (whichever of chestnut/bay/black carries the most probability) -
 * the hint is documented as an approximation already, and does not need to be exact for every base. */
function makeUncertainRegistrar(uncertain: UncertainColourLocus[], uncertainLoci: Set<string>, certainNamesSoFar: Set<string>) {
  return (locusCode: ColourLocus, sirePairs: AllelePair[], damPairs: AllelePair[], base: BaseBranch, gameDaysPerYear: number): void => {
    if (uncertainLoci.has(locusCode)) return;
    uncertainLoci.add(locusCode);
    uncertain.push({
      locusCode,
      unlockedColours: unlockedNamesFor(locusCode, sirePairs, damPairs, composeCandidateFor(locusCode, base, gameDaysPerYear), certainNamesSoFar),
      untestedParents: untestedParentsFor(sirePairs, damPairs),
    });
  };
}

// §6.2: outcomes below this probability merge into a single "other" bucket rather than padding the
// list with fractions a child can't act on; the eight most likely named outcomes are kept, the rest
// (below-floor or beyond the cap) fold into "other" too.
const PROBABILITY_FLOOR = 0.005;
const NAMED_OUTCOME_CAP = 8;

function applyFloorAndCap(raw: { colour: string; probability: number }[]): { colour: string; probability: number }[] {
  const sorted = [...raw].sort((a, b) => b.probability - a.probability);
  const kept = sorted.filter((c) => c.probability >= PROBABILITY_FLOOR).slice(0, NAMED_OUTCOME_CAP);
  const keptColours = new Set(kept.map((c) => c.colour));
  const otherProbability = sorted.filter((c) => !keptColours.has(c.colour)).reduce((sum, c) => sum + c.probability, 0);
  return otherProbability > 0 ? [...kept, { colour: 'other', probability: otherProbability }] : kept;
}

function pickRepresentativeBase(chestnutProb: number, bayProb: number, blackProb: number): BaseBranch {
  if (bayProb >= chestnutProb && bayProb >= blackProb) return BAY_BASE;
  if (blackProb >= chestnutProb) return BLACK_BASE;
  return CHESTNUT_BASE;
}

/**
 * §4.4's shape exactly, extended by slice 0021 Part D to all thirteen colour/pattern loci: certain =
 * the probability-weighted colours (now including pattern words, e.g. "bay tobiano") a pairing
 * produces where every locus that matters is known or defaults safely to absent; uncertain = the loci
 * where it isn't, each with what testing it could unlock. E gates the whole computation (chestnut is
 * epistatically blind to Agouti and, downstream, to silver - the textbook case inference.ts's own
 * comment describes), so an unresolved E means nothing about base colour can be asserted at all; A
 * only matters once a branch is confirmed not-chestnut. The five dilution loci (CR, D, Z, CH, RN) and
 * the six pattern loci (TO, O, SW1, SB1, LP, PATN1) are each folded independently per §6.2's CPU
 * budget - see this file's header comment for why splitting them this way is what keeps it fast.
 */
export function foalColourPossibilities(input: {
  sire: Record<string, AllelePair[]>;
  dam: Record<string, AllelePair[]>;
  gameDaysPerYear: number;
  /** Live config (config.values.pattern_penetrance) - defaulted so existing callers/tests that only
   * ever resolve E/A/CR (never O or SW1) don't need to plumb it through. */
  patternPenetrance?: PatternPenetrance;
}): FoalColourPossibilities {
  const { sire, dam, gameDaysPerYear } = input;
  const penetrance = input.patternPenetrance ?? DEFAULT_PATTERN_PENETRANCE;
  const get = (rec: Record<string, AllelePair[]>, code: string): AllelePair[] => rec[code] ?? [];

  const uncertain: UncertainColourLocus[] = [];
  const uncertainLoci = new Set<string>();
  // Filled in once the dilution x base names are known below. Every pattern-locus uncertain hint
  // only ever compares against the plain undiluted base name (composeCandidateFor's own doc comment)
  // so registering pattern uncertainty before this is populated is harmless - it's only used to avoid
  // listing a name in `unlockedColours` that's already certain.
  const certainNamesSoFar = new Set<string>();
  const registerUncertain = makeUncertainRegistrar(uncertain, uncertainLoci, certainNamesSoFar);

  const sireE = get(sire, 'E');
  const damE = get(dam, 'E');
  if (!isResolved(sireE) || !isResolved(damE)) {
    uncertain.push({
      locusCode: 'E',
      unlockedColours: unlockedNamesFor('E', sireE, damE, (pair) => composeDilutionName({ ePair: pair, aPair: null }, INITIAL_DILUTION, gameDaysPerYear), new Set()),
      untestedParents: untestedParentsFor(sireE, damE),
    });
    return { certain: [], uncertain };
  }

  // Base categories: chestnut / bay / black, each a single probability - E gates it, A only matters
  // once a branch is confirmed not-chestnut (unresolved A drops that branch's mass, per §4.4).
  let chestnutProb = 0;
  let bayProb = 0;
  let blackProb = 0;
  for (const eBranch of punnett('E', sireE[0], damE[0])) {
    const isChestnut = eBranch.pair[0] === 'e' && eBranch.pair[1] === 'e';
    if (isChestnut) {
      chestnutProb += eBranch.prob;
      continue;
    }
    const sireA = get(sire, 'A');
    const damA = get(dam, 'A');
    if (!isResolved(sireA) || !isResolved(damA)) {
      registerUncertain('A', sireA, damA, { ePair: eBranch.pair, aPair: null }, gameDaysPerYear);
      continue; // this branch's probability mass is left out of `certain` on purpose - see header
    }
    for (const aBranch of punnett('A', sireA[0], damA[0])) {
      const isBlack = aBranch.pair[0] === 'a' && aBranch.pair[1] === 'a';
      if (isBlack) blackProb += eBranch.prob * aBranch.prob;
      else bayProb += eBranch.prob * aBranch.prob;
    }
  }

  const representativeBase = pickRepresentativeBase(chestnutProb, bayProb, blackProb);

  // The dilution fold - independent of base, folded exactly once.
  let dilutionMap: DilutionMap = new Map([['init', { prob: 1, state: INITIAL_DILUTION }]]);
  dilutionMap = foldDilutionModifier(dilutionMap, 'CR', get(sire, 'CR'), get(dam, 'CR'), (s, pair) => ({ ...s, dose: pair.filter((a) => a === 'Cr').length as 0 | 1 | 2 }), () =>
    registerUncertain('CR', get(sire, 'CR'), get(dam, 'CR'), representativeBase, gameDaysPerYear)
  );
  dilutionMap = foldDilutionModifier(dilutionMap, 'D', get(sire, 'D'), get(dam, 'D'), (s, pair) => ({ ...s, dun: pair.includes('D') }), () =>
    registerUncertain('D', get(sire, 'D'), get(dam, 'D'), representativeBase, gameDaysPerYear)
  );
  dilutionMap = foldDilutionModifier(dilutionMap, 'CH', get(sire, 'CH'), get(dam, 'CH'), (s, pair) => ({ ...s, champagne: pair.includes('Ch') }), () =>
    registerUncertain('CH', get(sire, 'CH'), get(dam, 'CH'), representativeBase, gameDaysPerYear)
  );
  dilutionMap = foldDilutionModifier(dilutionMap, 'Z', get(sire, 'Z'), get(dam, 'Z'), (s, pair) => ({ ...s, silver: pair.includes('Z') }), () =>
    registerUncertain('Z', get(sire, 'Z'), get(dam, 'Z'), representativeBase, gameDaysPerYear)
  );
  dilutionMap = foldDilutionModifier(dilutionMap, 'RN', get(sire, 'RN'), get(dam, 'RN'), (s, pair) => ({ ...s, roan: pair.includes('Rn') }), () =>
    registerUncertain('RN', get(sire, 'RN'), get(dam, 'RN'), representativeBase, gameDaysPerYear)
  );

  // Cross the (<=3) base categories with the dilution fold's own distinct states - this is the only
  // place the real engine is called, and it happens at most a few dozen times.
  const colourNameTotals = new Map<string, number>();
  for (const [base, baseProb] of [
    [CHESTNUT_BASE, chestnutProb],
    [BAY_BASE, bayProb],
    [BLACK_BASE, blackProb],
  ] as [BaseBranch, number][]) {
    if (baseProb <= 0) continue;
    for (const { prob: dilProb, state } of dilutionMap.values()) {
      const name = composeDilutionName(base, state, gameDaysPerYear);
      colourNameTotals.set(name, (colourNameTotals.get(name) ?? 0) + baseProb * dilProb);
    }
  }
  for (const name of colourNameTotals.keys()) certainNamesSoFar.add(name);

  // The pattern fold - independent of base and dilution, folded exactly once, pure string/array
  // bookkeeping (this file's header explains why no engine call is needed here at all).
  let patternMap: PatternMap = new Map([['init', { prob: 1, patterns: [] }]]);
  patternMap = foldPatternFullPenetrance(patternMap, 'TO', get(sire, 'TO'), get(dam, 'TO'), (pair) => (pair.includes('TO') ? ['tobiano'] : []), () =>
    registerUncertain('TO', get(sire, 'TO'), get(dam, 'TO'), representativeBase, gameDaysPerYear)
  );
  patternMap = foldPatternPenetrant(patternMap, 'O', 'O', 'frame', get(sire, 'O'), get(dam, 'O'), penetrance.O, () =>
    registerUncertain('O', get(sire, 'O'), get(dam, 'O'), representativeBase, gameDaysPerYear)
  );
  patternMap = foldPatternPenetrant(patternMap, 'SW1', 'SW1', 'splash', get(sire, 'SW1'), get(dam, 'SW1'), penetrance.SW1, () =>
    registerUncertain('SW1', get(sire, 'SW1'), get(dam, 'SW1'), representativeBase, gameDaysPerYear)
  );
  patternMap = foldPatternFullPenetrance(
    patternMap,
    'SB1',
    get(sire, 'SB1'),
    get(dam, 'SB1'),
    (pair) => {
      const dose = pair.filter((a) => a === 'SB1').length;
      return dose === 1 ? ['sabino'] : dose === 2 ? ['sabino_max'] : [];
    },
    () => registerUncertain('SB1', get(sire, 'SB1'), get(dam, 'SB1'), representativeBase, gameDaysPerYear)
  );
  patternMap = foldAppaloosaPattern(
    patternMap,
    get(sire, 'LP'),
    get(dam, 'LP'),
    get(sire, 'PATN1'),
    get(dam, 'PATN1'),
    () => registerUncertain('LP', get(sire, 'LP'), get(dam, 'LP'), representativeBase, gameDaysPerYear),
    () => registerUncertain('PATN1', get(sire, 'PATN1'), get(dam, 'PATN1'), representativeBase, gameDaysPerYear)
  );

  // Cross colour names with patterns - cheap string concatenation, no engine calls.
  const finalTotals = new Map<string, number>();
  for (const [name, nameProb] of colourNameTotals) {
    for (const { prob: patProb, patterns } of patternMap.values()) {
      const words = patternWords(patterns);
      const finalName = words ? `${name} ${words}` : name;
      finalTotals.set(finalName, (finalTotals.get(finalName) ?? 0) + nameProb * patProb);
    }
  }

  const certain = applyFloorAndCap([...finalTotals.entries()].map(([colour, probability]) => ({ colour, probability })));
  return { certain, uncertain };
}
