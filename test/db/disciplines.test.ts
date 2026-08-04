// Slice 0019 §4.2/§10: getSpecializableAbilityTraits reads getEnabledDisciplines directly, so a
// minimal fake Env (just the one .prepare(...).all() chain the real function calls) is enough -
// no need for the full sqlite-backed D1 harness the market/consignment D1 tests use.
//
// disciplines.ts caches its rows in module scope (60s TTL, no cross-isolate invalidation - see
// that file's own header comment). Each test below resets the module registry and re-imports
// fresh, so one test's fake rows can never leak into the next through that cache.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisciplineRow } from '../../src/db/disciplines';
import type { Env } from '../../src/types';

function fakeEnv(rows: Partial<DisciplineRow>[]): Env {
  return {
    DB: {
      prepare: () => ({
        all: async () => ({ results: rows }),
      }),
    },
  } as unknown as Env;
}

const BARRELS_ONLY: Partial<DisciplineRow>[] = [
  {
    id: 1,
    code: 'barrels',
    name: 'Barrel Racing',
    // Real JSON this codebase ships (migration 0063): jump_scope is the only zero weight.
    ability_weights: '{"v":1,"traits":{"speed":1.4,"stamina":0.2,"jump_scope":0,"trainability":0.8,"agility":1.5}}',
    enabled: 1,
    sort_order: 1,
  },
];

beforeEach(() => {
  vi.resetModules();
});

describe('getSpecializableAbilityTraits (slice 0019 §4.2)', () => {
  it('with only Barrel Racing enabled, excludes jump_scope (weight 0) and includes every nonzero-weighted trait', async () => {
    const { getSpecializableAbilityTraits } = await import('../../src/db/disciplines');
    const traits = await getSpecializableAbilityTraits(fakeEnv(BARRELS_ONLY));
    // ABILITY_TRAITS' own order: stamina, jump_scope, speed, trainability, agility.
    expect(traits).toEqual(['stamina', 'speed', 'trainability', 'agility']);
    expect(traits).not.toContain('jump_scope');
  });

  it('a disabled discipline is not consulted at all - no enabled discipline means an empty list', async () => {
    const { getSpecializableAbilityTraits } = await import('../../src/db/disciplines');
    const disabled = BARRELS_ONLY.map((d) => ({ ...d, enabled: 0 }));
    const traits = await getSpecializableAbilityTraits(fakeEnv(disabled));
    expect(traits).toEqual([]);
  });
});
