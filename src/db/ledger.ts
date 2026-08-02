// The money truth table (slice 0009 §4.1/§4.2). stables.balance is a denormalized cache; ledger is
// what it is a cache of. buildLedgerStatements is the ONE function in this codebase allowed to
// change stables.balance - every caller puts its statements into the same env.DB.batch() as
// whatever else the same action writes, so the money and the thing that caused it land together or
// not at all. If you ever find yourself wanting a second function that writes stables.balance,
// stop - that is the rule this file exists to establish (slice 0009 §12).

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';

export type LedgerKind = 'opening' | 'upkeep' | 'prize' | 'adjustment';

export interface LedgerEntry {
  stableId: number;
  /** Signed. Negative is money leaving the stable. Integer - never a float (CLAUDE.md §7). */
  amount: number;
  kind: LedgerKind;
  /** What caused it, for tracing back: 'show_entry' | 'stable' | 'tick' | 'account'. Nullable. */
  referenceType: string | null;
  referenceId: number | null;
  /** One short sentence a child can read. "Board for 4 horses, 10 days." */
  description: string;
  gameDay: number;
}

export interface LedgerRow {
  id: number;
  stable_id: number;
  amount: number;
  kind: LedgerKind;
  reference_type: string | null;
  reference_id: number | null;
  description: string;
  game_day: number;
  created_real_ts: number;
}

/**
 * Returns the statements that post these entries: one INSERT into `ledger` and one balance UPDATE
 * per entry. The balance update is relative (`balance = balance + ?`), never an absolute write
 * computed in JS - a relative update can't lose a concurrent charge, which is also what makes the
 * tick's missed-tick catch-up arithmetic (§4.3) safe. No `balance_after` column: a stored running
 * total would be wrong the moment two writes interleave, so the Money page computes it at read
 * time instead (see withRunningBalance below).
 */
export function buildLedgerStatements(env: Env, entries: LedgerEntry[]): D1PreparedStatement[] {
  const nowSeconds = nowUtcSeconds();
  const statements: D1PreparedStatement[] = [];
  for (const entry of entries) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO ledger (stable_id, amount, kind, reference_type, reference_id, description, game_day, created_real_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(entry.stableId, entry.amount, entry.kind, entry.referenceType, entry.referenceId, entry.description, entry.gameDay, nowSeconds)
    );
    statements.push(env.DB.prepare('UPDATE stables SET balance = balance + ? WHERE id = ?').bind(entry.amount, entry.stableId));
  }
  return statements;
}

/** The Money page's one stable, newest first, capped at `limit` rows. */
export async function getLedgerForStable(env: Env, stableId: number, limit: number): Promise<LedgerRow[]> {
  const result = await env.DB.prepare('SELECT * FROM ledger WHERE stable_id = ? ORDER BY id DESC LIMIT ?').bind(stableId, limit).all<LedgerRow>();
  return result.results ?? [];
}

/**
 * Zips a running balance onto a set of ledger rows given oldest-first (§4.1's invariant means the
 * final row's running balance is the stable's current balance, if every row for that stable is
 * present). Pure, no database access - test/ledger.test.ts exercises this without D1. The Money
 * page fetches newest-first (its natural display order and the shape its LIMIT needs), reverses to
 * oldest-first to call this, then reverses back.
 */
export function withRunningBalance<T extends { amount: number }>(rowsOldestFirst: T[]): (T & { runningBalance: number })[] {
  let running = 0;
  return rowsOldestFirst.map((row) => {
    running += row.amount;
    return { ...row, runningBalance: running };
  });
}

export interface StableBalanceForAdmin {
  id: number;
  name: string;
  is_npc: number;
  balance: number;
  owner_username: string | null;
}

/** /admin/money's stable picker: every active stable, its owner (null for NPC stables), and its
 * current balance. */
export async function listStableBalancesForAdmin(env: Env): Promise<StableBalanceForAdmin[]> {
  const result = await env.DB.prepare(
    `SELECT s.id, s.name, s.is_npc, s.balance, a.username AS owner_username
     FROM stables s
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.active = 1
     ORDER BY s.name ASC`
  ).all<StableBalanceForAdmin>();
  return result.results ?? [];
}

export interface AdjustmentRow extends LedgerRow {
  stable_name: string;
}

/** /admin/money's "recent adjustments" list, so the same one isn't made twice. */
export async function listRecentAdjustments(env: Env, limit: number): Promise<AdjustmentRow[]> {
  const result = await env.DB.prepare(
    `SELECT l.*, s.name AS stable_name
     FROM ledger l JOIN stables s ON s.id = l.stable_id
     WHERE l.kind = 'adjustment'
     ORDER BY l.id DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<AdjustmentRow>();
  return result.results ?? [];
}
