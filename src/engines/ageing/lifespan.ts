// Old age (slice 0011 §4). Pure, no database access (CLAUDE.md §5.1) - the caller rolls a lifespan
// once at birth and snapshots it onto horses.natural_death_game_day; nothing here ever re-reads it
// from live config, which is what makes retuning the numbers below leave a horse already alive
// untouched (CLAUDE.md §5.5).

import type { Rng } from '../../lib/rng';

export interface LifespanRollConfig {
  lifespan_mean_game_days: number;
  lifespan_sd_game_days: number;
  lifespan_min_game_days: number;
  lifespan_max_game_days: number;
}

/**
 * A normal draw around lifespan_mean_game_days, spread by lifespan_sd_game_days, clamped to
 * [lifespan_min_game_days, lifespan_max_game_days] and rounded to a whole day (§4.2). The clamp is
 * not decoration - a normal draw has tails, and without a floor an unlucky roll produces a foal
 * that dies at four, which is not old age and would read as a bug. When min equals max (a
 * degenerate but legal config), every draw clamps to that one value - no loop, nothing to retry.
 */
export function rollLifespanGameDays(rng: Rng, config: LifespanRollConfig): number {
  const raw = rng.normal(config.lifespan_mean_game_days, config.lifespan_sd_game_days);
  const clamped = Math.min(config.lifespan_max_game_days, Math.max(config.lifespan_min_game_days, raw));
  return Math.round(clamped);
}

export type AgeState = 'young' | 'adult' | 'veteran' | 'failing' | 'ended';

export interface AgeStateHorse {
  bornGameDay: number;
  /** Null until the tick's backfill stage assigns one (§7.1) - never reads as 'failing' while
   * null, no matter how old the horse is (§4.3). */
  naturalDeathGameDay: number | null;
  status: 'alive' | 'dead' | 'removed';
}

export interface AgeStateConfig {
  frailty_window_game_days: number;
  veteran_age_game_days: number;
  /** The threshold the game already uses for "not yet grown" - reused rather than inventing a
   * second one (§4.3). */
  min_breeding_age_game_days: number;
}

/**
 * §4.3's five states, checked in this order for a reason: 'ended' first (a dead horse is never
 * described as failing), then 'failing' - about remaining life, not age, so a horse that drew a
 * short lifespan can read as failing before it is even a veteran (§4.4's accepted oddity) - then
 * 'veteran' and 'young', both about age, then 'adult' for everything else.
 */
export function ageState(horse: AgeStateHorse, gameDay: number, config: AgeStateConfig): AgeState {
  if (horse.status !== 'alive') return 'ended';

  if (horse.naturalDeathGameDay !== null && horse.naturalDeathGameDay - gameDay <= config.frailty_window_game_days) {
    return 'failing';
  }

  const ageGameDays = gameDay - horse.bornGameDay;
  if (ageGameDays >= config.veteran_age_game_days) return 'veteran';
  if (ageGameDays < config.min_breeding_age_game_days) return 'young';
  return 'adult';
}
