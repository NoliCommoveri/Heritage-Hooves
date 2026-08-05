// Shows, classes, entries and the permanent per-horse summary (slice 0008 §5-§7). Two tick stages
// live here (§6): createDueShows (called before judgeDueShowClasses, same pattern slice 0003's
// breeding stages use in db/tick.ts) and judgeDueShowClasses. Everything else is plain CRUD for the
// routes.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import type { Config } from '../lib/config-cache';
import { calendarEntryFor } from '../engines/showing/calendar';
import { checkEligibility, type EligibilityReason } from '../engines/showing/eligibility';
import { scoreEntry, parseIdealVector, parseJudgeWeights } from '../engines/showing/score';
import { scoreAbilityEntry, parseAbilityWeights } from '../engines/showing/abilityScore';
import { parseDisciplineAptitudes, aptitudeFor } from '../engines/breeds/identity';
import { assignPlacings } from '../engines/showing/placing';
import { noiseForEntry } from '../engines/showing/noise';
import { conformationValues, abilityValues, noiseFor, type RealizationConfig } from '../engines/conformation/model';
import { ABILITY_TRAITS } from '../engines/conformation/traits';
import { abilityLabelFor, type ConformationLabelBands } from '../engines/conformation/labels';
import { parseGenotype } from '../engines/genetics/genotype';
import { expressPhenotype } from '../engines/genetics/expression';
import type { TraitCode } from '../engines/genetics/polygenic';
import { getHorse, horseDisplayName, type HorseRow } from './horses';
import { getBreedsInPlay, getBreeds } from './breeds';
import { getJudges, getJudgeById } from './judges';
import { getEnabledDisciplines } from './disciplines';
import { getAbilityTraits } from './quantitativeTraits';
import { buildAbilityWordUpsertStatement, type AbilityWordLabel } from './abilityTests';
import { listNpcStableHorses } from './npc';
import { getStableById } from './stables';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { buildEventStatement } from './events';
import { isBarredFromShowing, getEnabledConditions, conditionDeltaMapForHorses } from './health';
import { acquiredBarringFlags, acuteCarePenaltyMapForHorses } from './incidents';
import { careModifierForHorse, availabilityForHorse } from './care';
import { ageModifierForHorse } from './ageing';

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique constraint failed/i.test(err.message);
}

export interface ShowRow {
  id: number;
  name: string;
  tier: 'local' | 'regional' | 'national';
  venue: string;
  scheduled_game_day: number;
  entry_deadline_game_day: number;
  status: 'entries_open' | 'judged' | 'cancelled';
  rng_seed: number;
  created_game_day: number;
  created_real_ts: number;
}

export interface ShowClassRow {
  id: number;
  show_id: number;
  name: string;
  /** Slice 0025 stage 3 adds 'young_conformation' (an in-hand conformation class restricted to a
   * yearling or two-year-old age band, scored exactly like breed_conformation) and 'ability_test'
   * (a single ABILITY_TRAITS trait, scored exactly like a discipline). Migration 0161's CHECK
   * enforces which columns each of the four requires. */
  class_type: 'breed_conformation' | 'discipline' | 'young_conformation' | 'ability_test';
  breed_id: number | null;
  discipline_code: string | null;
  /** Non-null for exactly 'ability_test' - which ABILITY_TRAITS code this class measures. */
  ability_trait_code: TraitCode | null;
  /** Non-null for exactly 'young_conformation'/'ability_test' - display/grouping metadata only;
   * min_age_game_days/max_age_game_days are what eligibility and judging actually read. */
  age_band: 'yearling' | 'two_year_old' | null;
  min_age_game_days: number;
  max_age_game_days: number | null;
  sex_restriction: 'mare' | 'stallion' | 'gelding' | null;
  crosses_eligible: number;
  requires_gait: number;
  target_field_size: number;
  max_entries_per_stable: number;
  judge_id: number;
  /** Null for a discipline or ability_test class (migration 0161's CHECK enforces the pairing). */
  ideal_vector: string | null;
  /** Null for a breed_conformation or young_conformation class. */
  ability_weights: string | null;
  ideal_falloff: number;
  noise_sd: number;
  status: 'scheduled' | 'judged';
  judged_game_day: number | null;
  rng_seed: number;
  /** Slice 0009 §4.4. JSON array, index 0 = first place - snapshotted from config.values.show_prize_schedule
   * at creation (CLAUDE.md §5.5), never re-read from config at judging. */
  prize_schedule: string;
}

export interface ShowEntryRow {
  id: number;
  class_id: number;
  horse_id: number;
  entered_by_stable_id: number;
  is_npc: number;
  entered_game_day: number;
  /** Renamed from conformation_snapshot by migration 0065 (slice 0012 §6.5) - the blob shape was
   * always trait-agnostic, only the column name said otherwise. */
  trait_snapshot: string;
  raw_score: number | null;
  noise_applied: number | null;
  final_score: number | null;
  score_breakdown: string | null;
  placing: number | null;
  scored_game_day: number | null;
  /** Slice 0009 §4.4. What was actually paid, snapshotted at judging - 0 if this entry didn't place
   * within the class's prize_schedule. */
  prize_paid: number;
  /** Slice 0013 §2.1/§8.4. The care modifier this entry was actually scored with, snapshotted at
   * judging time - never recomputed, so a result's explanation never changes afterwards even
   * though the horse's own care state keeps moving. 1.0 for every entry judged before this slice. */
  care_modifier_applied: number;
  /** Slice 0014 §2.3/§8.3. The age modifier this entry was actually scored with, snapshotted the
   * same way and for the same reason as care_modifier_applied - its own column, not folded into it
   * (§2.3). 1.0 for every entry judged before this slice. */
  age_modifier_applied: number;
}

export interface HorseShowSummaryRow {
  horse_id: number;
  starts: number;
  wins: number;
  placings: string;
  best_placing: number | null;
  last_shown_game_day: number | null;
}

export interface ClassEntryDisplayRow {
  id: number;
  horse_id: number;
  is_npc: number;
  placing: number | null;
  final_score: number | null;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  /** Slice 0016 §7.1: the entering stable and its owner, for the placings table's Stable column. */
  stable_id: number;
  stable_name: string;
  stable_is_npc: number;
  /** Null for an NPC stable, which has no account. */
  owner_display_name: string | null;
}

export interface HorseResultRow {
  entry_id: number;
  show_id: number;
  show_name: string;
  class_id: number;
  class_name: string;
  /** Which grouping this result belongs to on the horse page's Show record card (§ grouping by
   * discipline/conformation): 'breed_conformation' groups under "Conformation", 'discipline' groups
   * under the discipline's own name (discipline_name below), 'young_conformation' groups under
   * "Young Horse Conformation", 'ability_test' groups under its trait's own name (ability_trait_name
   * below) - slice 0025 stage 3. */
  class_type: 'breed_conformation' | 'discipline' | 'young_conformation' | 'ability_test';
  /** Null for anything but a discipline result. The discipline's display name, e.g. "Barrel Racing" -
   * joined in here rather than looked up separately since listRecentResultsForHorse already reads
   * one row per result. */
  discipline_name: string | null;
  /** Null for anything but an ability_test result. The trait's display name, e.g. "Speed". */
  ability_trait_name: string | null;
  scheduled_game_day: number;
  placing: number;
  final_score: number;
}

export interface AdminShowSummary {
  id: number;
  name: string;
  scheduled_game_day: number;
  status: string;
  judgeName: string | null;
  winnerName: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getShow(env: Env, id: number): Promise<ShowRow | null> {
  return env.DB.prepare('SELECT * FROM shows WHERE id = ?').bind(id).first<ShowRow>();
}

export async function getShowClassesForShow(env: Env, showId: number): Promise<ShowClassRow[]> {
  const result = await env.DB.prepare('SELECT * FROM show_classes WHERE show_id = ? ORDER BY id ASC').bind(showId).all<ShowClassRow>();
  return result.results ?? [];
}

export async function getShowClass(env: Env, id: number): Promise<ShowClassRow | null> {
  return env.DB.prepare('SELECT * FROM show_classes WHERE id = ?').bind(id).first<ShowClassRow>();
}

/** The earliest show still open for entries - normally at most one exists at a time, since the
 * default entry window matches the show interval (§2.1). */
export async function getNextShow(env: Env): Promise<ShowRow | null> {
  return env.DB.prepare(`SELECT * FROM shows WHERE status = 'entries_open' ORDER BY scheduled_game_day ASC LIMIT 1`).first<ShowRow>();
}

export async function listRecentJudgedShows(env: Env, limit: number): Promise<ShowRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM shows WHERE status = 'judged' ORDER BY scheduled_game_day DESC LIMIT ?`)
    .bind(limit)
    .all<ShowRow>();
  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// Slice 0016 §5: the /shows filters (class-type tabs, breed search) and item 8 (a judged class
// nobody entered publishes no results). One shared predicate so the SQL-driven recent-judged list
// and the in-memory filter applied to a single show's own classes can never disagree (§5.2).
// ---------------------------------------------------------------------------

export interface ShowsFilterParams {
  /** 'all' | 'conformation' | 'young' | a discipline code. 'young' (slice 0025 stage 3) is
   * young_conformation and ability_test together - the slice's own "young-horse classes" grouping,
   * kept as one tab rather than splitting it the way a breed/discipline picker would, since a horse
   * only ever matches one age band at a time regardless of which of the two class types it entered. */
  classType: string;
  /** Ignored (by construction - §5.1) unless classType is 'all' or 'conformation', since neither a
   * discipline nor a young-horse class carries a breed_id filter worth offering (ability_test has
   * none at all, and young_conformation's own breed picker would be confusing shared with
   * ability_test on the same tab). */
  breedId: number | null;
}

/** The one predicate every filtered view of a show's classes shares. */
export function classMatchesShowsFilter(
  cls: Pick<ShowClassRow, 'class_type' | 'discipline_code' | 'breed_id'>,
  filter: ShowsFilterParams
): boolean {
  if (filter.classType === 'conformation') {
    if (cls.class_type !== 'breed_conformation') return false;
  } else if (filter.classType === 'young') {
    if (cls.class_type !== 'young_conformation' && cls.class_type !== 'ability_test') return false;
  } else if (filter.classType !== 'all') {
    if (cls.discipline_code !== filter.classType) return false;
  }
  if ((filter.classType === 'all' || filter.classType === 'conformation') && filter.breedId !== null && cls.breed_id !== filter.breedId) {
    return false;
  }
  return true;
}

/** Item 8 (§5.3): true for a scheduled class always, and for a judged class only when at least one
 * of its entries is a player's own (not the show barn's). */
export async function classHasPlayerEntry(env: Env, classId: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS present FROM show_entries WHERE class_id = ? AND is_npc = 0 LIMIT 1').bind(classId).first<{ present: number }>();
  return row !== null;
}

/**
 * §5.2's SQL-driven list: judged shows having at least one class that matches the filter AND has a
 * player entry (item 8) - a show whose classes all fail either condition is not listed at all.
 * Built in SQL rather than loaded-then-filtered so this stays cheap as the breed/discipline count
 * grows (§5.2's own instruction).
 */
export async function listRecentJudgedShowsFiltered(env: Env, limit: number, filter: ShowsFilterParams): Promise<ShowRow[]> {
  const classTypeCond = filter.classType === 'conformation' ? 'breed_conformation' : null;
  const disciplineCond = filter.classType !== 'all' && filter.classType !== 'conformation' ? filter.classType : null;
  const breedCond = filter.classType === 'all' || filter.classType === 'conformation' ? filter.breedId : null;

  const result = await env.DB.prepare(
    `SELECT s.* FROM shows s
     WHERE s.status = 'judged'
       AND EXISTS (
         SELECT 1 FROM show_classes sc
         WHERE sc.show_id = s.id
           AND (? IS NULL OR sc.class_type = ?)
           AND (? IS NULL OR sc.discipline_code = ?)
           AND (? IS NULL OR sc.breed_id = ?)
           AND EXISTS (SELECT 1 FROM show_entries se WHERE se.class_id = sc.id AND se.is_npc = 0)
       )
     ORDER BY s.scheduled_game_day DESC LIMIT ?`
  )
    .bind(classTypeCond, classTypeCond, disciplineCond, disciplineCond, breedCond, breedCond, limit)
    .all<ShowRow>();
  return result.results ?? [];
}

/** Every class still waiting to be judged, oldest first - what the horse page's "Enter in a show"
 * button and /shows/:id's entry form both check a horse's eligibility against. */
export async function getOpenClasses(env: Env, limit = 10): Promise<ShowClassRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM show_classes WHERE status = 'scheduled' ORDER BY id ASC LIMIT ?`).bind(limit).all<ShowClassRow>();
  return result.results ?? [];
}

export async function getEntriesForClass(env: Env, classId: number): Promise<ShowEntryRow[]> {
  const result = await env.DB.prepare('SELECT * FROM show_entries WHERE class_id = ?').bind(classId).all<ShowEntryRow>();
  return result.results ?? [];
}

/** Slice 0016 §7.1: joins the entering stable and its owning account (LEFT JOIN - an NPC stable has
 * no account) alongside the horse, in the one query this was already making per class. */
export async function listClassEntriesForDisplay(env: Env, classId: number): Promise<ClassEntryDisplayRow[]> {
  const result = await env.DB.prepare(
    `SELECT se.id, se.horse_id, se.is_npc, se.placing, se.final_score, h.registered_name, h.barn_name, h.sex,
            st.id AS stable_id, st.name AS stable_name, st.is_npc AS stable_is_npc, a.display_name AS owner_display_name
     FROM show_entries se
     JOIN horses h ON h.id = se.horse_id
     JOIN stables st ON st.id = se.entered_by_stable_id
     LEFT JOIN accounts a ON a.id = st.account_id
     WHERE se.class_id = ?
     ORDER BY (se.placing IS NULL) ASC, se.placing ASC, se.id ASC`
  )
    .bind(classId)
    .all<ClassEntryDisplayRow>();
  return result.results ?? [];
}

export async function getEntry(env: Env, id: number): Promise<ShowEntryRow | null> {
  return env.DB.prepare('SELECT * FROM show_entries WHERE id = ?').bind(id).first<ShowEntryRow>();
}

export async function getEntryByClassAndHorse(env: Env, classId: number, horseId: number): Promise<ShowEntryRow | null> {
  return env.DB.prepare('SELECT * FROM show_entries WHERE class_id = ? AND horse_id = ?').bind(classId, horseId).first<ShowEntryRow>();
}

export interface OpenEntryForHorse {
  classId: number;
  className: string;
}

/** Slice 0011 §6.2/§7.4: this horse's entries in classes that have not been judged yet, identified
 * by the class's own status column rather than a date comparison - what the retire-away
 * confirmation page names, and exactly the set buildEndHorseParticipationStatements withdraws. */
export async function listOpenEntriesForHorse(env: Env, horseId: number): Promise<OpenEntryForHorse[]> {
  const result = await env.DB.prepare(
    `SELECT sc.id AS class_id, sc.name AS class_name FROM show_entries se
     JOIN show_classes sc ON sc.id = se.class_id
     WHERE se.horse_id = ? AND sc.status = 'scheduled'`
  )
    .bind(horseId)
    .all<{ class_id: number; class_name: string }>();
  return (result.results ?? []).map((r) => ({ classId: r.class_id, className: r.class_name }));
}

export async function countStableEntriesInClass(env: Env, classId: number, stableId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM show_entries WHERE class_id = ? AND entered_by_stable_id = ?')
    .bind(classId, stableId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface EntryFullContext {
  entry: ShowEntryRow;
  cls: ShowClassRow;
  show: ShowRow;
}

export async function getEntryFull(env: Env, entryId: number): Promise<EntryFullContext | null> {
  const entry = await getEntry(env, entryId);
  if (!entry) return null;
  const cls = await getShowClass(env, entry.class_id);
  if (!cls) return null;
  const show = await getShow(env, cls.show_id);
  if (!show) return null;
  return { entry, cls, show };
}

export async function getShowSummary(env: Env, horseId: number): Promise<HorseShowSummaryRow | null> {
  return env.DB.prepare('SELECT * FROM horse_show_summary WHERE horse_id = ?').bind(horseId).first<HorseShowSummaryRow>();
}

export async function listRecentResultsForHorse(env: Env, horseId: number, limit: number): Promise<HorseResultRow[]> {
  const result = await env.DB.prepare(
    `SELECT se.id AS entry_id, s.id AS show_id, s.name AS show_name, sc.id AS class_id, sc.name AS class_name,
            sc.class_type, d.name AS discipline_name, qt.name AS ability_trait_name,
            s.scheduled_game_day, se.placing, se.final_score
     FROM show_entries se
     JOIN show_classes sc ON sc.id = se.class_id
     JOIN shows s ON s.id = sc.show_id
     LEFT JOIN disciplines d ON d.code = sc.discipline_code
     LEFT JOIN quantitative_traits qt ON qt.code = sc.ability_trait_code
     WHERE se.horse_id = ? AND se.placing IS NOT NULL
     ORDER BY s.scheduled_game_day DESC
     LIMIT ?`
  )
    .bind(horseId, limit)
    .all<HorseResultRow>();
  return result.results ?? [];
}

/** /admin/shows' recent-shows list. Assumes one class per show, which is all this slice ever
 * creates (§3) - a later slice adding a second class type should give this its own per-class rows. */
export async function listShowsForAdmin(env: Env, limit: number): Promise<AdminShowSummary[]> {
  const result = await env.DB.prepare(
    `SELECT s.id, s.name, s.scheduled_game_day, s.status,
            j.name AS judge_name,
            h.registered_name AS winner_registered_name, h.barn_name AS winner_barn_name
     FROM shows s
     LEFT JOIN show_classes sc ON sc.show_id = s.id
     LEFT JOIN judges j ON j.id = sc.judge_id
     LEFT JOIN show_entries se ON se.class_id = sc.id AND se.placing = 1
     LEFT JOIN horses h ON h.id = se.horse_id
     GROUP BY s.id
     ORDER BY s.scheduled_game_day DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<{
      id: number;
      name: string;
      scheduled_game_day: number;
      status: string;
      judge_name: string | null;
      winner_registered_name: string | null;
      winner_barn_name: string | null;
    }>();
  return (result.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    scheduled_game_day: r.scheduled_game_day,
    status: r.status,
    judgeName: r.judge_name,
    winnerName: r.winner_registered_name ?? r.winner_barn_name ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Entering a horse
// ---------------------------------------------------------------------------

/** Slice 0012 §7.1/§8.2 (widened by slice 0025 stage 3): branches on the class's own class_type -
 * conformationValues for a breed_conformation or young_conformation class, abilityValues for a
 * discipline or ability_test one. Both go through the identical potential -> geneticValue ->
 * realization -> expressedValue pipeline; only which trait list gets mapped differs. */
export function classUsesAbilityScoring(classType: ShowClassRow['class_type']): boolean {
  return classType === 'discipline' || classType === 'ability_test';
}

function expressedTraitsForClass(horse: HorseRow, classType: ShowClassRow['class_type'], gameDay: number, config: RealizationConfig, gameDaysPerYear: number): Partial<Record<TraitCode, number>> {
  const genotype = parseGenotype(horse.genotype);
  const ageYears = (gameDay - horse.born_game_day) / gameDaysPerYear;
  const noise = noiseFor(horse.rng_seed, horse.environmental_noise);
  const values = classUsesAbilityScoring(classType) ? abilityValues(genotype, noise, ageYears, horse.coi, config) : conformationValues(genotype, noise, ageYears, horse.coi, config);
  const expressed: Partial<Record<TraitCode, number>> = {};
  for (const v of values) expressed[v.code] = v.expressed;
  return expressed;
}

/** trait_snapshot, written at entry time (migration 0065 renamed the column - the blob shape was
 * always trait-agnostic, §6.5). */
function traitSnapshot(horse: HorseRow, classType: ShowClassRow['class_type'], gameDay: number, config: RealizationConfig, gameDaysPerYear: number): string {
  const traits = expressedTraitsForClass(horse, classType, gameDay, config, gameDaysPerYear);
  const ageYears = (gameDay - horse.born_game_day) / gameDaysPerYear;
  return JSON.stringify({ v: 1, traits, age_years: Math.round(ageYears * 100) / 100, coi: horse.coi });
}

/**
 * Checks every rule in engines/showing/eligibility.ts for one horse against one class, loading
 * exactly what that pure function needs (§4.1's phenotype.gaited, the class's own snapshotted
 * rules, and how many of this stable's horses are already in). Shared by the read-only "can this
 * horse enter" check (horse page, /shows/:id) and enterHorseInClass below, so there is exactly one
 * place these rules are ever evaluated against real data.
 */
export async function checkHorseEligibilityForClass(
  env: Env,
  cls: ShowClassRow,
  horse: HorseRow,
  gameDay: number,
  gameDaysPerYear: number,
  config: Config
): Promise<{ ok: true } | { ok: false; reason: EligibilityReason }> {
  const [existing, stableCount] = await Promise.all([
    getEntryByClassAndHorse(env, cls.id, horse.id),
    countStableEntriesInClass(env, cls.id, horse.owner_stable_id),
  ]);
  const genotype = parseGenotype(horse.genotype);
  const ageGameDays = gameDay - horse.born_game_day;
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageGameDays, gameDaysPerYear, patternSeed, config.values.pattern_penetrance);
  const barredByCondition = await isBarredFromShowing(env, horse.id, genotype, gameDay);
  const { hasOpenAcuteIncident, hasDegenerativeIncident } = await acquiredBarringFlags(env, horse.id);

  return checkEligibility(
    {
      breedId: horse.breed_id,
      isCross: horse.is_cross === 1,
      ageGameDays,
      sex: horse.sex,
      gaited: phenotype.gaited,
      alreadyEntered: existing !== null,
      barredByCondition,
      hasOpenAcuteIncident,
      hasDegenerativeIncident,
      // The location flag: needs pasture_settle_game_days, which is why this function now takes the
      // live config rather than the two loose numbers it used to.
      availability: availabilityForHorse(horse, config.values, gameDay),
    },
    {
      breedId: cls.breed_id,
      minAgeGameDays: cls.min_age_game_days,
      maxAgeGameDays: cls.max_age_game_days,
      sexRestriction: cls.sex_restriction,
      crossesEligible: cls.crosses_eligible === 1,
      requiresGait: cls.requires_gait === 1,
      maxEntriesPerStable: cls.max_entries_per_stable,
    },
    stableCount
  );
}

export type EnterHorseResult = { ok: true } | { ok: false; reason: EligibilityReason | 'class_closed' | 'not_found' };

/**
 * §6.3: entries close when the tick judges the show - there is no separate deadline.
 *
 * Deliberately does not check canTakeOnCost (src/lib/money.ts) the way the breeding route does.
 * Slice 0009 §2.4/§4.6: shows are currently the only way a stable in the red earns its way back
 * out, so debt blocks expansion (booking a covering) but must never block competing. If a future
 * slice adds a real entry fee here, re-read that section before wiring a debt check into this path.
 */
export async function enterHorseInClass(
  env: Env,
  params: { classId: number; horseId: number; gameDay: number; gameDaysPerYear: number; conformationConfig: RealizationConfig; config: Config }
): Promise<EnterHorseResult> {
  const cls = await getShowClass(env, params.classId);
  if (!cls || cls.status !== 'scheduled') return { ok: false, reason: 'class_closed' };
  const horse = await getHorse(env, params.horseId);
  if (!horse) return { ok: false, reason: 'not_found' };

  const eligibility = await checkHorseEligibilityForClass(env, cls, horse, params.gameDay, params.gameDaysPerYear, params.config);
  if (!eligibility.ok) return eligibility;

  const snapshot = traitSnapshot(horse, cls.class_type, params.gameDay, params.conformationConfig, params.gameDaysPerYear);

  try {
    await env.DB.prepare(
      `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot)
       VALUES (?, ?, ?, 0, ?, ?)`
    )
      .bind(cls.id, horse.id, horse.owner_stable_id, params.gameDay, snapshot)
      .run();
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, reason: 'already_entered' };
    throw err;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tick stage one: create shows that are due (§6.1)
// ---------------------------------------------------------------------------

/**
 * Shows fall on game days that are exact multiples of show_interval_game_days. For every such day
 * in (gameDay, gameDay + show_entry_window_game_days] with no shows row yet, mints one. Idempotency
 * comes from the UNIQUE(scheduled_game_day, tier) index, not from a counter - re-deriving which
 * shows should exist from game_day arithmetic (CLAUDE.md §5.4) means a tick that fires twice
 * creates nothing the second time, and a tick that was missed creates the show late but on its
 * correct game day.
 */
export async function createDueShows(env: Env, gameDay: number, config: Config): Promise<void> {
  const interval = config.values.show_interval_game_days;
  const window = config.values.show_entry_window_game_days;
  if (interval <= 0) return;

  const firstDueDay = (Math.floor(gameDay / interval) + 1) * interval;
  for (let day = firstDueDay; day <= gameDay + window; day += interval) {
    await createShowIfMissing(env, day, gameDay, config);
  }
}

/** Slice 0025 stage 3 §7.3: the two young-horse age bands, derived from the two boundary config keys
 * plus the existing adult conformation min age - see migration 0163's own comment for why there is
 * no separate "two-year-old max" key. Exported for the eligibility-message rendering in
 * render/shows.ts, which needs the same arithmetic to describe a class's own age band in years. */
export interface YoungHorseAgeBands {
  yearling: { min: number; max: number };
  twoYearOld: { min: number; max: number };
}

export function youngHorseAgeBands(config: Config['values']): YoungHorseAgeBands {
  const yearlingMin = config.young_horse_yearling_min_age_game_days;
  const twoYearOldMin = config.young_horse_two_year_old_min_age_game_days;
  const adultMin = config.show_conformation_min_age_game_days;
  return {
    yearling: { min: yearlingMin, max: twoYearOldMin - 1 },
    twoYearOld: { min: twoYearOldMin, max: adultMin - 1 },
  };
}

async function createShowIfMissing(env: Env, scheduledGameDay: number, gameDay: number, config: Config): Promise<void> {
  const breeds = await getBreedsInPlay(env);
  // §4.2: a class is only created for a breed whose ideal_vector is non-null. Today that is the
  // Quarter Horse and nothing else - when the other seven breeds get vectors, they get classes with
  // no code change here. Amendment 0017a §6.2: also gated on `enabled` - a disabled breed's
  // standing classes run to completion, only the creation of the NEXT one is gated, so this is the
  // one place in this function that reads getBreedsInPlay rather than getBreeds.
  const eligibleBreeds = breeds.filter((b) => b.ideal_vector !== null);
  // Slice 0012 §8.1: one class per enabled discipline, ordered by sort_order, capped at
  // show_discipline_classes_per_show. Today that's Barrel Racing and nothing else (§5.1/§6.3) -
  // the other five disciplines arrive as pure data, no code change here either.
  const enabledDisciplines = (await getEnabledDisciplines(env)).slice(0, config.values.show_discipline_classes_per_show);
  // Slice 0025 stage 3: one ability_test class per ABILITY_TRAITS trait, always - unlike a
  // discipline, an ability test does not depend on any discipline being enabled (a Show Jumping
  // fan wants a jump_scope test even before Show Jumping itself has enough players to run).
  const abilityTraitNames = await getAbilityTraits(env);
  if (eligibleBreeds.length === 0 && enabledDisciplines.length === 0) return;

  // Slice 0024 §2: conformation and discipline classes draw from separate judge pools now (a
  // discipline judge's ability_weights would contribute nothing to a breed_conformation score, and
  // vice versa) - each pool only needs to be non-empty when a class of its type is actually being
  // created below. Slice 0025 stage 3: young_conformation reuses the conformation pool (it is
  // scored exactly like breed_conformation) and ability_test reuses the discipline pool (scored
  // exactly like discipline) - ability_test classes are always created once any show is, so the
  // discipline pool is required unconditionally here, not only when enabledDisciplines.length > 0.
  const conformationJudges = await getJudges(env, 'conformation');
  if (eligibleBreeds.length > 0 && conformationJudges.length === 0) {
    throw new Error('createShowIfMissing: no active conformation judges are seeded');
  }
  const disciplineJudges = await getJudges(env, 'discipline');
  if (disciplineJudges.length === 0) {
    throw new Error('createShowIfMissing: no active discipline judges are seeded');
  }
  const ageBands = youngHorseAgeBands(config.values);

  const { venue, name } = calendarEntryFor(scheduledGameDay, config.values.show_interval_game_days);
  const seed = randomSeed();
  const nowSeconds = nowUtcSeconds();

  // One batch: the show row and every one of its classes land together or not at all (§6.1). A
  // crash between them must not leave a show that exists forever with no class - the unique index
  // on (scheduled_game_day, tier) would then hide that gap from every future tick.
  const statements = [
    env.DB.prepare(
      `INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts)
       VALUES (?, 'local', ?, ?, ?, 'entries_open', ?, ?, ?)`
    ).bind(name, venue, scheduledGameDay, scheduledGameDay, seed, gameDay, nowSeconds),
  ];

  const prizeSchedule = JSON.stringify(config.values.show_prize_schedule);

  eligibleBreeds.forEach((breed, index) => {
    const ordinal = index + 1;
    const classSeed = deriveSeed(seed, `class_${String(ordinal)}`);
    const judge = conformationJudges[makeRng(deriveSeed(seed, `judge_${String(ordinal)}`)).int(conformationJudges.length)];

    statements.push(
      env.DB.prepare(
        `INSERT INTO show_classes (
           show_id, name, class_type, breed_id, discipline_code, min_age_game_days, max_age_game_days,
           sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
           judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (
           (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'breed_conformation', ?, NULL, ?, NULL,
           NULL, 0, 0, ?, ?, ?, ?, NULL, ?, ?, 'scheduled', NULL, ?, ?
         )`
      ).bind(
        `${breed.name} Conformation`,
        breed.id,
        config.values.show_conformation_min_age_game_days,
        config.values.show_target_field_size,
        config.values.show_max_entries_per_stable,
        judge.id,
        breed.ideal_vector,
        config.values.show_ideal_falloff,
        config.values.show_noise_sd,
        classSeed,
        prizeSchedule
      )
    );
  });

  // Slice 0012 §8.1: discipline classes are numbered after breed classes, continuing the same
  // class_N/judge_N sub-seed labels off the show's own seed. Slice 0024 §2 changes which pool
  // judge_N indexes into - a discipline class now draws from disciplineJudges, not the
  // conformation pool, so its judge's blurb and ability_weights actually mean something on this
  // class rather than being along for the ride with zero effect on the score (§15's open question
  // in slice 0012, resolved here).
  enabledDisciplines.forEach((discipline, index) => {
    const ordinal = eligibleBreeds.length + index + 1;
    const classSeed = deriveSeed(seed, `class_${String(ordinal)}`);
    const judge = disciplineJudges[makeRng(deriveSeed(seed, `judge_${String(ordinal)}`)).int(disciplineJudges.length)];

    statements.push(
      env.DB.prepare(
        `INSERT INTO show_classes (
           show_id, name, class_type, breed_id, discipline_code, min_age_game_days, max_age_game_days,
           sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
           judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (
           (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'discipline', NULL, ?, ?, NULL,
           NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'scheduled', NULL, ?, ?
         )`
      ).bind(
        discipline.name,
        discipline.code,
        discipline.min_age_game_days,
        discipline.crosses_eligible,
        discipline.requires_gait,
        config.values.show_target_field_size,
        config.values.show_max_entries_per_stable,
        judge.id,
        discipline.ability_weights,
        config.values.show_ideal_falloff,
        discipline.default_noise_sd,
        classSeed,
        prizeSchedule
      )
    );
  });

  // Slice 0025 stage 3 §7.3/§7.4: young_conformation (one per eligible breed per age band) and
  // ability_test (one per ABILITY_TRAITS trait per age band) classes, numbered after every breed and
  // discipline class - continuing the same class_N/judge_N sub-seed labelling, never restarting it.
  const youngBands: { band: 'yearling' | 'two_year_old'; label: string; min: number; max: number }[] = [
    { band: 'yearling', label: 'Yearling', min: ageBands.yearling.min, max: ageBands.yearling.max },
    { band: 'two_year_old', label: 'Two-Year-Old', min: ageBands.twoYearOld.min, max: ageBands.twoYearOld.max },
  ];
  let ordinalCursor = eligibleBreeds.length + enabledDisciplines.length;

  eligibleBreeds.forEach((breed) => {
    youngBands.forEach((band) => {
      ordinalCursor += 1;
      const ordinal = ordinalCursor;
      const classSeed = deriveSeed(seed, `class_${String(ordinal)}`);
      const judge = conformationJudges[makeRng(deriveSeed(seed, `judge_${String(ordinal)}`)).int(conformationJudges.length)];

      statements.push(
        env.DB.prepare(
          `INSERT INTO show_classes (
             show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, min_age_game_days, max_age_game_days,
             sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
             judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
           ) VALUES (
             (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'young_conformation', ?, NULL, NULL, ?, ?, ?,
             NULL, 0, 0, ?, ?, ?, ?, NULL, ?, ?, 'scheduled', NULL, ?, ?
           )`
        ).bind(
          `${band.label} ${breed.name} Conformation`,
          breed.id,
          band.band,
          band.min,
          band.max,
          config.values.show_target_field_size,
          config.values.show_max_entries_per_stable,
          judge.id,
          breed.ideal_vector,
          config.values.show_ideal_falloff,
          config.values.show_noise_sd,
          classSeed,
          prizeSchedule
        )
      );
    });
  });

  // ability_test classes reuse the discipline judge pool and scoreAbilityEntry's own single-trait
  // weight vector - a key missing from `weights` already reads 0 (src/engines/showing/abilityScore.ts),
  // so writing only the one trait that matters is enough.
  ABILITY_TRAITS.forEach((trait) => {
    const traitName = abilityTraitNames.find((t) => t.code === trait)?.name ?? trait;
    youngBands.forEach((band) => {
      ordinalCursor += 1;
      const ordinal = ordinalCursor;
      const classSeed = deriveSeed(seed, `class_${String(ordinal)}`);
      const judge = disciplineJudges[makeRng(deriveSeed(seed, `judge_${String(ordinal)}`)).int(disciplineJudges.length)];
      const abilityWeights = JSON.stringify({ v: 1, traits: { [trait]: 1 } });

      statements.push(
        env.DB.prepare(
          `INSERT INTO show_classes (
             show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, min_age_game_days, max_age_game_days,
             sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
             judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
           ) VALUES (
             (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'ability_test', NULL, NULL, ?, ?, ?, ?,
             NULL, 1, 0, ?, ?, ?, NULL, ?, ?, ?, 'scheduled', NULL, ?, ?
           )`
        ).bind(
          `${band.label} ${traitName} Test`,
          trait,
          band.band,
          band.min,
          band.max,
          config.values.show_target_field_size,
          config.values.show_max_entries_per_stable,
          judge.id,
          abilityWeights,
          config.values.show_ideal_falloff,
          config.values.show_noise_sd,
          classSeed,
          prizeSchedule
        )
      );
    });
  });

  try {
    await env.DB.batch(statements);
  } catch (err) {
    // Another tick run (or a re-fire) already created this show - the whole point of the unique
    // index (§6.1). Nothing to do.
    if (isUniqueConstraintError(err)) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tick stage two: judge shows whose day has arrived (§6.2)
// ---------------------------------------------------------------------------

export async function judgeDueShowClasses(env: Env, gameDay: number, config: Config): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT sc.* FROM show_classes sc JOIN shows s ON s.id = sc.show_id WHERE sc.status = 'scheduled' AND s.scheduled_game_day <= ?`
  )
    .bind(gameDay)
    .all<ShowClassRow>();

  for (const cls of due.results ?? []) {
    await judgeOneClass(env, cls, gameDay, config);
  }
}

async function judgeOneClass(env: Env, cls: ShowClassRow, gameDay: number, config: Config): Promise<void> {
  const gameDaysPerYear = config.values.game_days_per_year;
  const conformationConfig: RealizationConfig = config.values;
  // Slice 0025 stage 3 §7.4: the same Poor/Weak/Acceptable/Good/Outstanding band edges the
  // Conformation card already uses - one vocabulary, not a second set of tunables (CLAUDE.md §13).
  const abilityBands: ConformationLabelBands = {
    outstandingMin: config.values.conformation_label_outstanding_min,
    goodMin: config.values.conformation_label_good_min,
    acceptableMin: config.values.conformation_label_acceptable_min,
    weakMin: config.values.conformation_label_weak_min,
  };

  const existingEntries = await getEntriesForClass(env, cls.id);
  const alreadyIn = new Set(existingEntries.map((e) => e.horse_id));

  // §6.2 step 2: top the field up with show-barn horses, deterministically off the class's own
  // seed - never more than the shortfall, and decided at judging time (not entry time) so a player
  // entering late never changes the top-up count (§6.2's "topping up at judging time is deliberate").
  //
  // Never top up a class no player entered at all. A show nobody entered isn't a contest missing a
  // few competitors, it's a show nobody came to - filling it anyway would hand out ribbons for a
  // field of computer horses judged against each other, and inflate the show barn's own win/start
  // record for a "win" no player was ever part of. This is a deliberate departure from a literal
  // reading of §6.2, which tops up "if entries are fewer than target_field_size" with no floor -
  // flagged here per CLAUDE.md §2.
  const shortfall = existingEntries.length > 0 ? Math.max(0, cls.target_field_size - existingEntries.length) : 0;
  const npcHorses: HorseRow[] = [];
  if (shortfall > 0) {
    // Slice 0015 §7.1: every NPC stable's stock, not one hardcoded stable - everything else here
    // (the shuffle, the eligibility check, the is_npc flag on the resulting show_entries row, the
    // never-top-up-an-empty-field rule above) is unchanged.
    const candidates = await listNpcStableHorses(env);
    const eligible: HorseRow[] = [];
    for (const horse of candidates) {
      if (alreadyIn.has(horse.id)) continue;
      const result = await checkHorseEligibilityForClass(env, cls, horse, gameDay, gameDaysPerYear, config);
      if (result.ok) eligible.push(horse);
    }
    const rng = makeRng(deriveSeed(cls.rng_seed, 'npc_field'));
    npcHorses.push(...rng.shuffle(eligible).slice(0, shortfall));
  }
  const allHorseIds = [...existingEntries.map((e) => e.horse_id), ...npcHorses.map((h) => h.id)];
  if (allHorseIds.length === 0) {
    // Nobody entered at all (the only way to reach this branch, now that the barn is never used
    // to top up an empty field - see the comment above). Still close the class out rather than
    // leaving it 'scheduled' forever: §4.7 allows a zero-entry field, and nothing here touches
    // horse_show_summary for anyone, since nobody showed.
    await env.DB.batch([
      env.DB.prepare(`UPDATE show_classes SET status = 'judged', judged_game_day = ? WHERE id = ? AND status = 'scheduled'`).bind(gameDay, cls.id),
      closeShowIfAllClassesJudgedStatement(env, cls.show_id),
    ]);
    return;
  }

  const horseById = new Map<number, HorseRow>();
  for (const horse of npcHorses) horseById.set(horse.id, horse);
  for (const entry of existingEntries) {
    if (horseById.has(entry.horse_id)) continue;
    const horse = await getHorse(env, entry.horse_id);
    if (horse) horseById.set(horse.id, horse);
  }

  // Slice 0013 §8.4: the whole scoring integration is passing a real number into careModifier -
  // nothing about either formula changes. One feed_level lookup per unique owner stable, not per
  // horse; the show barn's own horses are always stamped current by the tick (§2.6), so their
  // modifier lands at 1.00 with no special case here.
  const feedLevelByStableId = new Map<number, string>();
  for (const stableId of new Set(Array.from(horseById.values()).map((h) => h.owner_stable_id))) {
    const stableRow = await getStableById(env, stableId);
    feedLevelByStableId.set(stableId, stableRow?.feed_level ?? 'standard');
  }

  // Slice 0014 §5.2: one query for horse_conditions, one for horse_knowledge, for the whole class -
  // never one pair per horse. Computed once here, read per horse in the scoring loop below.
  const enabledConditions = await getEnabledConditions(env);
  const conditionDeltaByHorseId = await conditionDeltaMapForHorses(
    env,
    Array.from(horseById.values()),
    enabledConditions,
    gameDay,
    config.values.unmanaged_condition_penalty
  );
  // Slice 0020 §2.9: careModifier's conditionDelta slot gains a second contributor - normally a
  // horse with an open incident was already refused entry (§5.4), but one entered before the
  // incident started and not yet judged still scores with the penalty applied, same as its own
  // Care card would show.
  const acuteDeltaByHorseId = await acuteCarePenaltyMapForHorses(env, Array.from(horseById.keys()), config.values.acute_incident_care_penalty);

  // Slice 0012 §8.2 (widened by slice 0025 stage 3): branch once, at the top, on class_type.
  // Everything after this block (NPC top-up already happened above, placings/summaries/prizes/events
  // below) is shared and unchanged - it does not care which scorer produced the numbers.
  // usesAbilityScoring covers 'discipline' and 'ability_test' (both scored by scoreAbilityEntry);
  // isRealDiscipline is narrower - only a true 'discipline' class has a discipline_code a breed
  // aptitude can be looked up against, so that modifier stays scoped to it alone (an ability_test
  // measures raw ability, not suitability for a specific discipline, and has no discipline_code to
  // look one up with).
  const usesAbilityScoring = classUsesAbilityScoring(cls.class_type);
  const isRealDiscipline = cls.class_type === 'discipline';
  const ideal = usesAbilityScoring ? null : parseIdealVector(cls.ideal_vector!);
  const abilityWeights = usesAbilityScoring ? parseAbilityWeights(cls.ability_weights!) : null;
  const judge = await getJudgeById(env, cls.judge_id);
  const judgeWeights = judge ? parseJudgeWeights(judge.trait_weights) : {};
  // Slice 0024 §3: the discipline counterpart to judgeWeights above - a judge row's ability_weights
  // is only ever non-null for a 'discipline'-kind judge (§2), which is the only kind judgeOneClass
  // ever assigns to a discipline or ability_test class, so this is never read against a conformation
  // judge's null.
  const judgeAbilityWeights = judge?.ability_weights ? parseAbilityWeights(judge.ability_weights) : {};
  const judgeCode = judge?.code ?? 'unknown';

  // Migration 0143: one parse per BREED for the whole class, not one per horse - getBreeds is a
  // cached eight-row read and every horse in a discipline class is looked up against it. Built only
  // for a real discipline class; a breed_conformation/young_conformation class admits one breed and
  // judges it against its own ideal_vector, so an aptitude there would multiply every entry by the
  // same number (see ScoreAbilityEntryParams.aptitudeModifier's own comment), and an ability_test has
  // no discipline_code for an aptitude to mean anything against.
  const aptitudeByBreedId = new Map<number, ReturnType<typeof parseDisciplineAptitudes>>();
  if (isRealDiscipline) {
    for (const breed of await getBreeds(env)) {
      aptitudeByBreedId.set(breed.id, parseDisciplineAptitudes(breed.discipline_aptitudes));
    }
  }

  interface Scored {
    horseId: number;
    rawScore: number;
    noise: number;
    finalScore: number;
    careModifierApplied: number;
    ageModifierApplied: number;
    breakdown: Record<string, unknown>;
    /** Slice 0025 stage 3 §7.4: set only for an 'ability_test' entry - the true expressed value
     * (before noise/care/age) for the one trait this class measures, banded into the same permanent
     * word src/db/abilityTests.ts writes to horse_ability_words. */
    abilityWord?: { traitCode: TraitCode; label: AbilityWordLabel };
  }

  const scored: Scored[] = [];
  for (const horseId of allHorseIds) {
    const horse = horseById.get(horseId);
    if (!horse) continue;
    const expressed = expressedTraitsForClass(horse, cls.class_type, gameDay, conformationConfig, gameDaysPerYear);
    const noise = noiseForEntry(cls.rng_seed, horse.id, cls.noise_sd);
    const feedLevel = feedLevelByStableId.get(horse.owner_stable_id) ?? 'standard';
    const conditionDelta = (conditionDeltaByHorseId.get(horse.id)?.delta ?? 0) + (acuteDeltaByHorseId.get(horse.id) ?? 0);
    const care = careModifierForHorse(horse, feedLevel, config.values, gameDay, conditionDelta);
    // Slice 0014 §4.3: a horse's age is not a barn-wide thing like feed, so no batching is needed
    // the way feedLevelByStableId batches one lookup per stable - this is a pure function of a
    // horse row and live config, computed once per horse exactly like care.
    const age = ageModifierForHorse(horse.born_game_day, config.values, gameDay);
    // Snake_case to match every other breakdown key (§9.1's own convention) - read by a render
    // route, not by TypeScript. farrier_status/wellness_status let the result explanation say
    // *why* without recomputing the ramp later against a horse whose care state has since moved on
    // (§8.4: the snapshot is the whole point, not a live recomputation).
    const careBreakdown = { modifier: care.modifier, farrier_status: care.farrier.status, wellness_status: care.wellness.status };
    const ageBreakdown = { modifier: age.modifier, phase: age.phase, age_years: age.ageYears };

    if (usesAbilityScoring) {
      // A horse whose breed_id is null, or whose breed has no aptitudes decided, or that is a
      // cross, all land on NEUTRAL_APTITUDE - see aptitudeFor, which owns that rule so this loop
      // does not have to restate it. An ability_test class never applies one at all - see
      // isRealDiscipline's own comment above.
      const breedAptitudes = !isRealDiscipline || horse.breed_id === null ? {} : (aptitudeByBreedId.get(horse.breed_id) ?? {});
      const aptitude = isRealDiscipline ? aptitudeFor(breedAptitudes, cls.discipline_code, horse.is_cross === 1) : 1.0;
      const result = scoreAbilityEntry({
        expressed,
        weights: abilityWeights!,
        judgeWeights: judgeAbilityWeights,
        noise,
        careModifier: care.modifier,
        ageModifier: age.modifier,
        aptitudeModifier: aptitude,
      });
      // Slice 0025 stage 3 §7.4: the permanent word, banded off the true expressed value for the
      // one trait this class measures - never the noisy/modified finalScore, same discipline
      // conformationLabelFor already holds (CLAUDE.md §13).
      const abilityWord =
        cls.class_type === 'ability_test' && cls.ability_trait_code
          ? {
              traitCode: cls.ability_trait_code,
              // eligible is always true here - this class exists to test exactly this trait, so
              // abilityLabelFor's 'unknown' branch (an untested trait) can never fire.
              label: abilityLabelFor(expressed[cls.ability_trait_code] ?? 0, abilityBands, true) as AbilityWordLabel,
            }
          : undefined;
      scored.push({
        horseId: horse.id,
        rawScore: result.rawScore,
        noise: result.noise,
        finalScore: result.finalScore,
        careModifierApplied: care.modifier,
        ageModifierApplied: age.modifier,
        abilityWord,
        // No target column - there is no target for an ability trait, only a weight and a
        // contribution.
        breakdown: {
          v: 1,
          kind: 'ability',
          discipline_code: cls.discipline_code,
          ability_trait_code: cls.ability_trait_code,
          traits: result.traits.map((t) => ({ code: t.code, expressed: t.expressed, weight: t.weight, contribution: t.contribution })),
          weight_sum: result.weightSum,
          raw_score: result.rawScore,
          noise: result.noise,
          final_score: result.finalScore,
          care: careBreakdown,
          age: ageBreakdown,
          // Snapshotted into the breakdown because the aptitude itself is NOT snapshotted onto the
          // class (migration 0143's own comment) - if the operator retunes a breed later, this row
          // is the only remaining record of what the horse was actually judged with. Only present for
          // a real discipline class - see isRealDiscipline's own comment above.
          aptitude: isRealDiscipline ? { modifier: aptitude, breed_id: horse.breed_id, is_cross: horse.is_cross === 1 } : undefined,
        },
      });
    } else {
      const result = scoreEntry({ expressed, ideal: ideal!, judgeWeights, falloff: cls.ideal_falloff, noise, careModifier: care.modifier, ageModifier: age.modifier });
      scored.push({
        horseId: horse.id,
        rawScore: result.rawScore,
        noise: result.noise,
        finalScore: result.finalScore,
        careModifierApplied: care.modifier,
        ageModifierApplied: age.modifier,
        // Snake_case to match the documented shape (migrations/0038_show_entries.sql's comment and
        // slice 0008 §5.5) - the score_breakdown blob is read by a render route, not by TypeScript,
        // so it follows this codebase's JSON-column convention rather than result.traits' own
        // camelCase field names.
        breakdown: {
          v: 1,
          kind: 'conformation',
          judge_code: judgeCode,
          traits: result.traits.map((t) => ({ code: t.code, expressed: t.expressed, target: t.target, weight: t.weight, trait_score: t.traitScore })),
          weight_sum: result.weightSum,
          raw_score: result.rawScore,
          noise: result.noise,
          final_score: result.finalScore,
          care: careBreakdown,
          age: ageBreakdown,
          // No aptitude key here, deliberately: a breed_conformation class admits one breed and
          // judges it against that breed's own ideal_vector, so there is no cross-breed comparison
          // for an aptitude to correct. See ScoreAbilityEntryParams.aptitudeModifier's own comment.
        },
      });
    }
  }

  const placed = assignPlacings(scored.map((s) => ({ horseId: s.horseId, finalScore: s.finalScore, rawScore: s.rawScore })));
  const placingByHorseId = new Map(placed.map((p) => [p.horseId, p.placing]));

  // Existing summaries, read before the batch so each row's new numbers are computed here in JS
  // rather than relying on SQL arithmetic mid-batch - the atomicity guarantee comes entirely from
  // the batch below (§5.6/CLAUDE.md §5.4), not from anything clever in the update expression.
  const summaryResults = await env.DB.batch<HorseShowSummaryRow>(
    allHorseIds.map((id) => env.DB.prepare('SELECT * FROM horse_show_summary WHERE horse_id = ?').bind(id))
  );
  const summaryByHorseId = new Map<number, HorseShowSummaryRow | null>();
  allHorseIds.forEach((id, i) => summaryByHorseId.set(id, summaryResults[i].results[0] ?? null));

  // Slice 0009 §4.4: prize money is paid inside this same batch, so a class can never be judged
  // without the money that placing earned landing in the same breath. A player-entered row's id is
  // already known (existingEntries); an NPC row's id is not, since it's inserted below - rather
  // than relying on statement adjacency (last_insert_rowid() goes stale after the first insert that
  // follows it, per the note on buildFoalInsertStatements in src/db/horses.ts) each NPC entry is
  // given an explicit id, pre-allocated from the table's current max, so the prize ledger rows
  // built later in this function can reference it directly. Safe because nothing else inserts into
  // show_entries in the time between this read and the batch below committing - the same
  // single-invocation assumption the ancestor-row subquery pattern elsewhere in this codebase
  // already relies on.
  const maxEntryIdRow = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM show_entries').first<{ maxId: number }>();
  let nextEntryId = (maxEntryIdRow?.maxId ?? 0) + 1;
  const entryIdByHorseId = new Map<number, number>();
  const stableIdByHorseId = new Map<number, number>();
  for (const entry of existingEntries) {
    entryIdByHorseId.set(entry.horse_id, entry.id);
    stableIdByHorseId.set(entry.horse_id, entry.entered_by_stable_id);
  }

  const statements = [];

  for (const horse of npcHorses) {
    const s = scored.find((x) => x.horseId === horse.id);
    if (!s) continue;
    const placing = placingByHorseId.get(horse.id)!;
    const snapshot = traitSnapshot(horse, cls.class_type, gameDay, conformationConfig, gameDaysPerYear);
    const entryId = nextEntryId++;
    entryIdByHorseId.set(horse.id, entryId);
    stableIdByHorseId.set(horse.id, horse.owner_stable_id);
    statements.push(
      env.DB.prepare(
        `INSERT INTO show_entries (
           id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot,
           raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day, care_modifier_applied, age_modifier_applied
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entryId,
        cls.id,
        horse.id,
        horse.owner_stable_id,
        gameDay,
        snapshot,
        s.rawScore,
        s.noise,
        s.finalScore,
        JSON.stringify(s.breakdown),
        placing,
        gameDay,
        s.careModifierApplied,
        s.ageModifierApplied
      )
    );
  }

  for (const entry of existingEntries) {
    const s = scored.find((x) => x.horseId === entry.horse_id);
    if (!s) continue;
    const placing = placingByHorseId.get(entry.horse_id)!;
    statements.push(
      env.DB.prepare(
        `UPDATE show_entries SET raw_score = ?, noise_applied = ?, final_score = ?, score_breakdown = ?, placing = ?, scored_game_day = ?, care_modifier_applied = ?, age_modifier_applied = ?
         WHERE id = ? AND placing IS NULL`
      ).bind(s.rawScore, s.noise, s.finalScore, JSON.stringify(s.breakdown), placing, gameDay, s.careModifierApplied, s.ageModifierApplied, entry.id)
    );
  }

  for (const horseId of allHorseIds) {
    const existing = summaryByHorseId.get(horseId) ?? null;
    const placing = placingByHorseId.get(horseId);
    if (placing === undefined) continue;
    const placings = existing ? (JSON.parse(existing.placings) as Record<string, number>) : {};
    placings[String(placing)] = (placings[String(placing)] ?? 0) + 1;
    const starts = (existing?.starts ?? 0) + 1;
    const wins = (existing?.wins ?? 0) + (placing === 1 ? 1 : 0);
    const bestPlacing = existing?.best_placing != null ? Math.min(existing.best_placing, placing) : placing;

    statements.push(
      env.DB.prepare(
        `INSERT INTO horse_show_summary (horse_id, starts, wins, placings, best_placing, last_shown_game_day)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (horse_id) DO UPDATE SET
           starts = excluded.starts, wins = excluded.wins, placings = excluded.placings,
           best_placing = excluded.best_placing, last_shown_game_day = excluded.last_shown_game_day`
      ).bind(horseId, starts, wins, JSON.stringify(placings), bestPlacing, gameDay)
    );
  }

  // Slice 0025 stage 3 §7.4: the permanent ability word, upserted once per horse per trait - every
  // entry in an 'ability_test' class carries one (scored.abilityWord above), never entries in any
  // other class_type.
  for (const s of scored) {
    if (!s.abilityWord) continue;
    const entryId = entryIdByHorseId.get(s.horseId);
    if (entryId === undefined) continue;
    statements.push(
      buildAbilityWordUpsertStatement(env, {
        horseId: s.horseId,
        traitCode: s.abilityWord.traitCode,
        label: s.abilityWord.label,
        entryId,
        gameDay,
      })
    );
  }

  // Slice 0009 §4.4: pays to show_entries.entered_by_stable_id, which is the show barn's own stable
  // id for an NPC entry - it is paid like anyone else (§3.7), even though nothing reads its balance.
  // A placing beyond the end of the schedule, or a schedule entry of 0, pays nothing.
  const show = await getShow(env, cls.show_id);
  const prizeSchedule = JSON.parse(cls.prize_schedule) as number[];
  const ledgerEntries: LedgerEntry[] = [];
  for (const horseId of allHorseIds) {
    const placing = placingByHorseId.get(horseId);
    if (placing === undefined) continue;
    const prize = prizeSchedule[placing - 1];
    if (!prize) continue;
    const entryId = entryIdByHorseId.get(horseId);
    const stableId = stableIdByHorseId.get(horseId);
    if (entryId === undefined || stableId === undefined) continue;

    statements.push(env.DB.prepare('UPDATE show_entries SET prize_paid = ? WHERE id = ?').bind(prize, entryId));
    ledgerEntries.push({
      stableId,
      amount: prize,
      kind: 'prize',
      referenceType: 'show_entry',
      referenceId: entryId,
      description: `${ordinalPlacing(placing)} place, ${show?.name ?? 'the show'}.`,
      gameDay,
    });
  }
  statements.push(...buildLedgerStatements(env, ledgerEntries));

  // Slice 0009 Part B §6.2: one show_result event per entry, win or not - the events feed is about
  // what happened to a stable's horses, not only what it earned (prize is 0 for an unpaid
  // placing). Skipped for the show barn's own entries and any stable with no account (§6.1),
  // via buildEventStatement's own accountId === null guard.
  const stableAccountById = new Map<number, number | null>();
  for (const stableId of new Set(stableIdByHorseId.values())) {
    const stableRow = await getStableById(env, stableId);
    stableAccountById.set(stableId, stableRow?.account_id ?? null);
  }
  for (const horseId of allHorseIds) {
    const placing = placingByHorseId.get(horseId);
    const stableId = stableIdByHorseId.get(horseId);
    const horse = horseById.get(horseId);
    if (placing === undefined || stableId === undefined || !horse) continue;
    statements.push(
      ...buildEventStatement(env, {
        stableId,
        accountId: stableAccountById.get(stableId) ?? null,
        gameDay,
        kind: 'show_result',
        subjectHorseId: horseId,
        payload: {
          horse_name: horseDisplayName(horse),
          show_name: show?.name ?? 'the show',
          class_name: cls.name,
          placing,
          prize: prizeSchedule[placing - 1] ?? 0,
        },
      })
    );
  }

  statements.push(
    env.DB.prepare(`UPDATE show_classes SET status = 'judged', judged_game_day = ? WHERE id = ? AND status = 'scheduled'`).bind(gameDay, cls.id)
  );
  statements.push(closeShowIfAllClassesJudgedStatement(env, cls.show_id));

  await env.DB.batch(statements);
}

/** "1st", "2nd", "3rd", "11th"... - the prize-ledger description's placing word. Kept local to this
 * file rather than shared with render/shows.ts's own copy (used for the ribbon line, a different
 * purpose in a different layer). */
function ordinalPlacing(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}

/**
 * Flips a show to 'judged' once none of its classes are still 'scheduled'. Placed after the class's
 * own status update in every statement list above, so - within the same D1 batch, which sees each
 * prior statement's effect (the same guarantee buildFoalInsertStatements' ancestor-row subqueries
 * rely on) - this always sees the class it just judged as already 'judged'.
 */
function closeShowIfAllClassesJudgedStatement(env: Env, showId: number): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE shows SET status = 'judged'
     WHERE id = ? AND status != 'judged'
       AND NOT EXISTS (SELECT 1 FROM show_classes WHERE show_id = ? AND status = 'scheduled')`
  ).bind(showId, showId);
}
