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
  /** Slice 0016 §9.2. Nullable - null means the admin PIN gate is off for this account (§9.6),
   * never rendered anywhere but the security page and the unlock check. */
  pin_hash: string | null;
  /** Migration 0153, 2026-08-05. 'gentle' / 'normal' / 'realistic', set only from /admin/accounts.
   * Read by the two incident tick stages and nothing else - see
   * src/engines/incidents/difficulty.ts for exactly what it does and does not touch. */
  difficulty: string;
  /** Migration 0174. Self-service (and admin-settable) pause, distinct from `active`. See
   * src/db/accounts.ts's setPaused and router.ts's paused gate for what it does and does not stop. */
  paused: number;
  /** Audit trail only (when the pause began, wall clock) - never read to decide anything. */
  paused_real_ts: number | null;
}

/**
 * Every account's difficulty, keyed by id. The whole table is five rows in this game, so this loads
 * all of them rather than filtering to the accounts a tick happens to need - the alternative is an
 * IN clause rebuilt per stage for no measurable gain.
 */
export async function getAccountDifficulties(env: Env): Promise<Map<number, string>> {
  const result = await env.DB.prepare('SELECT id, difficulty FROM accounts').all<{ id: number; difficulty: string }>();
  const map = new Map<number, string>();
  for (const row of result.results ?? []) map.set(row.id, row.difficulty);
  return map;
}

/** Migration 0153. No validation here beyond the caller's own - the column has no CHECK on purpose,
 * and an unrecognised value reads as neutral rather than breaking a tick. */
export async function setAccountDifficulty(env: Env, accountId: number, difficulty: string): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET difficulty = ? WHERE id = ?').bind(difficulty, accountId).run();
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

/**
 * Self-service (or admin-driven) pause: distinct from `active` (which blocks login entirely). A
 * paused account can still log in, but router.ts gates every page except /account/pause behind
 * "This account is paused" until this is called again with paused = false. paused_real_ts is
 * audit-trail only, cleared on unpause - nothing in game logic reads it (CLAUDE.md 5.3).
 */
export async function setAccountPaused(env: Env, accountId: number, paused: boolean): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET paused = ?, paused_real_ts = ? WHERE id = ?')
    .bind(paused ? 1 : 0, paused ? nowUtcSeconds() : null, accountId)
    .run();
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
// ---------------------------------------------------------------------------
// Slice 0016 §8: modifying and deleting accounts from /admin/accounts.
// ---------------------------------------------------------------------------

/** §8.1's "stables owned" column - every stable this account has ever had, active or not, one
 * grouped query rather than one per account (the same discipline listStablesForWorld's join uses). */
export async function countStablesByAccount(env: Env): Promise<Map<number, number>> {
  const result = await env.DB.prepare('SELECT account_id, COUNT(*) AS n FROM stables WHERE account_id IS NOT NULL GROUP BY account_id').all<{
    account_id: number;
    n: number;
  }>();
  const map = new Map<number, number>();
  for (const row of result.results ?? []) map.set(row.account_id, row.n);
  return map;
}

/** §8.4's delete-refusal sentence names the stables by name - active or inactive, since a
 * deactivated stable still belongs to this account. */
export async function listStableNamesForAccount(env: Env, accountId: number): Promise<string[]> {
  const result = await env.DB.prepare('SELECT name FROM stables WHERE account_id = ? ORDER BY created_real_ts ASC').bind(accountId).all<{ name: string }>();
  return (result.results ?? []).map((r) => r.name);
}

/** §8.4 point 2: a granted founding batch is a real foreign key (import_offers.granted_by_account_id),
 * so deleting the account would otherwise fail with a raw database error - checked up front instead. */
export async function hasGrantedFoundingBatch(env: Env, accountId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS present FROM import_offers WHERE granted_by_account_id = ? LIMIT 1').bind(accountId).first<{ present: number }>();
  return row !== null;
}

export async function countAdmins(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE is_admin = 1').first<{ n: number }>();
  return row?.n ?? 0;
}

export type UpdateAccountProfileResult = { ok: true } | { ok: false; error: 'taken' };

/** §8.2: rename and change username together. Changing a username does not log anyone out - the
 * session cookie carries the account id, not the name (src/lib/session.ts). */
export async function updateAccountProfile(env: Env, accountId: number, displayName: string, username: string): Promise<UpdateAccountProfileResult> {
  try {
    await env.DB.prepare('UPDATE accounts SET display_name = ?, username = ? WHERE id = ?').bind(displayName, username, accountId).run();
  } catch (err) {
    if (err instanceof Error && /unique constraint failed/i.test(err.message)) return { ok: false, error: 'taken' };
    throw err;
  }
  return { ok: true };
}

export async function setAdminFlag(env: Env, accountId: number, isAdmin: boolean): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET is_admin = ? WHERE id = ?').bind(isAdmin ? 1 : 0, accountId).run();
}

/** §8.4: only ever called after the route has confirmed the account owns no stable and has granted
 * no founding batch - see routes/admin.ts's adminAccountsRoute for the guard order. */
export async function deleteAccountRow(env: Env, accountId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId).run();
}

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
