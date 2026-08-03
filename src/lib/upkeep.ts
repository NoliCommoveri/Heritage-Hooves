/**
 * The tick's per-stable upkeep arithmetic (slice 0009 §4.3), pure so it's testable without D1.
 * `daysOwed` is `newGameDay - stable.last_upkeep_game_day`, computed by the caller. Idempotent by
 * construction (CLAUDE.md §5.4): a re-fired tick recomputes daysOwed against the already-advanced
 * marker and gets zero; a missed tick recomputes against a larger gap and charges the days that
 * actually passed.
 *
 * `advanceMarker` is true whenever daysOwed > 0, even for a stable with no horses (amount 0) -
 * without stamping last_upkeep_game_day forward for an empty stable, the day it buys its first
 * horse it would be charged for every game day since it was founded, for horses it never owned.
 */
export interface UpkeepCharge {
  /** Negative or zero - the ledger amount this stable owes. */
  amount: number;
  /** Whether last_upkeep_game_day should move to the new game day. */
  advanceMarker: boolean;
}

export function computeUpkeep(params: { daysOwed: number; aliveHorses: number; ratePerHorsePerGameDay: number; feedMultiplier?: number }): UpkeepCharge {
  if (params.daysOwed <= 0) return { amount: 0, advanceMarker: false };
  const feedMultiplier = params.feedMultiplier ?? 1;
  // Money is always an integer (CLAUDE.md §7) - rounded once, after every factor is applied, per
  // slice 0013 §7.1.
  const owed = Math.round(params.aliveHorses * params.daysOwed * params.ratePerHorsePerGameDay * feedMultiplier);
  // owed === 0 (no horses, or a days/rate combination that rounds to zero) would otherwise negate
  // to -0, which is a legal but confusing number to store or compare - JS's own -(0) is -0, and
  // Object.is(-0, 0) is false.
  return { amount: owed === 0 ? 0 : -owed, advanceMarker: true };
}
