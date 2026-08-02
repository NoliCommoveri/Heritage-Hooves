import { describe, expect, it } from 'vitest';
import { makeRng, deriveSeed } from '../src/lib/rng';

describe('makeRng', () => {
  it('is deterministic: the same seed produces the same sequence', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different sequences', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('int(n) stays in range and lands roughly evenly across buckets', () => {
    const rng = makeRng(7);
    const buckets = [0, 0, 0, 0, 0];
    const draws = 100_000;
    for (let i = 0; i < draws; i++) {
      const v = rng.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      buckets[v]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 5 - draws * 0.02);
      expect(count).toBeLessThan(draws / 5 + draws * 0.02);
    }
  });

  it('normal(0, 1) has a mean near 0 and a standard deviation near 1', () => {
    const rng = makeRng(99);
    const draws = 100_000;
    const values: number[] = [];
    for (let i = 0; i < draws; i++) values.push(rng.normal(0, 1));
    const mean = values.reduce((a, b) => a + b, 0) / draws;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / draws;
    expect(mean).toBeGreaterThan(-0.02);
    expect(mean).toBeLessThan(0.02);
    expect(Math.sqrt(variance)).toBeGreaterThan(0.97);
    expect(Math.sqrt(variance)).toBeLessThan(1.03);
  });

  it('shuffle returns a permutation and does not mutate its input', () => {
    const rng = makeRng(5);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const original = [...input];
    const shuffled = rng.shuffle(input);
    expect(input).toEqual(original);
    expect(shuffled).not.toBe(input);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it('pick returns an element from the array', () => {
    const rng = makeRng(3);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  // Golden-value test: if this ever fails, the RNG algorithm changed. That is a five-alarm
  // event, not a bug to quietly fix - every stored seed in the game reproduces different
  // values than it did before. See CLAUDE.md §5.2 and src/lib/rng.ts.
  it('produces exact, hardcoded output for a known seed (golden values - never change these)', () => {
    const rng = makeRng(12345);
    const outputs = Array.from({ length: 10 }, () => rng.next());
    expect(outputs).toEqual([
      0.25454781646840274, 0.04726540227420628, 0.8711017605382949, 0.885623776819557, 0.9729384118691087,
      0.18865043367259204, 0.31380670145154, 0.9401209598872811, 0.8683646530844271, 0.8954381737858057,
    ]);
    expect(deriveSeed(12345, 'genotype')).toBe(2036587423);
  });
});
