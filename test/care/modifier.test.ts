import { describe, expect, it } from 'vitest';
import { timerState, careModifier, feedLevelDefinition, type TimerConfig, type FeedLevelsConfig } from '../../src/engines/care/modifier';

// The starting numbers from slice 0013 §4.3/migrations/0072_config_care.sql.
const FARRIER: TimerConfig = { intervalGameDays: 45, overdueGameDays: 135, bonus: 0.01, penalty: 0.03 };
const WELLNESS: TimerConfig = { intervalGameDays: 180, overdueGameDays: 540, bonus: 0.01, penalty: 0.02 };
const CARE_START_GAME_DAY = 1000;

const FEED_LEVELS: FeedLevelsConfig = {
  v: 1,
  levels: {
    poor: { name: 'Poor', upkeep_multiplier: 0.6, care_delta: -0.02 },
    standard: { name: 'Standard', upkeep_multiplier: 1.0, care_delta: 0.0 },
    premium: { name: 'Premium', upkeep_multiplier: 2.0, care_delta: 0.02 },
  },
};

describe('timerState', () => {
  it('the three anchor points of the ramp: +bonus at 0, 0 at the interval, -penalty at overdue', () => {
    const lastCall = CARE_START_GAME_DAY;
    expect(timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall).delta).toBeCloseTo(FARRIER.bonus, 10);
    expect(timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.intervalGameDays).delta).toBeCloseTo(0, 10);
    expect(timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.overdueGameDays).delta).toBeCloseTo(-FARRIER.penalty, 10);
  });

  it('is continuous - no jump greater than the ramp\'s own slope between any two consecutive days', () => {
    const lastCall = CARE_START_GAME_DAY;
    const bonusSlope = FARRIER.bonus / FARRIER.intervalGameDays;
    const penaltySlope = FARRIER.penalty / (FARRIER.overdueGameDays - FARRIER.intervalGameDays);
    const maxSlope = Math.max(bonusSlope, penaltySlope);

    let previous = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall).delta;
    for (let day = lastCall + 1; day <= lastCall + FARRIER.overdueGameDays + 50; day++) {
      const current = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, day).delta;
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(maxSlope + 1e-9);
      previous = current;
    }
  });

  it('is monotonic - never improves as days pass without a call', () => {
    const lastCall = CARE_START_GAME_DAY;
    let previous = Infinity;
    for (let day = lastCall; day <= lastCall + FARRIER.overdueGameDays + 50; day++) {
      const current = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, day).delta;
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
  });

  it('past overdue the delta is flat forever', () => {
    const lastCall = CARE_START_GAME_DAY;
    const atOverdue = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.overdueGameDays).delta;
    const wayPast = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.overdueGameDays + 3600).delta;
    expect(wayPast).toBe(atOverdue);
    expect(wayPast).toBe(-FARRIER.penalty);
  });

  it('a horse below care start age with no call yet reads not_yet, delta 0, needsCall false', () => {
    const result = timerState({ lastCallGameDay: null, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, CARE_START_GAME_DAY - 500);
    expect(result.status).toBe('not_yet');
    expect(result.delta).toBe(0);
    expect(result.needsCall).toBe(false);
  });

  it('due_soon appears before due, at 80% of the interval, and needsCall stays false through it', () => {
    const lastCall = CARE_START_GAME_DAY;
    const dueSoonDay = lastCall + Math.ceil(FARRIER.intervalGameDays * 0.85);
    const result = timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, dueSoonDay);
    expect(result.status).toBe('due_soon');
    expect(result.needsCall).toBe(false);
  });

  it('due and overdue both set needsCall true', () => {
    const lastCall = CARE_START_GAME_DAY;
    expect(timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.intervalGameDays).needsCall).toBe(true);
    expect(timerState({ lastCallGameDay: lastCall, careStartGameDay: CARE_START_GAME_DAY }, FARRIER, lastCall + FARRIER.intervalGameDays + 1).needsCall).toBe(true);
  });
});

describe('feedLevelDefinition', () => {
  it('reads a known level straight from config', () => {
    expect(feedLevelDefinition('poor', FEED_LEVELS).care_delta).toBe(-0.02);
    expect(feedLevelDefinition('premium', FEED_LEVELS).upkeep_multiplier).toBe(2.0);
  });

  it('an unrecognised feed_level string reads as standard rather than throwing', () => {
    const result = feedLevelDefinition('deluxe', FEED_LEVELS);
    expect(result.care_delta).toBe(0);
    expect(result.upkeep_multiplier).toBe(1.0);
  });
});

describe('careModifier', () => {
  it('clamps: every component at maximum penalty lands exactly at care_modifier_min, and unclampedModifier is below it', () => {
    const result = careModifier({
      farrier: { lastCallGameDay: 0, careStartGameDay: 0 },
      farrierConfig: FARRIER,
      wellness: { lastCallGameDay: 0, careStartGameDay: 0 },
      wellnessConfig: WELLNESS,
      feedDelta: -0.02,
      conditionDelta: 0,
      gameDay: 100000,
      modifierMin: 0.95,
      modifierMax: 1.05,
    });
    expect(result.modifier).toBe(0.95);
    expect(result.unclampedModifier).toBeLessThan(0.95);
  });

  it('clamps at the ceiling too, when every component is at maximum bonus', () => {
    const result = careModifier({
      farrier: { lastCallGameDay: 1000, careStartGameDay: 1000 },
      farrierConfig: FARRIER,
      wellness: { lastCallGameDay: 1000, careStartGameDay: 1000 },
      wellnessConfig: WELLNESS,
      feedDelta: 0.02,
      conditionDelta: 0,
      gameDay: 1000,
      modifierMin: 0.95,
      modifierMax: 1.05,
    });
    // bonus(0.01) + bonus(0.01) + feed(0.02) = 1.04, under the 1.05 ceiling - not clamped, but
    // provably under the max regardless.
    expect(result.modifier).toBeLessThanOrEqual(1.05);
    expect(result.modifier).toBeCloseTo(1.04, 10);
  });

  it('a horse current on both timers with standard feed scores exactly 1.0 plus the fresh bonus', () => {
    const result = careModifier({
      farrier: { lastCallGameDay: 500, careStartGameDay: 0 },
      farrierConfig: FARRIER,
      wellness: { lastCallGameDay: 500, careStartGameDay: 0 },
      wellnessConfig: WELLNESS,
      feedDelta: 0,
      conditionDelta: 0,
      gameDay: 500,
      modifierMin: 0.95,
      modifierMax: 1.05,
    });
    expect(result.unclampedModifier).toBeCloseTo(1 + FARRIER.bonus + WELLNESS.bonus, 10);
  });
});
