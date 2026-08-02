import { describe, expect, it } from 'vitest';
import { assignPlacings, ribbonFor } from '../../src/engines/showing/placing';

describe('assignPlacings', () => {
  it('sorts descending by final score, and every entry gets a placing', () => {
    const result = assignPlacings([
      { horseId: 1, finalScore: 80, rawScore: 80 },
      { horseId: 2, finalScore: 95, rawScore: 95 },
      { horseId: 3, finalScore: 88, rawScore: 88 },
    ]);
    expect(result.map((e) => e.horseId)).toEqual([2, 3, 1]);
    expect(result.map((e) => e.placing)).toEqual([1, 2, 3]);
  });

  it('breaks ties by raw score, then by horse id ascending, deterministically', () => {
    const entries = [
      { horseId: 5, finalScore: 90, rawScore: 88 },
      { horseId: 2, finalScore: 90, rawScore: 92 },
      { horseId: 3, finalScore: 90, rawScore: 92 },
    ];
    const result = assignPlacings(entries);
    expect(result.map((e) => e.horseId)).toEqual([2, 3, 5]);
  });

  it('running the same class twice gives identical placings, regardless of input order', () => {
    const entries = [
      { horseId: 1, finalScore: 70, rawScore: 71 },
      { horseId: 2, finalScore: 75, rawScore: 71 },
      { horseId: 3, finalScore: 75, rawScore: 71 },
    ];
    const a = assignPlacings(entries);
    const b = assignPlacings([...entries].reverse());
    expect(a).toEqual(b);
  });
});

describe('ribbonFor', () => {
  it('attaches ribbon colours to placings 1-6 and nothing below', () => {
    expect(ribbonFor(1)).toBe('blue');
    expect(ribbonFor(2)).toBe('red');
    expect(ribbonFor(3)).toBe('yellow');
    expect(ribbonFor(4)).toBe('white');
    expect(ribbonFor(5)).toBe('pink');
    expect(ribbonFor(6)).toBe('green');
    expect(ribbonFor(7)).toBeUndefined();
    expect(ribbonFor(20)).toBeUndefined();
  });
});
