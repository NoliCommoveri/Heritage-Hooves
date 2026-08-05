import { describe, expect, it } from 'vitest';
import { canTakeOnCost } from '../../src/lib/money';
import { buildEventStatement, buildFoaledEventStatement } from '../../src/db/events';
import type { Env } from '../../src/types';

/**
 * Pure models of src/db/npcBreeding.ts's tick-stage guards (slice 0015 §4.2/§6.3), the same
 * approach test/ageing/tick.test.ts and test/health/lethal.test.ts use for their own tick stages:
 * this codebase has no D1 mock, so a model pins down the logic itself, independent of the database.
 */

interface FakeNpcPolicy {
  lastBredGameDay: number | null;
  breedingIntervalGameDays: number;
}

function isDueThisCycle(policy: FakeNpcPolicy, gameDay: number): boolean {
  return policy.lastBredGameDay === null || gameDay - policy.lastBredGameDay >= policy.breedingIntervalGameDays;
}

describe('the due-this-cycle predicate (npc_policy.last_bred_game_day)', () => {
  it('a stable whose interval has not yet elapsed is not due', () => {
    expect(isDueThisCycle({ lastBredGameDay: 100, breedingIntervalGameDays: 60 }, 140)).toBe(false);
  });

  it('a stable at or past its interval is due', () => {
    expect(isDueThisCycle({ lastBredGameDay: 100, breedingIntervalGameDays: 60 }, 160)).toBe(true);
    expect(isDueThisCycle({ lastBredGameDay: 100, breedingIntervalGameDays: 60 }, 200)).toBe(true);
  });

  it('a stable with no marker yet (its first cycle) is due', () => {
    expect(isDueThisCycle({ lastBredGameDay: null, breedingIntervalGameDays: 60 }, 0)).toBe(true);
  });
});

describe('running the due predicate twice against the same game day, marker advanced in between', () => {
  it('the second run selects nothing - idempotency (§6.3), the same property killDueOldHorses has', () => {
    const policy: FakeNpcPolicy = { lastBredGameDay: 100, breedingIntervalGameDays: 60 };
    const gameDay = 160;
    expect(isDueThisCycle(policy, gameDay)).toBe(true);
    // What runOnePolicy's final UPDATE does - the marker is set regardless of whether any pairs
    // were actually booked this cycle (§4.2 step 10).
    policy.lastBredGameDay = gameDay;
    expect(isDueThisCycle(policy, gameDay)).toBe(false);
  });

  it('a missed tick still catches up on the next one that fires - the comparison is >=, not ===', () => {
    expect(isDueThisCycle({ lastBredGameDay: 100, breedingIntervalGameDays: 60 }, 500)).toBe(true);
  });
});

describe('the capacity guard and the canTakeOnCost guard each exclude a stable on their own', () => {
  it('a stable in debt is excluded regardless of capacity headroom', () => {
    const balance = -5;
    const aliveCount = 3;
    const capacity = 40;
    const shouldBreed = canTakeOnCost(balance) && aliveCount < capacity;
    expect(shouldBreed).toBe(false);
  });

  it('a stable at or over capacity is excluded regardless of balance', () => {
    const balance = 200;
    const aliveCount = 40;
    const capacity = 40;
    const shouldBreed = canTakeOnCost(balance) && aliveCount < capacity;
    expect(shouldBreed).toBe(false);
  });

  it('a stable with money in hand and room under capacity is not excluded by either guard', () => {
    const balance = 0;
    const aliveCount = 39;
    const capacity = 40;
    const shouldBreed = canTakeOnCost(balance) && aliveCount < capacity;
    expect(shouldBreed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression (slice 0015 §9's own closing note): an NPC stable's account_id is always null (the
// CHECK on stables), and buildEventStatement's guard already returns [] for a null accountId - the
// one place a bug here would leak NPC breeding into a child's "While you were away" feed. Asserted
// directly against the real functions, not a model, since it costs three lines and the codebase
// already leans on this guard rather than a second one in npcBreeding.ts.
// ---------------------------------------------------------------------------

describe('an NPC stable writes no events, via the guard every event-writing helper already has', () => {
  const env = {} as Env;

  it('buildEventStatement returns no statements for a null accountId', () => {
    expect(buildEventStatement(env, { stableId: 1, accountId: null, gameDay: 100, kind: 'covering_conceived', subjectHorseId: 1, payload: {} })).toEqual([]);
  });

  it('buildFoaledEventStatement returns no statements for a null accountId', () => {
    expect(buildFoaledEventStatement(env, { stableId: 1, accountId: null, gameDay: 100, payload: {} })).toEqual([]);
  });
});
