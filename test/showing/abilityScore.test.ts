import { describe, expect, it } from 'vitest';
import { scoreAbilityEntry, type AbilityWeights } from '../../src/engines/showing/abilityScore';

// The Barrel Racing weights from slice 0012 §5.1/migrations/0063_seed_disciplines.sql.
const BARRELS: AbilityWeights = { speed: 1.4, stamina: 0.2, jump_scope: 0, trainability: 0.8, agility: 1.5 };

const EXPRESSED = { speed: 60, stamina: 40, jump_scope: 70, trainability: 55, agility: 80 };

describe('scoreAbilityEntry', () => {
  it('a worked example, checked by hand against the §7 formula', () => {
    // rawScore = Sum(weight * expressed) / Sum(weight)
    //   = (1.4*60 + 0.2*40 + 0*70 + 0.8*55 + 1.5*80) / (1.4 + 0.2 + 0 + 0.8 + 1.5)
    //   = (84 + 8 + 0 + 44 + 120) / 3.9 = 256 / 3.9
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    expect(result.weightSum).toBeCloseTo(3.9, 6);
    expect(result.rawScore).toBeCloseTo(256 / 3.9, 6);
    expect(result.finalScore).toBeCloseTo(result.rawScore, 6);
  });

  it('a missing weight key contributes zero rather than defaulting to 1.0 (the opposite of a judge)', () => {
    const partial = scoreAbilityEntry({ expressed: EXPRESSED, weights: { speed: 1.0 }, noise: 0 });
    // Only speed carries weight - jump_scope's expressed value (70) must not sneak in at a default
    // weight of 1.0, or the raw score would move.
    expect(partial.rawScore).toBeCloseTo(60, 6);
    expect(partial.weightSum).toBeCloseTo(1.0, 6);
    const jumpRow = partial.traits.find((t) => t.code === 'jump_scope')!;
    expect(jumpRow.weight).toBe(0);
    expect(jumpRow.contribution).toBe(0);
  });

  it('scaling every weight by the same factor leaves rawScore unchanged (Sum(weight) normalises it away)', () => {
    const base = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    const doubled: AbilityWeights = Object.fromEntries(Object.entries(BARRELS).map(([k, v]) => [k, v * 2]));
    const scaled = scoreAbilityEntry({ expressed: EXPRESSED, weights: doubled, noise: 0 });
    expect(scaled.rawScore).toBeCloseTo(base.rawScore, 6);
  });

  it('noise adds directly onto the final score, after the three modifiers (all pinned at 1.0)', () => {
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: -4.2 });
    expect(result.finalScore).toBeCloseTo(result.rawScore - 4.2, 6);
  });

  it('careModifier, tackModifier, trainingFactor and ageModifier all default to 1.0', () => {
    const withDefaults = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    const explicit = scoreAbilityEntry({
      expressed: EXPRESSED,
      weights: BARRELS,
      noise: 0,
      careModifier: 1.0,
      tackModifier: 1.0,
      trainingFactor: 1.0,
      ageModifier: 1.0,
    });
    expect(withDefaults.finalScore).toBeCloseTo(explicit.finalScore, 6);

    const halved = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 0.5 });
    expect(halved.finalScore).toBeCloseTo(withDefaults.finalScore * 0.5, 6);
  });

  // Slice 0014 §10 test 5: omitting ageModifier (a caller that predates this slice) must produce
  // exactly today's number.
  it('omitting ageModifier produces the same result as passing 1.0 explicitly', () => {
    const omitted = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 0.9 });
    const explicit = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 0.9, ageModifier: 1.0 });
    expect(omitted).toEqual(explicit);
  });

  it('ageModifier: 0.85 produces exactly rawScore * 0.85 + noise', () => {
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 1.2, ageModifier: 0.85 });
    expect(result.finalScore).toBeCloseTo(result.rawScore * 0.85 + 1.2, 10);
  });

  it('an entry with no weight at all (Sum(weight) = 0) scores zero rather than dividing by zero', () => {
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: {}, noise: 0 });
    expect(result.weightSum).toBe(0);
    expect(result.rawScore).toBe(0);
  });

  // Slice 0024 §3: a discipline judge's own opinion, layered onto the discipline's own weight -
  // the discipline judge counterpart to test/showing/score.test.ts's judge-weight coverage.
  describe('judgeWeights (slice 0024)', () => {
    it('omitting judgeWeights produces the same result as passing {} explicitly', () => {
      const omitted = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
      const explicit = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, judgeWeights: {}, noise: 0 });
      expect(omitted).toEqual(explicit);
    });

    it('a missing trait key in judgeWeights reads as 1.0 (the opposite of `weights`, the opposite convention)', () => {
      const withDefault = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, judgeWeights: {}, noise: 0 });
      const withExplicit1 = scoreAbilityEntry({
        expressed: EXPRESSED,
        weights: BARRELS,
        judgeWeights: { speed: 1.0, stamina: 1.0, jump_scope: 1.0, trainability: 1.0, agility: 1.0 },
        noise: 0,
      });
      expect(withDefault.rawScore).toBeCloseTo(withExplicit1.rawScore, 6);
    });

    // Ferris (need_for_speed) from migration 0140: speed 1.5, stamina 1.3, jump_scope 0.9,
    // trainability 0.6, agility 0.8 - checked by hand against §7's formula with weight_t now
    // discipline_weight_t * judge_weight_t.
    it('a worked example, checked by hand', () => {
      const ferris: AbilityWeights = { speed: 1.5, stamina: 1.3, jump_scope: 0.9, trainability: 0.6, agility: 0.8 };
      const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, judgeWeights: ferris, noise: 0 });
      // combined weight_t = 1.4*1.5, 0.2*1.3, 0*0.9, 0.8*0.6, 1.5*0.8 = 2.1, 0.26, 0, 0.48, 1.2
      expect(result.weightSum).toBeCloseTo(2.1 + 0.26 + 0 + 0.48 + 1.2, 6);
      // weighted sum = 2.1*60 + 0.26*40 + 0*70 + 0.48*55 + 1.2*80 = 258.8
      expect(result.rawScore).toBeCloseTo(258.8 / 4.04, 6);
    });

    it('judge weights change the winner - the same two horses, two judges, two different winners', () => {
      // Show Jumping (migration 0108): speed 0.3, stamina 0.5, jump_scope 1.6, trainability 1.0, agility 1.0
      const jumping: AbilityWeights = { speed: 0.3, stamina: 0.5, jump_scope: 1.6, trainability: 1.0, agility: 1.0 };
      const ferris: AbilityWeights = { speed: 1.5, stamina: 1.3, jump_scope: 0.9, trainability: 0.6, agility: 0.8 };
      const winslow: AbilityWeights = { speed: 0.7, stamina: 0.8, jump_scope: 1.3, trainability: 1.5, agility: 1.3 };
      // Scopey but green: real jump, modest trainability.
      const horseA = { speed: 50, stamina: 55, jump_scope: 85, trainability: 45, agility: 60 };
      // Obedient but modest jump: real trainability, ordinary scope.
      const horseB = { speed: 55, stamina: 50, jump_scope: 60, trainability: 85, agility: 65 };

      const aUnderFerris = scoreAbilityEntry({ expressed: horseA, weights: jumping, judgeWeights: ferris, noise: 0 }).rawScore;
      const bUnderFerris = scoreAbilityEntry({ expressed: horseB, weights: jumping, judgeWeights: ferris, noise: 0 }).rawScore;
      const aUnderWinslow = scoreAbilityEntry({ expressed: horseA, weights: jumping, judgeWeights: winslow, noise: 0 }).rawScore;
      const bUnderWinslow = scoreAbilityEntry({ expressed: horseB, weights: jumping, judgeWeights: winslow, noise: 0 }).rawScore;

      expect(aUnderFerris).toBeGreaterThan(bUnderFerris);
      expect(bUnderWinslow).toBeGreaterThan(aUnderWinslow);
    });
  });
});
