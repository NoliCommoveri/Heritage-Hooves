/**
 * docs/fixes/breed-disease-panels.md, "Signs take time to show" - tests 6 and 7 from that
 * document's own list. Pure: buildHorseConditionStatements only builds prepared statements, never
 * runs them, so a fake env whose `bind` just records its arguments is enough - no database needed.
 */
import { describe, expect, it } from 'vitest';
import { buildHorseConditionStatements, visibleAffectedConditions, type ConditionRow, type NewHorseConditionsParams } from '../../src/db/health';
import { GENOTYPE_VERSION, type Genotype } from '../../src/engines/genetics/genotype';
import type { Env } from '../../src/types';

function fakeEnv(): Env {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({ sql, args }),
      }),
    },
  } as unknown as Env;
}

function genotypeAffected(locus: string, mutant: string): Genotype {
  return { v: GENOTYPE_VERSION, mendelian: { [locus]: [mutant, mutant] }, polygenic: {} };
}

function condition(overrides: Partial<ConditionRow> = {}): ConditionRow {
  return {
    id: 1,
    code: 'CA',
    name: 'Cerebellar abiotrophy',
    category: 'single_gene',
    locus_code: 'CA',
    trigger: JSON.stringify({ v: 1, locus: 'CA', mutant: 'Ca', mode: 'recessive' }),
    severity_class: 'degenerative',
    signs_visible: 1,
    bars_showing: 1,
    breed_associations: '["AR"]',
    test_cost_key: 'genotype_test_cost',
    enabled: 1,
    teaching_text: '',
    event_text: '',
    sort_order: 1,
    management_text: null,
    signs_delay_min_game_days: 20,
    signs_delay_max_game_days: 60,
    ...overrides,
  };
}

function paramsFor(conditions: ConditionRow[], rngSeed: number, bornGameDay = 1000): NewHorseConditionsParams {
  return {
    genotype: genotypeAffected('CA', 'Ca'),
    bornGameDay,
    lethalFoalDeathGameDays: 30,
    stableId: 1,
    accountId: 1,
    horseName: 'Test Horse',
    conditions,
    rngSeed,
  };
}

// The horse_conditions INSERT binds (condition_code, state, onset_game_day, terminal_game_day,
// last_evaluated_game_day, signs_game_day) in that order - see buildHorseConditionStatements.
function signsGameDayFromStatement(stmt: { args: unknown[] }): number | null {
  return stmt.args[5] as number | null;
}

describe('buildHorseConditionStatements - signs delay', () => {
  it('draws a delay inside [min, max] and adds it to born_game_day', () => {
    const env = fakeEnv();
    const affected = condition({ signs_delay_min_game_days: 20, signs_delay_max_game_days: 60 });
    for (let seed = 1; seed <= 200; seed++) {
      const [stmt] = buildHorseConditionStatements(env, paramsFor([affected], seed)) as unknown as { args: unknown[] }[];
      const signsGameDay = signsGameDayFromStatement(stmt)!;
      const delay = signsGameDay - 1000;
      expect(delay).toBeGreaterThanOrEqual(20);
      expect(delay).toBeLessThanOrEqual(60);
    }
  });

  it('a zero-delay condition (min = max = 0) is due the day the row is written', () => {
    const env = fakeEnv();
    const zeroDelay = condition({ signs_delay_min_game_days: 0, signs_delay_max_game_days: 0 });
    const [stmt] = buildHorseConditionStatements(env, paramsFor([zeroDelay], 42)) as unknown as { args: unknown[] }[];
    expect(signsGameDayFromStatement(stmt)).toBe(1000);
  });

  it('a signs_visible = 0 condition never gets a signs_game_day at all', () => {
    const env = fakeEnv();
    const gbedLike = condition({ code: 'GBED', locus_code: 'GBED', trigger: JSON.stringify({ v: 1, locus: 'GBED', mutant: 'Gb', mode: 'recessive' }), signs_visible: 0 });
    const params = { ...paramsFor([gbedLike], 7), genotype: genotypeAffected('GBED', 'Gb') };
    const [stmt] = buildHorseConditionStatements(fakeEnv(), params) as unknown as { args: unknown[] }[];
    expect(signsGameDayFromStatement(stmt)).toBeNull();
    void gbedLike;
    void env;
  });

  it('the same rng_seed and the same condition produce the same signs_game_day twice - reproducible, never Math.random()', () => {
    const affected = condition({ signs_delay_min_game_days: 100, signs_delay_max_game_days: 250 });
    const [stmtA] = buildHorseConditionStatements(fakeEnv(), paramsFor([affected], 555)) as unknown as { args: unknown[] }[];
    const [stmtB] = buildHorseConditionStatements(fakeEnv(), paramsFor([affected], 555)) as unknown as { args: unknown[] }[];
    expect(signsGameDayFromStatement(stmtA)).toBe(signsGameDayFromStatement(stmtB));
  });

  it('two different seeds are not guaranteed (and, over enough draws, are not) the same delay', () => {
    const affected = condition({ signs_delay_min_game_days: 100, signs_delay_max_game_days: 250 });
    const delays = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const [stmt] = buildHorseConditionStatements(fakeEnv(), paramsFor([affected], seed)) as unknown as { args: unknown[] }[];
      delays.add(signsGameDayFromStatement(stmt)!);
    }
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('visibleAffectedConditions - signs due gating', () => {
  const genotype = genotypeAffected('CA', 'Ca');
  const affected = condition({ signs_delay_min_game_days: 20, signs_delay_max_game_days: 60 });

  it('invisible on the day the horse is created, before the delay elapses', () => {
    const signsByCode = new Map([['CA', 1030]]); // horse was written on game day 1000, signs due 1030
    expect(visibleAffectedConditions(genotype, [affected], signsByCode, 1000)).toEqual([]);
  });

  it('visible once the stored signs_game_day is reached', () => {
    const signsByCode = new Map([['CA', 1030]]);
    const visible = visibleAffectedConditions(genotype, [affected], signsByCode, 1030);
    expect(visible.map((c) => c.code)).toEqual(['CA']);
  });

  it('a missing entry (a horse_conditions row written before this column existed) is treated as already due', () => {
    const visible = visibleAffectedConditions(genotype, [affected], new Map(), 1000);
    expect(visible.map((c) => c.code)).toEqual(['CA']);
  });

  it('an explicit null signs_game_day is also treated as already due', () => {
    const signsByCode = new Map<string, number | null>([['CA', null]]);
    const visible = visibleAffectedConditions(genotype, [affected], signsByCode, 1000);
    expect(visible.map((c) => c.code)).toEqual(['CA']);
  });

  it('a zero-delay condition (min = max = 0) is visible immediately', () => {
    const zeroDelay = condition({ code: 'DWARF', locus_code: 'DWARF', trigger: JSON.stringify({ v: 1, locus: 'DWARF', mutant: 'Dw', mode: 'recessive' }), signs_delay_min_game_days: 0, signs_delay_max_game_days: 0 });
    const dwarfGenotype = genotypeAffected('DWARF', 'Dw');
    const signsByCode = new Map([['DWARF', 1000]]);
    const visible = visibleAffectedConditions(dwarfGenotype, [zeroDelay], signsByCode, 1000);
    expect(visible.map((c) => c.code)).toEqual(['DWARF']);
  });
});
