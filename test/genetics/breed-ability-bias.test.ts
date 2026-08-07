/**
 * breeds.ability_bias (migrations 0141/0142): the first thing in the game that makes a breed born
 * better at one ability than another. Before it, ability was completely breed-blind - a German
 * Warmblood's speed alleles were drawn from the identical distribution as a Quarter Horse's, which
 * is why Warmbloods were beating Quarter Horses in barrel classes.
 *
 * The seeded numbers are read out of the migration file itself, not hand-copied here, for the same
 * reason test/router-paths.test.ts reads src/router.ts: a retune that breaks the zero-sum rule
 * should fail in this file, named, rather than quietly making one breed globally better than the
 * other seven.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAbilityBias, biasedOneChance, ABILITY_BIAS_CHANCE_MIN, ABILITY_BIAS_CHANCE_MAX } from '../../src/engines/breeds/identity';
import { generateCandidate } from '../../src/engines/founding/generate';
import { potential, TRAITS } from '../../src/engines/genetics/polygenic';
import { ABILITY_TRAITS, CONFORMATION_TRAITS, ROBUSTNESS_TRAITS } from '../../src/engines/conformation/traits';
import type { AllelePool } from '../../src/engines/founding/pool';
import { LOCI } from '../../src/engines/genetics/loci';

const SEED_SQL = fs.readFileSync(path.join(process.cwd(), 'migrations', '0142_seed_breed_ability_bias.sql'), 'utf8');

/** Every `SET ability_bias = '<json>' ... WHERE code = '<code>'` pair in the migration. */
function seededBiases(): { code: string; json: string }[] {
  const out: { code: string; json: string }[] = [];
  const re = /SET ability_bias = '([^']+)'\s*\nWHERE code = '([A-Z]+)';/g;
  let match;
  while ((match = re.exec(SEED_SQL)) !== null) out.push({ code: match[2], json: match[1] });
  return out;
}

/** A minimal pool covering every locus generateCandidate walks, at fixed frequencies - this file is
 * about the polygenic draw only, so the Mendelian side just needs to not throw. */
function flatPool(): AllelePool {
  const pool: AllelePool = {};
  for (const locus of LOCI) {
    const share = 1 / locus.alleles.length;
    pool[locus.code] = Object.fromEntries(locus.alleles.map((a) => [a, share]));
  }
  return pool;
}

const POOL = flatPool();

function generate(seed: number, bias: Record<string, number> | null) {
  return generateCandidate({
    pool: POOL,
    abilityOneChance: 0.5,
    robustnessOneChance: 0.5,
    ageMinGameDays: 1000,
    ageMaxGameDays: 2000,
    seed,
    abilityBias: bias === null ? undefined : parseAbilityBias(JSON.stringify({ v: 1, traits: bias })),
  });
}

describe('the seeded ability biases', () => {
  it('covers all eight breeds', () => {
    expect(seededBiases().map((b) => b.code).sort()).toEqual(['AR', 'FR', 'GW', 'IC', 'NOK', 'PF', 'QH', 'TB']);
  });

  it('sums to zero for every breed - the constraint that makes a breed different rather than better', () => {
    for (const { code, json } of seededBiases()) {
      const bias = parseAbilityBias(json);
      const sum = ABILITY_TRAITS.reduce((acc, trait) => acc + (bias[trait] ?? 0), 0);
      // Floating point: 0.06 - 0.06 + 0.05 + 0.01 does not land exactly on 0.
      expect(Math.abs(sum), `${code} ability_bias sums to ${String(sum)}, not 0`).toBeLessThan(1e-9);
    }
  });

  it('names every ability trait for every breed, so no leaning is left implicit', () => {
    for (const { code, json } of seededBiases()) {
      const bias = parseAbilityBias(json);
      for (const trait of ABILITY_TRAITS) {
        expect(bias[trait], `${code} is missing ${trait}`).toBeTypeOf('number');
      }
    }
  });

  it('keeps every offset within +/-0.06', () => {
    for (const { code, json } of seededBiases()) {
      const bias = parseAbilityBias(json);
      for (const trait of ABILITY_TRAITS) {
        expect(Math.abs(bias[trait] ?? 0), `${code}.${trait} exceeds 0.06`).toBeLessThanOrEqual(0.06 + 1e-9);
      }
    }
  });

  it('puts the Quarter Horse ahead of the German Warmblood on both barrel traits', () => {
    const byCode = new Map(seededBiases().map((b) => [b.code, parseAbilityBias(b.json)]));
    const qh = byCode.get('QH')!;
    const gw = byCode.get('GW')!;
    // Barrel Racing's two dominant weights (migration 0063): speed 1.4, agility 1.5.
    expect(qh.speed!).toBeGreaterThan(gw.speed!);
    expect(qh.agility!).toBeGreaterThan(gw.agility!);
    // ...and the reverse where the Warmblood is actually meant to win.
    expect(gw.jump_scope!).toBeGreaterThan(qh.jump_scope!);
    expect(gw.trainability!).toBeGreaterThan(qh.trainability!);
  });
});

describe('parseAbilityBias', () => {
  it('reads null as no leaning at all', () => {
    expect(parseAbilityBias(null)).toEqual({});
  });

  it('drops conformation and robustness keys rather than honouring them', () => {
    const bias = parseAbilityBias(JSON.stringify({ v: 1, traits: { speed: 0.06, neck_length: 0.2, foot_robustness: 0.3 } }));
    expect(bias.speed).toBe(0.06);
    expect(bias.neck_length).toBeUndefined();
    expect(bias.foot_robustness).toBeUndefined();
  });
});

describe('biasedOneChance', () => {
  it('returns the base untouched for a trait with no offset', () => {
    expect(biasedOneChance(0.5, {}, 'speed')).toBe(0.5);
    expect(biasedOneChance(0.5, { speed: 0.06 }, 'neck_length')).toBe(0.5);
  });

  it('clamps rather than letting a retune collapse a trait to no variation', () => {
    expect(biasedOneChance(0.5, { speed: 5 }, 'speed')).toBe(ABILITY_BIAS_CHANCE_MAX);
    expect(biasedOneChance(0.5, { speed: -5 }, 'speed')).toBe(ABILITY_BIAS_CHANCE_MIN);
  });
});

describe('generateCandidate with an ability bias', () => {
  it('is a no-op when omitted - every trait draws exactly as it did before 0141', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const without = generate(seed, null);
      const empty = generate(seed, {});
      for (const trait of TRAITS) {
        expect(empty.genotype.polygenic[trait]).toBe(without.genotype.polygenic[trait]);
      }
    }
  });

  it('raises the expected potential of a biased trait and lowers its mirror', () => {
    // 600 horses is enough to separate a 1.2-potential shift from sampling noise without making the
    // test slow. Speed +0.06 predicts 20 x 0.56 = 11.2 against an unbiased 10.0.
    const N = 600;
    let biasedSpeed = 0;
    let plainSpeed = 0;
    let biasedStamina = 0;
    let plainStamina = 0;
    for (let seed = 1; seed <= N; seed++) {
      const biased = generate(seed, { speed: 0.06, stamina: -0.06, jump_scope: 0, trainability: 0, agility: 0 });
      const plain = generate(seed, null);
      biasedSpeed += potential(biased.genotype, 'speed');
      plainSpeed += potential(plain.genotype, 'speed');
      biasedStamina += potential(biased.genotype, 'stamina');
      plainStamina += potential(plain.genotype, 'stamina');
    }
    expect(biasedSpeed / N).toBeGreaterThan(plainSpeed / N + 0.6);
    expect(biasedStamina / N).toBeLessThan(plainStamina / N - 0.6);
  });

  it('leaves conformation and robustness traits alone', () => {
    // A bias JSON naming them is already filtered by parseAbilityBias; this asserts the generator
    // itself produces byte-identical strings for those traits, which is what actually matters.
    for (let seed = 1; seed <= 40; seed++) {
      const biased = generate(seed, { speed: 0.06, stamina: -0.06, jump_scope: 0, trainability: 0, agility: 0 });
      const plain = generate(seed, null);
      for (const trait of [...CONFORMATION_TRAITS, ...ROBUSTNESS_TRAITS, 'fertility' as const]) {
        expect(biased.genotype.polygenic[trait], `${trait} moved under an ability bias`).toBe(plain.genotype.polygenic[trait]);
      }
    }
  });

  it('does not shift any downstream RNG stream - age and both specialist picks are unchanged', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const biased = generate(seed, { speed: 0.06, stamina: -0.06, jump_scope: 0, trainability: 0, agility: 0 });
      const plain = generate(seed, null);
      expect(biased.ageGameDays).toBe(plain.ageGameDays);
      expect(biased.specialistTraits).toEqual(plain.specialistTraits);
    }
  });

  it('leaves a specialist trait at its own potential regardless of the breed leaning', () => {
    // This is what keeps an off-breed specialist competitive: a Warmblood singled out for speed gets
    // the full specialist potential, not the specialist potential minus its breed's penalty.
    const heavyPenalty = { speed: -0.06, stamina: 0, jump_scope: 0, trainability: 0, agility: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const withBias = generateCandidate({
        pool: POOL,
        abilityOneChance: 0.5,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 2000,
        seed,
        eligibleAbilityTraits: ['speed'],
        abilitySpecialistPotential: 15,
        abilityBias: parseAbilityBias(JSON.stringify({ v: 1, traits: heavyPenalty })),
      });
      const withoutBias = generateCandidate({
        pool: POOL,
        abilityOneChance: 0.5,
        robustnessOneChance: 0.5,
        ageMinGameDays: 1000,
        ageMaxGameDays: 2000,
        seed,
        eligibleAbilityTraits: ['speed'],
        abilitySpecialistPotential: 15,
      });
      expect(withBias.specialistTraits.ability).toBe('speed');
      expect(potential(withBias.genotype, 'speed')).toBe(potential(withoutBias.genotype, 'speed'));
    }
  });

  it('is deterministic - the same seed and bias produce the same horse', () => {
    const bias = { speed: 0.06, stamina: -0.06, jump_scope: -0.06, trainability: 0, agility: 0.06 };
    for (let seed = 1; seed <= 20; seed++) {
      expect(generate(seed, bias).genotype).toEqual(generate(seed, bias).genotype);
    }
  });
});
