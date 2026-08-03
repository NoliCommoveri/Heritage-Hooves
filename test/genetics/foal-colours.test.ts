import { describe, expect, it } from 'vitest';
import { foalColourPossibilities } from '../../src/engines/genetics/foal-colours';
import type { AllelePair } from '../../src/engines/genetics/genotype';

const GAME_DAYS_PER_YEAR = 360;

function sumProb(certain: { colour: string; probability: number }[]): number {
  return certain.reduce((acc, c) => acc + c.probability, 0);
}

function pairs(...p: [string, string][]): AllelePair[] {
  return p as AllelePair[];
}

describe('foalColourPossibilities (amendment 0017a §4.4)', () => {
  it('chestnut x chestnut is 100% chestnut, even with agouti fully untested', () => {
    const result = foalColourPossibilities({
      sire: { E: pairs(['e', 'e']), A: pairs(['A', 'A'], ['A', 'a'], ['a', 'a']), CR: pairs(['cr', 'cr']) },
      dam: { E: pairs(['e', 'e']), A: pairs(['A', 'A'], ['A', 'a'], ['a', 'a']), CR: pairs(['cr', 'cr']) },
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
    });
    expect(result.certain).toEqual([{ colour: 'chestnut', probability: 1 }]);
    expect(result.uncertain.find((u) => u.locusCode === 'A')).toBeUndefined();
  });

  it('a known Cr/cr x cr/cr is half diluted, probabilities sum to 1', () => {
    const result = foalColourPossibilities({
      sire: { E: pairs(['e', 'e']), A: pairs(['a', 'a']), CR: pairs(['Cr', 'cr']) },
      dam: { E: pairs(['e', 'e']), A: pairs(['a', 'a']), CR: pairs(['cr', 'cr']) },
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
    });
    expect(sumProb(result.certain)).toBeCloseTo(1);
    const chestnut = result.certain.find((c) => c.colour === 'chestnut');
    const palomino = result.certain.find((c) => c.colour === 'palomino');
    expect(chestnut?.probability).toBeCloseTo(0.5);
    expect(palomino?.probability).toBeCloseTo(0.5);
  });

  it('untested cream on both parents: certain gives the undiluted base, uncertain flags CR', () => {
    const result = foalColourPossibilities({
      sire: { E: pairs(['E', 'e']), A: pairs(['A', 'a']), CR: pairs(['Cr', 'Cr'], ['Cr', 'cr'], ['cr', 'cr']) },
      dam: { E: pairs(['E', 'e']), A: pairs(['A', 'a']), CR: pairs(['Cr', 'Cr'], ['Cr', 'cr'], ['cr', 'cr']) },
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
    });
    // Truth (if we peeked at a real genotype) could give a clean diluted answer - the point of the
    // test is that this function must never do that peeking. It reports the undiluted split and
    // flags CR as open, not a number derived from the hidden truth.
    expect(sumProb(result.certain)).toBeCloseTo(1);
    expect(result.certain.every((c) => !['palomino', 'buckskin', 'cremello', 'perlino', 'smoky black', 'smoky cream'].includes(c.colour))).toBe(true);
    const crEntry = result.uncertain.find((u) => u.locusCode === 'CR');
    expect(crEntry).toBeDefined();
    expect(crEntry?.untestedParents).toEqual(['sire', 'dam']);
    expect(crEntry?.unlockedColours.length).toBeGreaterThan(0);
  });

  it('E untested on either parent: no certain colour is asserted', () => {
    const result = foalColourPossibilities({
      sire: { E: pairs(['E', 'E'], ['E', 'e']), A: pairs(['a', 'a']), CR: pairs(['cr', 'cr']) },
      dam: { E: pairs(['e', 'e']), A: pairs(['a', 'a']), CR: pairs(['cr', 'cr']) },
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
    });
    expect(result.certain).toEqual([]);
    expect(result.uncertain.find((u) => u.locusCode === 'E')).toBeDefined();
  });

  it('E known dominant, A untested: the not-chestnut mass is left uncertain, not guessed', () => {
    const result = foalColourPossibilities({
      sire: { E: pairs(['E', 'E']), A: pairs(['A', 'A'], ['A', 'a'], ['a', 'a']), CR: pairs(['cr', 'cr']) },
      dam: { E: pairs(['E', 'E']), A: pairs(['A', 'A'], ['A', 'a'], ['a', 'a']), CR: pairs(['cr', 'cr']) },
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
    });
    expect(result.certain).toEqual([]);
    expect(result.uncertain.find((u) => u.locusCode === 'A')).toBeDefined();
  });
});
