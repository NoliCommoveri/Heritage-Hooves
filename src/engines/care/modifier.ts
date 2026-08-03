// Care: the farrier and wellness timers, feed, and the ±5% show-score modifier they produce
// together. Slice 0013 §4. Pure - no database access (CLAUDE.md §5.1) - and no randomness
// (CLAUDE.md §5.2/slice 0013 §9): every value here is a deterministic function of stored dates, a
// stored feed level and game_day. Two horses with the same care state always produce the same
// modifier.

export type CareStatus = 'not_yet' | 'fresh' | 'due_soon' | 'due' | 'overdue';

export interface TimerState {
  /** null = never called; the ramp then runs from careStartGameDay. */
  lastCallGameDay: number | null;
  careStartGameDay: number;
}

export interface TimerConfig {
  intervalGameDays: number;
  overdueGameDays: number;
  bonus: number;
  penalty: number;
}

export interface TimerResult {
  status: CareStatus;
  delta: number;
  /** Positive = due in this many days; 0 at the due day itself; negative = overdue by this many
   * days. Rendered as "due in 12 days" / "overdue by 30 days". */
  daysUntilDue: number;
  /** True when a round should include this horse and a notice should count it - due or overdue. */
  needsCall: boolean;
}

/** §4.4: a barn round should not re-shoe a horse that was done a few days ago - "due soon" starts
 * at 80% of the interval and is a display state only, never a needsCall trigger. */
const DUE_SOON_FRACTION = 0.8;

/**
 * §4.1's ramp, read in plain English: being current is neutral, being prompt is a small bonus that
 * fades as the next visit comes due, being late is a penalty that grows gradually and then stops
 * growing. No discontinuity anywhere in it (overview §8a's "neglect should degrade gradually and
 * recover, not produce cliff edges"), and one call restores a horse to the top of the ramp
 * instantly.
 *
 * A horse that has never been called and has not yet reached its care-start age (§4.2) reads as
 * 'not_yet' rather than counting down towards a due date it was never given - a foal is not
 * overdue for a farrier visit it is too young to need.
 */
export function timerState(state: TimerState, cfg: TimerConfig, gameDay: number): TimerResult {
  if (state.lastCallGameDay === null && gameDay < state.careStartGameDay) {
    return {
      status: 'not_yet',
      delta: 0,
      daysUntilDue: state.careStartGameDay + cfg.intervalGameDays - gameDay,
      needsCall: false,
    };
  }

  const anchor = state.lastCallGameDay ?? state.careStartGameDay;
  const daysSince = gameDay - anchor;
  const daysUntilDue = cfg.intervalGameDays - daysSince;

  if (daysSince <= 0) {
    return { status: 'fresh', delta: cfg.bonus, daysUntilDue, needsCall: false };
  }
  if (daysSince < cfg.intervalGameDays) {
    const delta = cfg.bonus * (1 - daysSince / cfg.intervalGameDays);
    const status: CareStatus = daysSince >= cfg.intervalGameDays * DUE_SOON_FRACTION ? 'due_soon' : 'fresh';
    return { status, delta, daysUntilDue, needsCall: false };
  }
  if (daysSince === cfg.intervalGameDays) {
    return { status: 'due', delta: 0, daysUntilDue, needsCall: true };
  }
  if (daysSince < cfg.overdueGameDays) {
    const delta = -cfg.penalty * ((daysSince - cfg.intervalGameDays) / (cfg.overdueGameDays - cfg.intervalGameDays));
    return { status: 'overdue', delta, daysUntilDue, needsCall: true };
  }
  return { status: 'overdue', delta: -cfg.penalty, daysUntilDue, needsCall: true };
}

/** The JSON shape of config.values.feed_levels (slice 0013 §4.3) - one object so a level can be
 * retuned or a fourth added without a code change. */
export interface FeedLevelDefinition {
  name: string;
  upkeep_multiplier: number;
  care_delta: number;
}

export interface FeedLevelsConfig {
  v: number;
  levels: Record<string, FeedLevelDefinition>;
}

const DEFAULT_FEED_LEVEL = 'standard';
const FALLBACK_FEED_LEVEL: FeedLevelDefinition = { name: 'Standard', upkeep_multiplier: 1, care_delta: 0 };

/** An unrecognised feed_level string (e.g. a level retired from config) reads as 'standard' rather
 * than throwing (§5.3's own comment on the stables.feed_level column). */
export function feedLevelDefinition(feedLevel: string, feedLevels: FeedLevelsConfig): FeedLevelDefinition {
  return feedLevels.levels[feedLevel] ?? feedLevels.levels[DEFAULT_FEED_LEVEL] ?? FALLBACK_FEED_LEVEL;
}

export interface CareModifierParams {
  farrier: TimerState;
  farrierConfig: TimerConfig;
  wellness: TimerState;
  wellnessConfig: TimerConfig;
  feedDelta: number;
  /** Part B (condition management, slice 0013 §4.5) was not built this session - always 0. Left as
   * an explicit parameter so a future session wires it in without touching this function's shape. */
  conditionDelta: number;
  gameDay: number;
  modifierMin: number;
  modifierMax: number;
}

export interface CareModifierResult {
  /** Clamped to [modifierMin, modifierMax] - §2.4's guarantee. */
  modifier: number;
  /** Before the clamp - for the admin screen and for testing the clamp itself. */
  unclampedModifier: number;
  farrier: TimerResult;
  wellness: TimerResult;
  feedDelta: number;
  conditionDelta: number;
}

/**
 * §2.4: the modifier is a sum of small deltas, then clamped last. The clamp - not the components -
 * is what guarantees the ±5% band holds regardless of how many components a future slice adds.
 */
export function careModifier(params: CareModifierParams): CareModifierResult {
  const farrier = timerState(params.farrier, params.farrierConfig, params.gameDay);
  const wellness = timerState(params.wellness, params.wellnessConfig, params.gameDay);
  const unclampedModifier = 1 + farrier.delta + wellness.delta + params.feedDelta + params.conditionDelta;
  const modifier = Math.min(params.modifierMax, Math.max(params.modifierMin, unclampedModifier));
  return { modifier, unclampedModifier, farrier, wellness, feedDelta: params.feedDelta, conditionDelta: params.conditionDelta };
}
