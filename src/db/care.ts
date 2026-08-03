// Care: the farrier and wellness timers, feed, condition management plans, and the ±5% show-score
// modifier they all produce together (slice 0013, Part B built in slice 0014 §5). The pure
// ramp-and-clamp math lives in src/engines/care/modifier.ts; this file is the thin database layer
// around it - one horse's call, a barn-wide round, the tick's overdue notice, and /admin/care's
// read-only counts.

import type { Env } from '../types';
import type { Config, ConfigValues } from '../lib/config-cache';
import type { HorseRow } from './horses';
import { horseDisplayName } from './horses';
import { buildLedgerStatements, type LedgerEntry, type LedgerKind } from './ledger';
import { buildEventStatement } from './events';
import { frozenCareDays, workAvailability, type WorkAvailability } from '../engines/care/location';
import {
  timerState,
  careModifier as computeCareModifier,
  feedLevelDefinition,
  type TimerConfig,
  type TimerState,
  type CareStatus,
  type CareModifierResult,
} from '../engines/care/modifier';
import { parseGenotype } from '../engines/genetics/genotype';
import {
  getManageableConditionsForHorses,
  getKnownGenotypeSubjectsForHorses,
  manageableConditionStates,
  type ConditionRow,
  type ManageableHorseConditionRow,
} from './health';

export type CareService = 'farrier' | 'wellness';

function farrierTimerConfig(cfg: ConfigValues): TimerConfig {
  return { intervalGameDays: cfg.farrier_interval_game_days, overdueGameDays: cfg.farrier_overdue_game_days, bonus: cfg.farrier_bonus, penalty: cfg.farrier_penalty };
}

function wellnessTimerConfig(cfg: ConfigValues): TimerConfig {
  return { intervalGameDays: cfg.vet_wellness_interval_game_days, overdueGameDays: cfg.vet_wellness_overdue_game_days, bonus: cfg.vet_wellness_bonus, penalty: cfg.vet_wellness_penalty };
}

function timerConfigFor(service: CareService, cfg: ConfigValues): TimerConfig {
  return service === 'farrier' ? farrierTimerConfig(cfg) : wellnessTimerConfig(cfg);
}

function columnFor(service: CareService): 'last_farrier_game_day' | 'last_vet_game_day' {
  return service === 'farrier' ? 'last_farrier_game_day' : 'last_vet_game_day';
}

function costFor(service: CareService, cfg: ConfigValues): number {
  return service === 'farrier' ? cfg.farrier_cost : cfg.vet_wellness_cost;
}

export function careStartGameDay(bornGameDay: number, cfg: ConfigValues): number {
  return bornGameDay + cfg.care_start_age_game_days;
}

type CareTimerHorse = Pick<HorseRow, 'born_game_day' | 'last_farrier_game_day' | 'last_vet_game_day'> & {
  /** The location flag. Optional so the pre-flag call shape still compiles; absent reads as 'barn',
   * which is what every horse was before migrations/0073 added the column. */
  location?: 'barn' | 'pasture';
};

function timerStateFor(service: CareService, horse: CareTimerHorse, cfg: ConfigValues, gameDay: number) {
  const state: TimerState = {
    lastCallGameDay: service === 'farrier' ? horse.last_farrier_game_day : horse.last_vet_game_day,
    careStartGameDay: careStartGameDay(horse.born_game_day, cfg),
    atPasture: horse.location === 'pasture',
  };
  return timerState(state, timerConfigFor(service, cfg), gameDay);
}

/** The scorer's one entry point (slice 0013 §8.4): this horse's farrier and wellness timer states
 * plus its owner stable's feed delta, combined into a clamped modifier (§2.4). conditionDelta
 * (slice 0014 §5.2) defaults to 0 - the caller computes it (conditionDeltaMapForHorses below) and
 * passes it in, since this function stays synchronous and must not query. */
export function careModifierForHorse(horse: CareTimerHorse, feedLevel: string, cfg: ConfigValues, gameDay: number, conditionDelta = 0): CareModifierResult {
  const startDay = careStartGameDay(horse.born_game_day, cfg);
  const atPasture = horse.location === 'pasture';
  const feed = feedLevelDefinition(feedLevel, cfg.feed_levels);
  return computeCareModifier({
    farrier: { lastCallGameDay: horse.last_farrier_game_day, careStartGameDay: startDay, atPasture },
    farrierConfig: farrierTimerConfig(cfg),
    wellness: { lastCallGameDay: horse.last_vet_game_day, careStartGameDay: startDay, atPasture },
    wellnessConfig: wellnessTimerConfig(cfg),
    // Feed is the barn's. A horse at grass is outside that standing trade entirely (§2.5 makes feed
    // a per-stable decision about what is in the mangers), so it carries no feed delta either - it
    // comes out at exactly 1.00, every component neutral.
    feedDelta: atPasture ? 0 : feed.care_delta,
    conditionDelta,
    gameDay,
    modifierMin: cfg.care_modifier_min,
    modifierMax: cfg.care_modifier_max,
  });
}

/** src/lib/upkeep.ts's `feedMultiplier` parameter, looked up the same way the care delta is - an
 * unrecognised feed_level reads as standard rather than throwing. */
export function feedUpkeepMultiplier(feedLevel: string, cfg: ConfigValues): number {
  return feedLevelDefinition(feedLevel, cfg.feed_levels).upkeep_multiplier;
}

// ---------------------------------------------------------------------------
// The Care card / barn list - slice 0013 §8.1/§8.2
// ---------------------------------------------------------------------------

export interface CareLineView {
  status: CareStatus;
  daysUntilDue: number;
  cost: number;
}

export interface CareCardView {
  tooYoung: boolean;
  farrier: CareLineView;
  wellness: CareLineView;
  modifier: number;
  needsFarrier: boolean;
  needsWellness: boolean;
}

/** Everything the Care card and the barn list's badge/summary need for one horse, resolved once so
 * neither screen recomputes the ramp on its own. conditionDelta (slice 0014 §5.2) defaults to 0 for
 * a caller that has not computed it - the barn list and horse page both do, via
 * conditionDeltaMapForHorses. */
export function careCardViewFor(horse: CareTimerHorse, feedLevel: string, cfg: ConfigValues, gameDay: number, conditionDelta = 0): CareCardView {
  const result = careModifierForHorse(horse, feedLevel, cfg, gameDay, conditionDelta);
  return {
    tooYoung: result.farrier.status === 'not_yet',
    farrier: { status: result.farrier.status, daysUntilDue: result.farrier.daysUntilDue, cost: cfg.farrier_cost },
    wellness: { status: result.wellness.status, daysUntilDue: result.wellness.daysUntilDue, cost: cfg.vet_wellness_cost },
    modifier: result.modifier,
    needsFarrier: result.farrier.needsCall,
    needsWellness: result.wellness.needsCall,
  };
}

// ---------------------------------------------------------------------------
// Calling the farrier / vet - slice 0013 §6
// ---------------------------------------------------------------------------

/**
 * The one-horse call (§6.2). No idempotency guard on the UPDATE - unlike the barn round, a double
 * submission here is an accepted, pre-existing exposure (§6.4) and re-shoeing an already-fresh
 * horse from the horse page is allowed on purpose ("it wastes money and resets the timer, which is
 * the player's business"). No turn is spent (§2.2) - callers must not call spendAction for this.
 */
export async function callOneHorseCare(
  env: Env,
  params: { horse: Pick<HorseRow, 'id' | 'sex' | 'registered_name' | 'barn_name'>; ownerStableId: number; service: CareService; cost: number; gameDay: number }
): Promise<void> {
  const column = columnFor(params.service);
  const kind: LedgerKind = params.service === 'farrier' ? 'farrier' : 'vet';
  const description = `${params.service === 'farrier' ? 'Farrier visit' : 'Wellness visit'}, ${horseDisplayName(params.horse)}.`;

  await env.DB.batch([
    // AND location = 'barn' is defence in depth - the route refuses a pastured horse before it gets
    // here, but a care call whose date lands on a horse at grass would silently break the
    // frozen-time credit invariant that bringInFromPasture relies on (see location.ts).
    env.DB.prepare(`UPDATE horses SET ${column} = ?, care_notice_game_day = NULL WHERE id = ? AND location = 'barn'`).bind(params.gameDay, params.horse.id),
    ...buildLedgerStatements(env, [
      { stableId: params.ownerStableId, amount: -params.cost, kind, referenceType: 'horse', referenceId: params.horse.id, description, gameDay: params.gameDay },
    ]),
  ]);
}

export interface BarnRoundResult {
  /** How many horses were actually serviced and charged for. */
  serviced: number;
  /** How many needed the service when the round was started - so "4 of 7" can be said even when
   * money ran out. */
  totalCount: number;
  charged: number;
}

/**
 * The barn round (§6.3): every alive horse at or past care-start age that needs this service,
 * oldest-due first, serviced until the stable's balance runs out. One ledger row for the whole
 * round, not one per horse. Guarded against a double submission (§6.4): each horse's own UPDATE
 * only lands if its column is still behind gameDay, and the charge is computed from the rows that
 * actually changed - a second identical request finds nothing to update and charges nothing.
 *
 * Callers must check canTakeOnCost(balance) themselves before calling this (the debt rule, §2.7) -
 * this function only handles "affordable but not the whole round".
 */
export async function callBarnRoundCare(
  env: Env,
  params: { stableId: number; service: CareService; gameDay: number; config: ConfigValues; balance: number }
): Promise<BarnRoundResult> {
  const cfg = params.config;
  // Horses at pasture are skipped entirely: their timers are frozen, so they are never due, and a
  // round must never spend money on a horse the owner deliberately turned out.
  const horsesResult = await env.DB.prepare(`SELECT * FROM horses WHERE owner_stable_id = ? AND status = 'alive' AND location = 'barn'`).bind(params.stableId).all<HorseRow>();
  const horses = horsesResult.results ?? [];

  const candidates = horses
    .map((horse) => ({ horse, timer: timerStateFor(params.service, horse, cfg, params.gameDay) }))
    .filter((c) => c.timer.needsCall)
    // Oldest-due first: the most negative daysUntilDue (most overdue) sorts first.
    .sort((a, b) => a.timer.daysUntilDue - b.timer.daysUntilDue);

  if (candidates.length === 0) return { serviced: 0, totalCount: 0, charged: 0 };

  const unitCost = costFor(params.service, cfg);
  const affordableCount = params.balance >= 0 ? Math.min(candidates.length, Math.floor(params.balance / unitCost)) : 0;
  const toService = candidates.slice(0, affordableCount);
  if (toService.length === 0) return { serviced: 0, totalCount: candidates.length, charged: 0 };

  const column = columnFor(params.service);
  const updateStatements = toService.map((c) =>
    env.DB
      .prepare(`UPDATE horses SET ${column} = ?, care_notice_game_day = NULL WHERE id = ? AND (${column} IS NULL OR ${column} < ?)`)
      .bind(params.gameDay, c.horse.id, params.gameDay)
  );
  const updateResults = await env.DB.batch(updateStatements);
  const actuallyServiced = updateResults.filter((r) => (r.meta.changes ?? 0) > 0).length;
  const charged = actuallyServiced * unitCost;

  if (actuallyServiced > 0) {
    const kind: LedgerKind = params.service === 'farrier' ? 'farrier' : 'vet';
    const description = `${params.service === 'farrier' ? 'Farrier round' : 'Wellness round'}, ${String(actuallyServiced)} horse${actuallyServiced === 1 ? '' : 's'}.`;
    const ledgerEntries: LedgerEntry[] = [
      { stableId: params.stableId, amount: -charged, kind, referenceType: 'stable', referenceId: params.stableId, description, gameDay: params.gameDay },
    ];
    await env.DB.batch(buildLedgerStatements(env, ledgerEntries));
  }

  return { serviced: actuallyServiced, totalCount: candidates.length, charged };
}

// ---------------------------------------------------------------------------
// Condition management plans - slice 0014 §5 (Part B, specified by slice 0013 §4.5)
// ---------------------------------------------------------------------------

export interface ManagementPlanRow {
  conditionCode: string;
  conditionName: string;
  managementText: string | null;
  managementUntilGameDay: number | null;
  current: boolean;
  cost: number;
}

/** §5.3: one row per manageable condition the viewing stable is entitled to know about - never a
 * row for one it isn't, which is itself part of the knowledge boundary (an entitled-to-nothing
 * horse returns an empty list, and the section on the care page does not render at all). */
export async function managementPlanRowsForHorse(
  env: Env,
  horse: { id: number; genotype: string },
  conditions: ConditionRow[],
  gameDay: number,
  cfg: ConfigValues
): Promise<ManagementPlanRow[]> {
  const [rows, known] = await Promise.all([getManageableConditionsForHorses(env, [horse.id]), getKnownGenotypeSubjectsForHorses(env, [horse.id])]);
  const knownCodes = new Set(known.map((k) => k.subject_code));
  const states = manageableConditionStates(parseGenotype(horse.genotype), rows, conditions, knownCodes);

  return states
    .filter((s) => s.ownerEntitled)
    .map((s) => {
      const condition = conditions.find((c) => c.code === s.conditionCode);
      return {
        conditionCode: s.conditionCode,
        conditionName: condition?.name ?? s.conditionCode,
        managementText: condition?.management_text ?? null,
        managementUntilGameDay: s.managementUntilGameDay,
        current: s.managementUntilGameDay !== null && gameDay <= s.managementUntilGameDay,
        cost: cfg.condition_management_cost,
      };
    });
}

/** One condition's plan, bought or renewed (§5.3). Money and no turn, same as callOneHorseCare -
 * callers must check canTakeOnCost themselves first and must not spend an action. Renewal is not
 * stacking (§5.3): this always sets management_until_game_day to gameDay + interval from today,
 * never adds to whatever was left on an existing plan. */
export async function callOneConditionManagement(
  env: Env,
  params: { horseId: number; horseName: string; ownerStableId: number; conditionCode: string; cost: number; intervalGameDays: number; gameDay: number }
): Promise<void> {
  const until = params.gameDay + params.intervalGameDays;
  const description = `Management plan, ${params.horseName} (${params.conditionCode}).`;
  await env.DB.batch([
    env.DB
      .prepare(`UPDATE horse_conditions SET management_state = 'managed', management_until_game_day = ? WHERE horse_id = ? AND condition_code = ?`)
      .bind(until, params.horseId, params.conditionCode),
    ...buildLedgerStatements(env, [
      { stableId: params.ownerStableId, amount: -params.cost, kind: 'vet', referenceType: 'horse', referenceId: params.horseId, description, gameDay: params.gameDay },
    ]),
  ]);
}

export interface ManagementBarnRoundResult {
  /** How many plans were actually renewed and charged for. */
  serviced: number;
  totalCount: number;
  charged: number;
}

/** §5.3: the barn round renews every due plan the stable is entitled to know about, alongside
 * shoes and wellness - one ledger row for the whole round, not one per plan. Guarded against a
 * double submission the same way callBarnRoundCare is: each UPDATE only lands if the plan is still
 * not current, so a second identical request finds nothing left to renew. */
export async function callBarnRoundManagement(
  env: Env,
  params: { stableId: number; gameDay: number; config: ConfigValues; balance: number; conditions: ConditionRow[] }
): Promise<ManagementBarnRoundResult> {
  const horsesResult = await env.DB.prepare(`SELECT id, genotype FROM horses WHERE owner_stable_id = ? AND status = 'alive' AND location = 'barn'`)
    .bind(params.stableId)
    .all<{ id: number; genotype: string }>();
  const horses = horsesResult.results ?? [];
  if (horses.length === 0) return { serviced: 0, totalCount: 0, charged: 0 };

  const horseIds = horses.map((h) => h.id);
  const [rows, known] = await Promise.all([getManageableConditionsForHorses(env, horseIds), getKnownGenotypeSubjectsForHorses(env, horseIds)]);

  const rowsByHorse = new Map<number, ManageableHorseConditionRow[]>();
  for (const r of rows) {
    const list = rowsByHorse.get(r.horse_id) ?? [];
    list.push(r);
    rowsByHorse.set(r.horse_id, list);
  }
  const knownByHorse = new Map<number, Set<string>>();
  for (const k of known) {
    const set = knownByHorse.get(k.horse_id) ?? new Set<string>();
    set.add(k.subject_code);
    knownByHorse.set(k.horse_id, set);
  }

  const due: { horseId: number; conditionCode: string }[] = [];
  for (const horse of horses) {
    const states = manageableConditionStates(parseGenotype(horse.genotype), rowsByHorse.get(horse.id) ?? [], params.conditions, knownByHorse.get(horse.id) ?? new Set());
    for (const s of states) {
      if (!s.ownerEntitled) continue;
      const current = s.managementUntilGameDay !== null && params.gameDay <= s.managementUntilGameDay;
      if (!current) due.push({ horseId: horse.id, conditionCode: s.conditionCode });
    }
  }
  if (due.length === 0) return { serviced: 0, totalCount: 0, charged: 0 };

  const unitCost = params.config.condition_management_cost;
  const affordableCount = params.balance >= 0 ? Math.min(due.length, Math.floor(params.balance / unitCost)) : 0;
  const toRenew = due.slice(0, affordableCount);
  if (toRenew.length === 0) return { serviced: 0, totalCount: due.length, charged: 0 };

  const until = params.gameDay + params.config.condition_management_interval_game_days;
  const updateStatements = toRenew.map((d) =>
    env.DB
      .prepare(
        `UPDATE horse_conditions SET management_state = 'managed', management_until_game_day = ?
         WHERE horse_id = ? AND condition_code = ? AND (management_until_game_day IS NULL OR management_until_game_day < ?)`
      )
      .bind(until, d.horseId, d.conditionCode, params.gameDay)
  );
  const updateResults = await env.DB.batch(updateStatements);
  const actuallyServiced = updateResults.filter((r) => (r.meta.changes ?? 0) > 0).length;
  if (actuallyServiced === 0) return { serviced: 0, totalCount: due.length, charged: 0 };

  const charged = actuallyServiced * unitCost;
  const description = `Management round, ${String(actuallyServiced)} plan${actuallyServiced === 1 ? '' : 's'}.`;
  await env.DB.batch(
    buildLedgerStatements(env, [
      { stableId: params.stableId, amount: -charged, kind: 'vet', referenceType: 'stable', referenceId: params.stableId, description, gameDay: params.gameDay },
    ])
  );

  return { serviced: actuallyServiced, totalCount: due.length, charged };
}

// ---------------------------------------------------------------------------
// The tick's overdue notice - slice 0013 §7.2/§2.6
// ---------------------------------------------------------------------------

interface CareCandidateRow {
  id: number;
  born_game_day: number;
  last_farrier_game_day: number | null;
  last_vet_game_day: number | null;
  owner_stable_id: number;
  account_id: number;
}

/**
 * §2.6: NPC-owned horses are kept current by the tick, not exempted at the scorer - one UPDATE,
 * idempotent by construction (it writes the same value every tick). Slice 0014 §5.4 extends this to
 * management plans: an NPC show barn horse affected by a manageable condition must have a current
 * plan for the same reason its feet are kept shod, or the show field would silently weaken for a
 * reason nobody can see and the scorer would need an NPC special case - which CLAUDE.md §13 forbids.
 */
async function stampNpcHorsesCurrent(env: Env, gameDay: number, managementIntervalGameDays: number): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE horses SET last_farrier_game_day = ?, last_vet_game_day = ?
         WHERE status = 'alive' AND location = 'barn' AND owner_stable_id IN (SELECT id FROM stables WHERE is_npc = 1)`
      )
      .bind(gameDay, gameDay),
    env.DB
      .prepare(
        `UPDATE horse_conditions SET management_state = 'managed', management_until_game_day = ?
         WHERE condition_code IN (SELECT code FROM conditions WHERE severity_class = 'manageable' AND enabled = 1)
           AND horse_id IN (SELECT id FROM horses WHERE status = 'alive' AND location = 'barn' AND owner_stable_id IN (SELECT id FROM stables WHERE is_npc = 1))`
      )
      .bind(gameDay + managementIntervalGameDays),
  ]);
}

/**
 * §7.2: finds every alive, account-owned horse that has just crossed into overdue on either timer
 * and has not already been counted (care_notice_game_day IS NULL), writes one care_due event per
 * affected stable with both counts, and marks those horses counted. A care call clears the marker
 * back to NULL (callOneHorseCare/callBarnRoundCare above), so the next time a horse falls overdue,
 * months later, it is noticed again.
 */
async function noticeCareDueForPlayers(env: Env, gameDay: number, cfg: ConfigValues): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT h.id, h.born_game_day, h.last_farrier_game_day, h.last_vet_game_day, h.owner_stable_id, s.account_id
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive' AND h.location = 'barn' AND h.care_notice_game_day IS NULL AND s.account_id IS NOT NULL`
  ).all<CareCandidateRow>();

  const byStable = new Map<number, { accountId: number; horseIds: number[]; farrierCount: number; wellnessCount: number }>();

  for (const row of rows.results ?? []) {
    const farrier = timerStateFor('farrier', row, cfg, gameDay);
    const wellness = timerStateFor('wellness', row, cfg, gameDay);
    const farrierOverdue = farrier.status === 'overdue';
    const wellnessOverdue = wellness.status === 'overdue';
    if (!farrierOverdue && !wellnessOverdue) continue;

    let entry = byStable.get(row.owner_stable_id);
    if (!entry) {
      entry = { accountId: row.account_id, horseIds: [], farrierCount: 0, wellnessCount: 0 };
      byStable.set(row.owner_stable_id, entry);
    }
    entry.horseIds.push(row.id);
    if (farrierOverdue) entry.farrierCount++;
    if (wellnessOverdue) entry.wellnessCount++;
  }

  if (byStable.size === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const [stableId, info] of byStable) {
    for (const horseId of info.horseIds) {
      statements.push(env.DB.prepare('UPDATE horses SET care_notice_game_day = ? WHERE id = ? AND care_notice_game_day IS NULL').bind(gameDay, horseId));
    }
    statements.push(
      ...buildEventStatement(env, {
        stableId,
        accountId: info.accountId,
        gameDay,
        kind: 'care_due',
        subjectHorseId: null,
        payload: { farrier_count: info.farrierCount, wellness_count: info.wellnessCount },
      })
    );
  }
  await env.DB.batch(statements);
}

/** The tick's new stage (§7.1-§7.4), in the order db/tick.ts wires it: after chargeUpkeep, before
 * deleteOldEvents. care_notice_enabled (config.flags) turns the notice off without a deploy while
 * still stamping the show barn current - the nag is the part most likely to need silencing, not
 * the fact that NPC horses read as normal. */
export async function noticeCareDue(env: Env, gameDay: number, config: Config): Promise<void> {
  await stampNpcHorsesCurrent(env, gameDay, config.values.condition_management_interval_game_days);
  if (config.flags.care_notice_enabled === false) return;
  await noticeCareDueForPlayers(env, gameDay, config.values);
}

// ---------------------------------------------------------------------------
// /admin/care - slice 0013 §8.5
// ---------------------------------------------------------------------------

const CARE_STATUSES: CareStatus[] = ['not_yet', 'fresh', 'due_soon', 'due', 'overdue'];

export interface CareAdminData {
  farrier: { status: CareStatus; count: number }[];
  wellness: { status: CareStatus; count: number }[];
  /** Ten buckets spanning [care_modifier_min, care_modifier_max], computed with each horse's own
   * feed delta folded in - so the distribution reflects the modifier a show would actually apply. */
  modifierBuckets: { rangeLabel: string; count: number }[];
  stables: { id: number; name: string; feedLevelName: string; boardPerDay: number }[];
  /** The location flag: how many living player horses are out at grass, and how many are home but
   * still inside their settling window - the two numbers that explain a suddenly-small show field. */
  atPasture: number;
  settlingIn: number;
}

interface CareCensusRow {
  born_game_day: number;
  last_farrier_game_day: number | null;
  last_vet_game_day: number | null;
  location: 'barn' | 'pasture';
  location_changed_game_day: number | null;
  feed_level: string;
}

export async function getCareAdminData(env: Env, gameDay: number, config: Config): Promise<CareAdminData> {
  const cfg = config.values;
  const rowsResult = await env.DB.prepare(
    `SELECT h.born_game_day, h.last_farrier_game_day, h.last_vet_game_day, h.location,
            h.location_changed_game_day, s.feed_level
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive' AND s.account_id IS NOT NULL`
  ).all<CareCensusRow>();
  const rows = rowsResult.results ?? [];

  const farrierCounts = new Map<CareStatus, number>(CARE_STATUSES.map((s) => [s, 0]));
  const wellnessCounts = new Map<CareStatus, number>(CARE_STATUSES.map((s) => [s, 0]));
  const bucketCounts = new Array(10).fill(0) as number[];
  const span = cfg.care_modifier_max - cfg.care_modifier_min;
  let atPasture = 0;
  let settlingIn = 0;

  for (const row of rows) {
    if (row.location === 'pasture') atPasture++;
    else if (!availabilityForHorse(row, cfg, gameDay).available) settlingIn++;
    const farrier = timerStateFor('farrier', row, cfg, gameDay);
    const wellness = timerStateFor('wellness', row, cfg, gameDay);
    farrierCounts.set(farrier.status, (farrierCounts.get(farrier.status) ?? 0) + 1);
    wellnessCounts.set(wellness.status, (wellnessCounts.get(wellness.status) ?? 0) + 1);

    const result = careModifierForHorse(row, row.feed_level, cfg, gameDay);
    const bucket = span > 0 ? Math.min(9, Math.max(0, Math.floor(((result.modifier - cfg.care_modifier_min) / span) * 10))) : 0;
    bucketCounts[bucket]++;
  }

  const modifierBuckets = bucketCounts.map((count, i) => {
    const lo = cfg.care_modifier_min + (span * i) / 10;
    const hi = cfg.care_modifier_min + (span * (i + 1)) / 10;
    return { rangeLabel: `${lo.toFixed(3)}-${hi.toFixed(3)}`, count };
  });

  const stableRows = await env.DB.prepare(
    `SELECT s.id, s.name, s.feed_level, COUNT(h.id) AS alive_count
     FROM stables s LEFT JOIN horses h ON h.owner_stable_id = s.id AND h.status = 'alive'
     WHERE s.active = 1 AND s.account_id IS NOT NULL
     GROUP BY s.id
     ORDER BY s.name ASC`
  ).all<{ id: number; name: string; feed_level: string; alive_count: number }>();

  const stables = (stableRows.results ?? []).map((r) => {
    const feedDefinition = feedLevelDefinition(r.feed_level, cfg.feed_levels);
    return {
      id: r.id,
      name: r.name,
      feedLevelName: feedDefinition.name,
      boardPerDay: Math.round(r.alive_count * cfg.upkeep_per_horse_per_game_day * feedDefinition.upkeep_multiplier),
    };
  });

  return {
    farrier: CARE_STATUSES.map((status) => ({ status, count: farrierCounts.get(status) ?? 0 })),
    wellness: CARE_STATUSES.map((status) => ({ status, count: wellnessCounts.get(status) ?? 0 })),
    modifierBuckets,
    stables,
    atPasture,
    settlingIn,
  };
}

/** §8.5's one control: moves every player-owned, care-eligible horse's dates far enough back to
 * trigger the full penalty on both timers, so the mechanic can be seen working without waiting
 * several real days. A horse still below care_start_age_game_days is left untouched - it stays
 * "not yet", exactly as a real foal would. */
export async function makeAllHorsesOverdue(env: Env, gameDay: number, config: ConfigValues): Promise<void> {
  const farrierBack = gameDay - config.farrier_overdue_game_days - 1;
  const wellnessBack = gameDay - config.vet_wellness_overdue_game_days - 1;
  const eligibleBornBy = gameDay - config.care_start_age_game_days;

  await env.DB.prepare(
    `UPDATE horses SET last_farrier_game_day = ?, last_vet_game_day = ?, care_notice_game_day = NULL
     WHERE status = 'alive' AND location = 'barn' AND born_game_day <= ?
       AND owner_stable_id IN (SELECT id FROM stables WHERE account_id IS NOT NULL)`
  )
    .bind(farrierBack, wellnessBack, eligibleBornBy)
    .run();
}

// ---------------------------------------------------------------------------
// Turning out and bringing in - the location flag
// ---------------------------------------------------------------------------

/** Whether this horse can be bred or shown right now. Wraps the pure rule so route and render code
 * never has to remember which config key the settling period lives under. */
export function availabilityForHorse(
  horse: { location?: 'barn' | 'pasture'; location_changed_game_day?: number | null },
  cfg: ConfigValues,
  gameDay: number
): WorkAvailability {
  return workAvailability(
    { location: horse.location ?? 'barn', locationChangedGameDay: horse.location_changed_game_day ?? null },
    gameDay,
    cfg.pasture_settle_game_days
  );
}

/**
 * Turn a horse out to pasture. Immediate - there is no wait going out, only coming back in.
 *
 * Its care timers are deliberately not touched here: they are simply not read while
 * `location = 'pasture'` (timerState short-circuits), and the frozen time is credited back on the
 * way in. Doing it this way rather than stamping on the way out means a horse turned out and
 * brought straight back is exactly where it started, with no rounding drift either direction.
 *
 * care_notice_game_day is cleared because a horse at pasture is never counted in an overdue notice,
 * and a stale marker left set would suppress the next genuine notice after it comes home.
 *
 * The WHERE clause is the idempotency guard (CLAUDE.md §5.4 applied to a button, as slice 0013 §6.4
 * does for the barn round): a double-tap finds the horse already at pasture and changes nothing,
 * rather than resetting location_changed_game_day and silently extending the freeze.
 */
export async function turnOutToPasture(env: Env, horseId: number, gameDay: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE horses SET location = 'pasture', location_changed_game_day = ?, care_notice_game_day = NULL
     WHERE id = ? AND status = 'alive' AND location = 'barn'`
  )
    .bind(gameDay, horseId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Bring a horse in from pasture, crediting back the care time frozen while it was out.
 *
 * The credit is what stops a horse coming home from two game years at grass reading as several
 * intervals overdue for a mechanic that was not running while it was gone - the same unfairness
 * migration 0068's backfill exists to prevent for every horse alive when care shipped.
 *
 * MIN(..., ?) is belt and braces. The invariant making the arithmetic exact is that care calls are
 * refused for a horse at pasture (the route checks, and callOneHorseCare's own UPDATE re-checks),
 * so a timer can never be later than the day the horse went out, and adding the full time out can
 * never push it past today. The MIN costs nothing and keeps this statement correct on its own terms
 * if a future session ever adds a path that shoes a horse at grass.
 *
 * location_changed_game_day is reset to today, which starts the settling window: the horse is home,
 * but not fit to be bred or shown until pasture_settle_game_days have passed.
 */
export async function bringInFromPasture(
  env: Env,
  horse: { id: number; location_changed_game_day: number | null },
  gameDay: number
): Promise<boolean> {
  const frozen = frozenCareDays({ location: 'pasture', locationChangedGameDay: horse.location_changed_game_day }, gameDay);
  const result = await env.DB.prepare(
    `UPDATE horses
        SET location = 'barn',
            location_changed_game_day = ?,
            last_farrier_game_day = MIN(last_farrier_game_day + ?, ?),
            last_vet_game_day     = MIN(last_vet_game_day + ?, ?)
      WHERE id = ? AND status = 'alive' AND location = 'pasture'`
  )
    .bind(gameDay, frozen, gameDay, frozen, gameDay, horse.id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
