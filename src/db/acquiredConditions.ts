// The twelve acquired conditions - colic, laminitis and the rest. Slice 0020. Two tick stages
// (rollAcuteIncidents, resolveAcuteIncidents), the /horses/:id/treat purchase, the eligibility
// facts, and /admin/incidents. Pure risk math lives in src/engines/health/acquired.ts; this file is
// the thin database layer around it, same split as db/care.ts/care/modifier.ts.

import type { Env } from '../types';
import type { Config, ConfigValues } from '../lib/config-cache';
import type { FeedLevelsConfig } from '../engines/care/modifier';
import { deriveSeed, makeRng } from '../lib/rng';
import { parseGenotype } from '../engines/genetics/genotype';
import { potential } from '../engines/genetics/polygenic';
import { onsetProbability, rollOutcome, parseAcquiredTrigger, type AcquiredTrigger, type IncidentOutcome } from '../engines/health/acquired';
import { timerState, feedLevelDefinition, type TimerConfig, type TimerResult } from '../engines/care/modifier';
import { careStartGameDay } from './care';
import { getConditions, type ConditionRow } from './health';
import { buildEventStatement } from './events';
import { buildEndHorseParticipationStatements } from './ageing';
import { horseDisplayName } from './horses';
import { buildLedgerStatements } from './ledger';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

async function getAcquiredConditions(env: Env): Promise<ConditionRow[]> {
  const all = await getConditions(env);
  return all.filter((c) => c.category === 'acquired' && c.enabled === 1);
}

/** §6.4: conditions.trigger.treatmentCostKey names a live config key - typed loosely here because
 * ConfigValues has one field per condition rather than a lookup map (the same shape every other
 * per-condition config key in this codebase uses, e.g. test_cost_key). An unrecognised key reads as
 * 0 rather than throwing - defence in depth, since every seeded row's key is checked against
 * ConfigValues by the seed migration's own test coverage. */
export function treatmentCostFor(trigger: AcquiredTrigger, cfg: ConfigValues): number {
  const value = (cfg as unknown as Record<string, unknown>)[trigger.treatmentCostKey];
  return typeof value === 'number' ? value : 0;
}

function farrierTimerConfig(cfg: ConfigValues): TimerConfig {
  return { intervalGameDays: cfg.farrier_interval_game_days, overdueGameDays: cfg.farrier_overdue_game_days, bonus: cfg.farrier_bonus, penalty: cfg.farrier_penalty };
}
function wellnessTimerConfig(cfg: ConfigValues): TimerConfig {
  return { intervalGameDays: cfg.vet_wellness_interval_game_days, overdueGameDays: cfg.vet_wellness_overdue_game_days, bonus: cfg.vet_wellness_bonus, penalty: cfg.vet_wellness_penalty };
}

/**
 * §4.2's care_weight input, derived from the existing farrier/wellness timers rather than a second
 * ramp: 0 (both fresh or better) .. 1 (either timer at its own full overdue penalty). Takes the
 * worse of the two - neglecting either counts as neglect, not just the average of both.
 */
export function carePenaltyFactorFor(farrier: TimerResult, wellness: TimerResult, cfg: ConfigValues): number {
  const farrierFrac = cfg.farrier_penalty > 0 ? clamp01(-farrier.delta / cfg.farrier_penalty) : 0;
  const wellnessFrac = cfg.vet_wellness_penalty > 0 ? clamp01(-wellness.delta / cfg.vet_wellness_penalty) : 0;
  return Math.max(farrierFrac, wellnessFrac);
}

/**
 * §2.6's feed input, derived from each feed level's own upkeep_multiplier rather than a new config
 * blob: normalised across whatever levels exist today, so Premium (the richest, most expensive
 * level) always reads as the highest laminitis risk without hardcoding the level keys themselves.
 */
export function feedRiskFactorFor(feedLevel: string, feedLevels: FeedLevelsConfig): number {
  const multipliers = Object.values(feedLevels.levels).map((l) => l.upkeep_multiplier);
  const min = Math.min(...multipliers);
  const max = Math.max(...multipliers);
  if (max === min) return 0;
  const current = feedLevelDefinition(feedLevel, feedLevels).upkeep_multiplier;
  return clamp01((current - min) / (max - min));
}

// ---------------------------------------------------------------------------
// §7.1: rollAcuteIncidents
// ---------------------------------------------------------------------------

interface IncidentCheckHorseRow {
  id: number;
  sex: 'mare' | 'stallion' | 'gelding';
  registered_name: string | null;
  barn_name: string | null;
  genotype: string;
  rng_seed: number;
  born_game_day: number;
  last_farrier_game_day: number | null;
  last_vet_game_day: number | null;
  location: 'barn' | 'pasture';
  last_incident_check_game_day: number;
  owner_stable_id: number;
  account_id: number | null;
  feed_level: string;
}

/** §7.1's day count. A marker of 0 means never checked (every horse alive before this slice
 * deployed) - read as "checked one day ago" rather than the literal, enormous gap since game start,
 * the same bootstrapping care backfillMissingLifespans/migrations/0068 already take for a slice
 * landing on top of an existing population. */
function daysSinceLastIncidentCheck(lastCheckGameDay: number, gameDay: number): number {
  if (lastCheckGameDay === 0) return 1;
  return Math.max(0, gameDay - lastCheckGameDay);
}

/**
 * §7.1: for every alive, care-eligible horse not already checked today, rolls all enabled acquired
 * conditions it does not currently have an open incident for, and writes a horse_conditions row +
 * incident_onset event on a hit. Idempotent: a horse whose marker already equals gameDay is
 * excluded from the SELECT entirely, so a re-fired tick finds nothing left to check.
 */
export async function rollAcuteIncidents(env: Env, gameDay: number, tickSeq: number, config: Config): Promise<void> {
  if (config.flags.acute_check_enabled === false) return;
  const cfg = config.values;

  const horsesResult = await env.DB.prepare(
    `SELECT h.id, h.sex, h.registered_name, h.barn_name, h.genotype, h.rng_seed, h.born_game_day,
            h.last_farrier_game_day, h.last_vet_game_day, h.location, h.last_incident_check_game_day,
            h.owner_stable_id, s.account_id, s.feed_level
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive' AND h.last_incident_check_game_day < ? AND h.born_game_day <= ?`
  )
    .bind(gameDay, gameDay - cfg.care_start_age_game_days)
    .all<IncidentCheckHorseRow>();
  const horses = horsesResult.results ?? [];
  if (horses.length === 0) return;

  const conditions = await getAcquiredConditions(env);
  if (conditions.length === 0) return;

  const horseIds = horses.map((h) => h.id);
  const placeholders = horseIds.map(() => '?').join(',');

  const [openRowsResult, workloadResult] = await Promise.all([
    env.DB.prepare(`SELECT horse_id, condition_code FROM horse_conditions WHERE state = 'acute' AND horse_id IN (${placeholders})`)
      .bind(...horseIds)
      .all<{ horse_id: number; condition_code: string }>(),
    env.DB.prepare(
      `SELECT horse_id, COUNT(*) AS n FROM show_entries WHERE horse_id IN (${placeholders}) AND entered_game_day >= ? GROUP BY horse_id`
    )
      .bind(...horseIds, gameDay - cfg.workload_window_game_days)
      .all<{ horse_id: number; n: number }>(),
  ]);

  const openByHorse = new Map<number, Set<string>>();
  for (const row of openRowsResult.results ?? []) {
    const set = openByHorse.get(row.horse_id) ?? new Set<string>();
    set.add(row.condition_code);
    openByHorse.set(row.horse_id, set);
  }
  const workloadByHorse = new Map<number, number>();
  for (const row of workloadResult.results ?? []) workloadByHorse.set(row.horse_id, row.n);

  const statements: D1PreparedStatement[] = [];

  for (const horse of horses) {
    const daysSinceLastCheck = daysSinceLastIncidentCheck(horse.last_incident_check_game_day, gameDay);
    const alreadyOpen = openByHorse.get(horse.id) ?? new Set<string>();
    const farrier = timerState(
      { lastCallGameDay: horse.last_farrier_game_day, careStartGameDay: careStartGameDay(horse.born_game_day, cfg), atPasture: horse.location === 'pasture' },
      farrierTimerConfig(cfg),
      gameDay
    );
    const wellness = timerState(
      { lastCallGameDay: horse.last_vet_game_day, careStartGameDay: careStartGameDay(horse.born_game_day, cfg), atPasture: horse.location === 'pasture' },
      wellnessTimerConfig(cfg),
      gameDay
    );
    const carePenaltyFactor = carePenaltyFactorFor(farrier, wellness, cfg);
    const workloadFactor = clamp01((workloadByHorse.get(horse.id) ?? 0) / Math.max(1, cfg.workload_ceiling_entries));
    const feedRiskFactor = feedRiskFactorFor(horse.feed_level, cfg.feed_levels);
    const genotype = parseGenotype(horse.genotype);

    for (const condition of conditions) {
      if (alreadyOpen.has(condition.code)) continue;
      const trigger = parseAcquiredTrigger(condition.trigger);
      const robustnessPotential = trigger.robustnessTrait !== null ? potential(genotype, trigger.robustnessTrait as Parameters<typeof potential>[1]) : null;

      const p = onsetProbability(
        trigger,
        {
          daysSinceLastCheck,
          carePenaltyFactor,
          workloadFactor,
          feedRiskFactor,
          location: horse.location,
          robustnessPotential,
        },
        cfg.incident_probability_ceiling_per_game_day
      );

      const rng = makeRng(deriveSeed(horse.rng_seed, `incident_${condition.code}_${String(tickSeq)}`));
      if (rng.next() >= p) continue;

      const resolveGameDay = gameDay + trigger.treatmentWindowGameDays;
      const horseName = horseDisplayName(horse);
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO horse_conditions (horse_id, condition_code, state, onset_game_day, resolve_game_day, last_evaluated_game_day)
             VALUES (?, ?, 'acute', ?, ?, ?)`
          )
          .bind(horse.id, condition.code, gameDay, resolveGameDay, gameDay),
        ...buildEventStatement(env, {
          stableId: horse.owner_stable_id,
          accountId: horse.account_id,
          gameDay,
          kind: 'incident_onset',
          subjectHorseId: horse.id,
          payload: {
            horse_name: horseName,
            condition_name: condition.name,
            condition_code: condition.code,
            window_game_days: trigger.treatmentWindowGameDays,
            treatment_cost: treatmentCostFor(trigger, cfg),
          },
        })
      );
    }

    statements.push(env.DB.prepare('UPDATE horses SET last_incident_check_game_day = ? WHERE id = ? AND last_incident_check_game_day < ?').bind(gameDay, horse.id, gameDay));
  }

  if (statements.length > 0) await env.DB.batch(statements);
}

// ---------------------------------------------------------------------------
// §7.2: resolveAcuteIncidents
// ---------------------------------------------------------------------------

interface DueIncidentRow {
  id: number;
  horse_id: number;
  condition_code: string;
  treated_game_day: number | null;
  rng_seed: number;
  sex: 'mare' | 'stallion' | 'gelding';
  registered_name: string | null;
  barn_name: string | null;
  owner_stable_id: number;
  account_id: number | null;
}

/**
 * §7.2: every open incident whose window has closed, resolved exactly once (the roll is keyed on
 * the incident row's own id, not tick_seq) against the treated or untreated outcome table.
 * Idempotency comes free from `hc.state = 'acute' AND h.status = 'alive'`, the same guard
 * killDueLethalFoals relies on - a re-fired tick finds nothing, because a resolved incident's state
 * no longer matches.
 */
export async function resolveAcuteIncidents(env: Env, gameDay: number, config: Config): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT hc.id, hc.horse_id, hc.condition_code, hc.treated_game_day, h.rng_seed, h.sex, h.registered_name, h.barn_name, h.owner_stable_id, s.account_id
     FROM horse_conditions hc
     JOIN horses h ON h.id = hc.horse_id
     JOIN stables s ON s.id = h.owner_stable_id
     WHERE hc.state = 'acute' AND hc.resolve_game_day <= ? AND h.status = 'alive'`
  )
    .bind(gameDay)
    .all<DueIncidentRow>();
  const rows = due.results ?? [];
  if (rows.length === 0) return;

  const conditions = await getConditions(env);

  for (const row of rows) {
    await resolveOneIncident(env, row, gameDay, conditions, config);
  }
}

async function resolveOneIncident(env: Env, row: DueIncidentRow, gameDay: number, conditions: ConditionRow[], config: Config): Promise<void> {
  const condition = conditions.find((c) => c.code === row.condition_code);
  if (!condition) return;
  const trigger = parseAcquiredTrigger(condition.trigger);
  const treated = row.treated_game_day !== null;
  const rng = makeRng(deriveSeed(row.rng_seed, `incident_resolve_${String(row.id)}`));
  const outcome: IncidentOutcome = rollOutcome(trigger, treated, rng);
  const horseName = horseDisplayName(row);

  const statements: D1PreparedStatement[] = [
    ...buildEventStatement(env, {
      stableId: row.owner_stable_id,
      accountId: row.account_id,
      gameDay,
      kind: 'incident_resolved',
      subjectHorseId: row.horse_id,
      payload: { horse_name: horseName, condition_name: condition.name, condition_code: condition.code, outcome, treated },
    }),
  ];

  if (outcome === 'death') {
    // Slice 0020 §7.2 names killDueLethalFoals' own status-update path, but that path never
    // cancels a live pregnancy/covering or withdraws a show entry - it doesn't need to, because a
    // GBED foal is 30 game days old and has none of those. An acquired-condition death can hit a
    // horse of any age with real breeding and show activity in flight, so this reuses
    // buildEndHorseParticipationStatements (src/db/ageing.ts) instead - the fuller adult-horse exit
    // path. The horse_died event is deliberately NOT also written here: its render is worded for a
    // newborn foal ("A mare's foal has died") and would misrender for an acquired-condition death
    // at any age - incident_resolved's own death-outcome sentence (src/render/stables.ts) carries
    // the narrative instead, in the calm register §4.5 drafted.
    statements.push(
      ...buildEndHorseParticipationStatements(env, { horseId: row.horse_id, sex: row.sex, gameDay, status: 'dead', endReason: row.condition_code }),
      env.DB
        .prepare(`UPDATE horse_conditions SET state = 'resolved', outcome = 'death', last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`)
        .bind(gameDay, row.id)
    );
  } else if (outcome === 'manageable') {
    statements.push(
      env.DB
        .prepare(
          `UPDATE horse_conditions SET state = 'resolved', outcome = 'manageable', management_state = 'unmanaged', last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`
        )
        .bind(gameDay, row.id)
    );
  } else {
    // 'resolved' and 'degenerative' both just close the incident - degenerative's permanence lives
    // in the outcome column itself, read by eligibility (§5.4), not in a further state change.
    statements.push(
      env.DB.prepare(`UPDATE horse_conditions SET state = 'resolved', outcome = ?, last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`).bind(outcome, gameDay, row.id)
    );
  }

  await env.DB.batch(statements);
  void config; // reserved for a future tuning read; not needed by this resolution path today.
}

// ---------------------------------------------------------------------------
// The horse page's Incidents card
// ---------------------------------------------------------------------------

export interface OpenIncidentView {
  conditionCode: string;
  conditionName: string;
  teachingText: string;
  daysRemaining: number;
  cost: number;
  treated: boolean;
}

export interface IncidentHistoryView {
  conditionCode: string;
  conditionName: string;
  onsetGameDay: number;
  outcome: IncidentOutcome;
}

interface HorseConditionAcquiredRow {
  id: number;
  condition_code: string;
  state: string;
  onset_game_day: number;
  resolve_game_day: number | null;
  treated_game_day: number | null;
  outcome: string | null;
}

/** Every open and past acquired-condition incident for one horse - no knowledge boundary to cross
 * (§2.7), so this reads truth directly, the same way the Health card's signs_visible rows do. */
export async function incidentsForHorse(
  env: Env,
  horseId: number,
  gameDay: number,
  cfg: ConfigValues
): Promise<{ open: OpenIncidentView[]; history: IncidentHistoryView[] }> {
  const [rowsResult, conditions] = await Promise.all([
    env.DB.prepare(
      `SELECT hc.id, hc.condition_code, hc.state, hc.onset_game_day, hc.resolve_game_day, hc.treated_game_day, hc.outcome
       FROM horse_conditions hc JOIN conditions c ON c.code = hc.condition_code
       WHERE hc.horse_id = ? AND c.category = 'acquired'
       ORDER BY hc.onset_game_day DESC`
    )
      .bind(horseId)
      .all<HorseConditionAcquiredRow>(),
    getConditions(env),
  ]);

  const open: OpenIncidentView[] = [];
  const history: IncidentHistoryView[] = [];

  for (const row of rowsResult.results ?? []) {
    const condition = conditions.find((c) => c.code === row.condition_code);
    if (!condition) continue;
    if (row.state === 'acute') {
      const trigger = parseAcquiredTrigger(condition.trigger);
      open.push({
        conditionCode: condition.code,
        conditionName: condition.name,
        teachingText: condition.teaching_text,
        daysRemaining: Math.max(0, (row.resolve_game_day ?? gameDay) - gameDay),
        cost: treatmentCostFor(trigger, cfg),
        treated: row.treated_game_day !== null,
      });
    } else if (row.outcome !== null) {
      history.push({ conditionCode: condition.code, conditionName: condition.name, onsetGameDay: row.onset_game_day, outcome: row.outcome as IncidentOutcome });
    }
  }

  return { open, history };
}

/**
 * §2.9: careModifier's conditionDelta slot gains a second contributor - a flat
 * acute_incident_care_penalty while ANY horse_conditions row reads state = 'acute', regardless of
 * which of the twelve. Deliberately flat, not per-condition (an active emergency is already the
 * point) and deliberately not summed twice for two simultaneous incidents on one horse - the
 * penalty exists so a horse mid-incident visibly underperforms, not to itself be a tuning lever.
 * The caller adds this to whatever conditionDeltaMapForHorses (src/db/health.ts) already returned
 * for the unmanaged-single-gene-condition penalty - two contributors to one clamped slot, per
 * §2.9's own framing, not two separate mechanisms.
 */
export async function acuteCarePenaltyMapForHorses(env: Env, horseIds: number[], penalty: number): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (horseIds.length === 0) return map;
  const openIds = await openIncidentHorseIds(env, horseIds);
  for (const id of openIds) map.set(id, -Math.abs(penalty));
  return map;
}

/** The barn list's badge (§8.3): every horse in the given set with a currently open acute incident,
 * one query for the whole barn rather than one per row - the same batching
 * getKnownGenotypeSubjectsForHorses already established for the cream-test badge. */
export async function openIncidentHorseIds(env: Env, horseIds: number[]): Promise<Set<number>> {
  if (horseIds.length === 0) return new Set();
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT DISTINCT horse_id FROM horse_conditions WHERE state = 'acute' AND horse_id IN (${placeholders})`)
    .bind(...horseIds)
    .all<{ horse_id: number }>();
  return new Set((result.results ?? []).map((r) => r.horse_id));
}

/** §5.4's two eligibility facts, computed from horse_conditions truth - no knowledge boundary. */
export async function acquiredBarringFlags(env: Env, horseId: number): Promise<{ hasOpenAcuteIncident: boolean; hasDegenerativeIncident: boolean }> {
  const row = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM horse_conditions hc JOIN conditions c ON c.code = hc.condition_code WHERE hc.horse_id = ? AND c.category = 'acquired' AND hc.state = 'acute') AS acute,
       EXISTS(SELECT 1 FROM horse_conditions hc JOIN conditions c ON c.code = hc.condition_code WHERE hc.horse_id = ? AND c.category = 'acquired' AND hc.outcome = 'degenerative') AS degenerative`
  )
    .bind(horseId, horseId)
    .first<{ acute: number; degenerative: number }>();
  return { hasOpenAcuteIncident: (row?.acute ?? 0) === 1, hasDegenerativeIncident: (row?.degenerative ?? 0) === 1 };
}

/** §8.1: "Call the vet" - one incident, paid once. Refuses (returns false, no statements run) if
 * the incident is not open or has already been paid for - re-derived from the horse's own truth,
 * never trusted from the form (the same discipline slice 0010 §7.1 step 1 uses for a test
 * purchase). */
export async function treatOneIncident(
  env: Env,
  params: { horseId: number; horseName: string; ownerStableId: number; conditionCode: string; cost: number; gameDay: number }
): Promise<boolean> {
  const updateResult = await env.DB
    .prepare(`UPDATE horse_conditions SET treated_game_day = ? WHERE horse_id = ? AND condition_code = ? AND state = 'acute' AND treated_game_day IS NULL`)
    .bind(params.gameDay, params.horseId, params.conditionCode)
    .run();
  if ((updateResult.meta.changes ?? 0) === 0) return false;

  const conditions = await getConditions(env);
  const conditionName = conditions.find((c) => c.code === params.conditionCode)?.name ?? params.conditionCode;
  await env.DB.batch(
    buildLedgerStatements(env, [
      {
        stableId: params.ownerStableId,
        amount: -params.cost,
        kind: 'vet',
        referenceType: 'horse',
        referenceId: params.horseId,
        description: `${conditionName}, ${params.horseName}.`,
        gameDay: params.gameDay,
      },
    ])
  );
  return true;
}

// ---------------------------------------------------------------------------
// /admin/incidents - §8.4
// ---------------------------------------------------------------------------

export interface IncidentAdminRow {
  condition: ConditionRow;
  openCount: number;
  resolved: number;
  manageable: number;
  degenerative: number;
  death: number;
}

export async function incidentAdminCensus(env: Env): Promise<IncidentAdminRow[]> {
  const conditions = await getAcquiredConditions(env);
  const [openResult, outcomeResult] = await Promise.all([
    env.DB.prepare(
      `SELECT condition_code, COUNT(*) AS n FROM horse_conditions WHERE state = 'acute'
         AND condition_code IN (SELECT code FROM conditions WHERE category = 'acquired')
       GROUP BY condition_code`
    ).all<{ condition_code: string; n: number }>(),
    env.DB.prepare(
      `SELECT condition_code, outcome, COUNT(*) AS n FROM horse_conditions
       WHERE state = 'resolved' AND outcome IS NOT NULL
         AND condition_code IN (SELECT code FROM conditions WHERE category = 'acquired')
       GROUP BY condition_code, outcome`
    ).all<{ condition_code: string; outcome: string; n: number }>(),
  ]);

  const openByCode = new Map((openResult.results ?? []).map((r) => [r.condition_code, r.n]));
  const outcomesByCode = new Map<string, Record<string, number>>();
  for (const row of outcomeResult.results ?? []) {
    const bucket = outcomesByCode.get(row.condition_code) ?? {};
    bucket[row.outcome] = row.n;
    outcomesByCode.set(row.condition_code, bucket);
  }

  return conditions.map((condition) => {
    const outcomes = outcomesByCode.get(condition.code) ?? {};
    return {
      condition,
      openCount: openByCode.get(condition.code) ?? 0,
      resolved: outcomes.resolved ?? 0,
      manageable: outcomes.manageable ?? 0,
      degenerative: outcomes.degenerative ?? 0,
      death: outcomes.death ?? 0,
    };
  });
}

/** §8.4's testing control: writes the acute row directly, bypassing the roll, so the full
 * lifecycle can be watched without waiting on real probabilities. Refuses (no-op) if this horse
 * already has an open incident for the chosen condition. */
export async function forceIncident(env: Env, horseId: number, conditionCode: string, gameDay: number): Promise<void> {
  const conditions = await getConditions(env);
  const condition = conditions.find((c) => c.code === conditionCode && c.category === 'acquired');
  if (!condition) return;
  const trigger = parseAcquiredTrigger(condition.trigger);

  await env.DB
    .prepare(
      `INSERT INTO horse_conditions (horse_id, condition_code, state, onset_game_day, resolve_game_day, last_evaluated_game_day)
       SELECT ?, ?, 'acute', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM horse_conditions WHERE horse_id = ? AND condition_code = ? AND state = 'acute')`
    )
    .bind(horseId, conditionCode, gameDay, gameDay + trigger.treatmentWindowGameDays, gameDay, horseId, conditionCode)
    .run();
}
