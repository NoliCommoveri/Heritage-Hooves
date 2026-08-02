import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/lib/rng';
import { combine, meiosis } from '../../src/engines/genetics/inheritance';
import { serializeGenotype, getMendelianPair, type Genotype } from '../../src/engines/genetics/genotype';
import { LOCI } from '../../src/engines/genetics/loci';

function genotypeWith(mendelian: Genotype['mendelian']): Genotype {
  return { v: 1, mendelian, polygenic: {} };
}

describe('combine: reproducibility', () => {
  // Guards the whole reproducibility promise (CLAUDE.md §5.2): if this ever fails, the same
  // stored seed can produce two different foals, which breaks every stored horse in the game.
  it('same parents and the same foal seed produce a byte-identical genotype', () => {
    const sire = genotypeWith({ E: ['E', 'e'], A: ['A', 'a'], CR: ['cr', 'cr'], G: ['g', 'g'], DMRT3: ['C', 'C'] });
    const dam = genotypeWith({ E: ['E', 'e'], A: ['a', 'a'], CR: ['Cr', 'cr'], G: ['G', 'g'], DMRT3: ['C', 'A'] });

    const foal1 = combine(sire, dam, 424242);
    const foal2 = combine(sire, dam, 424242);
    expect(serializeGenotype(foal1)).toBe(serializeGenotype(foal2));
  });

  it('different foal seeds (usually) produce different genotypes for the same parents', () => {
    const sire = genotypeWith({ E: ['E', 'e'], CR: ['Cr', 'cr'] });
    const dam = genotypeWith({ E: ['E', 'e'], CR: ['Cr', 'cr'] });
    const outputs = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) outputs.add(serializeGenotype(combine(sire, dam, seed)));
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('combine: carrier x carrier ratios', () => {
  it('E/e x E/e over 10,000 foals gives close to 25% ee', () => {
    const parent = genotypeWith({ E: ['E', 'e'] });
    let eeCount = 0;
    const N = 10_000;
    for (let seed = 1; seed <= N; seed++) {
      const foal = combine(parent, parent, seed);
      const [a, b] = foal.mendelian.E;
      if (a === 'e' && b === 'e') eeCount++;
    }
    const rate = eeCount / N;
    expect(rate).toBeGreaterThan(0.22);
    expect(rate).toBeLessThan(0.28);
  });

  it('E/E x e/e gives 100% E/e', () => {
    const sire = genotypeWith({ E: ['E', 'E'] });
    const dam = genotypeWith({ E: ['e', 'e'] });
    for (let seed = 1; seed <= 200; seed++) {
      const foal = combine(sire, dam, seed);
      expect(foal.mendelian.E).toEqual(['E', 'e']);
    }
  });
});

describe('meiosis: every allele in a gamete came from the parent', () => {
  it('holds for every locus, over a large sample', () => {
    const parent = genotypeWith({
      E: ['E', 'e'],
      A: ['A', 'a'],
      CR: ['Cr', 'cr'],
      G: ['G', 'g'],
      DMRT3: ['C', 'A'],
    });
    const rng = makeRng(777);
    for (let i = 0; i < 2000; i++) {
      const gamete = meiosis(parent, rng);
      for (const locus of LOCI) {
        const pair = getMendelianPair(parent, locus.code);
        expect(pair).toContain(gamete[locus.code]);
      }
    }
  });
});

describe('missing-locus rule', () => {
  it('a parent missing a locus entirely is read as homozygous wild-type, and the foal is well-formed', () => {
    // No DMRT3 key at all - as if this horse predates the gene.
    const sire = genotypeWith({ E: ['E', 'e'] });
    const dam = genotypeWith({ E: ['e', 'e'], DMRT3: ['C', 'A'] });

    expect(getMendelianPair(sire, 'DMRT3')).toEqual(['C', 'C']);

    for (let seed = 1; seed <= 50; seed++) {
      const foal = combine(sire, dam, seed);
      // The missing parent can only contribute its wild-type allele (C); the foal's DMRT3 pair
      // must therefore always include a C, and never be A/A.
      expect(foal.mendelian.DMRT3).toContain('C');
      expect(foal.mendelian.DMRT3).not.toEqual(['A', 'A']);
      for (const locus of LOCI) {
        expect(foal.mendelian[locus.code]).toHaveLength(2);
      }
    }
  });
});
