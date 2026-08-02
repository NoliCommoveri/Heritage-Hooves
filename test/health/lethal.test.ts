import { describe, expect, it } from 'vitest';
import { lethalTerminalGameDay } from '../../src/engines/health/status';

describe('lethalTerminalGameDay - the snapshot, not a live read (slice 0010 §2.2/CLAUDE.md §5.5)', () => {
  it('is born_game_day + the window at the time it is called', () => {
    expect(lethalTerminalGameDay(1000, 30)).toBe(1030);
  });

  it('changing the config value between two calls does not move a date already computed', () => {
    const bornGameDay = 500;
    const firstWindow = 30;
    const firstFoalDeathDay = lethalTerminalGameDay(bornGameDay, firstWindow);

    // The config value changes later (an admin retunes it) - a second, unrelated foal born after
    // the change gets the new window...
    const secondWindow = 45;
    const secondFoalBornGameDay = 600;
    const secondFoalDeathDay = lethalTerminalGameDay(secondFoalBornGameDay, secondWindow);

    // ...but the first foal's already-snapshotted death day is untouched by the retune, because
    // nothing here re-reads config - the value it was called with is the value it used, forever.
    expect(firstFoalDeathDay).toBe(530);
    expect(secondFoalDeathDay).toBe(645);
    expect(lethalTerminalGameDay(bornGameDay, firstWindow)).toBe(firstFoalDeathDay);
  });
});

/**
 * A pure model of the tick's death-selection predicate (src/db/health.ts's killDueLethalFoals SQL:
 * `WHERE hc.state = 'terminal' AND hc.terminal_game_day <= ? AND h.status = 'alive'`), so the
 * idempotency argument - a re-fired or missed tick kills a horse exactly once - is checkable
 * without a database. This codebase has no D1 mock (every other DB-touching stage is verified by
 * hand against a live wrangler dev, per slice 0010 §11); this model exists so the logic itself,
 * independent of D1, is pinned down by a test.
 */
interface FakeHorseCondition {
  state: 'onset' | 'terminal';
  terminalGameDay: number | null;
  horseStatus: 'alive' | 'dead';
}

function isDueForDeath(row: FakeHorseCondition, gameDay: number): boolean {
  return row.state === 'terminal' && row.terminalGameDay !== null && row.terminalGameDay <= gameDay && row.horseStatus === 'alive';
}

describe('the death-selection predicate, run twice against the same game day', () => {
  it('selects a due horse once - the second run finds it already dead', () => {
    const row: FakeHorseCondition = { state: 'terminal', terminalGameDay: 130, horseStatus: 'alive' };
    const gameDay = 130;

    expect(isDueForDeath(row, gameDay)).toBe(true);
    row.horseStatus = 'dead'; // what the tick's UPDATE ... WHERE status = 'alive' does
    expect(isDueForDeath(row, gameDay)).toBe(false);
  });

  it('a missed tick still catches up - the comparison is <=, not ===', () => {
    const row: FakeHorseCondition = { state: 'terminal', terminalGameDay: 130, horseStatus: 'alive' };
    expect(isDueForDeath(row, 150)).toBe(true); // the tick that should have run at 130 was skipped
  });

  it('a horse not yet due is left alone', () => {
    const row: FakeHorseCondition = { state: 'terminal', terminalGameDay: 130, horseStatus: 'alive' };
    expect(isDueForDeath(row, 129)).toBe(false);
  });

  it('an onset-state row (HYPP, PSSM1, HERDA) is never selected, regardless of date', () => {
    const row: FakeHorseCondition = { state: 'onset', terminalGameDay: null, horseStatus: 'alive' };
    expect(isDueForDeath(row, 999999)).toBe(false);
  });
});
