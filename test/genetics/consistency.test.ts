import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { LOCI } from '../../src/engines/genetics/loci';

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
