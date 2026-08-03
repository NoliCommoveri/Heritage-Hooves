import { describe, expect, it } from 'vitest';
import { selectBreedingPairs, clampedScore, type BreedingCandidate, type SelectionTarget } from '../../src/engines/npc/selection';
import { scoreEntry } from '../../src/engines/showing/score';
import { scoreAbilityEntry } from '../../src/engines/showing/abilityScore';

// The Quarter Horse's own ideal vector (migrations/0035_seed_qh_ideal_vector.sql) - reused rather
// than an invented one, so test 3's conformation case exercises the real numbers a Cedar Hollow
// cycle would.
const QH_IDEAL: SelectionTarget = {
  kind: 'conformation',
  ideal: { hock_set: { target: 50, weight: 0.9 } },
  judgeWeights: {},
  falloff: 2.0,
};

const BARRELS: SelectionTarget = {
  kind: 'ability',
  weights: { speed: 1.4, stamina: 0.2, jump_scope: 0, trainability: 0.8, agility: 1.5 },
};

function candidate(horseId: number, expressed: BreedingCandidate['expressed']): BreedingCandidate {
  return { horseId, expressed };
}

describe('selectBreedingPairs', () => {
  it('with no noise, pairs strictly by rank - best mare with best stallion, and so on', () => {
    const mares = [candidate(1, { hock_set: 60 }), candidate(2, { hock_set: 55 }), candidate(3, { hock_set: 40 })];
    const stallions = [candidate(11, { hock_set: 51 }), candidate(12, { hock_set: 45 }), candidate(13, { hock_set: 30 })];
    // Mare 2 (hock 55, distance 5) ranks above mare 1 (distance 10) above mare 3 (distance 20).
    // Stallion 11 (distance 1) ranks above 12 (distance 5) above 13 (distance 20).
    const result = selectBreedingPairs({
      mares,
      stallions,
      target: QH_IDEAL,
      ceiling: 100,
      selectionNoiseSd: 0,
      retentionBias: 0,
      maxPairs: 10,
      coiExceeded: new Set(),
      seed: 1,
    });
    expect(result.pairs).toEqual([
      { mareId: 2, stallionId: 11 },
      { mareId: 1, stallionId: 12 },
      { mareId: 3, stallionId: 13 },
    ]);
  });

  it('retentionBias = 1.0 skips every horse - no pairs, not an error', () => {
    const mares = [candidate(1, { hock_set: 50 })];
    const stallions = [candidate(11, { hock_set: 50 })];
    const result = selectBreedingPairs({
      mares,
      stallions,
      target: QH_IDEAL,
      ceiling: 100,
      selectionNoiseSd: 0,
      retentionBias: 1.0,
      maxPairs: 10,
      coiExceeded: new Set(),
      seed: 42,
    });
    expect(result.pairs).toEqual([]);
  });

  describe('clampedScore', () => {
    it('ability: two candidates on either side of the ceiling score identically at the ceiling', () => {
      const low = scoreAbilityEntry({ expressed: { speed: 52 }, weights: { speed: 1.0 }, noise: 0 });
      const high = scoreAbilityEntry({ expressed: { speed: 95 }, weights: { speed: 1.0 }, noise: 0 });
      expect(clampedScore(low, 52, 'ability')).toBeCloseTo(52, 6);
      expect(clampedScore(high, 52, 'ability')).toBeCloseTo(52, 6);
    });

    it('conformation: clamps traitScore (closeness to target), not the raw expressed value', () => {
      // Against the real QH ideal (hock target 50, falloff 2.0): a horse at hock 50 scores 100 on
      // this trait, a horse at hock 62 scores 100 - 12*2 = 76. A ceiling of 76 collapses both to
      // the same clamped quality, while a horse at hock 90 (distance 40, traitScore 20) still
      // scores strictly worse - a clamp on the raw expressed value (50 vs 62 vs 90) would not
      // produce this shape at all.
      const onTarget = scoreEntry({ expressed: { hock_set: 50 }, ideal: QH_IDEAL.ideal!, judgeWeights: {}, falloff: 2.0, noise: 0 });
      const nearTarget = scoreEntry({ expressed: { hock_set: 62 }, ideal: QH_IDEAL.ideal!, judgeWeights: {}, falloff: 2.0, noise: 0 });
      const farFromTarget = scoreEntry({ expressed: { hock_set: 90 }, ideal: QH_IDEAL.ideal!, judgeWeights: {}, falloff: 2.0, noise: 0 });

      const onTargetClamped = clampedScore(onTarget, 76, 'conformation');
      const nearTargetClamped = clampedScore(nearTarget, 76, 'conformation');
      const farClamped = clampedScore(farFromTarget, 76, 'conformation');

      expect(onTargetClamped).toBeCloseTo(76, 6);
      expect(nearTargetClamped).toBeCloseTo(76, 6);
      expect(farClamped).toBeLessThan(onTargetClamped);
    });
  });

  it('a pair in coiExceeded is never returned, even as the top-ranked pairing - the mare falls through to the next stallion', () => {
    const mares = [candidate(1, { hock_set: 50 })];
    const stallions = [candidate(11, { hock_set: 50 }), candidate(12, { hock_set: 40 })];
    const result = selectBreedingPairs({
      mares,
      stallions,
      target: QH_IDEAL,
      ceiling: 100,
      selectionNoiseSd: 0,
      retentionBias: 0,
      maxPairs: 10,
      coiExceeded: new Set(['1:11']),
      seed: 7,
    });
    expect(result.pairs).toEqual([{ mareId: 1, stallionId: 12 }]);
  });

  it('maxPairs = 0 returns no pairs regardless of how many eligible horses exist', () => {
    const mares = [candidate(1, { hock_set: 50 }), candidate(2, { hock_set: 45 })];
    const stallions = [candidate(11, { hock_set: 50 }), candidate(12, { hock_set: 45 })];
    const result = selectBreedingPairs({
      mares,
      stallions,
      target: QH_IDEAL,
      ceiling: 100,
      selectionNoiseSd: 0,
      retentionBias: 0,
      maxPairs: 0,
      coiExceeded: new Set(),
      seed: 3,
    });
    expect(result.pairs).toEqual([]);
  });

  it('one stallion, several mares: the stallion is paired with more than one mare (round-robin), up to maxPairs', () => {
    const mares = [candidate(1, { speed: 60 }), candidate(2, { speed: 55 }), candidate(3, { speed: 50 })];
    const stallions = [candidate(11, { speed: 70 })];
    const result = selectBreedingPairs({
      mares,
      stallions,
      target: BARRELS,
      ceiling: 100,
      selectionNoiseSd: 0,
      retentionBias: 0,
      maxPairs: 3,
      coiExceeded: new Set(),
      seed: 9,
    });
    expect(result.pairs).toHaveLength(3);
    expect(result.pairs.every((p) => p.stallionId === 11)).toBe(true);
    expect(new Set(result.pairs.map((p) => p.mareId))).toEqual(new Set([1, 2, 3]));
  });

  it('no mares, or no stallions: no pairs, not an error', () => {
    const one = candidate(1, { hock_set: 50 });
    expect(selectBreedingPairs({ mares: [], stallions: [one], target: QH_IDEAL, ceiling: 100, selectionNoiseSd: 0, retentionBias: 0, maxPairs: 10, coiExceeded: new Set(), seed: 1 }).pairs).toEqual([]);
    expect(selectBreedingPairs({ mares: [one], stallions: [], target: QH_IDEAL, ceiling: 100, selectionNoiseSd: 0, retentionBias: 0, maxPairs: 10, coiExceeded: new Set(), seed: 1 }).pairs).toEqual([]);
  });
});
