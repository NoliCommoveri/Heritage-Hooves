import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { parseAllelePool } from '../../src/engines/founding/pool';
import { generateCandidate } from '../../src/engines/founding/generate';
import { TRAITS, type TraitCode } from '../../src/engines/genetics/polygenic';
import { ROBUSTNESS_TRAITS, CONFORMATION_TRAITS } from '../../src/engines/conformation/traits';
import { parseIdealVector, type IdealVector } from '../../src/engines/showing/score';

/**
 * Pulls one breed's founding_allele_pool JSON straight out of migration SQL, so these tests
 * exercise the pool this codebase actually ships rather than a hand-copied duplicate that could
 * quietly drift from it. Reads 0146_breed_pools_disease_loci.sql, not 0051/0014/0024/0114 - that
 * migration (docs/fixes/breed-disease-panels.md) rewrites every breed's whole pool to add the seven
 * new disease loci, so it is the final, authoritative state, the same way a later UPDATE always
 * supersedes the INSERT it followed.
 */
function poolJsonForBreed(code: string): string {
  const migrationName = '0146_breed_pools_disease_loci.sql';
  const migration = MIGRATIONS.find((m) => m.name === migrationName);
  if (!migration) throw new Error(`migration ${migrationName} not found`);
  const pattern = new RegExp(`founding_allele_pool = '(\\{[^']*\\})' WHERE code = '${code}'`);
  const match = migration.sql.match(pattern);
  if (!match) throw new Error(`pool not found for breed ${code} in ${migrationName}`);
  return match[1];
}

const QH_POOL = parseAllelePool(poolJsonForBreed('QH'));
const FR_POOL = parseAllelePool(poolJsonForBreed('FR'));

/** Slice 0019: the Quarter Horse's real ideal_vector, pulled from its own migration the same way
 * poolJsonForBreed pulls a pool - exercises the vector this codebase actually ships. The base four
 * traits come from 0035; head_profile is patched in separately via json_set in 0111 (slice 0021
 * §3.3), so it's merged in here the same way test/genetics/consistency.test.ts merges it. */
function qhIdealVector(): IdealVector {
  const migrationName = '0035_seed_qh_ideal_vector.sql';
  const migration = MIGRATIONS.find((m) => m.name === migrationName);
  if (!migration) throw new Error(`migration ${migrationName} not found`);
  const match = migration.sql.match(/ideal_vector = '(\{[^']*\})'/);
  if (!match) throw new Error(`ideal_vector not found in ${migrationName}`);
  const ideal = parseIdealVector(match[1]);

  const headProfileMigrationName = '0111_breeds_head_profile_ideal.sql';
  const headProfileMigration = MIGRATIONS.find((m) => m.name === headProfileMigrationName);
  if (!headProfileMigration) throw new Error(`migration ${headProfileMigrationName} not found`);
  const headProfileMatch = headProfileMigration.sql.match(
    /json_set\(ideal_vector,\s*'\$\.traits\.head_profile',\s*json\('(\{[^']*\})'\)\)\s*WHERE code = 'QH'/
  );
  if (!headProfileMatch) throw new Error(`QH head_profile patch not found in ${headProfileMigrationName}`);
  ideal.head_profile = JSON.parse(headProfileMatch[1]) as { target: number; weight: number };

  return ideal;
}
const QH_IDEAL = qhIdealVector();

/** Slice 0019 §4.2: the real ability_weights this codebase ships for Barrel Racing, filtered the
 * same way getSpecializableAbilityTraits does (src/db/disciplines.ts) - a nonzero weight, not a
 * "meaningful" one, so stamina (0.2) is in and only jump_scope (0.0) is out. Kept in ABILITY_TRAITS'
 * own order like the real helper, not migration JSON order. */
const BARRELS_ABILITY_WEIGHTS: Record<string, number> = { speed: 1.4, stamina: 0.2, jump_scope: 0, trainability: 0.8, agility: 1.5 };
const BARRELS_ELIGIBLE_ABILITY_TRAITS: TraitCode[] = (['stamina', 'jump_scope', 'speed', 'trainability', 'agility'] as TraitCode[]).filter(
  (t) => (BARRELS_ABILITY_WEIGHTS[t] ?? 0) > 0
);

/** Slice 0014 §6.3's golden bit strings for seed 777777, QH_POOL, polygenicOneChance 0.5,
 * robustnessOneChance 0.5 - captured once, unrecoverable after the fact (see the describe block
 * below that first asserted them). Shared with slice 0019's own regression tests, which need the
 * same fixed point to prove a specialist overwrite disturbs no other trait's draw. */
const GOLDEN_BITS_777777: Record<string, string> = {
  neck_length: '10111001100000000010',
  shoulder_angle: '10011100001110001111',
  back_length: '10100011101000111000',
  hock_set: '11101001000001101100',
  stamina: '11010110010101010001',
  jump_scope: '10010110001101000101',
  speed: '00110100100110110101',
  trainability: '11111101101101000100',
  fertility: '10001111111011001101',
  agility: '01000010000001011100',
};

describe('generateCandidate - Hardy-Weinberg', () => {
  it('two independent draws at population frequency produce Hardy-Weinberg proportions', () => {
    // QH's E locus: E .55 / e .45 -> EE ~30%, Ee ~50%, ee ~20%.
    let ee = 0;
    let ee2 = 0; // heterozygous count
    let eeHomRecessive = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
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
      const { genotype } = generateCandidate({ pool: FR_POOL, polygenicOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
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
        robustnessOneChance: 0.5,
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
      const { genotype } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.42, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: 5_000_000 + i });
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
    const a = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: 424242 });
    const b = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: 424242 });
    expect(a).toEqual(b);
  });

  it('age lands within the requested range', () => {
    for (let i = 0; i < 200; i++) {
      const { ageGameDays } = generateCandidate({ pool: QH_POOL, polygenicOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1440, ageMaxGameDays: 2880, seed: i });
      expect(ageGameDays).toBeGreaterThanOrEqual(1440);
      expect(ageGameDays).toBeLessThanOrEqual(2880);
    }
  });
});

// Slice 0014 §2.8/§10 test 10: a raised quality band must not also make founding stock sounder -
// robustness draws at the fixed robustness_one_chance regardless of what polygenicOneChance is set
// to, so the two axes (show quality vs soundness) are genuinely independent.
describe('generateCandidate - robustness ignores the quality band (slice 0014 §2.8)', () => {
  it('robustness traits stay near 10/20 at a high polygenicOneChance while conformation rides the band up', () => {
    const n = 2000;
    let robustnessTotal = 0;
    let robustnessCount = 0;
    let conformationTotal = 0;
    let conformationCount = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({
        pool: QH_POOL,
        polygenicOneChance: 0.9,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed: 6_000_000 + i,
      });
      for (const trait of ROBUSTNESS_TRAITS) {
        robustnessTotal += [...genotype.polygenic[trait]].filter((c) => c === '1').length;
        robustnessCount++;
      }
      for (const trait of CONFORMATION_TRAITS) {
        conformationTotal += [...genotype.polygenic[trait]].filter((c) => c === '1').length;
        conformationCount++;
      }
    }
    const robustnessMean = robustnessTotal / robustnessCount;
    const conformationMean = conformationTotal / conformationCount;
    expect(robustnessMean).toBeGreaterThan(9);
    expect(robustnessMean).toBeLessThan(11);
    expect(conformationMean).toBeGreaterThan(17);
  });
});

// Slice 0014 §6.3/§10 test 11: TRAITS is append-only precisely so appending never perturbs an
// earlier trait's draw sequence. These strings were captured from generateCandidate at the moment
// foot_robustness/joint_robustness/ligament_robustness were appended (seed 777777, the QH pool,
// polygenicOneChance 0.5) - they cannot be recovered after the fact, so this is the one test that
// proves §6.3's reproducibility claim rather than asserting it in a comment.
describe('generateCandidate - appending robustness traits changed no earlier draw (slice 0014 §6.3)', () => {
  it("a fixed seed's earlier trait bit strings are unchanged by the traits appended after them", () => {
    const { genotype } = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1440,
      ageMaxGameDays: 2880,
      seed: 777777,
    });
    for (const [trait, bits] of Object.entries(GOLDEN_BITS_777777)) {
      expect(genotype.polygenic[trait], trait).toBe(bits);
    }
    // Sanity: the fixed strings above must actually be 20 characters (TRAIT_STRING_LENGTH) - a
    // typo here would otherwise pass by accident if the real value happened to start the same way.
    for (const trait of TRAITS.slice(0, 10)) {
      expect(genotype.polygenic[trait]?.length).toBe(20);
    }
  });
});

// Slice 0019 §10: the regression test that catches §7's failure mode directly - a specialist
// overwrite must never perturb the pool_polygenic loop's draws for any OTHER trait. Reuses seed
// 777777's own golden bit strings (slice 0014 §6.3) as the fixed point: whichever trait Part A/B
// pick, every trait that is NOT the chosen specialist must still read exactly the golden bits.
describe('generateCandidate - specialists do not move any other trait (slice 0019 §7/§10)', () => {
  it('every non-specialist trait keeps its golden bits with both Part A and Part B active', () => {
    const { genotype, specialistTraits } = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1440,
      ageMaxGameDays: 2880,
      seed: 777777,
      breedIdealVector: QH_IDEAL,
      eligibleAbilityTraits: BARRELS_ELIGIBLE_ABILITY_TRAITS,
      abilitySpecialistPotential: 15,
    });
    expect(specialistTraits.conformation).not.toBeNull();
    expect(specialistTraits.ability).not.toBeNull();
    for (const [trait, bits] of Object.entries(GOLDEN_BITS_777777)) {
      if (trait === specialistTraits.conformation || trait === specialistTraits.ability) continue;
      expect(genotype.polygenic[trait], trait).toBe(bits);
    }
  });

  it('a candidate with neither breedIdealVector nor eligibleAbilityTraits reproduces the golden bits exactly, unchanged', () => {
    const { genotype, specialistTraits } = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1440,
      ageMaxGameDays: 2880,
      seed: 777777,
    });
    expect(specialistTraits).toEqual({ conformation: null, ability: null });
    for (const [trait, bits] of Object.entries(GOLDEN_BITS_777777)) {
      expect(genotype.polygenic[trait], trait).toBe(bits);
    }
  });
});

describe('generateCandidate - Part A conformation specialist (slice 0019 §3)', () => {
  it('is deterministic: same seed picks the same trait and the same bits', () => {
    const params = {
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 42,
      breedIdealVector: QH_IDEAL,
    };
    const a = generateCandidate(params);
    const b = generateCandidate(params);
    expect(a).toEqual(b);
    expect(a.specialistTraits.conformation).not.toBeNull();
  });

  it('lands the specialist trait\'s potential within 1 allele of target/5, for every trait in the ideal vector', () => {
    for (const trait of CONFORMATION_TRAITS) {
      let picked = 0;
      for (let seed = 0; seed < 4000 && picked < 20; seed++) {
        const { genotype, specialistTraits } = generateCandidate({
          pool: QH_POOL,
          polygenicOneChance: 0.5,
          robustnessOneChance: 0.5,
          ageMinGameDays: 1000,
          ageMaxGameDays: 1000,
          seed,
          breedIdealVector: QH_IDEAL,
        });
        if (specialistTraits.conformation !== trait) continue;
        picked++;
        const target = QH_IDEAL[trait]!.target;
        const expectedPotential = Math.round(target / 5);
        const actualPotential = [...genotype.polygenic[trait]].filter((c) => c === '1').length;
        expect(Math.abs(actualPotential - expectedPotential), trait).toBeLessThanOrEqual(1);
      }
      expect(picked, `expected to see ${trait} chosen at least once across 4000 seeds`).toBeGreaterThan(0);
    }
  });

  it('no ideal vector (seven of the eight breeds today) skips Part A entirely - the common path, not an edge case', () => {
    const withNull = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 999,
      breedIdealVector: null,
    });
    const withUndefined = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 999,
    });
    expect(withNull.specialistTraits.conformation).toBeNull();
    expect(withNull).toEqual(withUndefined);
  });
});

describe('generateCandidate - Part B ability specialist (slice 0019 §4)', () => {
  it('is deterministic: same seed picks the same trait and the same bits', () => {
    const params = {
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 42,
      eligibleAbilityTraits: BARRELS_ELIGIBLE_ABILITY_TRAITS,
      abilitySpecialistPotential: 15,
    };
    const a = generateCandidate(params);
    const b = generateCandidate(params);
    expect(a).toEqual(b);
    expect(a.specialistTraits.ability).not.toBeNull();
  });

  it("lands the specialist trait's potential within 1 allele of the configured target", () => {
    for (let seed = 0; seed < 500; seed++) {
      const { genotype, specialistTraits } = generateCandidate({
        pool: QH_POOL,
        polygenicOneChance: 0.5,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed,
        eligibleAbilityTraits: BARRELS_ELIGIBLE_ABILITY_TRAITS,
        abilitySpecialistPotential: 15,
      });
      const trait = specialistTraits.ability!;
      const actualPotential = [...genotype.polygenic[trait]].filter((c) => c === '1').length;
      expect(Math.abs(actualPotential - 15), trait).toBeLessThanOrEqual(1);
    }
  });

  it('an empty eligible list (no enabled discipline weights any ability trait) skips Part B entirely', () => {
    const withEmpty = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 999,
      eligibleAbilityTraits: [],
      abilitySpecialistPotential: 15,
    });
    const withUndefined = generateCandidate({
      pool: QH_POOL,
      polygenicOneChance: 0.5,
      robustnessOneChance: 0.5,
      ageMinGameDays: 1000,
      ageMaxGameDays: 1000,
      seed: 999,
    });
    expect(withEmpty.specialistTraits.ability).toBeNull();
    expect(withEmpty).toEqual(withUndefined);
  });

  it('jump_scope is never chosen while Barrel Racing is the only enabled discipline - it never even appears in the eligible list', () => {
    expect(BARRELS_ELIGIBLE_ABILITY_TRAITS).not.toContain('jump_scope');
    expect(BARRELS_ELIGIBLE_ABILITY_TRAITS.sort()).toEqual(['agility', 'speed', 'stamina', 'trainability'].sort());
    for (let seed = 0; seed < 500; seed++) {
      const { specialistTraits } = generateCandidate({
        pool: QH_POOL,
        polygenicOneChance: 0.5,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed,
        eligibleAbilityTraits: BARRELS_ELIGIBLE_ABILITY_TRAITS,
        abilitySpecialistPotential: 15,
      });
      expect(specialistTraits.ability).not.toBe('jump_scope');
    }
  });

  it('throws if eligibleAbilityTraits is non-empty but abilitySpecialistPotential is not supplied', () => {
    expect(() =>
      generateCandidate({
        pool: QH_POOL,
        polygenicOneChance: 0.5,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed: 1,
        eligibleAbilityTraits: BARRELS_ELIGIBLE_ABILITY_TRAITS,
      })
    ).toThrow();
  });
});
