import type { Env } from '../types';

export interface ConfigAuditRow {
  id: number;
  changed_by_account_id: number | null;
  real_ts: number;
  game_day: number;
  path: string;
  old_value: string | null;
  new_value: string;
  changed_by_username: string | null;
}

export async function listConfigAudit(env: Env, limit = 100): Promise<ConfigAuditRow[]> {
  const result = await env.DB.prepare(
    `SELECT ca.*, a.username AS changed_by_username
     FROM config_audit ca
     LEFT JOIN accounts a ON a.id = ca.changed_by_account_id
     ORDER BY ca.id DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<ConfigAuditRow>();
  return result.results ?? [];
}
