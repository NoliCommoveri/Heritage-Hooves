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
 *
 * Two multipliers ride on the base rate:
 *   - feedMultiplier (slice 0013 §2.5/§7.1) scales the horses in the barn. Feed multiplies board
 *     rather than creating a second recurring charge, because feed *is* board.
 *   - pastureMultiplier (the location flag) scales the horses turned out. 0 today: a horse at grass
 *     costs nothing to keep. A multiplier rather than a hardcoded skip so board can be made to cost
 *     something again from /admin/config without a deploy.
 *
 * The two groups are rounded separately and then added rather than summed and rounded once. That is
 * deliberate: it keeps the barn's charge byte-for-byte what this function returned before pasture
 * existed whenever every horse is in the barn - which is the state every stable is in the moment
 * the location flag deploys.
 */
export interface UpkeepCharge {
  /** Negative or zero - the ledger amount this stable owes. */
  amount: number;
  /** Whether last_upkeep_game_day should move to the new game day. */
  advanceMarker: boolean;
}

export function computeUpkeep(params: {
  daysOwed: number;
  /** Alive horses in the barn - the ones feed and full board apply to. */
  aliveHorses: number;
  ratePerHorsePerGameDay: number;
  feedMultiplier?: number;
  /** Alive horses at pasture. Defaults to 0 so every pre-flag caller keeps its exact behaviour. */
  pastureHorses?: number;
  pastureMultiplier?: number;
}): UpkeepCharge {
  if (params.daysOwed <= 0) return { amount: 0, advanceMarker: false };
  const feedMultiplier = params.feedMultiplier ?? 1;
  const pastureHorses = params.pastureHorses ?? 0;
  const pastureMultiplier = params.pastureMultiplier ?? 0;
  // Money is always an integer (CLAUDE.md §7) - each group rounded after its own factors are
  // applied, per slice 0013 §7.1 and the note above on why the two are rounded separately.
  const barnOwed = Math.round(params.aliveHorses * params.daysOwed * params.ratePerHorsePerGameDay * feedMultiplier);
  const pastureOwed = Math.round(pastureHorses * params.daysOwed * params.ratePerHorsePerGameDay * pastureMultiplier);
  const owed = barnOwed + pastureOwed;
  // owed === 0 (no horses, every horse at grass on a free pasture multiplier, or a days/rate
  // combination that rounds to zero) would otherwise negate to -0, which is a legal but confusing number to store or compare - JS's own -(0) is -0, and
  // Object.is(-0, 0) is false.
  return { amount: owed === 0 ? 0 : -owed, advanceMarker: true };
}
