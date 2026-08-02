import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { parseAllelePool } from '../../src/engines/founding/pool';
import { generateCandidate } from '../../src/engines/founding/generate';

/**
 * Pulls one breed's founding_allele_pool JSON straight out of migration SQL, so these tests
 * exercise the pool this codebase actually ships rather than a hand-copied duplicate that could
 * quietly drift from it. Reads 0051_breed_pools_disease_loci.sql, not 0014/0024 - that migration
 * (slice 0010 §4.3) rewrites every breed's whole pool to add the four disease loci, so it is the
 * final, authoritative state, the same way a later UPDATE always supersedes the INSERT it followed.
 */
function poolJsonForBreed(code: string): string {
  const migrationName = '0051_breed_pools_disease_loci.sql';
  const migration = MIGRATIONS.find((m) => m.name === migrationName);
  if (!migration) throw new Error(`migration ${migrationName} not found`);
  const pattern = new RegExp(`founding_allele_pool = '(\\{[^']*\\})' WHERE code = '${code}'`);
  const match = migration.sql.match(pattern);
  if (!match) throw new Error(`pool not found for breed ${code} in ${migrationName}`);
  return match[1];
}

const QH_POOL = parseAllelePool(poolJsonForBreed('QH'));
const FR_POOL = parseAllelePool(poolJsonForBreed('FR'));

describe('generateCandidate - Hardy-Weinberg', () => {
  it('two independent draws at population frequency produce Hardy-Weinberg proportions', () => {
    // QH's E locus: E .55 / e .45 -> EE ~30%, Ee ~50%, ee ~20%.
    let ee = 0;
    let ee2 = 0; // heterozygous count
    let eeHomRecessive = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
      const [a1, a2] = genotype.mendelian.E;
      if (a1 === 'E' && a2 === 'E') ee++;
      else if (a1 === 'e' && a2 === 'e') eeHomRecessive++;
      else ee2++;
    }
    expect(ee / n).toBeCloseTo(0.3, 1);
    expect(ee2 / n).toBeCloseTo(0.5, 1);
    expect(eeHomRecessive / n).toBeCloseTo(0.2, 1);
  });
});

describe('generateCandidate - Friesian pool', () => {
  it('every candidate is black or chestnut, never bay, cream-diluted or grey', () => {
    const n = 5000;
    let chestnutCount = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({ pool: FR_POOL, polygenicOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
      expect(genotype.mendelian.A).toEqual(['a', 'a']); // fixed - bay is impossible
      expect(genotype.mendelian.CR).toEqual(['cr', 'cr']); // fixed - no dilution
      expect(genotype.mendelian.G).toEqual(['g', 'g']); // fixed - no grey
      const [e1, e2] = genotype.mendelian.E;
      if (e1 === 'e' && e2 === 'e') chestnutCount++;
    }
    // e at 8% -> ee at roughly 0.64%, "one foal in 150" per slice 0005 §5.3.
    const rate = chestnutCount / n;
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.02);
  });
});

describe('generateCandidate - quality bands', () => {
  function meanPotential(polygenicOneChance: number, n: number, seedOffset: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({
        pool: QH_POOL,
        polygenicOneChance,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed: seedOffset + i,
      });
      total += [...genotype.polygenic.speed].filter((c) => c === '1').length;
    }
    return total / n;
  }

  it('mean potential is strictly low < mid < high', () => {
    const n = 3000;
    const low = meanPotential(0.42, n, 1_000_000);
    const mid = meanPotential(0.5, n, 2_000_000);
    const high = meanPotential(0.58, n, 3_000_000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('the bands overlap: a low-band candidate can exceed the high-band mean', () => {
    // High-band mean is ~11.6 (Binomial(20, 0.58)). Over a few thousand low-band draws, at least
    // one should clear it - if not, the bands are separating tiers rather than shifting them.
    let sawOutlier = false;
    for (let i = 0; i < 4000; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.42, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: 5_000_000 + i });
      const potential = [...genotype.polygenic.speed].filter((c) => c === '1').length;
      if (potential > 11.6) {
        sawOutlier = true;
        break;
      }
    }
    expect(sawOutlier).toBe(true);
  });
});

describe('generateCandidate - determinism', () => {
  it('the same seed produces byte-identical candidates', () => {
    const a = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: 424242 });
    const b = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: 424242 });
    expect(a).toEqual(b);
  });

  it('age lands within the requested range', () => {
    for (let i = 0; i < 200; i++) {
      const { ageGameDays } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: i });
      expect(ageGameDays).toBeGreaterThanOrEqual(1440);
      expect(ageGameDays).toBeLessThanOrEqual(2880);
    }
  });
});
