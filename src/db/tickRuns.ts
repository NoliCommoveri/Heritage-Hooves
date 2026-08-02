import type { Env } from '../types';

export interface TickRunRow {
  id: number;
  tick_seq: number;
  stage: string;
  trigger_source: string;
  intended_local_time: string | null;
  fired_local_time: string;
  local_date: string;
  started_real_ts: number | null;
  completed_real_ts: number | null;
  game_day_before: number;
  game_day_after: number | null;
  rows_touched: number;
  status: string;
  error_text: string | null;
}

export async function listRecentTickRuns(env: Env, limit = 20): Promise<TickRunRow[]> {
  const result = await env.DB.prepare('SELECT * FROM tick_run ORDER BY tick_seq DESC LIMIT ?').bind(limit).all<TickRunRow>();
  return result.results ?? [];
}
