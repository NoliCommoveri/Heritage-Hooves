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

/**
 * Newest first, ordered by id rather than tick_seq. A failed run does not advance world.tick_seq
 * (executeTick only writes it on success), so every retry of the same tick shares one tick_seq -
 * and `ORDER BY tick_seq DESC` left those ties in whatever order SQLite felt like, which in
 * practice printed a run of failures oldest-first inside a newest-first list. id is monotonic per
 * insert, so it is the only column here that reliably means "when did this run happen".
 */
export async function listRecentTickRuns(env: Env, limit = 20): Promise<TickRunRow[]> {
  const result = await env.DB.prepare('SELECT * FROM tick_run ORDER BY id DESC LIMIT ?').bind(limit).all<TickRunRow>();
  return result.results ?? [];
}
