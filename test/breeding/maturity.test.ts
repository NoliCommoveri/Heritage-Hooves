import { describe, expect, it } from 'vitest';
import { isOldEnoughToBreed } from '../../src/engines/breeding/maturity';

const MIN_AGE = 1080;

describe('isOldEnoughToBreed', () => {
  it('is false one day under the minimum age', () => {
    expect(isOldEnoughToBreed(0, MIN_AGE - 1, MIN_AGE)).toBe(false);
  });

  it('is true exactly at the minimum age', () => {
    expect(isOldEnoughToBreed(0, MIN_AGE, MIN_AGE)).toBe(true);
  });

  it('is true one day over the minimum age', () => {
    expect(isOldEnoughToBreed(0, MIN_AGE + 1, MIN_AGE)).toBe(true);
  });
});
