// Upkeep on the tick (slice 0009 §4.3). Charged per horse per game day, from the world clock's
// game_day rather than tick_seq - CLAUDE.md §5.3, a paused world must not accrue board. The pure
// day-arithmetic lives in src/lib/upkeep.ts; this file is the thin database layer around it.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { computeUpkeep } from '../lib/upkeep';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { feedUpkeepMultiplier } from './care';

interface StableForUpkeep {
  id: number;
  last_upkeep_game_day: number;
  feed_level: string;
}

/**
 * For every active stable, player and NPC alike: works out how many game days it owes board for,
 * charges it, and stamps last_upkeep_game_day forward. One env.DB.batch() for the whole stage
 * (§4.3) - a re-fired tick recomputes daysOwed against the already-advanced marker and finds
 * nothing to do; a missed tick charges the days that actually passed rather than one tick's worth.
 *
 * A horse counts as alive by whatever `status = 'alive'` already means elsewhere in this codebase
 * (src/db/horses.ts's countAliveHorses) - counted directly here rather than via that function so
 * every stable's count can be fetched in one batch instead of one round trip each. A foal born
 * mid-gap is charged from the tick after its birth, not from its birth day - a one-tick
 * approximation, not worth a per-horse owned_from calculation at this scale.
 */
export async function chargeUpkeep(env: Env, newGameDay: number, tickSeq: number, config: Config): Promise<void> {
  const rate = config.values.upkeep_per_horse_per_game_day;
  const stablesResult = await env.DB.prepare('SELECT id, last_upkeep_game_day, feed_level FROM stables WHERE active = 1').all<StableForUpkeep>();
  const stables = stablesResult.results ?? [];
  if (stables.length === 0) return;

  // Counted by location in one pass per stable: the barn's horses carry feed and full board, the
  // pastured ones carry pasture_upkeep_multiplier (0 today). SUM over zero rows is NULL rather than
  // 0, which is why both are coalesced below.
  const countResults = await env.DB.batch<{ barn: number | null; pasture: number | null }>(
    stables.map((s) =>
      env.DB
        .prepare(
          `SELECT SUM(CASE WHEN location = 'barn' THEN 1 ELSE 0 END) AS barn,
                  SUM(CASE WHEN location = 'pasture' THEN 1 ELSE 0 END) AS pasture
             FROM horses WHERE owner_stable_id = ? AND status = 'alive'`
        )
        .bind(s.id)
    )
  );

  const ledgerEntries: LedgerEntry[] = [];
  const markerStatements: D1PreparedStatement[] = [];

  stables.forEach((stable, i) => {
    const daysOwed = newGameDay - stable.last_upkeep_game_day;
    const aliveHorses = countResults[i].results[0]?.barn ?? 0;
    const pastureHorses = countResults[i].results[0]?.pasture ?? 0;
    // Slice 0013 §2.5/§7.1: feed multiplies the existing charge rather than creating a second one -
    // feed *is* board.
    const feedMultiplier = feedUpkeepMultiplier(stable.feed_level, config.values);
    const charge = computeUpkeep({
      daysOwed,
      aliveHorses,
      ratePerHorsePerGameDay: rate,
      feedMultiplier,
      pastureHorses,
      pastureMultiplier: config.values.pasture_upkeep_multiplier,
    });
    if (!charge.advanceMarker) return;

    if (charge.amount !== 0) {
      const feedNote = stable.feed_level !== 'standard' ? ` (${config.values.feed_levels.levels[stable.feed_level]?.name.toLowerCase() ?? stable.feed_level} feed)` : '';
      ledgerEntries.push({
        stableId: stable.id,
        amount: charge.amount,
        kind: 'upkeep',
        referenceType: 'tick',
        referenceId: tickSeq,
        // Pasture is named only when there are horses out, so an ordinary barn's line reads exactly
        // as it did before the location flag existed.
        description: `Board for ${String(aliveHorses)} horse${aliveHorses === 1 ? '' : 's'}${pastureHorses > 0 ? `, ${String(pastureHorses)} at pasture` : ''}, ${String(daysOwed)} day${daysOwed === 1 ? '' : 's'}${feedNote}.`,
        gameDay: newGameDay,
      });
    }
    markerStatements.push(env.DB.prepare('UPDATE stables SET last_upkeep_game_day = ? WHERE id = ?').bind(newGameDay, stable.id));
  });

  const statements = [...buildLedgerStatements(env, ledgerEntries), ...markerStatements];
  if (statements.length === 0) return;
  await env.DB.batch(statements);
}
