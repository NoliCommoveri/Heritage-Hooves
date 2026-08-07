import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/db/migrations';
import { parseAllelePool } from '../../src/engines/founding/pool';
import { generateCandidate, type LethalTrigger } from '../../src/engines/founding/generate';

/** Same helper as test/founding/generate.test.ts - reads the final, post-0146 pool state rather
 * than the pre-disease-panel pools in 0014/0024/0051/0114. */
function poolJsonForBreed(code: string): string {
  const migration = MIGRATIONS.find((m) => m.name === '0146_breed_pools_disease_loci.sql');
  if (!migration) throw new Error('migration 0146_breed_pools_disease_loci.sql not found');
  const match = migration.sql.match(new RegExp(`founding_allele_pool = '(\\{[^']*\\})' WHERE code = '${code}'`));
  if (!match) throw new Error(`pool not found for breed ${code}`);
  return match[1];
}

const QH_POOL = parseAllelePool(poolJsonForBreed('QH'));
const OTHER_BREEDS = ['AR', 'TB', 'PF', 'IC', 'GW', 'FR', 'NOK'];

// Slice 0010 §4.3: only GBED is severity_class = 'lethal' among the four conditions this slice
// seeds - HERDA is degenerative (it bars showing, it does not kill). Matches conditions.code /
// conditions.trigger in migrations/0053_seed_conditions.sql.
const LETHAL_TRIGGERS: LethalTrigger[] = [{ locus: 'GBED', mutant: 'Gb' }];

describe('generateCandidate - Quarter Horse disease loci vs Hardy-Weinberg', () => {
  it('HYPP carrier/affected frequencies land close to Hardy-Weinberg for a 0.02 mutant frequency', () => {
    // p = 0.02 -> NN ~96.04%, NH ~3.92%, HH ~0.04%.
    const n = 20000;
    let nn = 0;
    let nh = 0;
    let hh = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: 9_000_000 + i });
      const [a, b] = genotype.mendelian.HYPP;
      if (a === 'N' && b === 'N') nn++;
      else if (a === 'H' && b === 'H') hh++;
      else nh++;
    }
    expect(nn / n).toBeCloseTo(0.9604, 1);
    expect(nh / n).toBeCloseTo(0.0392, 1);
    expect(hh / n).toBeCloseTo(0.0004, 2);
  });

  it('HERDA carrier frequency lands close to Hardy-Weinberg for a 0.06 mutant frequency (~11% carriers)', () => {
    const n = 20000;
    let carriers = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: 10_000_000 + i });
      const [a, b] = genotype.mendelian.HERDA;
      if (a !== b) carriers++;
    }
    expect(carriers / n).toBeCloseTo(2 * 0.06 * 0.94, 1);
  });
});

describe('generateCandidate - the lethal clamp (slice 0010 §4.3)', () => {
  it('no candidate is ever generated homozygous-affected for a lethal condition, over a large number of draws', () => {
    const n = 20000;
    let carriers = 0;
    for (let i = 0; i < n; i++) {
      const { genotype } = generateCandidate({
        pool: QH_POOL,
        abilityOneChance: 0.5, robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 1000,
        seed: 11_000_000 + i,
        lethalTriggers: LETHAL_TRIGGERS,
      });
      const [a, b] = genotype.mendelian.GBED;
      expect(a === 'Gb' && b === 'Gb').toBe(false);
      if (a !== b) carriers++;
    }
    // Sanity check the clamp is actually doing something observable, not merely never firing
    // because GBED's frequency is too low to ever draw homozygous in the first place: 0.05 mutant
    // frequency means ~0.25% of draws would have been homozygous-affected without the clamp, and
    // the clamp turns each of those into an extra carrier.
    expect(carriers / n).toBeGreaterThan(2 * 0.05 * 0.95);
  });

  it('without the clamp (no lethalTriggers passed), the same seeds do occasionally draw homozygous-affected', () => {
    let sawHomozygousAffected = false;
    for (let i = 0; i < 20000; i++) {
      const { genotype } = generateCandidate({ pool: QH_POOL, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: 11_000_000 + i });
      const [a, b] = genotype.mendelian.GBED;
      if (a === 'Gb' && b === 'Gb') {
        sawHomozygousAffected = true;
        break;
      }
    }
    expect(sawHomozygousAffected).toBe(true);
  });
});

describe('generateCandidate - the other seven pools never carry the original QH-only disease mutants', () => {
  it.each(OTHER_BREEDS)('%s never produces a mutant allele at HYPP, HERDA or GBED', (code) => {
    const pool = parseAllelePool(poolJsonForBreed(code));
    for (let i = 0; i < 500; i++) {
      const { genotype } = generateCandidate({ pool, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
      for (const locus of ['HYPP', 'HERDA', 'GBED']) {
        expect(genotype.mendelian[locus]).toEqual(['N', 'N']);
      }
    }
  });
});

// docs/fixes/breed-disease-panels.md: PSSM1 is deliberately widened to German Warmblood and Paso
// Fino (real biology, not a Quarter Horse exclusive), so those two are carved out of the blanket
// "never carries PSSM1" claim above and asserted the other way instead.
describe('generateCandidate - PSSM1 widened to German Warmblood and Paso Fino', () => {
  it.each(['AR', 'TB', 'IC', 'FR', 'NOK'])('%s never produces a mutant allele at PSSM1', (code) => {
    const pool = parseAllelePool(poolJsonForBreed(code));
    for (let i = 0; i < 500; i++) {
      const { genotype } = generateCandidate({ pool, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
      expect(genotype.mendelian.PSSM1).toEqual(['N', 'N']);
    }
  });

  it.each(['GW', 'PF'])('%s does occasionally produce a PSSM1 carrier, over enough draws', (code) => {
    const pool = parseAllelePool(poolJsonForBreed(code));
    let sawCarrier = false;
    for (let i = 0; i < 2000; i++) {
      const { genotype } = generateCandidate({ pool, abilityOneChance: 0.5, robustnessOneChance: 0.5, ageMinGameDays: 1000, ageMaxGameDays: 1000, seed: i });
      const [a, b] = genotype.mendelian.PSSM1;
      if (a !== b) {
        sawCarrier = true;
        break;
      }
    }
    expect(sawCarrier).toBe(true);
  });
});
