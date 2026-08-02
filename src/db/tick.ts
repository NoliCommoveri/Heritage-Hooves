// The tick's SQL. CLAUDE.md §5.4: a re-fired or double-fired tick must not double-advance
// anything; §8.2/§8.5 of the slice document describe exactly what a run does.
//
// The initial tick_run insert (status 'error' by default) is committed on its own before the
// world update runs, so a thrown error downstream still leaves a diagnosable row behind - D1
// does not give us a way to hold that insert open across a later failure the way a real nested
// transaction would.
import type { Env } from '../types';
import { getWorld } from './world';
import { getConfig } from '../lib/config-cache';
import { nowUtcSeconds } from '../lib/time';
import { resolveDueCoverings } from './coverings';
import { foalDuePregnancies } from './pregnancies';
import { createDueShows, judgeDueShowClasses } from './shows';
import { chargeUpkeep } from './upkeep';
import { deleteOldEvents } from './events';
import { killDueLethalFoals } from './health';
import { assignLifespansAndNoticeFrailty, killDueOldHorses } from './ageing';

export interface ExecuteTickParams {
  triggerSource: 'cron' | 'manual';
  /** The slot this run was meant to be, e.g. "07:00". Null for manual runs. */
  intendedLocalTime: string | null;
  /** The local date (YYYY-MM-DD) the slot belongs to. */
  localDate: string;
  /** What the local time actually was when the run happened. */
  firedLocalTime: string;
  /** Cron runs update world.last_tick_local_date/slot/real_ts; manual runs do not. */
  updateSlotBookkeeping: boolean;
}

export async function executeTick(env: Env, params: ExecuteTickParams): Promise<void> {
  const world = await getWorld(env);
  const config = await getConfig(env);
  const startedRealTs = nowUtcSeconds();
  const newTickSeq = world.tick_seq + 1;

  const insertResult = await env.DB.prepare(
    `INSERT INTO tick_run
       (tick_seq, stage, trigger_source, intended_local_time, fired_local_time, local_date, started_real_ts, game_day_before, status)
     VALUES (?, 'clock', ?, ?, ?, ?, ?, ?, 'error')`
  )
    .bind(newTickSeq, params.triggerSource, params.intendedLocalTime, params.firedLocalTime, params.localDate, startedRealTs, world.game_day)
    .run();
  const tickRunId = insertResult.meta.last_row_id;

  try {
    let newGameDay = world.game_day;
    let newSeasonIndex = world.season_index;
    let status: 'ok' | 'skipped_paused';

    if (world.paused === 0) {
      newGameDay = world.game_day + config.values.game_days_per_tick;
      newSeasonIndex = Math.floor(newGameDay / config.values.game_days_per_year);
      status = 'ok';
      // Slice 0003 §10: physics resolves against the tick's new game_day/tick_seq before the world
      // row itself is updated below, so a failure here leaves world untouched and a retry recomputes
      // the same newGameDay/newTickSeq and finds the same (still-pending) rows to process - both
      // stages guard their own writes with a status column, so re-running them is a no-op either way.
      await resolveDueCoverings(env, newGameDay, newTickSeq, config);
      await foalDuePregnancies(env, newGameDay, newTickSeq);
      // Slice 0010 §6.1: after foaling, since a foal born this tick needs its horse_conditions row
      // written first (though at a 30 game day window it cannot die on the tick it is born) - and
      // before chargeUpkeep, so a horse that dies this tick is not billed for board over the period
      // it partly lived. Idempotency comes free from horses.status = 'alive' (see that function's
      // own comment) - no processed-marker column needed here either.
      await killDueLethalFoals(env, newGameDay);
      // Slice 0011 §7.5: after foalDuePregnancies and killDueLethalFoals, before createDueShows.
      // A mare due to foal and due to die of old age on the same tick foals first, then dies - the
      // foal lives, and that ordering is deliberate (see the comment on the "after
      // foalDuePregnancies" point below). assignLifespansAndNoticeFrailty runs before
      // killDueOldHorses so a horse backfilled with a lifespan this same tick can, in principle,
      // already be due - both share the natural_death_game_day column, so there is nothing to lose
      // by keeping them adjacent.
      await assignLifespansAndNoticeFrailty(env, newGameDay, config);
      // Guarded by `status = 'alive'` on its own update (killDueLethalFoals' own comment explains
      // why that alone gives idempotency) and ordered after it: both stages guard the same column,
      // so whichever runs first wins, and a foal that is both GBED-terminal and at its natural end
      // dies of GBED - the more specific, more useful end_reason (§7.5).
      await killDueOldHorses(env, newGameDay, config);
      // Slice 0008 §6: show creation before judging, same reasoning as the breeding stages above -
      // both stages guard their own writes (the UNIQUE(scheduled_game_day, tier) index and each
      // class's own status column), so re-running them against the same newGameDay is a no-op.
      await createDueShows(env, newGameDay, config);
      await judgeDueShowClasses(env, newGameDay, config);
      // Slice 0009 §4.3: charged from the world clock's game_day, not tick_seq - this stage never
      // runs on a paused tick (it sits inside this same paused === 0 branch) and re-derives what's
      // owed from each stable's own last_upkeep_game_day, so a re-fired or missed tick is safe the
      // same way the stages above are.
      await chargeUpkeep(env, newGameDay, newTickSeq, config);
      // Slice 0009 Part B §6.4: a notice board, not an archive - deletes every event (read or not)
      // older than events_retention_game_days. Sits inside this same paused === 0 branch so it
      // never runs on a paused tick either, matching upkeep's own reasoning above.
      await deleteOldEvents(env, newGameDay, config.values.events_retention_game_days);
    } else {
      status = 'skipped_paused';
    }

    const completedRealTs = nowUtcSeconds();

    const worldUpdateSql = params.updateSlotBookkeeping
      ? `UPDATE world SET tick_seq = ?, game_day = ?, season_index = ?,
           last_tick_local_date = ?, last_tick_slot_local = ?, last_tick_real_ts = ? WHERE id = 1`
      : `UPDATE world SET tick_seq = ?, game_day = ?, season_index = ? WHERE id = 1`;
    const worldUpdateArgs = params.updateSlotBookkeeping
      ? [newTickSeq, newGameDay, newSeasonIndex, params.localDate, params.intendedLocalTime, completedRealTs]
      : [newTickSeq, newGameDay, newSeasonIndex];

    await env.DB.batch([
      env.DB.prepare(worldUpdateSql).bind(...worldUpdateArgs),
      env.DB.prepare('UPDATE tick_run SET completed_real_ts = ?, game_day_after = ?, status = ?, rows_touched = 1 WHERE id = ?').bind(
        completedRealTs,
        newGameDay,
        status,
        tickRunId
      ),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare('UPDATE tick_run SET status = ?, error_text = ?, completed_real_ts = ? WHERE id = ?')
      .bind('error', message, nowUtcSeconds(), tickRunId)
      .run();
    throw err;
  }
}
