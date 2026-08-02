import { describe, expect, it } from 'vitest';
import { decideNextSlot } from '../src/tick/slot';

const SLOTS = ['07:00', '12:00', '19:00'];

describe('decideNextSlot', () => {
  it('nothing due: current time is between the last run slot and the next one', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-08-02', lastTickSlotLocal: '07:00' },
      { dateKey: '2026-08-02', minutesOfDay: 8 * 60 } // 08:00, before the 12:00 slot
    );
    expect(decision).toEqual({ run: false });
  });

  it('one slot due: current time has reached the next slot', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-08-02', lastTickSlotLocal: '07:00' },
      { dateKey: '2026-08-02', minutesOfDay: 12 * 60 + 5 } // 12:05
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-02', slot: '12:00' });
  });

  it('a slot already run: asking again at the same time yields nothing new', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-08-02', lastTickSlotLocal: '12:00' },
      { dateKey: '2026-08-02', minutesOfDay: 12 * 60 + 5 }
    );
    expect(decision).toEqual({ run: false });
  });

  it('the very first tick ever: nothing has run, and the first slot of today is still ahead', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: null, lastTickSlotLocal: null },
      { dateKey: '2026-08-02', minutesOfDay: 6 * 60 } // 06:00, before 07:00
    );
    expect(decision).toEqual({ run: false });
  });

  it('the very first tick ever, once the first slot has arrived', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: null, lastTickSlotLocal: null },
      { dateKey: '2026-08-02', minutesOfDay: 7 * 60 }
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-02', slot: '07:00' });
  });

  it('a missed slot from yesterday: the last slot ran yesterday evening, today\'s first slot is now due', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-08-01', lastTickSlotLocal: '19:00' },
      { dateKey: '2026-08-02', minutesOfDay: 7 * 60 + 30 }
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-02', slot: '07:00' });
  });

  it('two days behind still catches up one slot at a time rather than skipping', () => {
    // last run was the final slot two days ago; the next unrun slot is one day behind "today",
    // which is not yet more than two days behind, so it runs as normal.
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-07-31', lastTickSlotLocal: '19:00' },
      { dateKey: '2026-08-02', minutesOfDay: 20 * 60 }
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-01', slot: '07:00' });
  });

  it('more than two days behind: skips the backlog and runs the most recent elapsed slot today', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-07-27', lastTickSlotLocal: '19:00' },
      { dateKey: '2026-08-02', minutesOfDay: 20 * 60 } // 20:00, after all three slots today
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-02', slot: '19:00' });
  });

  it('more than two days behind, but no slot has elapsed today yet: nothing to run', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: SLOTS, lastTickLocalDate: '2026-07-27', lastTickSlotLocal: '19:00' },
      { dateKey: '2026-08-02', minutesOfDay: 6 * 60 } // 06:00, before the first slot today
    );
    expect(decision).toEqual({ run: false });
  });

  it('sorts unsorted slot lists before deciding', () => {
    const decision = decideNextSlot(
      { tickTimesLocal: ['19:00', '07:00', '12:00'], lastTickLocalDate: '2026-08-02', lastTickSlotLocal: '07:00' },
      { dateKey: '2026-08-02', minutesOfDay: 12 * 60 }
    );
    expect(decision).toEqual({ run: true, localDate: '2026-08-02', slot: '12:00' });
  });
});
