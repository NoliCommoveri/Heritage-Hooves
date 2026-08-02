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
//   - breeds, loci, quantitative_traits, judges, d1_migrations - reference data, created by
//                       migrations. Clearing these would break the game with no way back from the
//                       browser.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { SHOW_BARN_PREFIX } from './npc';

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
 * `horses` referencing itself (sire_id/dam_id) needs no special handling: SQLite checks an
 * immediate foreign key at the *end* of the statement, and by then the table is empty.
 */
const HORSE_TABLES = [
  'import_candidates',
  'import_offers',
  'show_entries',
  'horse_show_summary',
  'show_classes',
  'shows',
  'pregnancies',
  'coverings',
  'horse_ancestors',
  'horses',
] as const;

/**
 * Emptied by a full world reset only. Still children-before-parents: prefixes and ledger rows both
 * point at stables. A horses-only reset deliberately leaves `ledger` alone (slice 0009 §4.5/§9) -
 * that scope keeps a stable's balance, so its ledger history must stay too, or the
 * balance-equals-sum-of-ledger invariant in src/db/ledger.ts would break the moment a horses-only
 * reset ran.
 */
const WORLD_ONLY_TABLES = ['stable_prefix_history', 'ledger', 'stables', 'tick_run'] as const;

export const RESET_TABLES = [...HORSE_TABLES, ...WORLD_ONLY_TABLES] as const;

export type ResetTable = (typeof RESET_TABLES)[number];

/** Plain-English names for the admin page - the operator does not read table names. */
export const RESET_TABLE_LABELS: Record<ResetTable, string> = {
  import_candidates: 'Horses offered in a batch',
  import_offers: 'Founding-stock batches',
  show_entries: 'Show entries',
  horse_show_summary: 'Horses\' show records',
  show_classes: 'Show classes',
  shows: 'Shows',
  pregnancies: 'Pregnancies',
  coverings: 'Coverings (booked matings)',
  horse_ancestors: 'Pedigree links',
  horses: 'Horses',
  stable_prefix_history: 'Claimed prefixes',
  ledger: 'Money history',
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
 * A full world reset's blanket `DELETE FROM stables` also removes the NPC show barn (slice 0008
 * §5.7) - it is a stable like any other, and migrations/0040_npc_show_barn.sql only ever runs
 * once, so nothing would recreate it afterwards. Re-inserted here, empty, in exactly the shape
 * that migration leaves it in - the operator re-stocks it from /admin/shows the same way as after
 * a fresh install.
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
