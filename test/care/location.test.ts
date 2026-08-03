import { describe, expect, it } from 'vitest';
import { workAvailability, isAvailableForWork, frozenCareDays } from '../../src/engines/care/location';
import { timerState, type TimerConfig } from '../../src/engines/care/modifier';

const SETTLE = 30;

describe('workAvailability', () => {
  it('a horse that has never moved is available', () => {
    expect(workAvailability({ location: 'barn', locationChangedGameDay: null }, 500, SETTLE)).toEqual({ available: true });
  });

  it('a horse at pasture is never available, however long it has been out', () => {
    expect(workAvailability({ location: 'pasture', locationChangedGameDay: 100 }, 100, SETTLE)).toEqual({ available: false, reason: 'at_pasture' });
    expect(workAvailability({ location: 'pasture', locationChangedGameDay: 100 }, 99_999, SETTLE)).toEqual({ available: false, reason: 'at_pasture' });
  });

  it('counts down the settling window and reports the days left', () => {
    const home = { location: 'barn' as const, locationChangedGameDay: 100 };
    expect(workAvailability(home, 100, SETTLE)).toEqual({ available: false, reason: 'settling_in', daysRemaining: 30 });
    expect(workAvailability(home, 118, SETTLE)).toEqual({ available: false, reason: 'settling_in', daysRemaining: 12 });
    expect(workAvailability(home, 129, SETTLE)).toEqual({ available: false, reason: 'settling_in', daysRemaining: 1 });
  });

  it('becomes available on the settling day itself, not the day after', () => {
    const home = { location: 'barn' as const, locationChangedGameDay: 100 };
    expect(workAvailability(home, 129, SETTLE).available).toBe(false);
    expect(workAvailability(home, 130, SETTLE)).toEqual({ available: true });
    expect(workAvailability(home, 131, SETTLE)).toEqual({ available: true });
  });

  it('a settle period of 0 makes coming in immediate', () => {
    expect(workAvailability({ location: 'barn', locationChangedGameDay: 100 }, 100, 0)).toEqual({ available: true });
  });

  /** Not reachable through config, but an admin time control could wind the world back. Delaying an
   * entry is the safe direction; allowing one that should not happen is not. */
  it('a marker in the future reads as still settling rather than available', () => {
    expect(workAvailability({ location: 'barn', locationChangedGameDay: 200 }, 100, SETTLE).available).toBe(false);
  });

  it('isAvailableForWork agrees with workAvailability', () => {
    const cases = [
      { location: 'barn' as const, locationChangedGameDay: null },
      { location: 'barn' as const, locationChangedGameDay: 100 },
      { location: 'pasture' as const, locationChangedGameDay: 100 },
    ];
    for (const state of cases) {
      expect(isAvailableForWork(state, 110, SETTLE)).toBe(workAvailability(state, 110, SETTLE).available);
    }
  });
});

describe('frozenCareDays', () => {
  it('is zero for a horse in the barn, whatever its marker says', () => {
    expect(frozenCareDays({ location: 'barn', locationChangedGameDay: 100 }, 500)).toBe(0);
  });

  it('is zero for a horse with no marker at all', () => {
    expect(frozenCareDays({ location: 'pasture', locationChangedGameDay: null }, 500)).toBe(0);
  });

  it('counts the game days since it was turned out', () => {
    expect(frozenCareDays({ location: 'pasture', locationChangedGameDay: 100 }, 100)).toBe(0);
    expect(frozenCareDays({ location: 'pasture', locationChangedGameDay: 100 }, 460)).toBe(360);
  });

  it('never goes negative', () => {
    expect(frozenCareDays({ location: 'pasture', locationChangedGameDay: 200 }, 100)).toBe(0);
  });
});

const FARRIER: TimerConfig = { intervalGameDays: 45, overdueGameDays: 135, bonus: 0.01, penalty: 0.03 };

describe('care timers at pasture', () => {
  it('a pastured horse is off the clock entirely, however stale its dates are', () => {
    const result = timerState({ lastCallGameDay: 0, careStartGameDay: 1080, atPasture: true }, FARRIER, 9_000);
    expect(result.status).toBe('at_pasture');
    expect(result.delta).toBe(0);
    expect(result.needsCall).toBe(false);
  });

  it('the same horse in the barn would be fully overdue - so the flag is doing the work', () => {
    const result = timerState({ lastCallGameDay: 0, careStartGameDay: 1080, atPasture: false }, FARRIER, 9_000);
    expect(result.status).toBe('overdue');
    expect(result.delta).toBe(-FARRIER.penalty);
    expect(result.needsCall).toBe(true);
  });

  /** The reason the ramp itself needed no location arithmetic: bringing a horse in credits the
   * frozen days back onto its timer, so a horse that goes out fresh comes home fresh. This is that
   * credit done in JS exactly as bringInFromPasture does it in SQL. */
  it('crediting the frozen days back leaves a horse exactly where it was when it went out', () => {
    const turnedOutOn = 2_000;
    const lastShod = 1_980; // 20 days into a 45-day cycle when it went out.
    const before = timerState({ lastCallGameDay: lastShod, careStartGameDay: 1080 }, FARRIER, turnedOutOn);

    const cameHomeOn = 2_720;
    const frozen = frozenCareDays({ location: 'pasture', locationChangedGameDay: turnedOutOn }, cameHomeOn);
    const credited = Math.min(lastShod + frozen, cameHomeOn);
    const after = timerState({ lastCallGameDay: credited, careStartGameDay: 1080 }, FARRIER, cameHomeOn);

    expect(after.status).toBe(before.status);
    expect(after.delta).toBeCloseTo(before.delta, 10);
    expect(after.daysUntilDue).toBe(before.daysUntilDue);
  });

  it('the credit can never push a timer past today, even for a horse turned out freshly shod', () => {
    const turnedOutOn = 2_000;
    const lastShod = 2_000;
    const cameHomeOn = 5_000;
    const frozen = frozenCareDays({ location: 'pasture', locationChangedGameDay: turnedOutOn }, cameHomeOn);
    expect(Math.min(lastShod + frozen, cameHomeOn)).toBe(cameHomeOn);
  });
});
