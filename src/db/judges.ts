// judges: a fixed pool a show class draws from (slice 0008 §5.1). Cached in module scope the same
// way breeds/loci are (src/db/breeds.ts) - edited approximately never, and only via D1's console
// (blurb, trait_weights), never through this app, so there is no write path here to invalidate the
// cache for.

import type { Env } from '../types';

export interface JudgeRow {
  id: number;
  code: string;
  name: string;
  blurb: string;
  trait_weights: string;
  active: number;
  sort_order: number;
}

const CACHE_MS = 60_000;
let cache: { rows: JudgeRow[]; expiresAtMs: number } | null = null;

export async function getJudges(env: Env): Promise<JudgeRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.rows;
  const result = await env.DB.prepare('SELECT * FROM judges WHERE active = 1 ORDER BY sort_order ASC').all<JudgeRow>();
  const rows = result.results ?? [];
  cache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

export async function getJudgeById(env: Env, id: number): Promise<JudgeRow | undefined> {
  return (await getJudges(env)).find((j) => j.id === id);
}
