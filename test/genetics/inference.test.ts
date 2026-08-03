import { describe, expect, it } from 'vitest';
import { inferFromPhenotype, hiddenColourAlleleCount } from '../../src/engines/genetics/inference';
import { expressPhenotype } from '../../src/engines/genetics/expression';
import type { Genotype } from '../../src/engines/genetics/genotype';

const GAME_DAYS_PER_YEAR = 360;
const ADULT = 4 * GAME_DAYS_PER_YEAR;

function genotypeWith(mendelian: Genotype['mendelian']): Genotype {
  return { v: 1, mendelian, polygenic: {} };
}

function pairSet(pairs: [string, string][]): Set<string> {
  return new Set(pairs.map((p) => [...p].sort().join('/')));
}

describe('inferFromPhenotype: amendment 0017a §4.2 table', () => {
  it('chestnut: E certain, A wide open (the epistasis case), CR certain', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E).toEqual([['e', 'e']]);
    expect(pairSet(inferred.A as [string, string][])).toEqual(pairSet([['A', 'A'], ['A', 'a'], ['a', 'a']]));
    expect(inferred.CR).toEqual([['cr', 'cr']]);
  });

  it('bay: E zygosity and A zygosity both open, CR certain from dilution', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E.length).toBe(2);
    expect(inferred.A.length).toBe(2);
    expect(inferred.CR).toEqual([['cr', 'cr']]);
  });

  it('black: A certain (a/a), CR ambiguous between clear and single dose', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.A).toEqual([['a', 'a']]);
    expect(pairSet(inferred.CR as [string, string][])).toEqual(pairSet([['Cr', 'cr'], ['cr', 'cr']]));
  });

  it('smoky cream (black, double cream) is visibly distinct: CR certain', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['Cr', 'Cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.CR).toEqual([['Cr', 'Cr']]);
  });

  it('grey (past foal stage): every base colour still possible', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    expect(phenotype.greyStage).not.toBe('none');
    expect(phenotype.greyStage).not.toBe('foal_grey');
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E.length).toBe(3);
    expect(inferred.A.length).toBe(3);
    expect(inferred.CR.length).toBe(3);
    expect(inferred.G.length).toBe(2);
  });

  it('a foal-grey horse still shows its birth colour', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] }), 0, GAME_DAYS_PER_YEAR);
    expect(phenotype.greyStage).toBe('foal_grey');
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E).toEqual([['e', 'e']]);
    expect(inferred.G.length).toBe(2);
  });

  it('not gaited: heterozygotes are invisible, so C/A is still possible', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(pairSet(inferred.DMRT3 as [string, string][])).toEqual(pairSet([['C', 'C'], ['C', 'A']]));
  });

  it('gaited: certain A/A', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['A', 'A'] }), ADULT, GAME_DAYS_PER_YEAR);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.DMRT3).toEqual([['A', 'A']]);
  });
});

describe('hiddenColourAlleleCount (amendment 0017a §4.7)', () => {
  it('a palomino testing CR contributes 0 - cream dose is already visible on a chestnut base', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['Cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    expect(phenotype.visibleColour).toBe('palomino');
    expect(hiddenColourAlleleCount(phenotype, ['CR'])).toBe(0);
  });

  it('a bay testing A contributes 1 - zygosity was genuinely unknown from looking', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    expect(phenotype.visibleColour).toBe('bay');
    expect(hiddenColourAlleleCount(phenotype, ['A'])).toBe(1);
  });

  it('a black testing CR contributes 1 - the smoky black ambiguity', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['Cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    expect(hiddenColourAlleleCount(phenotype, ['CR'])).toBe(1);
  });

  it('untested loci are simply not counted', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR);
    expect(hiddenColourAlleleCount(phenotype, [])).toBe(0);
  });
});
