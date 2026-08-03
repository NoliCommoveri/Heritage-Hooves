// Where a horse is, and what that stops it doing. Added alongside slice 0013's care model at the
// operator's request. Pure - no database access (CLAUDE.md §5.1), nothing random, and no wall
// clock: every decision here is game_day arithmetic (CLAUDE.md §5.3).
//
// The three rules, settled with the operator before building:
//   1. A horse at pasture costs no board (config.values.pasture_upkeep_multiplier, 0 today).
//   2. A horse brought in from pasture is "settling in" for pasture_settle_game_days before it can
//      be bred or shown. Turning out is immediate; only coming back in has a wait.
//   3. A mare carrying a foal cannot be turned out at all - she stays in until she has foaled.
//
// Rule 2 is what holds the whole design up. Without it, free pasture is free storage: a player
// parks every horse outside, pays nothing, and brings one in on show morning at no cost. With it,
// turning a horse out is a real decision about the next stretch of its career - which is what makes
// the free board defensible rather than a hole in the economy.

export type HorseLocation = 'barn' | 'pasture';

export interface LocationState {
  location: HorseLocation;
  /** horses.location_changed_game_day - null for a horse that has never moved. */
  locationChangedGameDay: number | null;
}

export type WorkAvailability =
  | { available: true }
  | { available: false; reason: 'at_pasture' }
  | { available: false; reason: 'settling_in'; daysRemaining: number };

/**
 * Whether a horse can be bred or entered in a show right now. The one function breeding, show
 * eligibility and every screen calls - there is deliberately no second place that decides this, for
 * the same reason slice 0013 §4.4 keeps `timerState` as the only judge of "overdue".
 *
 * A null locationChangedGameDay reads as settled: the horse has never moved, so there is no
 * settling period for it to be inside of. A marker somehow in the future (config cannot cause
 * this, but an admin time control could) reads as still settling - the conservative direction,
 * since it delays an entry rather than allowing one that should not happen.
 */
export function workAvailability(state: LocationState, gameDay: number, settleGameDays: number): WorkAvailability {
  if (state.location === 'pasture') return { available: false, reason: 'at_pasture' };
  if (state.locationChangedGameDay === null || settleGameDays <= 0) return { available: true };

  const settledOn = state.locationChangedGameDay + settleGameDays;
  if (gameDay >= settledOn) return { available: true };
  return { available: false, reason: 'settling_in', daysRemaining: settledOn - gameDay };
}

/** Convenience for the call sites that only need the boolean. */
export function isAvailableForWork(state: LocationState, gameDay: number, settleGameDays: number): boolean {
  return workAvailability(state, gameDay, settleGameDays).available;
}

/**
 * How many game days of frozen care time a horse currently at pasture has accrued - what the
 * bring-in statement credits back onto its two care timers (see migrations/0073's comment on why
 * one column serves both purposes).
 *
 * Zero for a horse in the barn, and zero rather than negative if the marker is missing or in the
 * future. The invariant that makes the credit exact: a care call is refused for a horse at pasture
 * (src/db/care.ts and the route both check), so last_farrier_game_day <= location_changed_game_day
 * always holds while it is out, and crediting the full time out can therefore never push a timer
 * past today.
 */
export function frozenCareDays(state: LocationState, gameDay: number): number {
  if (state.location !== 'pasture' || state.locationChangedGameDay === null) return 0;
  return Math.max(0, gameDay - state.locationChangedGameDay);
}
