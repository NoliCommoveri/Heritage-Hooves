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

// Slice 0021 Part D §6.2/§10: the CPU guard. Every one of the thirteen colour/pattern loci fully
// tested on both parents - the case a naive 3^13 genotype cross could not survive on a free-tier
// 10ms CPU budget. This asserts it completes fast and that the resulting probabilities are sound.
describe('foalColourPossibilities: the CPU guard (slice 0021 §6.2)', () => {
  it('thirteen fully-tested loci on both parents completes well under the CPU budget and sums to 1.0', () => {
    const heterozygousEverywhere = {
      E: pairs(['E', 'e']),
      A: pairs(['A', 'a']),
      CR: pairs(['Cr', 'cr']),
      D: pairs(['D', 'nd']),
      Z: pairs(['Z', 'z']),
      CH: pairs(['Ch', 'ch']),
      RN: pairs(['Rn', 'rn']),
      TO: pairs(['TO', 'n']),
      O: pairs(['O', 'n']),
      SW1: pairs(['SW1', 'n']),
      SB1: pairs(['SB1', 'n']),
      LP: pairs(['Lp', 'lp']),
      PATN1: pairs(['PATN1', 'n']),
    };
    const start = performance.now();
    const result = foalColourPossibilities({
      sire: heterozygousEverywhere,
      dam: heterozygousEverywhere,
      gameDaysPerYear: GAME_DAYS_PER_YEAR,
      patternPenetrance: { O: 0.85, SW1: 0.9 },
    });
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(50); // generous next to the free-tier 10ms CPU budget for our own logic
    expect(result.uncertain).toEqual([]);
    const total = sumProb(result.certain);
    expect(total).toBeCloseTo(1, 5);
    // §6.2's cap: the eight most likely named outcomes, plus an "other" bucket for the remainder.
    expect(result.certain.length).toBeLessThanOrEqual(9);
  });

  it('a homozygous-clear pairing at every new locus reproduces the plain three-locus answer unchanged', () => {
    const clearEverywhereElse = {
      E: pairs(['e', 'e']),
      A: pairs(['a', 'a']),
      CR: pairs(['cr', 'cr']),
      D: pairs(['nd', 'nd']),
      Z: pairs(['z', 'z']),
      CH: pairs(['ch', 'ch']),
      RN: pairs(['rn', 'rn']),
      TO: pairs(['n', 'n']),
      O: pairs(['n', 'n']),
      SW1: pairs(['n', 'n']),
      SB1: pairs(['n', 'n']),
      LP: pairs(['lp', 'lp']),
      PATN1: pairs(['n', 'n']),
    };
    const result = foalColourPossibilities({ sire: clearEverywhereElse, dam: clearEverywhereElse, gameDaysPerYear: GAME_DAYS_PER_YEAR });
    expect(result.certain).toEqual([{ colour: 'chestnut', probability: 1 }]);
  });

  it('a tobiano x tobiano cross names the pattern alongside the colour, e.g. "bay tobiano"', () => {
    const sire = { E: pairs(['E', 'E']), A: pairs(['A', 'A']), CR: pairs(['cr', 'cr']), TO: pairs(['TO', 'n']) };
    const dam = { E: pairs(['E', 'E']), A: pairs(['A', 'A']), CR: pairs(['cr', 'cr']), TO: pairs(['TO', 'TO']) };
    const result = foalColourPossibilities({ sire, dam, gameDaysPerYear: GAME_DAYS_PER_YEAR });
    expect(result.certain.every((c) => c.colour === 'bay tobiano')).toBe(true);
    expect(sumProb(result.certain)).toBeCloseTo(1);
  });
});
