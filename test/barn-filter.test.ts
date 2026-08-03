import { describe, expect, it } from 'vitest';
import { bucketFor } from '../src/lib/barnFilter';

describe('bucketFor', () => {
  it('a colt under the foal age is a foal, not a stallion', () => {
    expect(bucketFor({ sex: 'stallion', born_game_day: 100 }, 300, 360)).toBe('foals');
  });

  it('a filly under the foal age is a foal, not a mare', () => {
    expect(bucketFor({ sex: 'mare', born_game_day: 100 }, 300, 360)).toBe('foals');
  });

  it('crosses into stallions the day it reaches foal_max_age_game_days', () => {
    expect(bucketFor({ sex: 'stallion', born_game_day: 0 }, 360, 360)).toBe('stallions');
    expect(bucketFor({ sex: 'stallion', born_game_day: 0 }, 359, 360)).toBe('foals');
  });

  it('a gelding past the foal age is a gelding, at any age past it', () => {
    expect(bucketFor({ sex: 'gelding', born_game_day: 0 }, 360, 360)).toBe('geldings');
    expect(bucketFor({ sex: 'gelding', born_game_day: 0 }, 10_000, 360)).toBe('geldings');
  });

  it('a mare past the foal age is a mare', () => {
    expect(bucketFor({ sex: 'mare', born_game_day: 0 }, 4000, 360)).toBe('mares');
  });
});
