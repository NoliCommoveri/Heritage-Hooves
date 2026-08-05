// The paid conformation evaluation, 2026-08-05 (migration 0155). Thin database layer around
// src/engines/conformation/evaluation.ts - the same split db/care.ts keeps around
// engines/care/modifier.ts.
//
// Who may buy one, decided by the operator: the horse's owner, and anyone looking at a horse that is
// currently listed for sale or standing at stud. That second case is the point of the feature as
// much as the first - "they can pay for an evaluation if they want to buy" - and it is not a
// widening of what the market discloses, because it discloses nothing about conformation today.
// A horse in somebody else's barn that is neither for sale nor at stud cannot be evaluated at all.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { parseStoredEvaluation, type StoredEvaluation } from '../engines/conformation/evaluation';
import { buildLedgerStatements } from './ledger';

export interface HorseEvaluationRow {
  id: number;
  stable_id: number;
  horse_id: number;
  evaluated_game_day: number;
  age_game_days: number;
  verdicts: string;
  cost_paid: number;
}

export interface LoadedEvaluation {
  row: HorseEvaluationRow;
  verdicts: StoredEvaluation;
}

/** The most recent evaluation this stable holds for this horse, if any. Older rows stay in the table
 * (a child can see that the yearling verdict was vaguer) but only the newest is ever displayed. */
export async function getLatestEvaluation(env: Env, stableId: number, horseId: number): Promise<LoadedEvaluation | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM horse_evaluations WHERE stable_id = ? AND horse_id = ? ORDER BY evaluated_game_day DESC, id DESC LIMIT 1'
  )
    .bind(stableId, horseId)
    .first<HorseEvaluationRow>();
  if (!row) return null;
  return { row, verdicts: parseStoredEvaluation(row.verdicts) };
}

/** Every evaluation this stable holds across a set of horses, newest first per horse - for the barn
 * list, which would otherwise issue one query per horse. */
export async function getLatestEvaluations(env: Env, stableId: number, horseIds: number[]): Promise<Map<number, LoadedEvaluation>> {
  const out = new Map<number, LoadedEvaluation>();
  if (horseIds.length === 0) return out;
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT * FROM horse_evaluations WHERE stable_id = ? AND horse_id IN (${placeholders}) ORDER BY evaluated_game_day ASC, id ASC`
  )
    .bind(stableId, ...horseIds)
    .all<HorseEvaluationRow>();
  // Ascending, so the last row written for a horse is the newest - one pass, no per-horse sort.
  for (const row of result.results ?? []) out.set(row.horse_id, { row, verdicts: parseStoredEvaluation(row.verdicts) });
  return out;
}

export interface RecordEvaluationParams {
  stableId: number;
  horseId: number;
  horseName: string;
  gameDay: number;
  ageGameDays: number;
  verdicts: StoredEvaluation;
  cost: number;
}

/**
 * The purchase: one insert, one ledger entry, one balance change, in a single batch. Modelled on
 * db/health.ts's own test purchase - same shape, same ordering, same reason (a charge and the thing
 * it paid for must land together or not at all).
 *
 * The caller checks affordability and permission; this function does the writing.
 */
export function buildEvaluationStatements(env: Env, params: RecordEvaluationParams): D1PreparedStatement[] {
  return [
    env.DB
      .prepare(
        `INSERT INTO horse_evaluations (stable_id, horse_id, evaluated_game_day, age_game_days, verdicts, cost_paid)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(params.stableId, params.horseId, params.gameDay, params.ageGameDays, JSON.stringify(params.verdicts), params.cost),
    ...buildLedgerStatements(env, [
      {
        stableId: params.stableId,
        gameDay: params.gameDay,
        kind: 'evaluation',
        amount: -params.cost,
        description: `Conformation evaluation - ${params.horseName}`,
        referenceType: 'horse',
        referenceId: params.horseId,
      },
    ]),
  ];
}

/** Live, read at the point of purchase (CLAUDE.md §5.5). */
export function evaluationCost(config: Config): number {
  return config.values.evaluation_cost;
}
