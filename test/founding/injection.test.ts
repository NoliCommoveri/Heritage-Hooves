import { describe, expect, it } from 'vitest';
import { applyConsignmentInjection } from '../../src/engines/founding/injection';
import type { Genotype } from '../../src/engines/genetics/genotype';

function baseGenotype(): Genotype {
  return { v: 1, mendelian: { E: ['e', 'e'], A: ['a', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] }, polygenic: {} };
}

describe('applyConsignmentInjection (amendment 0017a §5.4)', () => {
  it('het writes one copy of the injected allele plus the locus wild type, sorted canonically', () => {
    const result = applyConsignmentInjection(baseGenotype(), { locusCode: 'CR', allele: 'Cr', zygosity: 'het' });
    expect(result.mendelian.CR).toEqual(['Cr', 'cr']);
  });

  it('hom writes two copies', () => {
    const result = applyConsignmentInjection(baseGenotype(), { locusCode: 'CR', allele: 'Cr', zygosity: 'hom' });
    expect(result.mendelian.CR).toEqual(['Cr', 'Cr']);
  });

  it('is deterministic regardless of what the candidate already carried at that locus', () => {
    const a = applyConsignmentInjection({ ...baseGenotype(), mendelian: { ...baseGenotype().mendelian, CR: ['Cr', 'Cr'] } }, { locusCode: 'CR', allele: 'Cr', zygosity: 'het' });
    const b = applyConsignmentInjection(baseGenotype(), { locusCode: 'CR', allele: 'Cr', zygosity: 'het' });
    expect(a.mendelian.CR).toEqual(b.mendelian.CR);
  });

  it('leaves every other locus untouched', () => {
    const result = applyConsignmentInjection(baseGenotype(), { locusCode: 'CR', allele: 'Cr', zygosity: 'het' });
    expect(result.mendelian.E).toEqual(['e', 'e']);
    expect(result.mendelian.A).toEqual(['a', 'a']);
    expect(result.mendelian.G).toEqual(['g', 'g']);
  });

  it('throws on an unknown locus or allele', () => {
    expect(() => applyConsignmentInjection(baseGenotype(), { locusCode: 'ZZ', allele: 'X', zygosity: 'het' })).toThrow();
    expect(() => applyConsignmentInjection(baseGenotype(), { locusCode: 'CR', allele: 'X', zygosity: 'het' })).toThrow();
  });
});
