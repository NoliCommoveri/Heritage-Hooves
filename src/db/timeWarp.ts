// The per-horse time warp, 2026-08-05 (migration 0159). One horse is moved forward in its own life;
// the world clock does not move, and no other horse is touched.
//
// The mechanism is deliberately the plainest one available: **every game day this horse's own
// timeline is measured from moves back by the same number of days.** That is `born_game_day`, its
// natural death, and the two birth-anchored dates on its conditions. Nothing else in the game reads
// an absolute date that belongs to one horse's birth, which is exactly why this is a short file - if
// a future slice adds such a column, it belongs in `buildTimeWarpStatements` and the test that
// enumerates them will not tell you, because nothing can enumerate a column that does not exist yet.
//
// **What is deliberately NOT simulated**, on the operator's instruction: the skipped months charge
// no board, roll no acquired incidents, and advance no care timers ("no upkeep cost, thats part of
// the cost of the advance"). Buying six months and being handed back a lame, half-starved horse
// would be exactly the frustration this exists to remove.
//
// **The one exception, also the operator's**: a lethal genetic condition the horse already carries
// still kills it on schedule. Moving `terminal_game_day` back with the birth date is what makes that
// true - a GBED foal warped to a yearling is a GBED foal that died on the way. That is a fact about
// the horse rather than a chance event, and difficulty (src/engines/incidents/difficulty.ts) does
// not soften it either.

import type { Env } from '../types';
import type { ConfigValues } from '../lib/config-cache';
import { buildLedgerStatements } from './ledger';
import type { HorseRow } from './horses';

export interface TimeWarpPlan {
  /** How many game days this purchase actually advances the horse - the configured step, or less
   * when the horse is nearly grown. */
  days: number;
  cost: number;
  /** True when the step was shortened by the maturity cap, so the button can say so before it is
   * pressed rather than after. */
  clamped: boolean;
}

/**
 * What a warp would do to this horse right now, or null when it cannot be bought at all. Pure
 * arithmetic - the caller checks money, turns and ownership.
 *
 * The cap is `min_breeding_age_game_days`: a horse can be brought up to grown and no further. That
 * is the operator's own boundary ("just to maturity"), and it is what stops the warp being a way to
 * push a mare through her breeding years or a veteran toward its death date.
 */
export function planTimeWarp(horse: HorseRow, gameDay: number, cfg: ConfigValues): TimeWarpPlan | null {
  if (horse.status !== 'alive') return null;
  const ageGameDays = gameDay - horse.born_game_day;
  const remaining = cfg.min_breeding_age_game_days - ageGameDays;
  if (remaining <= 0) return null;

  const step = Math.max(0, Math.round(cfg.time_warp_game_days));
  if (step === 0) return null;

  const days = Math.min(step, remaining);
  return { days, cost: cfg.time_warp_cost, clamped: days < step };
}

/**
 * Every write one warp makes. Batched by the caller together with nothing else - a warp is its own
 * transaction.
 *
 * `born_game_day` moves back rather than an age offset being stored anywhere: age is derived from it
 * in something like forty places (care start, conformation realisation, show eligibility, ageing
 * bands, market appraisal, breeding maturity), and a second source of truth for "how old is this
 * horse" would be wrong in some of them within one slice.
 *
 * The care markers are reset to today rather than left where they were. Left alone, a foal whose
 * care timers had not started yet would wake up past its own care-start day with no farrier visit on
 * record and read as immediately overdue - charging the player, in care penalty, for the months the
 * warp explicitly did not simulate.
 */
export function buildTimeWarpStatements(env: Env, params: { horse: HorseRow; horseName: string; days: number; cost: number; gameDay: number }): D1PreparedStatement[] {
  const { horse, days, gameDay } = params;
  return [
    env.DB
      .prepare(
        `UPDATE horses
            SET born_game_day = born_game_day - ?,
                natural_death_game_day = CASE WHEN natural_death_game_day IS NULL THEN NULL ELSE natural_death_game_day - ? END,
                last_farrier_game_day = ?,
                last_vet_game_day = ?,
                last_incident_check_game_day = ?
          WHERE id = ? AND status = 'alive'`
      )
      .bind(days, days, gameDay, gameDay, gameDay, horse.id),
    // Both are absolute days snapshotted from this horse's own birth (CLAUDE.md §5.5), so both move
    // with it. terminal_game_day landing in the past is the point, not a bug: killDueLethalFoals
    // finds it on the next tick and the foal dies, exactly as it would have done in real time.
    env.DB
      .prepare(
        `UPDATE horse_conditions
            SET terminal_game_day = CASE WHEN terminal_game_day IS NULL THEN NULL ELSE terminal_game_day - ? END,
                signs_game_day = CASE WHEN signs_game_day IS NULL THEN NULL ELSE signs_game_day - ? END
          WHERE horse_id = ?`
      )
      .bind(days, days, horse.id),
    ...buildLedgerStatements(env, [
      {
        stableId: horse.owner_stable_id,
        gameDay,
        kind: 'time_warp',
        amount: -params.cost,
        description: `Grew ${params.horseName} up by ${String(days)} days.`,
        referenceType: 'horse',
        referenceId: horse.id,
      },
    ]),
  ];
}
