import type { Env } from '../types';

export interface WorldRow {
  id: number;
  game_day: number;
  paused: number;
  tick_seq: number;
  season_index: number;
  tick_times_local: string;
  tick_timezone: string;
  last_tick_local_date: string | null;
  last_tick_slot_local: string | null;
  last_tick_real_ts: number | null;
  started_real_ts: number;
}

export async function getWorld(env: Env): Promise<WorldRow> {
  const row = await env.DB.prepare('SELECT * FROM world WHERE id = 1').first<WorldRow>();
  if (!row) throw new Error('world row missing - migrations not applied?');
  return row;
}

export async function setPaused(env: Env, paused: boolean): Promise<void> {
  await env.DB.prepare('UPDATE world SET paused = ? WHERE id = 1').bind(paused ? 1 : 0).run();
}
