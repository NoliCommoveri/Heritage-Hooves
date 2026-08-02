import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';

export interface AccountRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: number;
  must_change_password: number;
  active: number;
  last_active_stable_id: number | null;
  last_login_real_ts: number | null;
  created_real_ts: number;
  /** Slice 0009 Part B §5. Derived, not written by the tick - see src/lib/actions.ts's
   * actionsRemaining(). Both default 0, which reads as "reset at tick 0, none left"; a fresh
   * account is at full budget the moment its actions_reset_tick_seq is behind world.tick_seq. */
  actions_remaining: number;
  actions_reset_tick_seq: number;
}

export async function countAccounts(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getAccountById(env: Env, id: number): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
}

export async function getAccountByUsername(env: Env, username: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first<AccountRow>();
}

export async function listAccounts(env: Env): Promise<AccountRow[]> {
  const result = await env.DB.prepare('SELECT * FROM accounts ORDER BY created_real_ts ASC').all<AccountRow>();
  return result.results ?? [];
}

export interface CreateAccountParams {
  username: string;
  displayName: string;
  passwordHash: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

/**
 * Guards the insert against the accounts table being non-empty when isAdmin is requested via the
 * first-run setup screen - belt and braces alongside the /setup page's own 404-once-populated
 * check (slice §6.3).
 */
export async function createAccount(env: Env, params: CreateAccountParams): Promise<number> {
  if (params.isAdmin) {
    const existing = await countAccounts(env);
    if (existing > 0) throw new Error('setup already completed');
  }
  const result = await env.DB.prepare(
    `INSERT INTO accounts (username, display_name, password_hash, is_admin, must_change_password, created_real_ts)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(params.username, params.displayName, params.passwordHash, params.isAdmin ? 1 : 0, params.mustChangePassword ? 1 : 0, nowUtcSeconds())
    .run();
  return result.meta.last_row_id;
}

export async function updatePassword(env: Env, accountId: number, passwordHash: string, mustChangePassword: boolean): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET password_hash = ?, must_change_password = ? WHERE id = ?')
    .bind(passwordHash, mustChangePassword ? 1 : 0, accountId)
    .run();
}

export async function setActive(env: Env, accountId: number, active: boolean): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET active = ? WHERE id = ?').bind(active ? 1 : 0, accountId).run();
}

export async function recordLogin(env: Env, accountId: number): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET last_login_real_ts = ? WHERE id = ?').bind(nowUtcSeconds(), accountId).run();
}

export async function setLastActiveStable(env: Env, accountId: number, stableId: number): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET last_active_stable_id = ? WHERE id = ?').bind(stableId, accountId).run();
}

/**
 * Spends `cost` turns, atomically checking the budget and decrementing it in the same statement
 * (slice 0009 Part B §5.3) - the WHERE clause is what makes this race-safe, so two forms submitted
 * at the same instant cannot both spend the last turn. Callers check-act-spend (read the budget
 * and refuse up front if it looks empty, perform the game action, then spend): if this loses a
 * race and returns false, the caller lets the action stand and charges nothing anyway - a child
 * charged for something that did not happen has no way to find out why or get it back, so a rare
 * free turn is the right way for this to fail, not a rare unexplained charge.
 */
export async function spendAction(env: Env, accountId: number, tickSeq: number, actionsPerTick: number, cost: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE accounts
        SET actions_remaining = CASE WHEN actions_reset_tick_seq = ?
                                      THEN actions_remaining - ?
                                      ELSE ? - ? END,
            actions_reset_tick_seq = ?
      WHERE id = ?
        AND (actions_reset_tick_seq <> ? OR actions_remaining >= ?)`
  )
    .bind(tickSeq, cost, actionsPerTick, cost, tickSeq, accountId, tickSeq, cost)
    .run();
  return result.meta.changes === 1;
}
