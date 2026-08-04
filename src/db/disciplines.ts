// disciplines: reference data for a discipline show class (slice 0012 §6.2), the counterpart to
// src/db/breeds.ts's getBreeds. Cached in module scope the same way breeds/loci/judges are - edited
// approximately never through this app.

import type { Env } from '../types';
import { ABILITY_TRAITS } from '../engines/conformation/traits';
import { parseAbilityWeights } from '../engines/showing/abilityScore';
import type { TraitCode } from '../engines/genetics/polygenic';

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

/**
 * Slice 0019 §4.2: ABILITY_TRAITS filtered down to the ones with a nonzero weight in at least one
 * *enabled* discipline - specialising a founding horse in a trait no running discipline scores
 * (jump_scope, today, weight 0.0 in the only enabled discipline, Barrel Racing) would be a dead
 * gift. Follows getBreedsInPlay's own shape (src/db/breeds.ts): one helper, every founding-specialist
 * call site reads it, and the pool widens by itself the day a second discipline is seeded - no code
 * change there or here.
 */
export async function getSpecializableAbilityTraits(env: Env): Promise<TraitCode[]> {
  const enabled = await getEnabledDisciplines(env);
  const weightsByDiscipline = enabled.map((d) => parseAbilityWeights(d.ability_weights));
  return ABILITY_TRAITS.filter((trait) => weightsByDiscipline.some((weights) => (weights[trait] ?? 0) > 0));
}
