// The twelve acquired incidents - colic, laminitis and the rest. Originally slice 0020, moved out
// of the genetics tables and renamed by slice 0022 Part A: an incident is an event, not a condition
// a horse carries, and living in the same tables as HYPP/HERDA/GBED forced six separate call sites
// to remember a `category !== 'acquired'` filter (see CLAUDE.md's slice 0022 entry). Reference data
// lives in incident_types, per-horse episodes in horse_incidents - both new tables, replacing what
// used to be acquired rows in conditions/horse_conditions. Two tick stages (rollAcuteIncidents,
// resolveAcuteIncidents), the /horses/:id/treat purchase, the eligibility facts, and
// /admin/incidents. Pure risk math lives in src/engines/incidents/risk.ts; this file is the thin
// database layer around it, same split as db/care.ts/care/modifier.ts.

import type { Env } from '../types';
import type { Config, ConfigValues } from '../lib/config-cache';
import type { FeedLevelsConfig } from '../engines/care/modifier';
import { deriveSeed, makeRng } from '../lib/rng';
import { parseGenotype } from '../engines/genetics/genotype';
import { potential } from '../engines/genetics/polygenic';
import { onsetProbability, rollOutcome, parseIncidentRiskModel, type IncidentOutcome } from '../engines/incidents/risk';
import { difficultyMultipliers, NEUTRAL_DIFFICULTY } from '../engines/incidents/difficulty';
import { getAccountDifficulties } from './accounts';
import { timerState, feedLevelDefinition, type TimerConfig, type TimerResult } from '../engines/care/modifier';
import { careStartGameDay } from './care';
import { buildEventStatement } from './events';
import { buildEndHorseParticipationStatements } from './ageing';
import { horseDisplayName } from './horses';
import { buildLedgerStatements } from './ledger';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// ---------------------------------------------------------------------------
// incident_types - reference data
// ---------------------------------------------------------------------------

export interface IncidentTypeRow {
  id: number;
  code: string;
  name: string;
  risk_model: string;
  treatment_window_game_days: number;
  treatment_cost_key: string;
  enabled: number;
  description: string;
  event_text: string;
  sort_order: number;
}

const CACHE_MS = 60_000;
let incidentTypesCache: { rows: IncidentTypeRow[]; expiresAtMs: number } | null = null;

/** All twelve incident types, cached the same way db/health.ts caches conditions - nothing writes
 * to this table after the seed migration. */
export async function getIncidentTypes(env: Env): Promise<IncidentTypeRow[]> {
  const now = Date.now();
  if (incidentTypesCache && incidentTypesCache.expiresAtMs > now) return incidentTypesCache.rows;
  const result = await env.DB.prepare('SELECT * FROM incident_types ORDER BY sort_order ASC').all<IncidentTypeRow>();
  const rows = result.results ?? [];
  incidentTypesCache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

async function getEnabledIncidentTypes(env: Env): Promise<IncidentTypeRow[]> {
  return (await getIncidentTypes(env)).filter((t) => t.enabled === 1);
}

/** §6.4: incident_types.treatment_cost_key names a live config key - typed loosely here because
 * ConfigValues has one field per incident type rather than a lookup map (the same shape every other
 * per-condition config key in this codebase uses, e.g. test_cost_key). An unrecognised key reads as
 * 0 rather than throwing - defence in depth, since every seeded row's key is checked against
 * ConfigValues by the seed migration's own test coverage. */
export function treatmentCostFor(incidentType: IncidentTypeRow, cfg: ConfigValues): number {
  const value = (cfg as unknown as Record<string, unknown>)[incidentType.treatment_cost_key];
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
 * §7.1: for every alive, care-eligible horse not already checked today, rolls all enabled incident
 * types it does not currently have an open episode for, and writes a horse_incidents row +
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

  const incidentTypes = await getEnabledIncidentTypes(env);
  if (incidentTypes.length === 0) return;

  // 2026-08-05: per-account difficulty. An NPC stable's account_id is null and reads neutral, which
  // is why this is a lookup rather than a column on the horse row - difficulty belongs to a person,
  // and a horse sold from one child's barn to another's takes on the buyer's setting from the next
  // check onward rather than carrying the seller's around with it.
  const difficulties = await getAccountDifficulties(env);

  const horseIds = horses.map((h) => h.id);
  const placeholders = horseIds.map(() => '?').join(',');

  const [openRowsResult, workloadResult] = await Promise.all([
    env.DB.prepare(`SELECT horse_id, incident_type_code FROM horse_incidents WHERE state = 'acute' AND horse_id IN (${placeholders})`)
      .bind(...horseIds)
      .all<{ horse_id: number; incident_type_code: string }>(),
    env.DB.prepare(
      `SELECT horse_id, COUNT(*) AS n FROM show_entries WHERE horse_id IN (${placeholders}) AND entered_game_day >= ? GROUP BY horse_id`
    )
      .bind(...horseIds, gameDay - cfg.workload_window_game_days)
      .all<{ horse_id: number; n: number }>(),
  ]);

  const openByHorse = new Map<number, Set<string>>();
  for (const row of openRowsResult.results ?? []) {
    const set = openByHorse.get(row.horse_id) ?? new Set<string>();
    set.add(row.incident_type_code);
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
    const difficulty = horse.account_id === null ? NEUTRAL_DIFFICULTY : difficultyMultipliers(difficulties.get(horse.account_id), cfg);

    for (const incidentType of incidentTypes) {
      if (alreadyOpen.has(incidentType.code)) continue;
      const trigger = parseIncidentRiskModel(incidentType.risk_model);
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
          difficultyRateMultiplier: difficulty.incidentRate,
        },
        cfg.incident_probability_ceiling_per_game_day
      );

      const rng = makeRng(deriveSeed(horse.rng_seed, `incident_${incidentType.code}_${String(tickSeq)}`));
      if (rng.next() >= p) continue;

      const resolveGameDay = gameDay + incidentType.treatment_window_game_days;
      const horseName = horseDisplayName(horse);
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO horse_incidents (horse_id, incident_type_code, state, onset_game_day, resolve_game_day, last_evaluated_game_day)
             VALUES (?, ?, 'acute', ?, ?, ?)`
          )
          .bind(horse.id, incidentType.code, gameDay, resolveGameDay, gameDay),
        ...buildEventStatement(env, {
          stableId: horse.owner_stable_id,
          accountId: horse.account_id,
          gameDay,
          kind: 'incident_onset',
          subjectHorseId: horse.id,
          payload: {
            horse_name: horseName,
            condition_name: incidentType.name,
            condition_code: incidentType.code,
            window_game_days: incidentType.treatment_window_game_days,
            treatment_cost: treatmentCostFor(incidentType, cfg),
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
  incident_type_code: string;
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
 * Idempotency comes free from `hi.state = 'acute' AND h.status = 'alive'`, the same guard
 * killDueLethalFoals relies on - a re-fired tick finds nothing, because a resolved incident's state
 * no longer matches.
 */
export async function resolveAcuteIncidents(env: Env, gameDay: number, config: Config): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT hi.id, hi.horse_id, hi.incident_type_code, hi.treated_game_day, h.rng_seed, h.sex, h.registered_name, h.barn_name, h.owner_stable_id, s.account_id
     FROM horse_incidents hi
     JOIN horses h ON h.id = hi.horse_id
     JOIN stables s ON s.id = h.owner_stable_id
     WHERE hi.state = 'acute' AND hi.resolve_game_day <= ? AND h.status = 'alive'`
  )
    .bind(gameDay)
    .all<DueIncidentRow>();
  const rows = due.results ?? [];
  if (rows.length === 0) return;

  const [incidentTypes, difficulties] = await Promise.all([getIncidentTypes(env), getAccountDifficulties(env)]);

  for (const row of rows) {
    await resolveOneIncident(env, row, gameDay, incidentTypes, config, difficulties);
  }
}

async function resolveOneIncident(
  env: Env,
  row: DueIncidentRow,
  gameDay: number,
  incidentTypes: IncidentTypeRow[],
  config: Config,
  difficulties: Map<number, string>
): Promise<void> {
  const incidentType = incidentTypes.find((t) => t.code === row.incident_type_code);
  if (!incidentType) return;
  const trigger = parseIncidentRiskModel(incidentType.risk_model);
  const treated = row.treated_game_day !== null;
  const rng = makeRng(deriveSeed(row.rng_seed, `incident_resolve_${String(row.id)}`));
  // 2026-08-05: the owning account's difficulty reshapes the outcome table before the draw. The
  // seed and the draw are unchanged, so an outcome stays reproducible from the horse's own seed -
  // it is the same roll against a kinder or harsher table, never a second roll.
  const difficulty = row.account_id === null ? NEUTRAL_DIFFICULTY : difficultyMultipliers(difficulties.get(row.account_id), config.values);
  const outcome: IncidentOutcome = rollOutcome(trigger, treated, rng, difficulty.badOutcome);
  const horseName = horseDisplayName(row);

  const statements: D1PreparedStatement[] = [
    ...buildEventStatement(env, {
      stableId: row.owner_stable_id,
      accountId: row.account_id,
      gameDay,
      kind: 'incident_resolved',
      subjectHorseId: row.horse_id,
      payload: { horse_name: horseName, condition_name: incidentType.name, condition_code: incidentType.code, outcome, treated },
    }),
  ];

  if (outcome === 'death') {
    // Slice 0020 §7.2 names killDueLethalFoals' own status-update path, but that path never
    // cancels a live pregnancy/covering or withdraws a show entry - it doesn't need to, because a
    // GBED foal is 30 game days old and has none of those. An acquired-incident death can hit a
    // horse of any age with real breeding and show activity in flight, so this reuses
    // buildEndHorseParticipationStatements (src/db/ageing.ts) instead - the fuller adult-horse exit
    // path. The horse_died event is deliberately NOT also written here: its render is worded for a
    // newborn foal ("A mare's foal has died") and would misrender for an acquired-incident death
    // at any age - incident_resolved's own death-outcome sentence (src/render/stables.ts) carries
    // the narrative instead, in the calm register §4.5 drafted.
    statements.push(
      ...buildEndHorseParticipationStatements(env, { horseId: row.horse_id, sex: row.sex, gameDay, status: 'dead', endReason: row.incident_type_code }),
      env.DB
        .prepare(`UPDATE horse_incidents SET state = 'resolved', outcome = 'death', last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`)
        .bind(gameDay, row.id)
    );
  } else if (outcome === 'manageable') {
    statements.push(
      env.DB
        .prepare(
          `UPDATE horse_incidents SET state = 'resolved', outcome = 'manageable', management_state = 'unmanaged', last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`
        )
        .bind(gameDay, row.id)
    );
  } else {
    // 'resolved' and 'degenerative' both just close the incident - degenerative's permanence lives
    // in the outcome column itself, read by eligibility (§5.4), not in a further state change.
    statements.push(
      env.DB.prepare(`UPDATE horse_incidents SET state = 'resolved', outcome = ?, last_evaluated_game_day = ? WHERE id = ? AND state = 'acute'`).bind(outcome, gameDay, row.id)
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

interface HorseIncidentRow {
  id: number;
  incident_type_code: string;
  state: string;
  onset_game_day: number;
  resolve_game_day: number | null;
  treated_game_day: number | null;
  outcome: string | null;
}

/**
 * Every open and past incident for one horse - no knowledge boundary to cross (§2.7), so this reads
 * truth directly, the same way the Health card's signs_visible rows do.
 *
 * §A6's history trim: a resolved, non-degenerative row older than `historyWindowGameDays` (measured
 * from resolve_game_day) is left out of `history` and counted in `hiddenCount` instead - display
 * only, the row itself is never deleted. An open incident and any 'degenerative' outcome are always
 * included regardless of the window.
 */
export async function incidentsForHorse(
  env: Env,
  horseId: number,
  gameDay: number,
  cfg: ConfigValues
): Promise<{ open: OpenIncidentView[]; history: IncidentHistoryView[]; hiddenCount: number }> {
  const [rowsResult, incidentTypes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, incident_type_code, state, onset_game_day, resolve_game_day, treated_game_day, outcome
       FROM horse_incidents
       WHERE horse_id = ?
       ORDER BY onset_game_day DESC`
    )
      .bind(horseId)
      .all<HorseIncidentRow>(),
    getIncidentTypes(env),
  ]);

  const open: OpenIncidentView[] = [];
  const history: IncidentHistoryView[] = [];
  let hiddenCount = 0;
  const cutoffGameDay = gameDay - cfg.incident_history_game_days;

  for (const row of rowsResult.results ?? []) {
    const incidentType = incidentTypes.find((t) => t.code === row.incident_type_code);
    if (!incidentType) continue;
    if (row.state === 'acute') {
      open.push({
        conditionCode: incidentType.code,
        conditionName: incidentType.name,
        teachingText: incidentType.description,
        daysRemaining: Math.max(0, (row.resolve_game_day ?? gameDay) - gameDay),
        cost: treatmentCostFor(incidentType, cfg),
        treated: row.treated_game_day !== null,
      });
    } else if (row.outcome !== null) {
      const inWindow = row.outcome === 'degenerative' || (row.resolve_game_day ?? 0) >= cutoffGameDay;
      if (!inWindow) {
        hiddenCount++;
        continue;
      }
      history.push({ conditionCode: incidentType.code, conditionName: incidentType.name, onsetGameDay: row.onset_game_day, outcome: row.outcome as IncidentOutcome });
    }
  }

  return { open, history, hiddenCount };
}

/**
 * §2.9: careModifier's conditionDelta slot gains a second contributor - a flat
 * acute_incident_care_penalty while ANY horse_incidents row reads state = 'acute', regardless of
 * which of the twelve. Deliberately flat, not per-incident-type (an active emergency is already the
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
  const result = await env.DB.prepare(`SELECT DISTINCT horse_id FROM horse_incidents WHERE state = 'acute' AND horse_id IN (${placeholders})`)
    .bind(...horseIds)
    .all<{ horse_id: number }>();
  return new Set((result.results ?? []).map((r) => r.horse_id));
}

/** §5.4's two eligibility facts, computed from horse_incidents truth - no knowledge boundary. */
export async function acquiredBarringFlags(env: Env, horseId: number): Promise<{ hasOpenAcuteIncident: boolean; hasDegenerativeIncident: boolean }> {
  const map = await acquiredBarringFlagsMap(env, [horseId]);
  return map.get(horseId) ?? { hasOpenAcuteIncident: false, hasDegenerativeIncident: false };
}

/**
 * Slice 0025 stage 4 §7.5a.1: the batched sibling of acquiredBarringFlags - one query for every
 * horse given, rather than one two-EXISTS-subquery call per horse. acquiredBarringFlags is now just
 * this map with a one-element input (and, as a side effect, drops from two subqueries to one grouped
 * query even for that single-horse case).
 */
export async function acquiredBarringFlagsMap(
  env: Env,
  horseIds: number[]
): Promise<Map<number, { hasOpenAcuteIncident: boolean; hasDegenerativeIncident: boolean }>> {
  const map = new Map<number, { hasOpenAcuteIncident: boolean; hasDegenerativeIncident: boolean }>();
  if (horseIds.length === 0) return map;
  for (const id of horseIds) map.set(id, { hasOpenAcuteIncident: false, hasDegenerativeIncident: false });

  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT horse_id,
            MAX(CASE WHEN state = 'acute' THEN 1 ELSE 0 END) AS acute,
            MAX(CASE WHEN outcome = 'degenerative' THEN 1 ELSE 0 END) AS degenerative
     FROM horse_incidents WHERE horse_id IN (${placeholders}) GROUP BY horse_id`
  )
    .bind(...horseIds)
    .all<{ horse_id: number; acute: number; degenerative: number }>();
  for (const row of result.results ?? []) {
    map.set(row.horse_id, { hasOpenAcuteIncident: row.acute === 1, hasDegenerativeIncident: row.degenerative === 1 });
  }
  return map;
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
    .prepare(`UPDATE horse_incidents SET treated_game_day = ? WHERE horse_id = ? AND incident_type_code = ? AND state = 'acute' AND treated_game_day IS NULL`)
    .bind(params.gameDay, params.horseId, params.conditionCode)
    .run();
  if ((updateResult.meta.changes ?? 0) === 0) return false;

  const incidentTypes = await getIncidentTypes(env);
  const incidentName = incidentTypes.find((t) => t.code === params.conditionCode)?.name ?? params.conditionCode;
  await env.DB.batch(
    buildLedgerStatements(env, [
      {
        stableId: params.ownerStableId,
        amount: -params.cost,
        kind: 'vet',
        referenceType: 'horse',
        referenceId: params.horseId,
        description: `${incidentName}, ${params.horseName}.`,
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
  incidentType: IncidentTypeRow;
  openCount: number;
  resolved: number;
  manageable: number;
  degenerative: number;
  death: number;
}

export async function incidentAdminCensus(env: Env): Promise<IncidentAdminRow[]> {
  const incidentTypes = await getEnabledIncidentTypes(env);
  const [openResult, outcomeResult] = await Promise.all([
    env.DB.prepare(`SELECT incident_type_code, COUNT(*) AS n FROM horse_incidents WHERE state = 'acute' GROUP BY incident_type_code`).all<{
      incident_type_code: string;
      n: number;
    }>(),
    env.DB.prepare(`SELECT incident_type_code, outcome, COUNT(*) AS n FROM horse_incidents WHERE state = 'resolved' AND outcome IS NOT NULL GROUP BY incident_type_code, outcome`).all<{
      incident_type_code: string;
      outcome: string;
      n: number;
    }>(),
  ]);

  const openByCode = new Map((openResult.results ?? []).map((r) => [r.incident_type_code, r.n]));
  const outcomesByCode = new Map<string, Record<string, number>>();
  for (const row of outcomeResult.results ?? []) {
    const bucket = outcomesByCode.get(row.incident_type_code) ?? {};
    bucket[row.outcome] = row.n;
    outcomesByCode.set(row.incident_type_code, bucket);
  }

  return incidentTypes.map((incidentType) => {
    const outcomes = outcomesByCode.get(incidentType.code) ?? {};
    return {
      incidentType,
      openCount: openByCode.get(incidentType.code) ?? 0,
      resolved: outcomes.resolved ?? 0,
      manageable: outcomes.manageable ?? 0,
      degenerative: outcomes.degenerative ?? 0,
      death: outcomes.death ?? 0,
    };
  });
}

/** §8.4's testing control: writes the acute row directly, bypassing the roll, so the full
 * lifecycle can be watched without waiting on real probabilities. Refuses (no-op) if this horse
 * already has an open incident for the chosen incident type. */
export async function forceIncident(env: Env, horseId: number, incidentTypeCode: string, gameDay: number): Promise<void> {
  const incidentTypes = await getIncidentTypes(env);
  const incidentType = incidentTypes.find((t) => t.code === incidentTypeCode);
  if (!incidentType) return;

  await env.DB
    .prepare(
      `INSERT INTO horse_incidents (horse_id, incident_type_code, state, onset_game_day, resolve_game_day, last_evaluated_game_day)
       SELECT ?, ?, 'acute', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM horse_incidents WHERE horse_id = ? AND incident_type_code = ? AND state = 'acute')`
    )
    .bind(horseId, incidentTypeCode, gameDay, gameDay + incidentType.treatment_window_game_days, gameDay, horseId, incidentTypeCode)
    .run();
}
