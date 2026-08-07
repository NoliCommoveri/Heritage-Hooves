import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { LOCI } from '../../src/engines/genetics/loci';
import { parseAllelePool } from '../../src/engines/founding/pool';
import { TRAITS, LOCI_PER_TRAIT, type TraitCode } from '../../src/engines/genetics/polygenic';
import { TRAIT_CATEGORY, TRAIT_DIRECTION, CONFORMATION_TRAITS, ABILITY_TRAITS } from '../../src/engines/conformation/traits';
import { TYPE_LOCUS_CODE } from '../../src/engines/conformation/typeGene';

// Slice 0028 §2.5/pool.ts's own POOL_EXEMPT_LOCI: the five type-gene loci are dealt from a breed's
// ideal_vector, never drawn from a founding_allele_pool - restated here rather than imported, since
// pool.ts's own set is intentionally not exported (nothing outside parseAllelePool should need it).
const TYPE_GENE_LOCUS_CODES = new Set(Object.values(TYPE_LOCUS_CODE));

// The test CLAUDE.md §8/§11 asks for: the engine's LOCI constant is the source of truth for
// iteration order and reproducibility (loci.ts), but a player-facing operator might reword
// loci.teaching_text in the database - this test guards the two never drifting apart on the
// things that actually matter: codes, canonical allele order, and iteration order. Slice 0010 §10
// extends this to also cover 0050_seed_disease_loci.sql, the four loci appended after DMRT3 -
// scanning both migrations in order and asserting against the whole of LOCI is what proves the new
// four are last and in the right order, not a separate assertion bolted on beside it.
describe('LOCI vs the seed migrations (0015 + 0050)', () => {
  it('seeds exactly the codes in LOCI, in the same order, with the same canonical allele order', () => {
    const migrationNames = [
      '0015_seed_loci.sql',
      '0050_seed_disease_loci.sql',
      '0113_seed_colour_pattern_loci.sql',
      '0145_seed_breed_disease_loci.sql',
      '0186_seed_type_gene_loci.sql',
    ];
    const rowPattern = /\('([A-Z0-9]+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*'(\[[^\]]*\])'/g;
    const seeded: { code: string; alleles: string[] }[] = [];

    for (const name of migrationNames) {
      const migration = MIGRATIONS.find((m) => m.name === name);
      expect(migration, `migration ${name} not found`).toBeDefined();
      const pattern = new RegExp(rowPattern.source, rowPattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(migration!.sql)) !== null) {
        seeded.push({ code: match[1], alleles: JSON.parse(match[2]) as string[] });
      }
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
// locus-adding migration can't silently violate. Reads 0146_breed_pools_disease_loci.sql
// (docs/fixes/breed-disease-panels.md), not 0051/0014/0024/0114 - that migration rewrites every
// breed's whole pool to add the seven new disease loci, so it is the final, authoritative state a
// later UPDATE always supersedes an INSERT with, the same reasoning test/founding/generate.test.ts's
// own pool-loading helper uses.
describe('every seeded breed pool vs LOCI', () => {
  const seedMigrations = ['0146_breed_pools_disease_loci.sql'];
  const poolPattern = /founding_allele_pool = '(\{[^']*\})' WHERE code = '([A-Z0-9]+)'/g;

  const pools: { code: string; poolJson: string }[] = [];
  for (const name of seedMigrations) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    expect(migration, `migration ${name} not found`).toBeDefined();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(poolPattern.source, poolPattern.flags);
    while ((match = pattern.exec(migration!.sql)) !== null) {
      pools.push({ code: match[2], poolJson: match[1] });
    }
  }

  it('found at least one breed per seed migration', () => {
    expect(pools.length).toBeGreaterThanOrEqual(8);
  });

  it.each(pools.map((p) => [p.code, p.poolJson] as const))('%s pool covers every locus, valid alleles, sums to 1.0', (code, poolJson) => {
    const pool = parseAllelePool(poolJson);
    for (const locus of LOCI) {
      if (TYPE_GENE_LOCUS_CODES.has(locus.code)) continue; // dealt from ideal_vector, never pooled
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

// Slice 0006 §8.6/slice 0012 §11.4: TRAITS (polygenic.ts) is the source of truth for iteration
// order and the RNG draw sequence; src/engines/conformation/traits.ts's
// TRAIT_CATEGORY/TRAIT_DIRECTION maps and the seed migrations are both display metadata that must
// agree with it, exactly as 0015_seed_loci.sql must agree with LOCI above. Slice 0012 appends
// 'agility' in migration 0061 - scanning 0029 then 0061 in sequence and asserting against the
// whole of TRAITS is what proves agility is both correct and *last* (§4.1's append-only rule).
describe('TRAITS vs migrations/0029 + 0061 + 0081 + 0110 (quantitative_traits seeds)', () => {
  it('seeds exactly the codes in TRAITS, in the same order, with matching category, direction and locus_count', () => {
    const migrationNames = [
      '0029_seed_quantitative_traits.sql',
      '0061_quantitative_traits_agility.sql',
      '0081_quantitative_traits_robustness.sql',
      '0110_quantitative_traits_head_profile.sql',
    ];
    const rowPattern =
      /\('([a-z_]+)',\s*'[^']*',\s*'(conformation|ability|hidden)',\s*'(bidirectional|higher_better)',\s*(?:'[^']*'|NULL),\s*(?:'[^']*'|NULL),\s*(\d+)/g;
    const seeded: { code: string; category: string; direction: string; locusCount: number }[] = [];

    for (const name of migrationNames) {
      const migration = MIGRATIONS.find((m) => m.name === name);
      expect(migration, `migration ${name} not found`).toBeDefined();
      const pattern = new RegExp(rowPattern.source, rowPattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(migration!.sql)) !== null) {
        seeded.push({ code: match[1], category: match[2], direction: match[3], locusCount: Number(match[4]) });
      }
    }

    expect(seeded.length).toBe(TRAITS.length);
    expect(seeded.map((s) => s.code)).toEqual([...TRAITS]);
    expect(seeded[seeded.length - 1].code).toBe('head_profile');
    seeded.forEach((s) => {
      const code = s.code as TraitCode;
      expect(s.category, `${s.code} category`).toBe(TRAIT_CATEGORY[code]);
      expect(s.direction, `${s.code} direction`).toBe(TRAIT_DIRECTION[code]);
      expect(s.locusCount, `${s.code} locus_count`).toBe(LOCI_PER_TRAIT);
    });
  });
});

// Slice 0012 §11.4: 0035's ideal-vector test from the other side - every seeded discipline's
// ability_weights must name only codes ABILITY_TRAITS iterates, with weights >= 0 and at least one
// strictly positive (a discipline that weights nothing would be a data-entry mistake, not a
// legitimate discipline). Scans 0063 (Barrel Racing) and 0108 (the other five, seeded once the
// breeds stage landed) in sequence, the same two-migration-scan pattern the LOCI and TRAITS blocks
// above use.
describe('seeded disciplines vs ABILITY_TRAITS (slice 0012 §11.4)', () => {
  const migrationNames = ['0063_seed_disciplines.sql', '0108_seed_disciplines_remaining.sql'];
  it('both discipline seed migrations exist', () => {
    for (const name of migrationNames) {
      expect(MIGRATIONS.find((m) => m.name === name), name).toBeDefined();
    }
  });

  const rowPattern = /\('([a-z]+)',\s*'[^']*',\s*'(\{[^']*\})'/g;
  const seeded: { code: string; weights: Record<string, number> }[] = [];
  for (const name of migrationNames) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    let match: RegExpExecArray | null;
    const pattern = new RegExp(rowPattern.source, rowPattern.flags);
    while (migration && (match = pattern.exec(migration.sql)) !== null) {
      const parsed = JSON.parse(match[2]) as { v: number; traits: Record<string, number> };
      seeded.push({ code: match[1], weights: parsed.traits });
    }
  }

  it('found all six seeded disciplines', () => {
    expect(seeded.length).toBe(6);
  });

  it.each(seeded.map((s) => [s.code, s.weights] as const))('%s names only ABILITY_TRAITS codes, weights >= 0, at least one > 0', (code, weights) => {
    expect(Object.keys(weights).sort()).toEqual([...ABILITY_TRAITS].sort());
    let anyPositive = false;
    for (const [trait, weight] of Object.entries(weights)) {
      expect(ABILITY_TRAITS, `${code} has unknown ability trait ${trait}`).toContain(trait);
      expect(weight, `${code}.${trait} weight`).toBeGreaterThanOrEqual(0);
      if (weight > 0) anyPositive = true;
    }
    expect(anyPositive, `${code} weights nothing at all`).toBe(true);
  });

  it('agility is the strict maximum weight in Barrel Racing', () => {
    const barrels = seeded.find((s) => s.code === 'barrels');
    expect(barrels).toBeDefined();
    const maxWeight = Math.max(...Object.values(barrels!.weights));
    expect(barrels!.weights.agility).toBe(maxWeight);
    const others = Object.entries(barrels!.weights).filter(([t]) => t !== 'agility');
    for (const [, w] of others) expect(w).toBeLessThan(barrels!.weights.agility);
  });

  // §5.2: the property that makes the six-discipline set worth having, now that all six exist -
  // every ability trait is the strict maximum weight in at least one enabled discipline, so no
  // trait is dead weight and no two disciplines select for the same horse.
  it('every ability trait is the strict maximum weight in at least one discipline', () => {
    for (const trait of ABILITY_TRAITS) {
      const isDominantSomewhere = seeded.some((s) => {
        const maxWeight = Math.max(...Object.values(s.weights));
        return s.weights[trait] === maxWeight && Object.entries(s.weights).filter(([t]) => t !== trait).every(([, w]) => w < maxWeight);
      });
      expect(isDominantSomewhere, `${trait} is never the strict maximum in any seeded discipline`).toBe(true);
    }
  });
});

// Slice 0008 §4.2 / docs/breed-ideal-vectors.md §3, extended by slice 0021 §3.3: every breed's
// ideal vector must name exactly the five conformation trait codes CONFORMATION_TRAITS iterates -
// no more, no fewer - or scoreEntry (which iterates that same list) would silently ignore an extra
// trait or score a missing one as 0. Scans 0035 (Quarter Horse) and 0107 (the other seven) for the
// original four traits, then 0111 for head_profile - seeded separately via json_set so 0035/0107's
// exact target values are never retyped (slice 0021 §3.3) - and merges the two by breed code.
describe('breed ideal_vectors vs CONFORMATION_TRAITS (slice 0008 §4.2, slice 0021 §3.3)', () => {
  const migrationNames = ['0035_seed_qh_ideal_vector.sql', '0107_seed_breed_ideal_vectors.sql'];
  const rowPattern = /ideal_vector = '(\{[^']*\})'\s*WHERE code = '([A-Z]+)'/g;

  const vectors: { code: string; traits: Record<string, { target: number; weight: number }> }[] = [];
  for (const name of migrationNames) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    expect(migration, `migration ${name} not found`).toBeDefined();
    let match: RegExpExecArray | null;
    const pattern = new RegExp(rowPattern.source, rowPattern.flags);
    while (migration && (match = pattern.exec(migration.sql)) !== null) {
      const parsed = JSON.parse(match[1]) as { v: number; traits: Record<string, { target: number; weight: number }> };
      vectors.push({ code: match[2], traits: parsed.traits });
    }
  }

  const headProfileMigration = MIGRATIONS.find((m) => m.name === '0111_breeds_head_profile_ideal.sql');
  expect(headProfileMigration, '0111_breeds_head_profile_ideal.sql not found').toBeDefined();
  const headProfilePattern = /json_set\(ideal_vector,\s*'\$\.traits\.head_profile',\s*json\('(\{[^']*\})'\)\)\s*WHERE code = '([A-Z]+)'/g;
  let headProfileMatch: RegExpExecArray | null;
  while (headProfileMigration && (headProfileMatch = headProfilePattern.exec(headProfileMigration.sql)) !== null) {
    const target = JSON.parse(headProfileMatch[1]) as { target: number; weight: number };
    const vector = vectors.find((v) => v.code === headProfileMatch![2]);
    expect(vector, `${headProfileMatch[2]} has no base ideal_vector to patch head_profile onto`).toBeDefined();
    vector!.traits.head_profile = target;
  }

  it('found all eight breed vectors', () => {
    expect(vectors.map((v) => v.code).sort()).toEqual(['AR', 'FR', 'GW', 'IC', 'NOK', 'PF', 'QH', 'TB']);
  });

  it.each(vectors.map((v) => [v.code, v.traits] as const))('%s names exactly the five conformation trait codes', (code, traits) => {
    expect(Object.keys(traits).sort()).toEqual([...CONFORMATION_TRAITS].sort());
    for (const trait of Object.values(traits)) {
      expect(trait.target, `${code} target`).toBeGreaterThanOrEqual(1);
      expect(trait.target, `${code} target`).toBeLessThanOrEqual(99);
      expect(trait.weight, `${code} weight`).toBeGreaterThan(0);
    }
  });

  // docs/breed-ideal-vectors.md §5: a target sitting on the population centre of 50 would reward
  // inbreeding on that breed's own standard - checked here so a future retune can't reintroduce it
  // silently. (Only checks for an exact 50; §5's exposure-index table is a judgement call, not a
  // hard rule, and stays a document rather than a test.)
  it.each(vectors.map((v) => [v.code, v.traits] as const))('%s has at least one target off the population centre of 50', (code, traits) => {
    expect(Object.values(traits).some((t) => t.target !== 50), `${code} has every target on 50`).toBe(true);
  });
});

// docs/fixes/breed-disease-panels.md, test 5: breed_associations stays display-only (never
// enforced - src/engines/health/panel.ts derives the real panel from the pools), but it must still
// say the truth, or the words under a condition and the panel it actually appears on could disagree
// without anything catching it - the LWO trap (see that document's own "the rule" section) made
// unrepeatable. Reads every conditions seed migration and the final pool migration, both already
// parsed by name above, and cross-checks them directly rather than hand-copying either.
describe('conditions.breed_associations matches the breeds whose pool actually carries the mutant (docs/fixes/breed-disease-panels.md)', () => {
  const conditionMigrationNames = ['0053_seed_conditions.sql', '0117_condition_lethal_white.sql', '0147_seed_breed_conditions.sql'];
  const conditionRowPattern =
    /\('([A-Z0-9]+)',\s*'[^']*',\s*'[^']*',\s*'([A-Z0-9]+)',\s*'(\{[^']*\})',\s*'[^']*',\s*(\d),\s*(\d),\s*'(\[[^\]]*\])'/g;

  interface ParsedCondition {
    code: string;
    locusCode: string;
    trigger: { locus: string; mutant: string };
    breedAssociations: string[];
  }

  const conditions: ParsedCondition[] = [];
  for (const name of conditionMigrationNames) {
    const migration = MIGRATIONS.find((m) => m.name === name);
    expect(migration, `migration ${name} not found`).toBeDefined();
    const pattern = new RegExp(conditionRowPattern.source, conditionRowPattern.flags);
    let match: RegExpExecArray | null;
    while (migration && (match = pattern.exec(migration.sql)) !== null) {
      conditions.push({
        code: match[1],
        locusCode: match[2],
        trigger: JSON.parse(match[3]) as { locus: string; mutant: string },
        breedAssociations: JSON.parse(match[6]) as string[],
      });
    }
  }

  // migrations/0152 corrects PSSM1's breed_associations by UPDATE, after 0146 widened its pool to
  // GW/PF - an UPDATE rather than a re-INSERT (0053 is already applied and forward-only), so it
  // needs its own small merge here rather than falling out of conditionRowPattern.
  const pssm1Override = MIGRATIONS.find((m) => m.name === '0152_pssm1_breed_associations.sql');
  expect(pssm1Override, '0152_pssm1_breed_associations.sql not found').toBeDefined();
  const overrideMatch = pssm1Override && /breed_associations = '(\[[^\]]*\])' WHERE code = 'PSSM1'/.exec(pssm1Override.sql);
  expect(overrideMatch, "0152's UPDATE ... WHERE code = 'PSSM1' not found").toBeTruthy();
  const pssm1 = conditions.find((c) => c.code === 'PSSM1');
  if (pssm1 && overrideMatch) pssm1.breedAssociations = JSON.parse(overrideMatch[1]) as string[];

  const poolMigration = MIGRATIONS.find((m) => m.name === '0146_breed_pools_disease_loci.sql');
  expect(poolMigration, '0146_breed_pools_disease_loci.sql not found').toBeDefined();
  const poolRowPattern = /founding_allele_pool = '(\{[^']*\})' WHERE code = '([A-Z0-9]+)'/g;
  const pools: { code: string; pool: Record<string, Record<string, number>> }[] = [];
  {
    let match: RegExpExecArray | null;
    const pattern = new RegExp(poolRowPattern.source, poolRowPattern.flags);
    while (poolMigration && (match = pattern.exec(poolMigration.sql)) !== null) {
      pools.push({ code: match[2], pool: JSON.parse(match[1]) as Record<string, Record<string, number>> });
    }
  }

  it('found conditions from all three migrations and pools for all eight breeds', () => {
    expect(conditions.length).toBeGreaterThanOrEqual(9); // 4 (0053) + 1 (0117) + 8 (0147, incl. MCOA/DSLD)
    expect(pools.map((p) => p.code).sort()).toEqual(['AR', 'FR', 'GW', 'IC', 'NOK', 'PF', 'QH', 'TB']);
  });

  it.each(conditions.map((c) => [c.code, c] as const))('%s breed_associations names exactly the breeds whose pool carries the mutant at nonzero frequency', (code, condition) => {
    const actual = pools
      .filter((p) => (p.pool[condition.trigger.locus]?.[condition.trigger.mutant] ?? 0) > 0)
      .map((p) => p.code)
      .sort();
    expect(condition.breedAssociations.slice().sort(), `${code} breed_associations`).toEqual(actual);
  });
});
