import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { LOCI } from '../../src/engines/genetics/loci';
import { parseAllelePool } from '../../src/engines/founding/pool';

// The test CLAUDE.md §8/§11 asks for: the engine's LOCI constant is the source of truth for
// iteration order and reproducibility (loci.ts), but a player-facing operator might reword
// loci.teaching_text in the database - this test guards the two never drifting apart on the
// things that actually matter: codes, canonical allele order, and iteration order.
describe('LOCI vs migrations/0015_seed_loci.sql', () => {
  it('seeds exactly the codes in LOCI, in the same order, with the same canonical allele order', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0015_seed_loci.sql');
    expect(migration).toBeDefined();

    const rowPattern = /\('([A-Z0-9]+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'(\[[^\]]*\])'/g;
    const seeded: { code: string; alleles: string[] }[] = [];
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(migration!.sql)) !== null) {
      seeded.push({ code: match[1], alleles: JSON.parse(match[2]) as string[] });
    }

    expect(seeded.length).toBe(LOCI.length);
    expect(seeded.map((s) => s.code)).toEqual(LOCI.map((l) => l.code));
    seeded.forEach((s, i) => {
      expect(s.alleles).toEqual([...LOCI[i].alleles]);
    });
  });
});

// Slice 0005 §9: every seeded breed's founding_allele_pool must list every locus in LOCI, using
// only known allele symbols, each locus summing to 1.0 - the guarantee that turns §3.2's rule
// ("a pool missing a locus is an error, not a default") from a comment into something a future
// locus-adding migration can't silently violate.
describe('every seeded breed pool vs LOCI', () => {
  const seedMigrations = ['0014_seed_breeds.sql', '0024_seed_breed_pools.sql'];
  const poolPattern = /'([A-Z0-9]+)',\s*'[^']*',\s*\d+,\s*\d+,\s*\n?\s*'(\{[^']*\})'/g;

  const pools: { code: string; poolJson: string }[] = [];
  for (const name of seedMigrations) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    expect(migration, `migration ${name} not found`).toBeDefined();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(poolPattern.source, poolPattern.flags);
    while ((match = pattern.exec(migration!.sql)) !== null) {
      pools.push({ code: match[1], poolJson: match[2] });
    }
  }

  it('found at least one breed per seed migration', () => {
    expect(pools.length).toBeGreaterThanOrEqual(8);
  });

  it.each(pools.map((p) => [p.code, p.poolJson] as const))('%s pool covers every locus, valid alleles, sums to 1.0', (code, poolJson) => {
    const pool = parseAllelePool(poolJson);
    for (const locus of LOCI) {
      expect(pool[locus.code], `${code} missing locus ${locus.code}`).toBeDefined();
      const freqs = pool[locus.code];
      let sum = 0;
      for (const allele of Object.keys(freqs)) {
        expect(locus.alleles, `${code} has unknown allele ${allele} at locus ${locus.code}`).toContain(allele);
        sum += freqs[allele];
      }
      expect(sum, `${code} locus ${locus.code} sums to ${String(sum)}`).toBeCloseTo(1.0, 6);
    }
  });
});
