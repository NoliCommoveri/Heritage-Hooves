// Old age, the failing notice, and the exit path death and removal both share (slice 0011).
// horseDisplayName, getConditions et al already split "pure engine, thin database layer" this way
// (CLAUDE.md §5.1) - src/engines/ageing/lifespan.ts holds the roll and the age-state logic; this
// file is the SQL around it, plus the tick's two new stages.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { deriveSeed, makeRng } from '../lib/rng';
import { rollLifespanGameDays, ageState, type AgeState } from '../engines/ageing/lifespan';
import { agePerformanceModifier, type AgeModifierResult } from '../engines/ageing/performance';
import { horseDisplayName } from './horses';
import { buildEventStatement } from './events';

// ---------------------------------------------------------------------------
// Slice 0014 §4.3: the scorer's other entry point (careModifierForHorse in src/db/care.ts is the
// first) - a horse's age in game days, handed to the pure engine. Live tunables, read fresh - §4.1
// is explicit that nothing here is snapshotted onto a horse; what is snapshotted is the modifier a
// judged entry actually scored with (show_entries.age_modifier_applied).
// ---------------------------------------------------------------------------

export function ageModifierForHorse(bornGameDay: number, cfg: Config['values'], gameDay: number): AgeModifierResult {
  return agePerformanceModifier(gameDay - bornGameDay, cfg);
}

// ---------------------------------------------------------------------------
// §6.5: the shared exit path - death and removal both call this for the statements that end a
// horse's participation. Never write the pregnancy/covering cancellation a second time anywhere
// else; if a future change needs it, that is the signal this function is not being reused properly.
// ---------------------------------------------------------------------------

export interface EndHorseParticipationParams {
  horseId: number;
  sex: 'mare' | 'stallion' | 'gelding';
  gameDay: number;
  status: 'dead' | 'removed';
  /** 'old_age' for the tick's death stage, 'retired_away' for the route - horses.end_reason is
   * free text (migrations/0012_horses.sql has no CHECK on it), so no migration is needed for
   * either. */
  endReason: string;
}

/**
 * The horses status update, plus cancelling this horse's own in-progress pregnancy and booked
 * covering (whichever table it appears in - a mare only ever appears as dam_id/mare_id, a stallion
 * only ever as sire_id/stallion_id, so one cancelled_reason derived from sex is always correct),
 * plus withdrawing this horse's entries in classes that have not been judged yet (§7.4 - a judged
 * class is history and §5.5 keeps it, identified by the class's own status column, not by
 * comparing dates).
 *
 * §5.2: "live" for a pregnancy or covering means status says so AND cancelled_game_day IS NULL -
 * the UPDATE below only ever touches rows where that second half is still true, so running this
 * twice for the same horse (a re-fired tick, or the death and removal paths somehow both reaching
 * the same horse) cancels nothing a second time.
 */
/** Pulled out as its own pure function purely so the mapping is checkable in isolation
 * (test/ageing/removal.test.ts) - this codebase has no D1 mock, so a function with no database
 * access is the one part of buildEndHorseParticipationStatements a test can call directly. */
export function cancelledReasonFor(sex: 'mare' | 'stallion' | 'gelding', status: 'dead' | 'removed'): string {
  return `${sex === 'stallion' ? 'sire' : 'dam'}_${status === 'dead' ? 'died' : 'removed'}`;
}

/** Slice 0026 §1.2: a third value alongside cancelledReasonFor's own sire_died/sire_removed, for a
 * stallion's own unresolved coverings cancelled by his own gelding (src/routes/horses.ts's
 * horseGeldRoute) - kept as its own constant rather than widening cancelledReasonFor above, whose
 * signature is keyed on ('dead' | 'removed'), neither of which gelding is. */
export const SIRE_GELDED_REASON = 'sire_gelded';

/**
 * Slice 0026 §1.2: the core of what gelding writes to `horses` and `coverings` - pulled out of
 * horseGeldRoute so it is checkable against a real database (test/ageing/geld-d1.test.ts) the same
 * way buildEndHorseParticipationStatements above is. The stud-listing withdrawal, the ledger row and
 * the event are each already-tested builders the route composes alongside this one; only as SIRE,
 * unlike buildEndHorseParticipationStatements' own covering cancel - a gelding was never a mare, so
 * there is no dam_id half to this WHERE clause. Existing pregnancies are untouched deliberately
 * (§1.2's "a conception already resolved is untouched") - nothing here writes to `pregnancies`.
 */
export function buildGeldStatements(env: Env, params: { horseId: number; gameDay: number }): D1PreparedStatement[] {
  return [
    env.DB
      .prepare(`UPDATE horses SET sex = 'gelding', gelded_game_day = ? WHERE id = ? AND status = 'alive' AND sex = 'stallion'`)
      .bind(params.gameDay, params.horseId),
    env.DB
      .prepare(`UPDATE coverings SET cancelled_game_day = ?, cancelled_reason = ? WHERE stallion_id = ? AND status = 'booked' AND cancelled_game_day IS NULL`)
      .bind(params.gameDay, SIRE_GELDED_REASON, params.horseId),
  ];
}

export function buildEndHorseParticipationStatements(env: Env, params: EndHorseParticipationParams): D1PreparedStatement[] {
  const cancelledReason = cancelledReasonFor(params.sex, params.status);

  return [
    env.DB
      .prepare(`UPDATE horses SET status = ?, ended_game_day = ?, end_reason = ? WHERE id = ? AND status = 'alive'`)
      .bind(params.status, params.gameDay, params.endReason, params.horseId),
    env.DB
      .prepare(
        `UPDATE pregnancies SET cancelled_game_day = ?, cancelled_reason = ?
         WHERE (dam_id = ? OR sire_id = ?) AND status = 'in_progress' AND cancelled_game_day IS NULL`
      )
      .bind(params.gameDay, cancelledReason, params.horseId, params.horseId),
    env.DB
      .prepare(
        `UPDATE coverings SET cancelled_game_day = ?, cancelled_reason = ?
         WHERE (mare_id = ? OR stallion_id = ?) AND status = 'booked' AND cancelled_game_day IS NULL`
      )
      .bind(params.gameDay, cancelledReason, params.horseId, params.horseId),
    env.DB
      .prepare(
        `DELETE FROM show_entries WHERE horse_id = ? AND class_id IN (SELECT id FROM show_classes WHERE status = 'scheduled')`
      )
      .bind(params.horseId),
  ];
}

async function countFoals(env: Env, horseId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM horses WHERE sire_id = ? OR dam_id = ?')
    .bind(horseId, horseId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// §7.1/§7.2: the tick's first ageing stage - assign a lifespan to any living horse that still
// lacks one, then fire the failing notice for anyone whose window has arrived.
// ---------------------------------------------------------------------------

interface LifespanBackfillRow {
  id: number;
  born_game_day: number;
  rng_seed: number;
}

/**
 * §7.1: every living horse with no natural_death_game_day yet gets one, rolled from its own seed
 * exactly the way a newly-created horse does. Idempotent by the null check in both the SELECT and
 * the UPDATE's WHERE clause - a horse that already has one is never touched again, and this also
 * self-heals a creation path that forgot to assign one (deliberately redundant with §7.1's other
 * requirement that every creation path assign its own - do not "clean up" this redundancy).
 */
async function backfillMissingLifespans(env: Env, config: Config): Promise<void> {
  const missing = await env.DB.prepare(`SELECT id, born_game_day, rng_seed FROM horses WHERE status = 'alive' AND natural_death_game_day IS NULL`).all<LifespanBackfillRow>();
  const rows = missing.results ?? [];
  if (rows.length === 0) return;

  const statements = rows.map((row) => {
    const naturalDeathGameDay = row.born_game_day + rollLifespanGameDays(makeRng(deriveSeed(row.rng_seed, 'lifespan')), config.values);
    return env.DB
      .prepare('UPDATE horses SET natural_death_game_day = ? WHERE id = ? AND natural_death_game_day IS NULL')
      .bind(naturalDeathGameDay, row.id);
  });
  await env.DB.batch(statements);
}

interface FrailtyDueRow {
  id: number;
  sex: 'mare' | 'stallion' | 'gelding';
  registered_name: string | null;
  barn_name: string | null;
  born_game_day: number;
  owner_stable_id: number;
  account_id: number;
}

/**
 * §7.2: every living horse whose remaining life has dropped to the frailty window and has not
 * been told yet - belonging to a stable with an account (the show barn's horses notify nobody,
 * per events.ts's own header comment; the join here is an inner join for exactly that reason,
 * rather than a null check on a left join). The null check on frailty_notice_game_day is this
 * stage's own idempotency marker - a re-fired tick finds nothing, a missed tick still catches up
 * because the comparison is <=, not =.
 */
async function noticeFrailty(env: Env, gameDay: number, config: Config): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT h.id, h.sex, h.registered_name, h.barn_name, h.born_game_day, h.owner_stable_id, s.account_id
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive'
       AND h.frailty_notice_game_day IS NULL
       AND h.natural_death_game_day IS NOT NULL
       AND (h.natural_death_game_day - ?) <= ?
       AND s.account_id IS NOT NULL`
  )
    .bind(gameDay, config.values.frailty_window_game_days)
    .all<FrailtyDueRow>();

  const gameDaysPerYear = config.values.game_days_per_year;
  const statements: D1PreparedStatement[] = [];
  for (const row of due.results ?? []) {
    const ageYears = Math.floor((gameDay - row.born_game_day) / gameDaysPerYear);
    statements.push(
      env.DB.prepare('UPDATE horses SET frailty_notice_game_day = ? WHERE id = ? AND frailty_notice_game_day IS NULL').bind(gameDay, row.id),
      ...buildEventStatement(env, {
        stableId: row.owner_stable_id,
        accountId: row.account_id,
        gameDay,
        kind: 'horse_failing',
        subjectHorseId: row.id,
        payload: { horse_name: horseDisplayName(row), age_years: ageYears, sex: row.sex },
      })
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

/** §7.1/§7.2's combined stage, in the tick order the slice document names (§7.5): after
 * killDueLethalFoals, before killDueOldHorses. */
export async function assignLifespansAndNoticeFrailty(env: Env, gameDay: number, config: Config): Promise<void> {
  await backfillMissingLifespans(env, config);
  await noticeFrailty(env, gameDay, config);
}

// ---------------------------------------------------------------------------
// §7.3: the tick's death stage.
// ---------------------------------------------------------------------------

interface DueOldAgeRow {
  id: number;
  sex: 'mare' | 'stallion' | 'gelding';
  registered_name: string | null;
  barn_name: string | null;
  born_game_day: number;
  owner_stable_id: number;
  account_id: number | null;
}

/**
 * Every still-alive horse whose natural_death_game_day has arrived, killed through the shared exit
 * path above with end_reason = 'old_age'. Idempotency comes free from the same `status = 'alive'`
 * guard killDueLethalFoals already relies on (src/db/health.ts's own comment on the point) - no
 * separate marker column needed here either. Ordered after killDueLethalFoals in db/tick.ts: both
 * stages guard the same column, so whichever runs first wins, and a foal that is both GBED-terminal
 * and at its natural end dies of GBED - the more specific, more useful end_reason.
 */
export async function killDueOldHorses(env: Env, gameDay: number, config: Config): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT h.id, h.sex, h.registered_name, h.barn_name, h.born_game_day, h.owner_stable_id, s.account_id
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive' AND h.natural_death_game_day <= ?`
  )
    .bind(gameDay)
    .all<DueOldAgeRow>();

  for (const row of due.results ?? []) {
    await killOneOldHorse(env, row, gameDay, config);
  }
}

// ---------------------------------------------------------------------------
// /admin/ageing (§8.4)
// ---------------------------------------------------------------------------

interface LivingHorseAdminRow {
  id: number;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  born_game_day: number;
  natural_death_game_day: number | null;
  status: 'alive' | 'dead' | 'removed';
  stable_name: string;
}

export interface LivingHorseAdminDisplay {
  id: number;
  name: string;
  stableName: string;
  bornGameDay: number;
  ageState: AgeState;
  /** Slice 0014 §8.5. */
  ageModifier: AgeModifierResult;
}

/**
 * Every living horse in the game, oldest first - both what /admin/ageing's "oldest living horses"
 * table shows (the top of this list) and the source for the bring-forward control's dropdown (the
 * whole list). One query for both, since this game runs at a scale (§14/CLAUDE.md's own note) where
 * "every living horse" is not a large list.
 */
export async function listLivingHorsesForAdmin(env: Env, gameDay: number, config: Config): Promise<LivingHorseAdminDisplay[]> {
  const result = await env.DB.prepare(
    `SELECT h.id, h.registered_name, h.barn_name, h.sex, h.born_game_day, h.natural_death_game_day, h.status, s.name AS stable_name
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'alive'
     ORDER BY h.born_game_day ASC, h.id ASC`
  ).all<LivingHorseAdminRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: horseDisplayName(row),
    stableName: row.stable_name,
    bornGameDay: row.born_game_day,
    ageState: ageState({ bornGameDay: row.born_game_day, naturalDeathGameDay: row.natural_death_game_day, status: row.status }, gameDay, config.values),
    ageModifier: agePerformanceModifier(gameDay - row.born_game_day, config.values),
  }));
}

/** §8.5: "how many at 1.0, how many between, how many at the floor" - the three phases
 * agePerformanceModifier already names, counted rather than bucketed continuously like
 * getCareAdminData's modifierBuckets, per the slice's own wording. Pure - takes the list
 * listLivingHorsesForAdmin already builds, no second query. */
export function ageModifierDistribution(horses: LivingHorseAdminDisplay[]): { prime: number; pastPeak: number; floor: number } {
  let prime = 0;
  let pastPeak = 0;
  let floor = 0;
  for (const h of horses) {
    if (h.ageModifier.phase === 'prime') prime++;
    else if (h.ageModifier.phase === 'floor') floor++;
    else pastPeak++;
  }
  return { prime, pastPeak, floor };
}

interface RecentDeathAdminRow {
  id: number;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  born_game_day: number;
  ended_game_day: number;
  end_reason: string | null;
  stable_name: string;
}

export interface RecentDeathAdminDisplay {
  id: number;
  name: string;
  stableName: string;
  endedGameDay: number;
  endReason: string | null;
}

/** §8.4: deaths in the last `windowGameDays`, newest first - old age and every other end_reason
 * killDueLethalFoals already writes (a condition code), so the operator sees the rate, not just
 * old age's share of it. Voluntary removals are a different thing (a decision, not a death) and are
 * not counted here. */
export async function listRecentDeaths(env: Env, gameDay: number, windowGameDays: number): Promise<RecentDeathAdminDisplay[]> {
  const result = await env.DB.prepare(
    `SELECT h.id, h.registered_name, h.barn_name, h.sex, h.born_game_day, h.ended_game_day, h.end_reason, s.name AS stable_name
     FROM horses h JOIN stables s ON s.id = h.owner_stable_id
     WHERE h.status = 'dead' AND h.ended_game_day >= ?
     ORDER BY h.ended_game_day DESC, h.id DESC`
  )
    .bind(gameDay - windowGameDays)
    .all<RecentDeathAdminRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: horseDisplayName(row),
    stableName: row.stable_name,
    endedGameDay: row.ended_game_day,
    endReason: row.end_reason,
  }));
}

/**
 * §8.4's one control: moves a chosen living horse's natural_death_game_day to today, so the next
 * tick's killDueOldHorses picks it up - the same "testing control that exists because verification
 * is otherwise months away" shape as /admin/breeding's force-twins. Narrower than overview §6b's
 * warning about advancing an individual horse: this moves one horse's death date, not its age, so
 * pedigree, COI, show eligibility and every age-derived number are untouched.
 */
export async function bringHorseDeathForward(env: Env, horseId: number, gameDay: number): Promise<void> {
  await env.DB.prepare(`UPDATE horses SET natural_death_game_day = ? WHERE id = ? AND status = 'alive'`).bind(gameDay, horseId).run();
}

async function killOneOldHorse(env: Env, row: DueOldAgeRow, gameDay: number, config: Config): Promise<void> {
  const foals = await countFoals(env, row.id);
  const ageYears = Math.floor((gameDay - row.born_game_day) / config.values.game_days_per_year);

  const statements = [
    ...buildEndHorseParticipationStatements(env, { horseId: row.id, sex: row.sex, gameDay, status: 'dead', endReason: 'old_age' }),
    ...buildEventStatement(env, {
      stableId: row.owner_stable_id,
      accountId: row.account_id,
      gameDay,
      kind: 'horse_died_old_age',
      subjectHorseId: row.id,
      payload: { horse_name: horseDisplayName(row), age_years: ageYears, sex: row.sex, foals },
    }),
  ];

  await env.DB.batch(statements);
}
