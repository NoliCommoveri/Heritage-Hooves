import { describe, expect, it } from 'vitest';
import { actionsRemaining, nextTickLocalTime } from '../src/lib/actions';

describe('actionsRemaining', () => {
  it('an account whose actions_reset_tick_seq matches the current tick reports its stored remainder', () => {
    expect(actionsRemaining({ actions_remaining: 3, actions_reset_tick_seq: 12 }, 12, 6)).toBe(3);
  });

  it('an account behind the current tick reports a full budget regardless of what it has stored', () => {
    expect(actionsRemaining({ actions_remaining: 0, actions_reset_tick_seq: 11 }, 12, 6)).toBe(6);
  });

  it('an account ahead of the current tick (impossible, but assert it anyway) reports full rather than something negative', () => {
    expect(actionsRemaining({ actions_remaining: -5, actions_reset_tick_seq: 13 }, 12, 6)).toBe(6);
  });

  it('a fresh account with both columns 0, at tick 12, reports full', () => {
    expect(actionsRemaining({ actions_remaining: 0, actions_reset_tick_seq: 0 }, 12, 6)).toBe(6);
  });
});

describe('nextTickLocalTime', () => {
  it('finds the next slot later today', () => {
    expect(nextTickLocalTime(['07:00', '12:00', '19:00'], 8 * 60)).toBe('12:00');
  });

  it('wraps to the earliest slot once every slot today has passed', () => {
    expect(nextTickLocalTime(['07:00', '12:00', '19:00'], 20 * 60)).toBe('07:00');
  });

  it('sorts unsorted input before searching', () => {
    expect(nextTickLocalTime(['19:00', '07:00', '12:00'], 0)).toBe('07:00');
  });
});
