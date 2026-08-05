import { describe, expect, it } from 'vitest';
import { noiseForEntry, geldingAdjustedNoise } from '../../src/engines/showing/noise';

describe('noiseForEntry', () => {
  it('the same (class seed, horse id) gives the same noise every time', () => {
    const a = noiseForEntry(12345, 42, 5);
    const b = noiseForEntry(12345, 42, 5);
    expect(a).toBe(b);
  });

  it('entry order does not change any horse\'s noise - each horse draws its own independent stream', () => {
    const classSeed = 987654;
    const noiseAlone = noiseForEntry(classSeed, 7, 5);
    // Drawing other horses' noise first must not perturb horse 7's - each one derives its own
    // sub-seed rather than sharing one rng advanced sequentially down the entry list (§7.2).
    noiseForEntry(classSeed, 1, 5);
    noiseForEntry(classSeed, 2, 5);
    const noiseAfterOthers = noiseForEntry(classSeed, 7, 5);
    expect(noiseAfterOthers).toBe(noiseAlone);
  });

  it('different horses in the same class draw different noise', () => {
    const classSeed = 55;
    const a = noiseForEntry(classSeed, 1, 5);
    const b = noiseForEntry(classSeed, 2, 5);
    expect(a).not.toBe(b);
  });

  it('a re-fired tick reproduces the same class byte for byte: same class seed, same horses, same noise', () => {
    const classSeed = 111;
    const horseIds = [10, 20, 30];
    const firstRun = horseIds.map((id) => noiseForEntry(classSeed, id, 5));
    const secondRun = horseIds.map((id) => noiseForEntry(classSeed, id, 5));
    expect(secondRun).toEqual(firstRun);
  });
});

// Slice 0026 §1.4/§5 test 1.
describe('geldingAdjustedNoise', () => {
  it('leaves positive noise untouched even for a gelding', () => {
    expect(geldingAdjustedNoise(4, true, 0.75)).toBe(4);
  });

  it('leaves a non-gelding untouched, whatever the sign of the noise', () => {
    expect(geldingAdjustedNoise(-4, false, 0.75)).toBe(-4);
    expect(geldingAdjustedNoise(4, false, 0.75)).toBe(4);
  });

  it('softens negative noise for a gelding by the relief factor', () => {
    expect(geldingAdjustedNoise(-4, true, 0.75)).toBeCloseTo(-3, 10);
  });

  it('the same (class seed, horse id) reproduces the same adjusted value across runs - a re-fired tick byte for byte', () => {
    const classSeed = 222;
    const horseId = 7;
    const first = geldingAdjustedNoise(noiseForEntry(classSeed, horseId, 5), true, 0.75);
    const second = geldingAdjustedNoise(noiseForEntry(classSeed, horseId, 5), true, 0.75);
    expect(second).toBe(first);
  });
});
