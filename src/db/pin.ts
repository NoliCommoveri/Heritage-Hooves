// The admin PIN gate's storage (slice 0016 §9.2). Shared with slice 0005 §7's own future
// parent-PIN consumer over the same accounts.pin_hash / pin_attempts tables - CLAUDE.md §11's own
// PIN entry.

import type { Env } from '../types';

export async function setPinHash(env: Env, accountId: number, pinHash: string | null): Promise<void> {
  await env.DB.prepare('UPDATE accounts SET pin_hash = ? WHERE id = ?').bind(pinHash, accountId).run();
}

export interface PinAttemptRow {
  id: number;
  account_id: number | null;
  attempted_by_account_id: number;
  real_ts: number;
  success: number;
}

export async function recordPinAttempt(
  env: Env,
  params: { accountId: number | null; attemptedByAccountId: number; success: boolean; nowSeconds: number }
): Promise<void> {
  await env.DB.prepare('INSERT INTO pin_attempts (account_id, attempted_by_account_id, real_ts, success) VALUES (?, ?, ?, ?)')
    .bind(params.accountId, params.attemptedByAccountId, params.nowSeconds, params.success ? 1 : 0)
    .run();
}

/** §9.3's lockout check reads over every recent attempt, any account - the lockout is global. A
 * plain limit (rather than a time filter in SQL) keeps this one query; src/lib/pin.ts's
 * decidePinAttempt does the actual windowing. */
export async function listRecentPinAttempts(env: Env, limit: number): Promise<{ real_ts: number; success: number }[]> {
  const result = await env.DB.prepare('SELECT real_ts, success FROM pin_attempts ORDER BY real_ts DESC LIMIT ?').bind(limit).all<{
    real_ts: number;
    success: number;
  }>();
  return result.results ?? [];
}

export interface PinAttemptDisplayRow {
  real_ts: number;
  success: number;
  attempted_by_username: string | null;
}

/** /admin/security's own list (§9.3: "so the operator can see that someone has been trying"). */
export async function listRecentPinAttemptsForDisplay(env: Env, limit: number): Promise<PinAttemptDisplayRow[]> {
  const result = await env.DB.prepare(
    `SELECT pa.real_ts, pa.success, a.username AS attempted_by_username
     FROM pin_attempts pa LEFT JOIN accounts a ON a.id = pa.attempted_by_account_id
     ORDER BY pa.real_ts DESC LIMIT ?`
  )
    .bind(limit)
    .all<PinAttemptDisplayRow>();
  return result.results ?? [];
}
