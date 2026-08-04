// Genotype + age -> a structured phenotype. Slice 0002 §5.3, extended by slice 0021 §5 for the ten
// colour/pattern loci. This is the biology; get it exactly right, in the order below, because later
// rules depend on earlier ones running first:
//   1. Base (E, then A) - epistasis: ee ignores Agouti entirely.
//   2. Cream dose (0/1/2).
//   3. Dun - acts on base+cream.
//   4. Champagne - acts on base+cream+dun.
//   5. Silver - only if the horse can make black pigment at all (not ee). Same epistasis rule as
//      Agouti, same lesson as smoky black: a chestnut can carry two copies of silver and look like
//      any other chestnut.
//   6. Roan - a prefix on whatever came out of 1-5.
//   7. Grey - masks everything with age, applied last.
//   8. Patterns (tobiano/frame/splash/sabino/appaloosa) - computed independently into patterns[],
//      never folded into the colour string (slice 0021 §5.1: that combinatorial explosion lands
//      directly in market_visible_colour_factors, a flat colour -> number map).

import { getMendelianPair, type Genotype } from './genotype';
import { makeRng } from '../../lib/rng';

export type BaseColour = 'bay' | 'black' | 'chestnut';
export type Dilution = 'none' | 'cream_single' | 'cream_double';
export type GreyStage = 'none' | 'foal_grey' | 'greying' | 'light_grey' | 'white_grey';

/** Slice 0021 §5.4/§5.5. `frame` and `splash` are the two loci with a penetrance (below); the rest
 * are fully penetrant. Order here is push order in patternsOf, which follows LOCI order (TO, O,
 * SW1, SB1, LP+PATN1) - the same load-bearing discipline loci.ts's own comment describes. */
export type PatternCode =
  | 'tobiano'
  | 'frame'
  | 'splash'
  | 'sabino'
  | 'sabino_max'
  | 'appaloosa'
  | 'appaloosa_blanket'
  | 'appaloosa_leopard'
  | 'appaloosa_fewspot';

/** Locus code -> probability a present allele actually shows (slice 0021 §5.5). Only O and SW1 have
 * a real chance of staying cryptic; everything else in LOCI is fully penetrant. */
export interface PatternPenetrance {
  O: number;
  SW1: number;
}

export const DEFAULT_PATTERN_PENETRANCE: PatternPenetrance = { O: 0.85, SW1: 0.9 };

export interface Phenotype {
  baseColour: BaseColour;
  /** Cream dose only - dun/champagne/silver live in dilutedColour's string, not here. */
  dilution: Dilution;
  /** Base + cream + dun + champagne + silver, composed by name (composeDilutedColour below). */
  dilutedColour: string;
  greyStage: GreyStage;
  /** dilutedColour, roan-prefixed if present, then grey-masked if the horse has started greying. */
  visibleColour: string;
  bornColour: string;
  gaited: boolean;
  /** Ordered, e.g. ['tobiano', 'sabino']. Never folded into visibleColour - see this file's own
   * top comment and slice 0021 §5.1. */
  patterns: PatternCode[];
  /** Slice 0021 Part D (§6.1): the raw presence flags behind dilutedColour/visibleColour's composed
   * name - unconditional truth, exactly like baseColour above, not masked by grey. inference.ts
   * needs these directly because the named-combination table (grullo, silver bay, ...) makes the
   * individual modifier unrecoverable by parsing the string back apart. */
  dunPresent: boolean;
  champagnePresent: boolean;
  silverPresent: boolean;
  roanPresent: boolean;
}

// Grey stage thresholds, in game years - not config (CLAUDE.md §5.5: they only affect display and
// are read fresh every time; a session that wants them tunable can move them to config in ten
// minutes). Converted to game days by the caller-supplied game_days_per_year.
export const GREY_FOAL_UNTIL_YEARS = 1;
export const GREY_GREYING_UNTIL_YEARS = 4;
export const GREY_LIGHT_UNTIL_YEARS = 8;

const CREAM_TABLE: Record<BaseColour, { single: string; double: string }> = {
  chestnut: { single: 'palomino', double: 'cremello' },
  bay: { single: 'buckskin', double: 'perlino' },
  // smoky black looks almost identical to plain black - flagged so it isn't mistaken for a bug
  // when a black-based, single-cream horse doesn't visibly change much.
  black: { single: 'smoky black', double: 'smoky cream' },
};

function baseColourOf(genotype: Genotype): BaseColour {
  const [e1, e2] = getMendelianPair(genotype, 'E');
  // Extension: ee -> red base, and Agouti is not consulted at all. This is the epistasis case: a
  // chestnut horse can carry any Agouti genotype and look identical.
  if (e1 === 'e' && e2 === 'e') return 'chestnut';

  const [a1, a2] = getMendelianPair(genotype, 'A');
  return a1 === 'a' && a2 === 'a' ? 'black' : 'bay';
}

function creamDoseOf(genotype: Genotype): 0 | 1 | 2 {
  const pair = getMendelianPair(genotype, 'CR');
  const doses = pair.filter((allele) => allele === 'Cr').length;
  return doses as 0 | 1 | 2;
}

function dilutionFor(dose: 0 | 1 | 2): Dilution {
  return dose === 0 ? 'none' : dose === 1 ? 'cream_single' : 'cream_double';
}

// Slice 0021 §5.3: the named combinations that have a real name, keyed on
// "base|creamDose|dun|champagne|silver". Chestnut never appears with silver=1 - the epistasis check
// in expressPhenotype below means that combination can never occur, not merely that it's unnamed.
const NAMED_COLOURS: Record<string, string> = {
  'chestnut|1|0|0|0': 'palomino',
  'chestnut|2|0|0|0': 'cremello',
  'bay|1|0|0|0': 'buckskin',
  'bay|2|0|0|0': 'perlino',
  // smoky black/cream look almost identical to plain black/cremello - flagged so it isn't mistaken
  // for a bug when a black-based, cream-dosed horse doesn't visibly change much.
  'black|1|0|0|0': 'smoky black',
  'black|2|0|0|0': 'smoky cream',
  'bay|0|1|0|0': 'bay dun',
  'black|0|1|0|0': 'grullo',
  'chestnut|0|1|0|0': 'red dun',
  'bay|0|0|1|0': 'amber champagne',
  'black|0|0|1|0': 'classic champagne',
  'chestnut|0|0|1|0': 'gold champagne',
  'black|0|0|0|1': 'silver black',
  'bay|0|0|0|1': 'silver bay',
  'chestnut|1|1|0|0': 'dunalino',
  'bay|1|1|0|0': 'dunskin',
};

/** Base + cream + dun + champagne + silver, composed by name. The named table above is an override
 * on top of a fixed adjective order (silver, champagne, dun, then the cream/base name) - a future
 * locus added to this stack is one more adjective in the list, not 72 new rows (slice 0021 §5.3). */
function composeDilutedColour(baseColour: BaseColour, dose: 0 | 1 | 2, dun: boolean, champagne: boolean, silver: boolean): string {
  const key = `${baseColour}|${String(dose)}|${dun ? 1 : 0}|${champagne ? 1 : 0}|${silver ? 1 : 0}`;
  const named = NAMED_COLOURS[key];
  if (named) return named;

  const row = CREAM_TABLE[baseColour];
  const creamBaseName = dose === 0 ? baseColour : dose === 1 ? row.single : row.double;
  const adjectives = [silver && 'silver', champagne && 'champagne', dun && 'dun'].filter((a): a is string => Boolean(a));
  return adjectives.length === 0 ? creamBaseName : `${adjectives.join(' ')} ${creamBaseName}`;
}

// Slice 0021 §5.3: roan prefixes whatever came before it, with three traditional names overriding
// the generic "<colour> roan" - only when the horse is otherwise a plain, undiluted base colour.
const ROAN_OVERRIDE: Record<BaseColour, string> = { black: 'blue roan', chestnut: 'red roan', bay: 'bay roan' };

function applyRoan(dilutedColour: string, baseColour: BaseColour, roan: boolean): string {
  if (!roan) return dilutedColour;
  return dilutedColour === baseColour ? ROAN_OVERRIDE[baseColour] : `${dilutedColour} roan`;
}

function greyStageOf(genotype: Genotype, ageGameDays: number, gameDaysPerYear: number): GreyStage {
  const pair = getMendelianPair(genotype, 'G');
  const isGrey = pair.includes('G');
  if (!isGrey) return 'none';

  const ageYears = ageGameDays / gameDaysPerYear;
  if (ageYears < GREY_FOAL_UNTIL_YEARS) return 'foal_grey';
  if (ageYears < GREY_GREYING_UNTIL_YEARS) return 'greying';
  if (ageYears < GREY_LIGHT_UNTIL_YEARS) return 'light_grey';
  return 'white_grey';
}

// preGreyColour is dilutedColour with roan already prefixed (step 6) - grey (step 7) masks that
// whole result with age, exactly as it masked plain dilutedColour before this slice.
function visibleColourFor(greyStage: GreyStage, preGreyColour: string): string {
  switch (greyStage) {
    case 'none':
    // A grey foal still looks like its base colour, just with grey hairs starting to show
    // around the eyes - see describe.ts for the sentence that says so.
    case 'foal_grey':
      return preGreyColour;
    case 'greying':
      return 'greying';
    case 'light_grey':
      return 'light grey';
    case 'white_grey':
      return 'white grey';
  }
}

function gaitedOf(genotype: Genotype): boolean {
  const pair = getMendelianPair(genotype, 'DMRT3');
  // Heterozygotes (C/A) are treated as not gaited. This is a simplification of a real trait whose
  // heterozygous effect is partial and breed-dependent (slice 0002 §5.3) - a later slice may want
  // a third state.
  return pair[0] === 'A' && pair[1] === 'A';
}

/** Step 8: patterns computed independently of the colour string, one draw per penetrant locus (O,
 * then SW1, in that LOCI order) from a single Rng seeded off patternSeed - so the same seed always
 * produces the same patterns[], deterministically (slice 0021 §5.5's whole point). Tobiano, Sabino1
 * and the LP/PATN1 pair are read straight off the genotype with no roll: they are fully penetrant. */
function patternsOf(genotype: Genotype, patternSeed: number, penetrance: PatternPenetrance): PatternCode[] {
  const rng = makeRng(patternSeed);
  const patterns: PatternCode[] = [];

  if (getMendelianPair(genotype, 'TO').includes('TO')) patterns.push('tobiano');

  const framePresent = getMendelianPair(genotype, 'O').includes('O');
  const frameRoll = rng.next();
  if (framePresent && frameRoll < penetrance.O) patterns.push('frame');

  const splashPresent = getMendelianPair(genotype, 'SW1').includes('SW1');
  const splashRoll = rng.next();
  if (splashPresent && splashRoll < penetrance.SW1) patterns.push('splash');

  const sabinoDose = getMendelianPair(genotype, 'SB1').filter((a) => a === 'SB1').length;
  if (sabinoDose === 1) patterns.push('sabino');
  else if (sabinoDose === 2) patterns.push('sabino_max');

  // Appaloosa (§5.4): LP alone is varnish-roan/few-spot; PATN1 alongside it turns that into the
  // more heavily patterned blanket/leopard forms.
  const lpDose = getMendelianPair(genotype, 'LP').filter((a) => a === 'Lp').length;
  const patn1Present = getMendelianPair(genotype, 'PATN1').includes('PATN1');
  if (lpDose === 1) patterns.push(patn1Present ? 'appaloosa_blanket' : 'appaloosa');
  else if (lpDose === 2) patterns.push(patn1Present ? 'appaloosa_leopard' : 'appaloosa_fewspot');

  return patterns;
}

/**
 * patternSeed is supplied by the caller, the same shape as ageGameDays/gameDaysPerYear - typically
 * deriveSeed(horse.rng_seed, 'pattern_expression') (slice 0021 §5.5). penetrance is a live config
 * value (config.values.pattern_penetrance); defaulted here only so a caller that doesn't care yet
 * (a synthetic/hypothetical genotype with no O or SW1 allele set) doesn't have to plumb it through.
 */
export function expressPhenotype(
  genotype: Genotype,
  ageGameDays: number,
  gameDaysPerYear: number,
  patternSeed: number,
  penetrance: PatternPenetrance = DEFAULT_PATTERN_PENETRANCE
): Phenotype {
  const baseColour = baseColourOf(genotype);
  const dose = creamDoseOf(genotype);
  const dilution = dilutionFor(dose);

  const dunPresent = getMendelianPair(genotype, 'D').includes('D');
  const champagnePresent = getMendelianPair(genotype, 'CH').includes('Ch');
  // Silver epistasis (step 5): a chestnut horse makes no black pigment for silver to act on - the
  // same rule as Agouti above, and the same lesson as smoky black.
  const silverPresent = baseColour !== 'chestnut' && getMendelianPair(genotype, 'Z').includes('Z');
  const roanPresent = getMendelianPair(genotype, 'RN').includes('Rn');

  const dilutedColour = composeDilutedColour(baseColour, dose, dunPresent, champagnePresent, silverPresent);
  const bornColour = dilutedColour;

  const preGreyColour = applyRoan(dilutedColour, baseColour, roanPresent);
  const greyStage = greyStageOf(genotype, ageGameDays, gameDaysPerYear);
  const visibleColour = visibleColourFor(greyStage, preGreyColour);

  const gaited = gaitedOf(genotype);
  const patterns = patternsOf(genotype, patternSeed, penetrance);

  return {
    baseColour,
    dilution,
    dilutedColour,
    greyStage,
    visibleColour,
    bornColour,
    gaited,
    patterns,
    dunPresent,
    champagnePresent,
    silverPresent,
    roanPresent,
  };
}
