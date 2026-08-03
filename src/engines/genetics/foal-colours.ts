// Amendment 0017a §4.4: every colour a pairing could produce, computed only from what is KNOWN
// about each parent (a narrowed possibility set from inference.ts, or a single pair once a locus is
// tested) - never from horses.genotype. Pure, no database access (CLAUDE.md §5.1), no randomness:
// this is a probability model over Mendelian segregation, not a dice roll, so it runs the same way
// every time it's asked.
//
// It reuses expressPhenotype (the real colour engine) rather than re-deriving base/dilution rules a
// second time - the same "no second colour model" reasoning slice 0017 §4.1 gives for reusing
// scoreEntry. A foal's colour at birth is read at age 0, which lands every grey genotype in
// 'foal_grey' (visibly its base colour, per expression.ts) - grey and gait are not "colours" this
// function predicts; they are the horse's own page's job (§4.5 point 2), via inferFromPhenotype.

import { expressPhenotype, type Phenotype } from './expression';
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

type ColourLocus = 'E' | 'A' | 'CR';

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

function colourFor(pairs: Partial<Record<ColourLocus, AllelePair>>, gameDaysPerYear: number): string {
  const mendelian: Record<string, AllelePair> = {};
  if (pairs.E) mendelian.E = pairs.E;
  if (pairs.A) mendelian.A = pairs.A;
  if (pairs.CR) mendelian.CR = pairs.CR;
  const genotype: Genotype = { v: 1, mendelian, polygenic: {} };
  const phenotype: Phenotype = expressPhenotype(genotype, 0, gameDaysPerYear);
  return phenotype.visibleColour;
}

interface CertainAccumulator {
  totals: Map<string, number>;
}

function addCertain(acc: CertainAccumulator, colour: string, prob: number): void {
  if (prob <= 0) return;
  acc.totals.set(colour, (acc.totals.get(colour) ?? 0) + prob);
}

function untestedParentsFor(sirePairs: AllelePair[], damPairs: AllelePair[]): ('sire' | 'dam')[] {
  const out: ('sire' | 'dam')[] = [];
  if (!isResolved(sirePairs)) out.push('sire');
  if (!isResolved(damPairs)) out.push('dam');
  return out;
}

/** What colours a test on this locus could newly reveal, holding everything else at the resolved
 * base (or, when another locus is also unresolved, at its first listed possibility) - an
 * approximation, not an exhaustive joint distribution, offered as the teaching hint (§4.4's second
 * paragraph), not as a probability. */
function unlockedColoursFor(
  locus: ColourLocus,
  sirePairs: AllelePair[],
  damPairs: AllelePair[],
  otherBase: Partial<Record<ColourLocus, AllelePair>>,
  gameDaysPerYear: number,
  alreadyCertain: Set<string>
): string[] {
  const found = new Set<string>();
  for (const sPair of sirePairs) {
    for (const dPair of damPairs) {
      for (const sAllele of sPair) {
        for (const dAllele of dPair) {
          const pair = sortAllelePair(locus, sAllele, dAllele);
          const colour = colourFor({ ...otherBase, [locus]: pair }, gameDaysPerYear);
          if (!alreadyCertain.has(colour)) found.add(colour);
        }
      }
    }
  }
  return [...found];
}

/**
 * §4.4's shape exactly: certain = the probability-weighted colours a pairing produces where every
 * locus that matters is known; uncertain = the loci where it isn't, each with what testing it could
 * unlock. E gates the whole computation (chestnut is epistatically blind to Agouti - the textbook
 * case inference.ts's own comment describes), so an unresolved E means nothing about base colour can
 * be asserted at all; A only matters once a branch is confirmed not-chestnut; CR only ever adds a
 * dilution on top of whatever base is already decided.
 */
export function foalColourPossibilities(input: {
  sire: Record<string, AllelePair[]>;
  dam: Record<string, AllelePair[]>;
  gameDaysPerYear: number;
}): FoalColourPossibilities {
  const { sire, dam, gameDaysPerYear } = input;
  const sireE = sire.E ?? [];
  const damE = dam.E ?? [];
  const sireA = sire.A ?? [];
  const damA = dam.A ?? [];
  const sireCr = sire.CR ?? [];
  const damCr = dam.CR ?? [];

  const acc: CertainAccumulator = { totals: new Map() };
  const uncertain: UncertainColourLocus[] = [];
  const uncertainLoci = new Set<ColourLocus>();

  function applyCr(base: Partial<Record<ColourLocus, AllelePair>>, prob: number): void {
    if (isResolved(sireCr) && isResolved(damCr)) {
      for (const branch of punnett('CR', sireCr[0], damCr[0])) {
        addCertain(acc, colourFor({ ...base, CR: branch.pair }, gameDaysPerYear), prob * branch.prob);
      }
      return;
    }
    // CR unresolved: the certain figure assumes no dilution (the base colour itself), and the
    // uncertain note is what tells the player dilution is still an open question - never silently
    // asserting a diluted colour nor silently asserting the base is definitely undiluted.
    addCertain(acc, colourFor(base, gameDaysPerYear), prob);
    if (!uncertainLoci.has('CR')) {
      uncertainLoci.add('CR');
      const alreadyCertain = new Set(acc.totals.keys());
      uncertain.push({
        locusCode: 'CR',
        unlockedColours: unlockedColoursFor('CR', sireCr, damCr, base, gameDaysPerYear, alreadyCertain),
        untestedParents: untestedParentsFor(sireCr, damCr),
      });
    }
  }

  if (!isResolved(sireE) || !isResolved(damE)) {
    uncertain.push({
      locusCode: 'E',
      unlockedColours: unlockedColoursFor('E', sireE, damE, {}, gameDaysPerYear, new Set()),
      untestedParents: untestedParentsFor(sireE, damE),
    });
    return { certain: [], uncertain };
  }

  for (const eBranch of punnett('E', sireE[0], damE[0])) {
    const isChestnut = eBranch.pair[0] === 'e' && eBranch.pair[1] === 'e';
    if (isChestnut) {
      applyCr({ E: eBranch.pair }, eBranch.prob);
      continue;
    }
    if (!isResolved(sireA) || !isResolved(damA)) {
      if (!uncertainLoci.has('A')) {
        uncertainLoci.add('A');
        uncertain.push({
          locusCode: 'A',
          unlockedColours: unlockedColoursFor('A', sireA, damA, { E: eBranch.pair }, gameDaysPerYear, new Set(acc.totals.keys())),
          untestedParents: untestedParentsFor(sireA, damA),
        });
      }
      continue; // this branch's probability mass is left out of `certain` on purpose - see header
    }
    for (const aBranch of punnett('A', sireA[0], damA[0])) {
      applyCr({ E: eBranch.pair, A: aBranch.pair }, eBranch.prob * aBranch.prob);
    }
  }

  const certain = [...acc.totals.entries()].map(([colour, probability]) => ({ colour, probability }));
  return { certain, uncertain };
}
