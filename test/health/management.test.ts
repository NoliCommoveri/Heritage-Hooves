import { describe, expect, it } from 'vitest';
import { conditionDelta, type ManageableConditionState } from '../../src/engines/health/management';
import { manageableConditionStates, type ManageableHorseConditionRow, type ConditionRow } from '../../src/db/health';
import { careModifier } from '../../src/engines/care/modifier';
import { GENOTYPE_VERSION, type Genotype } from '../../src/engines/genetics/genotype';

const UNMANAGED_PENALTY = -0.03;

function genotypeWith(locus: string, a: string, b: string): Genotype {
  return { v: GENOTYPE_VERSION, mendelian: { [locus]: [a, b] }, polygenic: {} };
}

function fabricatedCondition(overrides: Partial<ConditionRow> = {}): ConditionRow {
  return {
    id: 999,
    code: 'FAKE',
    name: 'Fabricated condition',
    category: 'single_gene',
    locus_code: 'HYPP',
    trigger: JSON.stringify({ v: 1, locus: 'HYPP', mutant: 'H', mode: 'dominant' }),
    severity_class: 'manageable',
    // §5.1's trap: HYPP and PSSM1 both have signs_visible = 1 in the real seed, so the boundary
    // never fires in play. This fixture sets it to 0 on purpose - the one case the screens can't
    // catch.
    signs_visible: 0,
    bars_showing: 0,
    breed_associations: '[]',
    test_cost_key: null,
    enabled: 1,
    teaching_text: '',
    event_text: '',
    sort_order: 1,
    management_text: 'Do the thing.',
    ...overrides,
  };
}

// Slice 0014 §10 test 6: the single most important test in the slice, per §5.1 - a stable that has
// never tested, for a condition with no visible signs, must not be penalised for failing to manage
// something the game never told them about.
describe('manageableConditionStates - the knowledge boundary (slice 0014 §5.1/§10 test 6)', () => {
  const condition = fabricatedCondition();
  const affectedGenotype = genotypeWith('HYPP', 'N', 'H'); // affected - one copy is enough (dominant)
  const row: ManageableHorseConditionRow = { horse_id: 1, condition_code: 'FAKE', management_until_game_day: null };

  it('no knowledge row, signs not visible: ownerEntitled is false, and the delta is exactly 0', () => {
    const states = manageableConditionStates(affectedGenotype, [row], [condition], new Set());
    expect(states).toHaveLength(1);
    expect(states[0].ownerEntitled).toBe(false);

    const result = conditionDelta(states, 100, UNMANAGED_PENALTY);
    expect(result.delta).toBe(0);
    expect(result.unmanagedCodes).toEqual([]);
  });

  it('a genotype test on file for this condition: ownerEntitled is true, and the penalty applies', () => {
    const states = manageableConditionStates(affectedGenotype, [row], [condition], new Set(['FAKE']));
    expect(states[0].ownerEntitled).toBe(true);

    const result = conditionDelta(states, 100, UNMANAGED_PENALTY);
    expect(result.delta).toBe(UNMANAGED_PENALTY);
    expect(result.unmanagedCodes).toEqual(['FAKE']);
  });

  it('with signs_visible = 1 instead, entitlement is free - no knowledge row needed', () => {
    const visibleCondition = fabricatedCondition({ signs_visible: 1 });
    const states = manageableConditionStates(affectedGenotype, [row], [visibleCondition], new Set());
    expect(states[0].ownerEntitled).toBe(true);
  });
});

describe('conditionDelta - stacking and the boundary day (slice 0014 §10 tests 7/8)', () => {
  it('two unmanaged manageable conditions stack to -0.06, and the care clamp catches the total', () => {
    const states: ManageableConditionState[] = [
      { conditionCode: 'HYPP', ownerEntitled: true, managementUntilGameDay: null },
      { conditionCode: 'PSSM1', ownerEntitled: true, managementUntilGameDay: null },
    ];
    const result = conditionDelta(states, 1000, UNMANAGED_PENALTY);
    expect(result.delta).toBeCloseTo(-0.06, 10);
    expect(result.unmanagedCodes).toEqual(['HYPP', 'PSSM1']);

    const modifier = careModifier({
      farrier: { lastCallGameDay: 1000, careStartGameDay: 0 },
      farrierConfig: { intervalGameDays: 45, overdueGameDays: 135, bonus: 0.01, penalty: 0.03 },
      wellness: { lastCallGameDay: 1000, careStartGameDay: 0 },
      wellnessConfig: { intervalGameDays: 180, overdueGameDays: 540, bonus: 0.01, penalty: 0.02 },
      feedDelta: 0,
      conditionDelta: result.delta,
      gameDay: 1000,
      modifierMin: 0.95,
      modifierMax: 1.05,
    });
    // Farrier and wellness are both freshly called (delta +0.01 each), feed neutral: unclamped =
    // 1 + 0.01 + 0.01 + 0 - 0.06 = 0.96 - still inside the band, so this alone doesn't prove the
    // clamp. Push it further out with a bigger unmanaged stack to actually hit the floor.
    expect(modifier.unclampedModifier).toBeCloseTo(0.96, 10);

    const bigger = careModifier({
      farrier: { lastCallGameDay: 1000, careStartGameDay: 0 },
      farrierConfig: { intervalGameDays: 45, overdueGameDays: 135, bonus: 0.01, penalty: 0.03 },
      wellness: { lastCallGameDay: 1000, careStartGameDay: 0 },
      wellnessConfig: { intervalGameDays: 180, overdueGameDays: 540, bonus: 0.01, penalty: 0.02 },
      feedDelta: -0.02,
      conditionDelta: result.delta,
      gameDay: 1000,
      modifierMin: 0.95,
      modifierMax: 1.05,
    });
    // 1 + 0.01 + 0.01 - 0.02 - 0.06 = 0.94, clamped to the floor.
    expect(bigger.unclampedModifier).toBeCloseTo(0.94, 10);
    expect(bigger.modifier).toBe(0.95);
  });

  it('management_until_game_day == gameDay counts as current (delta 0); gameDay one day later does not', () => {
    const untilDay = 500;
    const states: ManageableConditionState[] = [{ conditionCode: 'HYPP', ownerEntitled: true, managementUntilGameDay: untilDay }];

    const onTheDay = conditionDelta(states, untilDay, UNMANAGED_PENALTY);
    expect(onTheDay.delta).toBe(0);
    expect(onTheDay.unmanagedCodes).toEqual([]);

    const dayAfter = conditionDelta(states, untilDay + 1, UNMANAGED_PENALTY);
    expect(dayAfter.delta).toBe(UNMANAGED_PENALTY);
    expect(dayAfter.unmanagedCodes).toEqual(['HYPP']);
  });

  it('a condition the stable is not entitled to know about never contributes, however stale its plan', () => {
    const states: ManageableConditionState[] = [{ conditionCode: 'HYPP', ownerEntitled: false, managementUntilGameDay: 0 }];
    const result = conditionDelta(states, 999_999, UNMANAGED_PENALTY);
    expect(result.delta).toBe(0);
  });
});
