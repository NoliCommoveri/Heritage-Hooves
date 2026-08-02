import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { LOCI } from '../../src/engines/genetics/loci';
import { parseAllelePool } from '../../src/engines/founding/pool';
import { TRAITS, LOCI_PER_TRAIT, type TraitCode } from '../../src/engines/genetics/polygenic';
import { TRAIT_CATEGORY, TRAIT_DIRECTION } from '../../src/engines/conformation/traits';

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

// Slice 0006 §8.6: TRAITS (polygenic.ts) is the source of truth for iteration order and the RNG
// draw sequence; src/engines/conformation/traits.ts's TRAIT_CATEGORY/TRAIT_DIRECTION maps and
// migrations/0029_seed_quantitative_traits.sql are both display metadata that must agree with it,
// exactly as 0015_seed_loci.sql must agree with LOCI above.
describe('TRAITS vs migrations/0029_seed_quantitative_traits.sql', () => {
  it('seeds exactly the codes in TRAITS, in the same order, with matching category, direction and locus_count', () => {
    const migration = MIGRATIONS.find((m) => m.name === '0029_seed_quantitative_traits.sql');
    expect(migration).toBeDefined();

    const rowPattern =
      /\('([a-z_]+)',\s*'[^']*',\s*'(conformation|ability|hidden)',\s*'(bidirectional|higher_better)',\s*(?:'[^']*'|NULL),\s*(?:'[^']*'|NULL),\s*(\d+)/g;
    const seeded: { code: string; category: string; direction: string; locusCount: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(migration!.sql)) !== null) {
      seeded.push({ code: match[1], category: match[2], direction: match[3], locusCount: Number(match[4]) });
    }

    expect(seeded.length).toBe(TRAITS.length);
    expect(seeded.map((s) => s.code)).toEqual([...TRAITS]);
    seeded.forEach((s) => {
      const code = s.code as TraitCode;
      expect(s.category, `${s.code} category`).toBe(TRAIT_CATEGORY[code]);
      expect(s.direction, `${s.code} direction`).toBe(TRAIT_DIRECTION[code]);
      expect(s.locusCount, `${s.code} locus_count`).toBe(LOCI_PER_TRAIT);
    });
  });
});
