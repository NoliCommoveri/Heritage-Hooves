// disciplines: reference data for a discipline show class (slice 0012 §6.2), the counterpart to
// src/db/breeds.ts's getBreeds. Cached in module scope the same way breeds/loci/judges are - edited
// approximately never through this app.

import type { Env } from '../types';

export interface DisciplineRow {
  id: number;
  code: string;
  name: string;
  ability_weights: string;
  requires_gait: number;
  crosses_eligible: number;
  min_age_game_days: number;
  default_noise_sd: number;
  teaching_text: string;
  enabled: number;
  sort_order: number;
}

const CACHE_MS = 60_000;
let cache: { rows: DisciplineRow[]; expiresAtMs: number } | null = null;

export async function getDisciplines(env: Env): Promise<DisciplineRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.rows;
  const result = await env.DB.prepare('SELECT * FROM disciplines ORDER BY sort_order ASC').all<DisciplineRow>();
  const rows = result.results ?? [];
  cache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

/** §8.1: the classes createShowIfMissing mints one of, ordered by sort_order and capped at
 * show_discipline_classes_per_show - the enabled/disabled toggle is §13.1's first kill-switch. */
export async function getEnabledDisciplines(env: Env): Promise<DisciplineRow[]> {
  return (await getDisciplines(env)).filter((d) => d.enabled === 1);
}

export async function getDisciplineByCode(env: Env, code: string): Promise<DisciplineRow | undefined> {
  return (await getDisciplines(env)).find((d) => d.code === code);
}
