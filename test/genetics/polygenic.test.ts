import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/lib/rng';
import { generateFounderPolygenic, inheritPolygenic, potential, TRAITS } from '../../src/engines/genetics/polygenic';
import type { Genotype } from '../../src/engines/genetics/genotype';

function genotypeWithPolygenic(polygenic: Record<string, string>): Genotype {
  return { v: 1, mendelian: {}, polygenic };
}

describe('generateFounderPolygenic', () => {
  it('produces a spread of potentials rather than everything at the maximum', () => {
    const rng = makeRng(55);
    const potentials: number[] = [];
    for (let i = 0; i < 500; i++) {
      const polygenic = generateFounderPolygenic(rng);
      potentials.push(potential(genotypeWithPolygenic(polygenic), TRAITS[0]));
    }
    expect(new Set(potentials).size).toBeGreaterThan(5);
    const mean = potentials.reduce((a, b) => a + b, 0) / potentials.length;
    // Binomial(20, 0.5): expected mean 10.
    expect(mean).toBeGreaterThan(9);
    expect(mean).toBeLessThan(11);
  });
});

describe('inheritPolygenic', () => {
  it("a foal's potential, averaged over many draws, lands close to the midpoint of its parents' potentials", () => {
    const trait = TRAITS[0];
    // Sire: heterozygous at every locus (potential 10, but each draw is a coin flip).
    // Dam: homozygous absent at every locus (potential 0, no randomness).
    const sireBits = '10'.repeat(10);
    const damBits = '0'.repeat(20);
    const sire = genotypeWithPolygenic({ [trait]: sireBits });
    const dam = genotypeWithPolygenic({ [trait]: damBits });

    const samples: number[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const foalPolygenic = inheritPolygenic(sire, dam, makeRng(seed), makeRng(seed + 1_000_000));
      samples.push(potential(genotypeWithPolygenic(foalPolygenic), trait));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Midpoint of sire's potential (10) and dam's potential (0) is 5.
    expect(mean).toBeGreaterThan(4.5);
    expect(mean).toBeLessThan(5.5);
  });
});
