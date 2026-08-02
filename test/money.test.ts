import { describe, expect, it } from 'vitest';
import { canTakeOnCost } from '../src/lib/money';

describe('canTakeOnCost', () => {
  it('exactly 0 is allowed', () => {
    expect(canTakeOnCost(0)).toBe(true);
  });

  it('-1 is not allowed', () => {
    expect(canTakeOnCost(-1)).toBe(false);
  });

  it('a large positive balance is allowed', () => {
    expect(canTakeOnCost(1_000_000)).toBe(true);
  });
});
