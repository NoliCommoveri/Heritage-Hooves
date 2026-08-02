import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { getConfig } from '../lib/config-cache';

export interface StableRow {
  id: number;
  account_id: number | null;
  name: string;
  prefix: string;
  prefix_set_game_day: number;
  prefix_locked: number;
  is_npc: number;
  balance: number;
  capacity: number;
  last_processed_tick_seq: number;
  created_game_day: number;
  created_real_ts: number;
  active: number;
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique constraint failed/i.test(err.message);
}

export async function countActiveStablesForAccount(env: Env, accountId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM stables WHERE account_id = ? AND active = 1')
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listStablesForAccount(env: Env, accountId: number): Promise<StableRow[]> {
  const result = await env.DB.prepare('SELECT * FROM stables WHERE account_id = ? AND active = 1 ORDER BY created_real_ts ASC')
    .bind(accountId)
    .all<StableRow>();
  return result.results ?? [];
}

export async function getStableById(env: Env, id: number): Promise<StableRow | null> {
  return env.DB.prepare('SELECT * FROM stables WHERE id = ?').bind(id).first<StableRow>();
}

export interface CreateStableParams {
  accountId: number;
  name: string;
  prefix: string;
  gameDay: number;
}

export type CreateStableResult = { ok: true; stableId: number } | { ok: false; error: 'prefix_taken' };

/**
 * Creates a stable and claims its prefix atomically. Both rows are written in a single D1 batch
 * (an implicit transaction): the stable is inserted first so we have a row id, and the prefix
 * history row references it via SQLite's last_insert_rowid(), which sees the immediately
 * preceding statement in the same batch. If the prefix is already claimed - live or retired -
 * the history insert's unique-constraint failure rolls the whole batch back, so no stable row is
 * left behind either. This achieves the guarantee slice §7.1.5 asks for (insert-and-catch, no
 * prior SELECT) without needing stable_prefix_history.stable_id to be nullable.
 */
export async function createStableWithPrefix(env: Env, params: CreateStableParams): Promise<CreateStableResult> {
  const config = await getConfig(env);
  const nowSeconds = nowUtcSeconds();

  let results;
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO stables
           (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
      ).bind(
        params.accountId,
        params.name,
        params.prefix,
        params.gameDay,
        config.values.starting_balance,
        config.values.starting_stable_capacity,
        params.gameDay,
        nowSeconds
      ),
      env.DB.prepare(
        `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
         VALUES (last_insert_rowid(), ?, ?, NULL, ?, ?)`
      ).bind(params.prefix, params.gameDay, params.accountId, nowSeconds),
    ]);
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'prefix_taken' };
    throw err;
  }

  const stableId = results[0].meta.last_row_id;
  return { ok: true, stableId };
}

export type RenamePrefixResult = { ok: true } | { ok: false; error: 'prefix_taken' } | { ok: false; error: 'locked' };

export async function renamePrefix(
  env: Env,
  params: { stableId: number; newPrefix: string; gameDay: number }
): Promise<RenamePrefixResult> {
  const stable = await getStableById(env, params.stableId);
  if (!stable) throw new Error('stable not found');
  if (stable.prefix_locked) return { ok: false, error: 'locked' };

  const nowSeconds = nowUtcSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE stable_prefix_history SET to_game_day = ? WHERE stable_id = ? AND to_game_day IS NULL').bind(
        params.gameDay,
        params.stableId
      ),
      env.DB.prepare(
        `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
         VALUES (?, ?, ?, NULL, ?, ?)`
      ).bind(params.stableId, params.newPrefix, params.gameDay, stable.account_id, nowSeconds),
      env.DB.prepare('UPDATE stables SET prefix = ?, prefix_set_game_day = ? WHERE id = ?').bind(
        params.newPrefix,
        params.gameDay,
        params.stableId
      ),
    ]);
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'prefix_taken' };
    throw err;
  }
  return { ok: true };
}

export async function lockPrefix(env: Env, stableId: number): Promise<void> {
  await env.DB.prepare('UPDATE stables SET prefix_locked = 1 WHERE id = ?').bind(stableId).run();
}
