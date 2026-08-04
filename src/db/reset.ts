// Wiping the game world back to a clean slate, so the game can be play-tested from the start
// more than once. Everything here is deliberately blunt: whole-table DELETEs in an order that
// respects the foreign keys, run in one D1 batch (one implicit transaction) so a reset either
// happens completely or not at all.
//
// What this never touches, on purpose:
//   - accounts        - deleting these locks everyone out of the site, including whoever pressed
//                       the button. Logins survive a reset; only what they own is cleared.
//   - config          - the tuning numbers on /admin/config are settings, not world content.
//   - config_audit    - append-only (CLAUDE.md §7), and it is a record of admin tuning rather
//                       than of anything that happened in the world.
//   - breeds, loci, quantitative_traits, judges, conditions, disciplines, npc_ceiling_schedule,
//                       d1_migrations - reference data, created by migrations. Clearing these
//                       would break the game with no way back from the browser.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { SHOW_BARN_PREFIX, CEDAR_HOLLOW_PREFIX, WILLOW_CREEK_BARRELS_PREFIX } from './npc';
import { CONSIGNMENT_DEALER_PREFIX } from './consignment';

export type ResetScope = 'horses' | 'world';

/**
 * Every table a reset empties, children before parents. The order is the whole point of this
 * list - `import_candidates` points at `import_offers` and `horses`; `pregnancies` points at
 * `coverings` and `horses`; `horses`, `coverings`, `import_offers` and `stable_prefix_history`
 * all point at `stables` - so anything that references another row must be emptied first.
 *
 * Slice 0008 adds `show_entries` and `horse_show_summary` (both point at `horses`) and
 * `show_classes`/`shows` (which `show_entries` points at, in turn) to this same list - a
 * horses-only reset also clears the show barn's own horses, so their entries and summaries would
 * otherwise dangle. `judges` is reference data (like `breeds`) and is never cleared.
 *
 * Slice 0009 Part B adds `events` - it has a real foreign key into `horses` (subject_horse_id), so
 * it must be emptied before horses are, in both scopes (unlike `ledger`, which a horses-only reset
 * deliberately keeps - events have no balance-equals-sum invariant holding them back).
 *
 * `horses` referencing itself (sire_id/dam_id) needs no special handling: SQLite checks an
 * immediate foreign key at the *end* of the statement, and by then the table is empty.
 *
 * Slice 0010 adds `horse_knowledge` and `horse_conditions`, both before `horses` - both have real
 * foreign keys into it (horse_id), same reasoning as `horse_ancestors` above.
 *
 * Slice 0017 adds `listings`, first in the list - it points at both `horses` and `stables`, and a
 * horses-only reset that left it behind would leave every listing pointing at a deleted horse,
 * which breaks `/market` on the first page view (§9). It is in `HORSE_TABLES` rather than
 * `WORLD_ONLY_TABLES` for exactly that reason: the scope that deletes horses must delete these.
 *
 * Slice 0017 Part D adds `stud_bookings` and `stud_listings`, before `listings` - `stud_bookings`
 * has real foreign keys into `stud_listings`, `coverings`, `horses` and `stables`, so it must go
 * before all four; `stud_listings` points at `horses` and `stables`, same reasoning as `listings`
 * right beside it.
 */
const HORSE_TABLES = [
  'stud_bookings',
  'stud_listings',
  'listings',
  'import_candidates',
  'import_offers',
  'show_entries',
  'horse_show_summary',
  'show_classes',
  'shows',
  'pregnancies',
  'coverings',
  'events',
  'horse_ancestors',
  'horse_knowledge',
  'horse_conditions',
  'horses',
] as const;

/**
 * Emptied by a full world reset only. Still children-before-parents: prefixes and ledger rows both
 * point at stables. A horses-only reset deliberately leaves `ledger` alone (slice 0009 §4.5/§9) -
 * that scope keeps a stable's balance, so its ledger history must stay too, or the
 * balance-equals-sum-of-ledger invariant in src/db/ledger.ts would break the moment a horses-only
 * reset ran.
 *
 * Slice 0015 adds `npc_policy`, before `stables` - it has a real foreign key into it
 * (stable_id), and D1 enforces foreign keys (migrations/0064_show_classes_discipline.sql's own
 * comment confirms this was checked against a live database), so leaving it out would make a full
 * world reset fail outright the moment an NPC stable has a policy row. Left out of `HORSE_TABLES`
 * deliberately: a horses-only reset keeps stables (and therefore their policies) exactly as it
 * keeps everything else about a stable.
 *
 * Slice 0017 §12 (Part C) adds `buy_offers`, same reasoning as `npc_policy` right beside it - a
 * real foreign key into `stables` (stable_id) and no dependency on `horses` at all (an offer is
 * criteria, not a link to a specific horse), so a horses-only reset leaves it exactly as it leaves
 * every other stable-scoped row.
 */
const WORLD_ONLY_TABLES = ['stable_prefix_history', 'ledger', 'npc_policy', 'buy_offers', 'stables', 'tick_run'] as const;

export const RESET_TABLES = [...HORSE_TABLES, ...WORLD_ONLY_TABLES] as const;

export type ResetTable = (typeof RESET_TABLES)[number];

/** Plain-English names for the admin page - the operator does not read table names. */
export const RESET_TABLE_LABELS: Record<ResetTable, string> = {
  stud_bookings: 'Stud bookings',
  stud_listings: 'Stallions standing at stud',
  listings: 'Horses for sale, and past sales',
  import_candidates: 'Horses offered in a batch',
  import_offers: 'Founding-stock batches',
  show_entries: 'Show entries',
  horse_show_summary: 'Horses\' show records',
  show_classes: 'Show classes',
  shows: 'Shows',
  pregnancies: 'Pregnancies',
  coverings: 'Coverings (booked matings)',
  events: 'While-you-were-away notices',
  horse_ancestors: 'Pedigree links',
  horse_knowledge: 'What stables have paid to learn about horses',
  horse_conditions: 'Recorded health conditions',
  horses: 'Horses',
  stable_prefix_history: 'Claimed prefixes',
  ledger: 'Money history',
  npc_policy: 'NPC stables\' breeding policies',
  buy_offers: 'NPC standing buy offers',
  stables: 'Stables',
  tick_run: 'Tick history',
};

export function tablesForScope(scope: ResetScope): ResetTable[] {
  return scope === 'world' ? [...RESET_TABLES] : [...HORSE_TABLES];
}

export interface TableCount {
  table: ResetTable;
  label: string;
  rows: number;
  /** False for the tables only a full world reset clears - the page marks these. */
  inHorsesScope: boolean;
}

/**
 * How much is in each table right now, so the confirmation page can say what is about to go.
 * Table names are interpolated into the SQL because they come from RESET_TABLES above and can
 * never come from a request - there is no user input anywhere near this string.
 */
export async function countResetRows(env: Env): Promise<TableCount[]> {
  const horsesScope = new Set<string>(tablesForScope('horses'));
  const results = await env.DB.batch<{ n: number }>(
    RESET_TABLES.map((table) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`))
  );
  return RESET_TABLES.map((table, i) => ({
    table,
    label: RESET_TABLE_LABELS[table],
    rows: results[i].results[0]?.n ?? 0,
    inHorsesScope: horsesScope.has(table),
  }));
}

export interface ResetResult {
  scope: ResetScope;
  rowsDeleted: number;
}

/**
 * Empties every table in scope, then - for a full world reset - puts the clock back to day zero
 * and forgets each account's last-used stable, which no longer exists.
 *
 * `paused` is deliberately left exactly as the operator has it. A reset is about world content;
 * silently unpausing here would let the next cron tick start moving a world the operator had
 * stopped on purpose. Every other clock column is reset, because they describe a world that is
 * now gone.
 *
 * A full world reset's blanket `DELETE FROM stables` also removes every NPC stable - each is a
 * stable like any other, and the migrations that created them (0040, 0085, 0097) only ever run
 * once, so nothing would recreate them afterwards. All four (Fair Meadow, Cedar Hollow, Willow
 * Creek Barrels, and the Consignment Yard) are re-inserted here, empty, in exactly the shape those
 * migrations leave them in, along with the three real `npc_policy` rows - without the policy rows,
 * every NPC stable comes back after a reset and none of them ever breeds again once a later session
 * wires the tick stage in (slice 0015 §7.4). Fair Meadow is re-stocked from /admin/shows exactly as
 * before; Cedar Hollow and Willow Creek Barrels have no stocking control yet at all (that is slice
 * 0015 §7.3's outcross control, not built by this session - see CLAUDE.md §10's NPC stables row) -
 * a reset before that lands simply leaves them real, empty, unstocked stables, same as right after
 * this migration. The Consignment Yard gets no `npc_policy` row, deliberately matching migration
 * 0097 - it never breeds, shows or buys, and `runConsignments` mints its next batch on the tick
 * immediately following the reset (`nextConsignmentDueGameDay` treats "no listing yet" as due now).
 */
export async function resetWorld(env: Env, scope: ResetScope): Promise<ResetResult> {
  const statements = tablesForScope(scope).map((table) => env.DB.prepare(`DELETE FROM ${table}`));

  if (scope === 'world') {
    statements.push(env.DB.prepare('UPDATE accounts SET last_active_stable_id = NULL'));
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (NULL, 'Fair Meadow Show Barn', ?, 0, 1, 1, 0, 200, 0, ?, 1)`
        )
        .bind(SHOW_BARN_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
           VALUES ((SELECT id FROM stables ORDER BY id DESC LIMIT 1), ?, 0, NULL, NULL, ?)`
        )
        .bind(SHOW_BARN_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          // balance_floor mirrors migrations/0118 - a reset that recreated these stables without it
          // would leave every one of them with the floor switched off (the column defaults to 0),
          // and nobody would notice until the market quietly stopped moving.
          `INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), 'volume_breeder', 'conformation', (SELECT id FROM breeds WHERE code = 'QH'), 12.0, 0.05, 60, 4, 0.85, 0.15, 3000)`
        )
        .bind(SHOW_BARN_PREFIX)
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (NULL, ?, ?, 0, 1, 1, 0, 40, 0, ?, 1)`
        )
        .bind(CEDAR_HOLLOW_PREFIX, CEDAR_HOLLOW_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), ?, 0, NULL, NULL, ?)`
        )
        .bind(CEDAR_HOLLOW_PREFIX, CEDAR_HOLLOW_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), 'conformation_specialist', 'conformation', (SELECT id FROM breeds WHERE code = 'QH'), 3.0, 0.10, 180, 2, 1.25, 0.08, 5000)`
        )
        .bind(CEDAR_HOLLOW_PREFIX)
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (NULL, ?, ?, 0, 1, 1, 0, 40, 0, ?, 1)`
        )
        .bind(WILLOW_CREEK_BARRELS_PREFIX, WILLOW_CREEK_BARRELS_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), ?, 0, NULL, NULL, ?)`
        )
        .bind(WILLOW_CREEK_BARRELS_PREFIX, WILLOW_CREEK_BARRELS_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), 'discipline_barn', 'ability', 'barrels', 4.0, 0.10, 150, 2, 1.10, 0.10, 5000)`
        )
        .bind(WILLOW_CREEK_BARRELS_PREFIX)
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (NULL, 'The Consignment Yard', ?, 0, 1, 1, 0, 200, 0, ?, 1)`
        )
        .bind(CONSIGNMENT_DEALER_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
           VALUES ((SELECT id FROM stables WHERE prefix = ?), ?, 0, NULL, NULL, ?)`
        )
        .bind(CONSIGNMENT_DEALER_PREFIX, CONSIGNMENT_DEALER_PREFIX, nowUtcSeconds())
    );
    statements.push(
      env.DB
        .prepare(
          `UPDATE world SET
             game_day = 0,
             tick_seq = 0,
             season_index = 0,
             last_tick_local_date = NULL,
             last_tick_slot_local = NULL,
             last_tick_real_ts = NULL,
             started_real_ts = ?
           WHERE id = 1`
        )
        .bind(nowUtcSeconds())
    );
  }

  const results = await env.DB.batch(statements);
  const rowsDeleted = results
    .slice(0, tablesForScope(scope).length)
    .reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);

  return { scope, rowsDeleted };
}
