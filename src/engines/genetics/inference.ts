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

// Slice 0021 Part D (§6.1): the ten colour/pattern loci added in Part B/C. D, Z (silver) and CH all
// follow the same "visible -> dominant present, zygosity unknown; not visible -> homozygous wild
// type" shape as dun/champagne/roan below, fully penetrant (§5.3) - so, like E/A/CR above, they are
// simply masked to the fully-open set when grey has taken the base colour past reading.
const D_ALL: AllelePair[] = [sortAllelePair('D', 'D', 'D'), sortAllelePair('D', 'D', 'nd'), sortAllelePair('D', 'nd', 'nd')];
const D_HAS_DOMINANT: AllelePair[] = [sortAllelePair('D', 'D', 'D'), sortAllelePair('D', 'D', 'nd')];
const D_CLEAR: AllelePair[] = [sortAllelePair('D', 'nd', 'nd')];

const CH_ALL: AllelePair[] = [sortAllelePair('CH', 'Ch', 'Ch'), sortAllelePair('CH', 'Ch', 'ch'), sortAllelePair('CH', 'ch', 'ch')];
const CH_HAS_DOMINANT: AllelePair[] = [sortAllelePair('CH', 'Ch', 'Ch'), sortAllelePair('CH', 'Ch', 'ch')];
const CH_CLEAR: AllelePair[] = [sortAllelePair('CH', 'ch', 'ch')];

// Silver only touches black pigment (§6.1) - fully open on any chestnut regardless of zygosity, the
// same epistasis blindness E_ALL's own chestnut branch already models for Agouti.
const Z_ALL: AllelePair[] = [sortAllelePair('Z', 'Z', 'Z'), sortAllelePair('Z', 'Z', 'z'), sortAllelePair('Z', 'z', 'z')];
const Z_HAS_DOMINANT: AllelePair[] = [sortAllelePair('Z', 'Z', 'Z'), sortAllelePair('Z', 'Z', 'z')];
const Z_CLEAR: AllelePair[] = [sortAllelePair('Z', 'z', 'z')];

const RN_ALL: AllelePair[] = [sortAllelePair('RN', 'Rn', 'Rn'), sortAllelePair('RN', 'Rn', 'rn'), sortAllelePair('RN', 'rn', 'rn')];
const RN_HAS_DOMINANT: AllelePair[] = [sortAllelePair('RN', 'Rn', 'Rn'), sortAllelePair('RN', 'Rn', 'rn')];
const RN_CLEAR: AllelePair[] = [sortAllelePair('RN', 'rn', 'rn')];

// Tobiano is read straight from phenotype.patterns (fully penetrant, never masked by grey - patterns
// are computed independently of greyStage in expression.ts) - no "ALL" variant needed, looking always
// resolves presence, only zygosity stays open.
const TO_HAS_DOMINANT: AllelePair[] = [sortAllelePair('TO', 'TO', 'TO'), sortAllelePair('TO', 'TO', 'n')];
const TO_CLEAR: AllelePair[] = [sortAllelePair('TO', 'n', 'n')];

// Frame overo: O/O never draws breath (slice 0021 §1/§7), so a horse alive to be looked at that
// visibly shows frame is O/n with certainty - the one locus where "visible" collapses to a single
// pair rather than "present, zygosity unknown". Not visible stays open because of §5.5's cryptic
// carriers: a solid horse could be n/n, or an O/n that simply didn't roll penetrant.
const O_CERTAIN_CARRIER: AllelePair[] = [sortAllelePair('O', 'O', 'n')];
const O_OPEN: AllelePair[] = [sortAllelePair('O', 'O', 'n'), sortAllelePair('O', 'n', 'n')];

// Splashed white has no lethal double-copy, so - unlike frame - a visibly splashed horse could be
// SW1/SW1 or SW1/n (zygosity genuinely unknown). §5.5's penetrance still applies, so "not visible"
// stays open too, exactly the same shape as frame's cryptic-carrier case.
const SW1_HAS_DOMINANT: AllelePair[] = [sortAllelePair('SW1', 'SW1', 'SW1'), sortAllelePair('SW1', 'SW1', 'n')];
const SW1_OPEN: AllelePair[] = [sortAllelePair('SW1', 'SW1', 'n'), sortAllelePair('SW1', 'n', 'n')];

// Sabino1's three doses are each visibly distinct (§6.1) - looking always resolves to a single pair,
// making a genotype test on this locus worthless, exactly as inference.ts's own header comment says
// a one-element array means.
const SB1_CLEAR: AllelePair[] = [sortAllelePair('SB1', 'n', 'n')];
const SB1_SINGLE: AllelePair[] = [sortAllelePair('SB1', 'SB1', 'n')];
const SB1_DOUBLE: AllelePair[] = [sortAllelePair('SB1', 'SB1', 'SB1')];

// Leopard complex: no spotting visible at all means lp/lp with certainty, regardless of PATN1 (PATN1
// has no effect without at least one Lp). Spotting visible means Lp present but Lp/Lp vs Lp/lp is not
// reliably distinguishable by eye (§6.1) - zygosity open. PATN1 itself is only ever readable when
// spotting is visible in the first place: no spotting leaves PATN1 fully open (it could be anything,
// unexpressed), a blanket/leopard pattern proves PATN1 present (zygosity unknown), and plain
// appaloosa/few-spot proves PATN1 absent.
const LP_HAS_LP: AllelePair[] = [sortAllelePair('LP', 'Lp', 'Lp'), sortAllelePair('LP', 'Lp', 'lp')];
const LP_CLEAR: AllelePair[] = [sortAllelePair('LP', 'lp', 'lp')];
const PATN1_ALL: AllelePair[] = [sortAllelePair('PATN1', 'PATN1', 'PATN1'), sortAllelePair('PATN1', 'PATN1', 'n'), sortAllelePair('PATN1', 'n', 'n')];
const PATN1_HAS_DOMINANT: AllelePair[] = [sortAllelePair('PATN1', 'PATN1', 'PATN1'), sortAllelePair('PATN1', 'PATN1', 'n')];
const PATN1_CLEAR: AllelePair[] = [sortAllelePair('PATN1', 'n', 'n')];

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

  // Slice 0021 Part D (§6.1): D, CH, Z and RN are all masked to fully-open by the same grey stage
  // that masks E/A/CR above - grey takes the whole base+dilution picture with it, not just the base.
  const d = baseHidden ? D_ALL : phenotype.dunPresent ? D_HAS_DOMINANT : D_CLEAR;
  const ch = baseHidden ? CH_ALL : phenotype.champagnePresent ? CH_HAS_DOMINANT : CH_CLEAR;
  const z = baseHidden || phenotype.baseColour === 'chestnut' ? Z_ALL : phenotype.silverPresent ? Z_HAS_DOMINANT : Z_CLEAR;
  const rn = baseHidden ? RN_ALL : phenotype.roanPresent ? RN_HAS_DOMINANT : RN_CLEAR;

  // Patterns are read straight off phenotype.patterns, never masked by baseHidden - expression.ts
  // computes them independently of greyStage (this file's own header explains why for the five
  // existing loci; patterns work the same way, and real pinto/appaloosa markings are not erased by
  // greying the way a solid base colour is).
  const to = phenotype.patterns.includes('tobiano') ? TO_HAS_DOMINANT : TO_CLEAR;
  const o = phenotype.patterns.includes('frame') ? O_CERTAIN_CARRIER : O_OPEN;
  const sw1 = phenotype.patterns.includes('splash') ? SW1_HAS_DOMINANT : SW1_OPEN;

  const sb1 = phenotype.patterns.includes('sabino_max') ? SB1_DOUBLE : phenotype.patterns.includes('sabino') ? SB1_SINGLE : SB1_CLEAR;

  const hasSpotting = phenotype.patterns.some((p) => p.startsWith('appaloosa'));
  const hasBlanketOrLeopard = phenotype.patterns.includes('appaloosa_blanket') || phenotype.patterns.includes('appaloosa_leopard');
  const lp = hasSpotting ? LP_HAS_LP : LP_CLEAR;
  const patn1 = !hasSpotting ? PATN1_ALL : hasBlanketOrLeopard ? PATN1_HAS_DOMINANT : PATN1_CLEAR;

  return { E: e, A: a, CR: cr, G: g, DMRT3: dmrt3, D: d, CH: ch, Z: z, RN: rn, TO: to, O: o, SW1: sw1, SB1: sb1, LP: lp, PATN1: patn1 };
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
