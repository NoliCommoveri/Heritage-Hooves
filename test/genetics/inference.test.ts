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
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E).toEqual([['e', 'e']]);
    expect(pairSet(inferred.A as [string, string][])).toEqual(pairSet([['A', 'A'], ['A', 'a'], ['a', 'a']]));
    expect(inferred.CR).toEqual([['cr', 'cr']]);
  });

  it('bay: E zygosity and A zygosity both open, CR certain from dilution', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E.length).toBe(2);
    expect(inferred.A.length).toBe(2);
    expect(inferred.CR).toEqual([['cr', 'cr']]);
  });

  it('black: A certain (a/a), CR ambiguous between clear and single dose', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.A).toEqual([['a', 'a']]);
    expect(pairSet(inferred.CR as [string, string][])).toEqual(pairSet([['Cr', 'cr'], ['cr', 'cr']]));
  });

  it('smoky cream (black, double cream) is visibly distinct: CR certain', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['Cr', 'Cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.CR).toEqual([['Cr', 'Cr']]);
  });

  it('grey (past foal stage): every base colour still possible', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.greyStage).not.toBe('none');
    expect(phenotype.greyStage).not.toBe('foal_grey');
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E.length).toBe(3);
    expect(inferred.A.length).toBe(3);
    expect(inferred.CR.length).toBe(3);
    expect(inferred.G.length).toBe(2);
  });

  it('a foal-grey horse still shows its birth colour', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'C'] }), 0, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.greyStage).toBe('foal_grey');
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.E).toEqual([['e', 'e']]);
    expect(inferred.G.length).toBe(2);
  });

  it('not gaited: heterozygotes are invisible, so C/A is still possible', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(pairSet(inferred.DMRT3 as [string, string][])).toEqual(pairSet([['C', 'C'], ['C', 'A']]));
  });

  it('gaited: certain A/A', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['A', 'A'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.DMRT3).toEqual([['A', 'A']]);
  });
});

// Slice 0021 Part D (§10): one case per new locus, plus the ones called out as mattering most.
describe('inferFromPhenotype: the ten colour/pattern loci (slice 0021 §6.1)', () => {
  const solidBase = { E: ['E', 'e'] as [string, string], A: ['A', 'a'] as [string, string], CR: ['cr', 'cr'] as [string, string], G: ['g', 'g'] as [string, string], DMRT3: ['C', 'C'] as [string, string] };

  it('silver on a chestnut is fully open, both alleles unknown', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, E: ['e', 'e'], Z: ['Z', 'Z'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.visibleColour).toBe('chestnut');
    const inferred = inferFromPhenotype(phenotype);
    expect(pairSet(inferred.Z as [string, string][])).toEqual(pairSet([['Z', 'Z'], ['Z', 'z'], ['z', 'z']]));
  });

  it('silver on a black-pigmented horse is visible: Z present, zygosity unknown', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, A: ['a', 'a'], Z: ['Z', 'z'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.visibleColour).toBe('silver black');
    const inferred = inferFromPhenotype(phenotype);
    expect(pairSet(inferred.Z as [string, string][])).toEqual(pairSet([['Z', 'Z'], ['Z', 'z']]));
  });

  it('silver not visible on a black-pigmented horse resolves to z/z', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, A: ['a', 'a'], Z: ['z', 'z'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.Z).toEqual([['z', 'z']]);
  });

  it('dun, champagne and roan: visible means zygosity open, not visible means homozygous wild certain', () => {
    const visible = expressPhenotype(genotypeWith({ ...solidBase, D: ['D', 'nd'], CH: ['Ch', 'ch'], RN: ['Rn', 'rn'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferredVisible = inferFromPhenotype(visible);
    expect(inferredVisible.D.length).toBe(2);
    expect(inferredVisible.CH.length).toBe(2);
    expect(inferredVisible.RN.length).toBe(2);

    const notVisible = expressPhenotype(genotypeWith(solidBase), ADULT, GAME_DAYS_PER_YEAR, 1);
    const inferredNot = inferFromPhenotype(notVisible);
    expect(inferredNot.D).toEqual([['nd', 'nd']]);
    expect(inferredNot.CH).toEqual([['ch', 'ch']]);
    expect(inferredNot.RN).toEqual([['rn', 'rn']]);
  });

  it('tobiano: visible means zygosity open, not visible means n/n certain', () => {
    const visible = expressPhenotype(genotypeWith({ ...solidBase, TO: ['TO', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(inferFromPhenotype(visible).TO.length).toBe(2);
    const notVisible = expressPhenotype(genotypeWith(solidBase), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(inferFromPhenotype(notVisible).TO).toEqual([['n', 'n']]);
  });

  it('frame overo: visibly framed resolves to O/n with certainty - O/O never draws breath', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, O: ['O', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1, { O: 1, SW1: 1 });
    expect(phenotype.patterns).toContain('frame');
    expect(inferFromPhenotype(phenotype).O).toEqual([['O', 'n']]);
  });

  it('frame overo: not visible stays open - could be n/n or a cryptic carrier that just did not roll penetrant', () => {
    const cryptic = expressPhenotype(genotypeWith({ ...solidBase, O: ['O', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1, { O: 0, SW1: 0 });
    expect(cryptic.patterns).not.toContain('frame');
    expect(pairSet(inferFromPhenotype(cryptic).O as [string, string][])).toEqual(pairSet([['O', 'n'], ['n', 'n']]));
  });

  it('Sabino1: all three doses are visibly distinct, so a genotype test is worthless - a single pair every time', () => {
    const clear = expressPhenotype(genotypeWith({ ...solidBase, SB1: ['n', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(inferFromPhenotype(clear).SB1).toEqual([['n', 'n']]);
    const single = expressPhenotype(genotypeWith({ ...solidBase, SB1: ['SB1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(inferFromPhenotype(single).SB1).toEqual([['SB1', 'n']]);
    const double = expressPhenotype(genotypeWith({ ...solidBase, SB1: ['SB1', 'SB1'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(inferFromPhenotype(double).SB1).toEqual([['SB1', 'SB1']]);
  });

  it('leopard complex: Lp/Lp + PATN1 (full leopard) - LP zygosity open, PATN1 present with zygosity open', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, LP: ['Lp', 'Lp'], PATN1: ['PATN1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.patterns).toEqual(['appaloosa_leopard']);
    const inferred = inferFromPhenotype(phenotype);
    expect(pairSet(inferred.LP as [string, string][])).toEqual(pairSet([['Lp', 'Lp'], ['Lp', 'lp']]));
    expect(pairSet(inferred.PATN1 as [string, string][])).toEqual(pairSet([['PATN1', 'PATN1'], ['PATN1', 'n']]));
  });

  it('leopard complex: no spotting visible resolves LP to lp/lp with certainty, and leaves PATN1 fully open', () => {
    const phenotype = expressPhenotype(genotypeWith({ ...solidBase, LP: ['lp', 'lp'], PATN1: ['PATN1', 'n'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.patterns).toEqual([]);
    const inferred = inferFromPhenotype(phenotype);
    expect(inferred.LP).toEqual([['lp', 'lp']]);
    expect(pairSet(inferred.PATN1 as [string, string][])).toEqual(pairSet([['PATN1', 'PATN1'], ['PATN1', 'n'], ['n', 'n']]));
  });
});

describe('hiddenColourAlleleCount (amendment 0017a §4.7)', () => {
  it('a palomino testing CR contributes 0 - cream dose is already visible on a chestnut base', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['a', 'a'], CR: ['Cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.visibleColour).toBe('palomino');
    expect(hiddenColourAlleleCount(phenotype, ['CR'])).toBe(0);
  });

  it('a bay testing A contributes 1 - zygosity was genuinely unknown from looking', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(phenotype.visibleColour).toBe('bay');
    expect(hiddenColourAlleleCount(phenotype, ['A'])).toBe(1);
  });

  it('a black testing CR contributes 1 - the smoky black ambiguity', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['Cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(hiddenColourAlleleCount(phenotype, ['CR'])).toBe(1);
  });

  it('untested loci are simply not counted', () => {
    const phenotype = expressPhenotype(genotypeWith({ E: ['e', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }), ADULT, GAME_DAYS_PER_YEAR, 1);
    expect(hiddenColourAlleleCount(phenotype, [])).toBe(0);
  });
});
