// judges: a fixed pool a show class draws from (slice 0008 §5.1). Cached in module scope the same
// way breeds/loci are (src/db/breeds.ts) - edited approximately never, and only via D1's console
// (blurb, trait_weights, ability_weights), never through this app, so there is no write path here
// to invalidate the cache for.
//
// Slice 0024 §2: a judge has a kind - 'conformation' (weights trait_weights, judges a
// breed_conformation class) or 'discipline' (weights ability_weights, judges a discipline class).
// getJudges(env, kind) filters the pool a class is drawn from; getJudgeById stays kind-agnostic,
// since a class already carries its own judge_id and only ever looks one judge up by id.

import type { Env } from '../types';

export type JudgeKind = 'conformation' | 'discipline';

export interface JudgeRow {
  id: number;
  code: string;
  name: string;
  blurb: string;
  trait_weights: string;
  ability_weights: string | null;
  kind: JudgeKind;
  active: number;
  sort_order: number;
}

const CACHE_MS = 60_000;
let cache: { rows: JudgeRow[]; expiresAtMs: number } | null = null;

async function getAllJudges(env: Env): Promise<JudgeRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.rows;
  const result = await env.DB.prepare('SELECT * FROM judges WHERE active = 1 ORDER BY sort_order ASC').all<JudgeRow>();
  const rows = result.results ?? [];
  cache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

/** Omit `kind` for the whole active pool (e.g. a by-id lookup); pass it to draw from one pool only
 * (class creation, §8.1 below). */
export async function getJudges(env: Env, kind?: JudgeKind): Promise<JudgeRow[]> {
  const all = await getAllJudges(env);
  return kind ? all.filter((j) => j.kind === kind) : all;
}

export async function getJudgeById(env: Env, id: number): Promise<JudgeRow | undefined> {
  return (await getAllJudges(env)).find((j) => j.id === id);
}
