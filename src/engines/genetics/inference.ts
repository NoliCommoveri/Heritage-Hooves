// Amendment 0017a §4.2: what a horse's visible phenotype constrains its genotype to, before anyone
// has paid for a colour test. Pure, no database access (CLAUDE.md §5.1) - this is the genetics
// lesson the colour test sells, so it has to be exactly right about what looking tells you and what
// it doesn't.
//
// This takes the horse's real, computed Phenotype (expression.ts already has the truth) and works
// backwards to the set of allele pairs still consistent with what a viewer could actually read off
// the horse - never returning the truth itself, only the possibility set. A tested locus (see
// src/db/health.ts's `locus:`-prefixed horse_knowledge rows) narrows a set to one pair; this
// function is what the set looks like before that test is bought.

import type { Phenotype } from './expression';
import { sortAllelePair, type AllelePair } from './genotype';

const E_HAS_DOMINANT: AllelePair[] = [sortAllelePair('E', 'E', 'E'), sortAllelePair('E', 'E', 'e')];
const E_ALL: AllelePair[] = [...E_HAS_DOMINANT, sortAllelePair('E', 'e', 'e')];
const A_ALL: AllelePair[] = [sortAllelePair('A', 'A', 'A'), sortAllelePair('A', 'A', 'a'), sortAllelePair('A', 'a', 'a')];
const A_HAS_DOMINANT: AllelePair[] = [sortAllelePair('A', 'A', 'A'), sortAllelePair('A', 'A', 'a')];
const A_AA: AllelePair[] = [sortAllelePair('A', 'a', 'a')];
const CR_ALL: AllelePair[] = [sortAllelePair('CR', 'Cr', 'Cr'), sortAllelePair('CR', 'Cr', 'cr'), sortAllelePair('CR', 'cr', 'cr')];
const CR_CLEAR: AllelePair[] = [sortAllelePair('CR', 'cr', 'cr')];
const CR_SINGLE: AllelePair[] = [sortAllelePair('CR', 'Cr', 'cr')];
const CR_DOUBLE: AllelePair[] = [sortAllelePair('CR', 'Cr', 'Cr')];
// "Looks black": plain black and smoky black are visually indistinguishable (§4.3) - one copy of
// cream on a black base does not read as diluted to the eye, so looking at a black-appearing horse
// leaves CR ambiguous between clear and single-dose.
const CR_LOOKS_BLACK: AllelePair[] = [CR_SINGLE[0], CR_CLEAR[0]];
const G_GREY: AllelePair[] = [sortAllelePair('G', 'G', 'G'), sortAllelePair('G', 'G', 'g')];
const G_NOT_GREY: AllelePair[] = [sortAllelePair('G', 'g', 'g')];
const DMRT3_GAITED: AllelePair[] = [sortAllelePair('DMRT3', 'A', 'A')];
const DMRT3_NOT_GAITED: AllelePair[] = [sortAllelePair('DMRT3', 'C', 'C'), sortAllelePair('DMRT3', 'C', 'A')];

/**
 * What the visible horse constrains its genotype to, before anyone has paid for anything. Takes a
 * Phenotype, returns the set of allele pairs still possible at each locus - a single-element array
 * means looking alone already settles it (a genotype test on that locus is worthless); more than one
 * means there is a real question a test can answer.
 *
 * A grey horse beyond the foal-grey stage has its base colour masked (expression.ts's own
 * visibleColourFor returns "greying"/"light grey"/"white grey", not the base) - E, A and CR all come
 * back fully open in that case. A foal-grey horse still visibly shows its birth colour (the same
 * function returns bornColour for that stage), so it is read exactly like a non-grey horse of the
 * same age at those three loci; only G's own zygosity is ever unreadable by eye, at any stage,
 * because both G/G and G/g grey out.
 */
export function inferFromPhenotype(phenotype: Phenotype): Record<string, AllelePair[]> {
  const baseHidden = phenotype.greyStage !== 'none' && phenotype.greyStage !== 'foal_grey';

  const e = baseHidden ? E_ALL : phenotype.baseColour === 'chestnut' ? [sortAllelePair('E', 'e', 'e')] : E_HAS_DOMINANT;

  const a = baseHidden
    ? A_ALL
    : phenotype.baseColour === 'chestnut'
      ? A_ALL // the epistasis case (§4.2's table): a chestnut horse carries any Agouti genotype and looks identical
      : phenotype.baseColour === 'black'
        ? A_AA
        : A_HAS_DOMINANT;

  const cr = baseHidden
    ? CR_ALL
    : phenotype.baseColour === 'black'
      ? phenotype.dilution === 'cream_double'
        ? CR_DOUBLE // smoky cream is visibly distinct from plain/smoky black
        : CR_LOOKS_BLACK
      : phenotype.dilution === 'none'
        ? CR_CLEAR
        : phenotype.dilution === 'cream_single'
          ? CR_SINGLE
          : CR_DOUBLE;

  const g = phenotype.greyStage !== 'none' ? G_GREY : G_NOT_GREY;
  const dmrt3 = phenotype.gaited ? DMRT3_GAITED : DMRT3_NOT_GAITED;

  return { E: e, A: a, CR: cr, G: g, DMRT3: dmrt3 };
}

/**
 * Amendment 0017a §4.7: how many of the given tested locus codes were genuinely hidden by looking -
 * inferFromPhenotype's own (untested) possibility set had more than one member for that locus. This
 * is the single implementation of "was this locus visible for free or not"; appraise()'s
 * carried-allele premium prices exactly this count, and never a second, looser guess at it. A
 * palomino's cream dose is visible on its chestnut base (CR's own set is already a singleton), so a
 * cream test on a palomino contributes 0 here - the premium belongs to the horse whose test result
 * looking could not have told you.
 */
export function hiddenColourAlleleCount(phenotype: Phenotype, testedLocusCodes: string[]): number {
  const inferred = inferFromPhenotype(phenotype);
  return testedLocusCodes.filter((code) => (inferred[code]?.length ?? 1) > 1).length;
}
