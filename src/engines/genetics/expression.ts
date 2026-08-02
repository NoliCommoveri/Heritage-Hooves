// Genotype + age -> a structured phenotype. Slice 0002 §5.3. This is the biology; get it exactly
// right, in the order below, because later rules depend on earlier ones running first.

import { getMendelianPair, type Genotype } from './genotype';

export type BaseColour = 'bay' | 'black' | 'chestnut';
export type Dilution = 'none' | 'cream_single' | 'cream_double';
export type GreyStage = 'none' | 'foal_grey' | 'greying' | 'light_grey' | 'white_grey';

export interface Phenotype {
  baseColour: BaseColour;
  dilution: Dilution;
  dilutedColour: string;
  greyStage: GreyStage;
  visibleColour: string;
  bornColour: string;
  gaited: boolean;
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

function dilutedColourOf(baseColour: BaseColour, dose: 0 | 1 | 2): { dilution: Dilution; dilutedColour: string } {
  if (dose === 0) return { dilution: 'none', dilutedColour: baseColour };
  const row = CREAM_TABLE[baseColour];
  return dose === 1 ? { dilution: 'cream_single', dilutedColour: row.single } : { dilution: 'cream_double', dilutedColour: row.double };
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

function visibleColourFor(greyStage: GreyStage, bornColour: string): string {
  switch (greyStage) {
    case 'none':
    // A grey foal still looks like its base colour, just with grey hairs starting to show
    // around the eyes - see describe.ts for the sentence that says so.
    case 'foal_grey':
      return bornColour;
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

export function expressPhenotype(genotype: Genotype, ageGameDays: number, gameDaysPerYear: number): Phenotype {
  const baseColour = baseColourOf(genotype);
  const dose = creamDoseOf(genotype);
  const { dilution, dilutedColour } = dilutedColourOf(baseColour, dose);
  const bornColour = dilutedColour;
  const greyStage = greyStageOf(genotype, ageGameDays, gameDaysPerYear);
  const visibleColour = visibleColourFor(greyStage, bornColour);
  const gaited = gaitedOf(genotype);

  return { baseColour, dilution, dilutedColour, greyStage, visibleColour, bornColour, gaited };
}
