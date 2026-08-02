import { describe, expect, it } from 'vitest';
import { foalComposition } from '../../src/engines/genetics/composition';

describe('foalComposition', () => {
  it('a clean purebred x purebred pairing stays that single breed', () => {
    const parent = { composition: { QH: 1 }, isCross: false, breedId: 1 };
    const result = foalComposition(parent, parent);
    expect(result).toEqual({ composition: { QH: 1 }, isCross: false, breedId: 1 });
  });

  it('averages composition fractions across breeds', () => {
    const sire = { composition: { QH: 1 }, isCross: false, breedId: 1 };
    const dam = { composition: { QH: 0.5, TB: 0.5 }, isCross: true, breedId: null };
    const result = foalComposition(sire, dam);
    expect(result.composition).toEqual({ QH: 0.75, TB: 0.25 });
  });

  it('is a cross when the parents are different breeds, even if both are purebred', () => {
    const sire = { composition: { QH: 1 }, isCross: false, breedId: 1 };
    const dam = { composition: { TB: 1 }, isCross: false, breedId: 2 };
    const result = foalComposition(sire, dam);
    expect(result.isCross).toBe(true);
    expect(result.breedId).toBeNull();
  });

  it('once a cross, always a cross: a cross parent bred back to a purebred stays a cross', () => {
    const purebredSireOfPurebredSire = { composition: { QH: 1 }, isCross: false, breedId: 1 };
    // A parent that is itself 100% QH by composition, but is flagged is_cross because a cross
    // happened further back in its own ancestry.
    const crossDam = { composition: { QH: 1 }, isCross: true, breedId: null };
    const result = foalComposition(purebredSireOfPurebredSire, crossDam);
    expect(result.isCross).toBe(true);
    expect(result.breedId).toBeNull();
    expect(result.composition).toEqual({ QH: 1 });
  });
});
