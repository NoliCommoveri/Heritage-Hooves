import { describe, expect, it } from 'vitest';
import { conditionStatus, type ConditionTrigger } from '../../src/engines/health/status';
import { GENOTYPE_VERSION, type Genotype } from '../../src/engines/genetics/genotype';

function genotypeWith(locus: string, a: string, b: string): Genotype {
  return { v: GENOTYPE_VERSION, mendelian: { [locus]: [a, b] }, polygenic: {} };
}

const RECESSIVE: ConditionTrigger = { v: 1, locus: 'GBED', mutant: 'Gb', mode: 'recessive' };
const DOMINANT: ConditionTrigger = { v: 1, locus: 'HYPP', mutant: 'H', mode: 'dominant' };

describe('conditionStatus - recessive', () => {
  it('0 copies of the mutant allele reads clear', () => {
    expect(conditionStatus(genotypeWith('GBED', 'N', 'N'), RECESSIVE)).toEqual({ status: 'clear', copies: 0 });
  });

  it('1 copy reads carrier', () => {
    expect(conditionStatus(genotypeWith('GBED', 'N', 'Gb'), RECESSIVE)).toEqual({ status: 'carrier', copies: 1 });
    expect(conditionStatus(genotypeWith('GBED', 'Gb', 'N'), RECESSIVE)).toEqual({ status: 'carrier', copies: 1 });
  });

  it('2 copies reads affected', () => {
    expect(conditionStatus(genotypeWith('GBED', 'Gb', 'Gb'), RECESSIVE)).toEqual({ status: 'affected', copies: 2 });
  });
});

describe('conditionStatus - dominant', () => {
  it('0 copies reads clear', () => {
    expect(conditionStatus(genotypeWith('HYPP', 'N', 'N'), DOMINANT)).toEqual({ status: 'clear', copies: 0 });
  });

  it('1 copy reads affected, never carrier - there is no such thing as a carrier of a dominant', () => {
    const result = conditionStatus(genotypeWith('HYPP', 'N', 'H'), DOMINANT);
    expect(result).toEqual({ status: 'affected', copies: 1 });
    expect(result.status).not.toBe('carrier');
  });

  it('2 copies also reads affected', () => {
    expect(conditionStatus(genotypeWith('HYPP', 'H', 'H'), DOMINANT)).toEqual({ status: 'affected', copies: 2 });
  });

  it('the word "carrier" never appears across the whole dominant range', () => {
    for (const pair of [
      ['N', 'N'],
      ['N', 'H'],
      ['H', 'H'],
    ] as const) {
      expect(conditionStatus(genotypeWith('HYPP', pair[0], pair[1]), DOMINANT).status).not.toBe('carrier');
    }
  });
});

describe('conditionStatus - the missing-locus rule', () => {
  it('a genotype with no key at all for this locus reads clear, for both modes - this is the whole existing population', () => {
    const empty: Genotype = { v: GENOTYPE_VERSION, mendelian: {}, polygenic: {} };
    expect(conditionStatus(empty, RECESSIVE)).toEqual({ status: 'clear', copies: 0 });
    expect(conditionStatus(empty, DOMINANT)).toEqual({ status: 'clear', copies: 0 });
  });
});
