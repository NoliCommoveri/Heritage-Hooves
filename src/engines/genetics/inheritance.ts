// Meiosis and combination: two parent genotypes plus a foal seed produce one foal genotype.
// Slice 0002 §5.2.
//
// combine() derives four independent sub-seed streams from the foal's own seed -
// "mendelian_sire", "mendelian_dam", "polygenic_sire", "polygenic_dam" - rather than drawing
// everything from one stream, so that adding a locus or a trait later does not shift the draws of
// an unrelated system (CLAUDE.md §5.2 forbids a second independent generator from a stored seed;
// deriveSeed is how you get more than one stream out of one).
//
// Design note not spelled out in the slice document: meiosis() below only produces the Mendelian
// half of a gamete (one allele per locus in LOCI). The polygenic half has its own gamete-drawing
// logic in polygenic.ts (inheritPolygenic), because it draws per quantitative-trait-locus rather
// than per Mendelian locus. combine() calls both and assembles the full Genotype.

import type { Rng } from '../../lib/rng';
import { makeRng, deriveSeed } from '../../lib/rng';
import { LOCI } from './loci';
import { getMendelianPair, sortAllelePair, GENOTYPE_VERSION, type Genotype, type AllelePair } from './genotype';
import { inheritPolygenic } from './polygenic';

/** One allele per Mendelian locus, contributed by one parent. */
export type Haplotype = Record<string, string>;

export function meiosis(parentGenotype: Genotype, rng: Rng): Haplotype {
  const gamete: Haplotype = {};
  for (const locus of LOCI) {
    const pair = getMendelianPair(parentGenotype, locus.code);
    gamete[locus.code] = rng.pick(pair);
  }
  return gamete;
}

export function combine(sire: Genotype, dam: Genotype, foalSeed: number): Genotype {
  const sireMendelianRng = makeRng(deriveSeed(foalSeed, 'mendelian_sire'));
  const damMendelianRng = makeRng(deriveSeed(foalSeed, 'mendelian_dam'));
  const sirePolygenicRng = makeRng(deriveSeed(foalSeed, 'polygenic_sire'));
  const damPolygenicRng = makeRng(deriveSeed(foalSeed, 'polygenic_dam'));

  const sireGamete = meiosis(sire, sireMendelianRng);
  const damGamete = meiosis(dam, damMendelianRng);

  const mendelian: Record<string, AllelePair> = {};
  for (const locus of LOCI) {
    mendelian[locus.code] = sortAllelePair(locus.code, sireGamete[locus.code], damGamete[locus.code]);
  }

  const polygenic = inheritPolygenic(sire, dam, sirePolygenicRng, damPolygenicRng);

  return { v: GENOTYPE_VERSION, mendelian, polygenic };
}
