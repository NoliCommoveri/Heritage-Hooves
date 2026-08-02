import { describe, expect, it } from 'vitest';
import { withRunningBalance } from '../src/db/ledger';

describe('withRunningBalance', () => {
  it('given an opening row and three movements (oldest first), the running column ends at the stable balance', () => {
    const rows = [
      { amount: 100 }, // opening
      { amount: -20 }, // upkeep
      { amount: 50 }, // prize
      { amount: -10 }, // upkeep
    ];
    const withBalances = withRunningBalance(rows);
    expect(withBalances.map((r) => r.runningBalance)).toEqual([100, 80, 130, 120]);
    expect(withBalances[withBalances.length - 1].runningBalance).toBe(120);
  });

  it('an empty ledger has an empty running balance', () => {
    expect(withRunningBalance([])).toEqual([]);
  });

  it('preserves every field already on the row alongside the new runningBalance', () => {
    const rows = [{ amount: 10, description: 'Starting balance.' }];
    expect(withRunningBalance(rows)).toEqual([{ amount: 10, description: 'Starting balance.', runningBalance: 10 }]);
  });
});
