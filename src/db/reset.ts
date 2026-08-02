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
//   - breeds, loci, quantitative_traits, d1_migrations - reference data, created by migrations.
//                       Clearing these would break the game with no way back from the browser.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';

export type ResetScope = 'horses' | 'world';

/**
 * Every table a reset empties, children before parents. The order is the whole point of this
 * list - `import_candidates` points at `import_offers` and `horses`; `pregnancies` points at
 * `coverings` and `horses`; `horses`, `coverings`, `import_offers` and `stable_prefix_history`
 * all point at `stables` - so anything that references another row must be emptied first.
 *
 * `horses` referencing itself (sire_id/dam_id) needs no special handling: SQLite checks an
 * immediate foreign key at the *end* of the statement, and by then the table is empty.
 */
const HORSE_TABLES = [
  'import_candidates',
  'import_offers',
  'pregnancies',
  'coverings',
  'horse_ancestors',
  'horses',
] as const;

/** Emptied by a full world reset only. Still children-before-parents: prefixes point at stables. */
const WORLD_ONLY_TABLES = ['stable_prefix_history', 'stables', 'tick_run'] as const;

export const RESET_TABLES = [...HORSE_TABLES, ...WORLD_ONLY_TABLES] as const;

export type ResetTable = (typeof RESET_TABLES)[number];

/** Plain-English names for the admin page - the operator does not read table names. */
export const RESET_TABLE_LABELS: Record<ResetTable, string> = {
  import_candidates: 'Horses offered in a batch',
  import_offers: 'Founding-stock batches',
  pregnancies: 'Pregnancies',
  coverings: 'Coverings (booked matings)',
  horse_ancestors: 'Pedigree links',
  horses: 'Horses',
  stable_prefix_history: 'Claimed prefixes',
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
 */
export async function resetWorld(env: Env, scope: ResetScope): Promise<ResetResult> {
  const statements = tablesForScope(scope).map((table) => env.DB.prepare(`DELETE FROM ${table}`));

  if (scope === 'world') {
    statements.push(env.DB.prepare('UPDATE accounts SET last_active_stable_id = NULL'));
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
