// Structured phenotype -> an English sentence. Slice 0002 §5.4. This is the entire presentation
// layer for a horse until the image slot lands, so the vocabulary below is worth getting right.

import type { Phenotype, PatternCode } from './expression';

// Slice 0021 §5.6. Plain-English words for each pattern code, in the sentence rather than the raw
// code - 'frame' alone reads as a typo, 'frame overo' is the name a breeder would use. Exported for
// slice 0021 Part D (§6.2): foal-colours.ts's foal preview composes the same words onto a predicted
// colour name, so there is exactly one place a pattern code becomes English.
export const PATTERN_LABELS: Record<PatternCode, string> = {
  tobiano: 'tobiano',
  frame: 'frame overo',
  splash: 'splash',
  sabino: 'sabino',
  sabino_max: 'maximum sabino',
  appaloosa: 'appaloosa',
  appaloosa_blanket: 'blanket appaloosa',
  appaloosa_leopard: 'leopard appaloosa',
  appaloosa_fewspot: 'few-spot appaloosa',
};

/** Reads patterns[] in its own stored order (expression.ts's patternsOf) - not re-sorted here. */
function patternClause(patterns: PatternCode[]): string {
  return patterns.length === 0 ? '' : `${patterns.map((p) => PATTERN_LABELS[p]).join(' ')} `;
}

/** Below this age (in game years), a horse reads as a filly/colt rather than a mare/stallion/gelding. */
const YOUNG_AGE_YEARS = 3;

const YOUNG_NOUN: Record<string, string> = {
  mare: 'filly',
  stallion: 'colt',
  gelding: 'colt',
};

const ADULT_NOUN: Record<string, string> = {
  mare: 'mare',
  stallion: 'stallion',
  gelding: 'gelding',
};

function subjectNoun(sex: string, ageYears: number): string {
  const table = ageYears < YOUNG_AGE_YEARS ? YOUNG_NOUN : ADULT_NOUN;
  return table[sex] ?? sex;
}

function pronoun(sex: string): string {
  return sex === 'mare' ? 'she' : 'he';
}

function ageClause(ageYears: number): string {
  const wholeYears = Math.floor(ageYears);
  if (wholeYears < 1) return 'under a year old';
  if (wholeYears === 1) return '1 year old';
  return `${wholeYears} years old`;
}

export function describeHorse(phenotype: Phenotype, sex: string, ageYears: number): string {
  const noun = subjectNoun(sex, ageYears);
  // Foal-grey horses look like their base colour still (see expression.ts) so no "born X" clause
  // is needed until the grey has actually started changing how the horse reads.
  const bornClause = phenotype.greyStage !== 'none' && phenotype.greyStage !== 'foal_grey' ? `, born ${phenotype.bornColour}` : '';
  const gaitedClause = phenotype.gaited ? `, and ${pronoun(sex)} is gaited` : '';
  const patterns = patternClause(phenotype.patterns);
  return `A ${phenotype.visibleColour} ${patterns}${noun}${bornClause}, ${ageClause(ageYears)}${gaitedClause}.`;
}
