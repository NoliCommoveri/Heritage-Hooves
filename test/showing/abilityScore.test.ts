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

  it('careModifier, tackModifier and trainingFactor all default to 1.0', () => {
    const withDefaults = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0 });
    const explicit = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 1.0, tackModifier: 1.0, trainingFactor: 1.0 });
    expect(withDefaults.finalScore).toBeCloseTo(explicit.finalScore, 6);

    const halved = scoreAbilityEntry({ expressed: EXPRESSED, weights: BARRELS, noise: 0, careModifier: 0.5 });
    expect(halved.finalScore).toBeCloseTo(withDefaults.finalScore * 0.5, 6);
  });

  it('an entry with no weight at all (Sum(weight) = 0) scores zero rather than dividing by zero', () => {
    const result = scoreAbilityEntry({ expressed: EXPRESSED, weights: {}, noise: 0 });
    expect(result.weightSum).toBe(0);
    expect(result.rawScore).toBe(0);
  });
});
