import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/lib/rng';
import { generateFounderPolygenic, inheritPolygenic, potential, TRAITS, LOCI_PER_TRAIT } from '../../src/engines/genetics/polygenic';
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

  // Slice 0014 §10 test 12: the new robustness traits are ordinary TRAITS entries and
  // inheritPolygenic iterates TRAITS generically - this just proves it, rather than trusting that
  // "nothing needs to change" (§6.2) held in practice.
  it('a foal inherits ten loci per new robustness trait, one allele from each parent at each locus', () => {
    const robustnessTraits = ['foot_robustness', 'joint_robustness', 'ligament_robustness'] as const;
    const sirePolygenic: Record<string, string> = {};
    const damPolygenic: Record<string, string> = {};
    for (const trait of robustnessTraits) {
      sirePolygenic[trait] = '11'.repeat(LOCI_PER_TRAIT); // sire homozygous present at every locus
      damPolygenic[trait] = '00'.repeat(LOCI_PER_TRAIT); // dam homozygous absent at every locus
    }
    const sire = genotypeWithPolygenic(sirePolygenic);
    const dam = genotypeWithPolygenic(damPolygenic);

    const foalPolygenic = inheritPolygenic(sire, dam, makeRng(1), makeRng(2));
    for (const trait of robustnessTraits) {
      const bits = foalPolygenic[trait];
      expect(bits.length).toBe(LOCI_PER_TRAIT * 2);
      // One allele per locus from each parent: sire always contributes '1' (his only allele), dam
      // always contributes '0' (her only allele) - so every locus reads exactly ['1', '0'].
      for (let i = 0; i < LOCI_PER_TRAIT; i++) {
        expect([bits[i * 2], bits[i * 2 + 1]].sort()).toEqual(['0', '1']);
      }
    }
  });
});
