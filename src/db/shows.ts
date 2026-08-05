// Shows, classes, entries and the permanent per-horse summary (slice 0008 §5-§7). Two tick stages
// live here (§6): createDueShows (called before judgeDueShowClasses, same pattern slice 0003's
// breeding stages use in db/tick.ts) and judgeDueShowClasses. Everything else is plain CRUD for the
// routes.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import type { Config } from '../lib/config-cache';
import { calendarEntryFor, onDemandCalendarEntryFor } from '../engines/showing/calendar';
import { checkEligibility, type EligibilityReason, type ShowRank, type ClassRank } from '../engines/showing/eligibility';
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
import { isBarredFromShowing, isBarredFromShowingMap, getEnabledConditions, conditionDeltaMapForHorses } from './health';
import { acquiredBarringFlags, acquiredBarringFlagsMap, acuteCarePenaltyMapForHorses } from './incidents';
import { careModifierForHorse, availabilityForHorse } from './care';
import { ageModifierForHorse } from './ageing';

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique constraint failed/i.test(err.message);
}

/**
 * Slice 0025 stage 4 (migration 0165's own comment): the single always-populated identity a
 * show_classes row's (class_type, breed_id, discipline_code, ability_trait_code, age_band) tuple
 * folds down to - what the partial unique index on (class_key, rank) actually indexes, and what the
 * on-demand join-or-create lookup (§7.5a) matches an incoming request against. The same prefixes the
 * migration's own backfill SQL uses; horse_class_ranks reuses the 'bc:'/'disc:' prefixes for its own
 * class_key, since those are the only two rank-tracked class types.
 */
export function classKeyFor(
  classType: ShowClassRow['class_type'],
  breedId: number | null,
  disciplineCode: string | null,
  abilityTraitCode: string | null,
  ageBand: string | null
): string {
  switch (classType) {
    case 'breed_conformation':
      return `bc:${String(breedId)}`;
    case 'discipline':
      return `disc:${String(disciplineCode)}`;
    case 'young_conformation':
      return `yc:${String(breedId)}:${String(ageBand)}`;
    case 'ability_test':
      return `at:${String(abilityTraitCode)}:${String(ageBand)}`;
  }
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
  /** Slice 0025 stage 4 (migration 0165). Always populated - see classKeyFor's own comment for why
   * this exists (a raw multi-column NULL-bearing tuple can't be indexed uniquely in SQLite). */
  class_key: string;
  /** Slice 0025 stage 4 §7.5. 'none' for young_conformation/ability_test - neither is rank-tracked. */
  rank: ClassRank;
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

/** Every show still open for entries, earliest deadline first. Before slice 0025 stage 4, at most
 * one of these ever existed at a time (the calendar minted one show interval at a time - §2.1); on
 * demand (§7.5a), a class is minted the moment somebody asks, so several can be open in parallel -
 * /shows' own index lists all of them rather than assuming there is only ever "the next show". */
export async function listOpenShows(env: Env, limit: number): Promise<ShowRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM shows WHERE status = 'entries_open' ORDER BY scheduled_game_day ASC LIMIT ?`).bind(limit).all<ShowRow>();
  return result.results ?? [];
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
// Rank progression (slice 0025 stage 4 §7.5). One row per (horse, class_key) in horse_class_ranks
// - only ever written for breed_conformation/discipline classes (migration 0166's own comment).
// ---------------------------------------------------------------------------

export interface HorseClassRankRow {
  horse_id: number;
  class_key: string;
  rank: ShowRank;
  top3_since_promotion: number;
  wins_since_promotion: number;
}

/** This horse's current rank in one specific class_key - 'novice' when there is no row yet (a horse
 * starts at the bottom of every class type the first time it's checked, not "unranked"). */
async function horseRankForClass(env: Env, horseId: number, classKey: string): Promise<ShowRank> {
  const row = await env.DB.prepare('SELECT rank FROM horse_class_ranks WHERE horse_id = ? AND class_key = ?').bind(horseId, classKey).first<{ rank: ShowRank }>();
  return row?.rank ?? 'novice';
}

/** The batched sibling of horseRankForClass - every rank this horse has ever earned, across every
 * class_key, in one query. Used by the horse page's catalogue (one horse, many catalogue rows) so
 * checking rank eligibility for the whole "Enter in a show" card costs one query, not one per row. */
export async function horseClassRanksMap(env: Env, horseId: number): Promise<Map<string, ShowRank>> {
  const result = await env.DB.prepare('SELECT class_key, rank FROM horse_class_ranks WHERE horse_id = ?').bind(horseId).all<{ class_key: string; rank: ShowRank }>();
  const map = new Map<string, ShowRank>();
  for (const row of result.results ?? []) map.set(row.class_key, row.rank);
  return map;
}

/** The NPC top-up's own batching axis: every candidate horse's rank for ONE class_key, in one
 * query, rather than one horseRankForClass call per candidate (§7.5a.1's required hoist-and-batch,
 * applied to the dimension that loop actually iterates over). */
async function rankMapForHorsesInClassKey(env: Env, horseIds: number[], classKey: string): Promise<Map<number, ShowRank>> {
  const map = new Map<number, ShowRank>();
  if (horseIds.length === 0) return map;
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB
    .prepare(`SELECT horse_id, rank FROM horse_class_ranks WHERE class_key = ? AND horse_id IN (${placeholders})`)
    .bind(classKey, ...horseIds)
    .all<{ horse_id: number; rank: ShowRank }>();
  for (const row of result.results ?? []) map.set(row.horse_id, row.rank);
  return map;
}

const RANK_ORDER: ShowRank[] = ['novice', 'open', 'champion'];

/**
 * The graduation rule (migration 0166's own comment): every placed entry in a rank-tracked class
 * (breed_conformation/discipline - young_conformation/ability_test never call this) advances its
 * counters, and a horse holding both show_rank_top3_required top-3s and show_rank_win_required wins
 * since its last promotion moves up one rank, counters reset to 0. A horse already at 'champion'
 * still has its counters updated (so /admin can see how a champion is actually doing) but never
 * promotes further - RANK_ORDER has no rank after it.
 */
function nextRankProgressionRow(
  existing: HorseClassRankRow | null,
  placing: number,
  top3Required: number,
  winRequired: number
): { rank: ShowRank; top3: number; wins: number } {
  const rank = existing?.rank ?? 'novice';
  const top3 = (existing?.top3_since_promotion ?? 0) + (placing <= 3 ? 1 : 0);
  const wins = (existing?.wins_since_promotion ?? 0) + (placing === 1 ? 1 : 0);
  const promotes = top3 >= top3Required && wins >= winRequired && rank !== 'champion';
  return promotes ? { rank: RANK_ORDER[RANK_ORDER.indexOf(rank) + 1], top3: 0, wins: 0 } : { rank, top3, wins };
}

function buildRankProgressionUpsertStatement(
  env: Env,
  params: { horseId: number; classType: 'breed_conformation' | 'discipline'; breedId: number | null; disciplineCode: string | null; classKey: string; rank: ShowRank; top3: number; wins: number; gameDay: number }
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO horse_class_ranks (horse_id, class_type, breed_id, discipline_code, class_key, rank, top3_since_promotion, wins_since_promotion, updated_game_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (horse_id, class_key) DO UPDATE SET
       rank = excluded.rank, top3_since_promotion = excluded.top3_since_promotion,
       wins_since_promotion = excluded.wins_since_promotion, updated_game_day = excluded.updated_game_day`
  ).bind(params.horseId, params.classType, params.breedId, params.disciplineCode, params.classKey, params.rank, params.top3, params.wins, params.gameDay);
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
  const [existing, stableCount, rank] = await Promise.all([
    getEntryByClassAndHorse(env, cls.id, horse.id),
    countStableEntriesInClass(env, cls.id, horse.owner_stable_id),
    // Slice 0025 stage 4 §7.5: only breed_conformation/discipline classes rank-gate at all
    // (cls.rank is 'none' for young_conformation/ability_test, which checkEligibility never
    // compares against) - skip the extra query for the two class types that can never need it.
    cls.rank === 'none' ? Promise.resolve<ShowRank>('novice') : horseRankForClass(env, horse.id, cls.class_key),
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
      rank,
    },
    {
      breedId: cls.breed_id,
      minAgeGameDays: cls.min_age_game_days,
      maxAgeGameDays: cls.max_age_game_days,
      sexRestriction: cls.sex_restriction,
      crossesEligible: cls.crosses_eligible === 1,
      requiresGait: cls.requires_gait === 1,
      maxEntriesPerStable: cls.max_entries_per_stable,
      rank: cls.rank,
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
  // Slice 0025 stage 4 §7.5a: off by default (migration 0167). Classes are minted on demand now
  // (requestClassEntry, below) - this calendar path is left in place, unused, as the operator's
  // named "way back" if an empty /shows page ever reads as broken rather than quiet.
  if (config.flags.show_auto_create_enabled !== true) return;
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
           show_id, name, class_type, breed_id, discipline_code, class_key, rank, min_age_game_days, max_age_game_days,
           sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
           judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (
           (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'breed_conformation', ?, NULL, ?, 'novice', ?, NULL,
           NULL, 0, 0, ?, ?, ?, ?, NULL, ?, ?, 'scheduled', NULL, ?, ?
         )`
      ).bind(
        `${breed.name} Conformation`,
        breed.id,
        classKeyFor('breed_conformation', breed.id, null, null, null),
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
           show_id, name, class_type, breed_id, discipline_code, class_key, rank, min_age_game_days, max_age_game_days,
           sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
           judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (
           (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'discipline', NULL, ?, ?, 'novice', ?, NULL,
           NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'scheduled', NULL, ?, ?
         )`
      ).bind(
        discipline.name,
        discipline.code,
        classKeyFor('discipline', null, discipline.code, null, null),
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
             show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, class_key, rank, min_age_game_days, max_age_game_days,
             sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
             judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
           ) VALUES (
             (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'young_conformation', ?, NULL, NULL, ?, ?, 'none', ?, ?,
             NULL, 0, 0, ?, ?, ?, ?, NULL, ?, ?, 'scheduled', NULL, ?, ?
           )`
        ).bind(
          `${band.label} ${breed.name} Conformation`,
          breed.id,
          band.band,
          classKeyFor('young_conformation', breed.id, null, null, band.band),
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
             show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, class_key, rank, min_age_game_days, max_age_game_days,
             sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
             judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
           ) VALUES (
             (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'ability_test', NULL, NULL, ?, ?, ?, 'none', ?, ?,
             NULL, 1, 0, ?, ?, ?, NULL, ?, ?, ?, 'scheduled', NULL, ?, ?
           )`
        ).bind(
          `${band.label} ${traitName} Test`,
          trait,
          band.band,
          classKeyFor('ability_test', null, null, trait, band.band),
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
// The on-demand catalogue and join-or-create (slice 0025 stage 4 §7.5a). A class exists because
// somebody entered a horse in it - the catalogue below is the full list of class types that COULD
// exist for a given horse, whether or not a live show_classes row currently does. requestClassEntry
// is the horse page's "Enter in Show Jumping" button: it joins a live class matching the catalogue
// entry and the horse's own current rank if one is open, or mints exactly one new class otherwise.
// ---------------------------------------------------------------------------

/** One entry in the full catalogue - what a class of this type WOULD look like if minted right now,
 * independent of whether one is currently open. Everything here is what createShowIfMissing already
 * computes per class; this is the same computation, just not yet written to a row. */
export interface CatalogueClassSpec {
  classType: ShowClassRow['class_type'];
  name: string;
  breedId: number | null;
  disciplineCode: string | null;
  abilityTraitCode: TraitCode | null;
  ageBand: 'yearling' | 'two_year_old' | null;
  classKey: string;
  teachingText: string | null;
  minAgeGameDays: number;
  maxAgeGameDays: number | null;
  crossesEligible: number;
  requiresGait: number;
  idealVector: string | null;
  abilityWeights: string | null;
  noiseSd: number;
}

/** §7.5a: "built from the disciplines rows plus the breeds carrying an ideal_vector plus the two
 * young-horse class types" - every catalogue row a mature horse of some breed could conceivably
 * enter, in the same order createShowIfMissing used to mint them (breed conformation, discipline,
 * young conformation, ability test) so the picker reads the same way the old calendar page did. */
export async function buildShowCatalogue(env: Env, config: Config): Promise<CatalogueClassSpec[]> {
  const eligibleBreeds = (await getBreedsInPlay(env)).filter((b) => b.ideal_vector !== null);
  const enabledDisciplines = await getEnabledDisciplines(env);
  const abilityTraitNames = await getAbilityTraits(env);
  const ageBands = youngHorseAgeBands(config.values);
  const bands: { band: 'yearling' | 'two_year_old'; label: string; min: number; max: number }[] = [
    { band: 'yearling', label: 'Yearling', min: ageBands.yearling.min, max: ageBands.yearling.max },
    { band: 'two_year_old', label: 'Two-Year-Old', min: ageBands.twoYearOld.min, max: ageBands.twoYearOld.max },
  ];

  const out: CatalogueClassSpec[] = [];

  for (const breed of eligibleBreeds) {
    out.push({
      classType: 'breed_conformation',
      name: `${breed.name} Conformation`,
      breedId: breed.id,
      disciplineCode: null,
      abilityTraitCode: null,
      ageBand: null,
      classKey: classKeyFor('breed_conformation', breed.id, null, null, null),
      teachingText: null,
      minAgeGameDays: config.values.show_conformation_min_age_game_days,
      maxAgeGameDays: null,
      crossesEligible: 0,
      requiresGait: 0,
      idealVector: breed.ideal_vector,
      abilityWeights: null,
      noiseSd: config.values.show_noise_sd,
    });
  }

  for (const discipline of enabledDisciplines) {
    out.push({
      classType: 'discipline',
      name: discipline.name,
      breedId: null,
      disciplineCode: discipline.code,
      abilityTraitCode: null,
      ageBand: null,
      classKey: classKeyFor('discipline', null, discipline.code, null, null),
      teachingText: discipline.teaching_text,
      minAgeGameDays: discipline.min_age_game_days,
      maxAgeGameDays: null,
      crossesEligible: discipline.crosses_eligible,
      requiresGait: discipline.requires_gait,
      idealVector: null,
      abilityWeights: discipline.ability_weights,
      noiseSd: discipline.default_noise_sd,
    });
  }

  for (const breed of eligibleBreeds) {
    for (const band of bands) {
      out.push({
        classType: 'young_conformation',
        name: `${band.label} ${breed.name} Conformation`,
        breedId: breed.id,
        disciplineCode: null,
        abilityTraitCode: null,
        ageBand: band.band,
        classKey: classKeyFor('young_conformation', breed.id, null, null, band.band),
        teachingText: null,
        minAgeGameDays: band.min,
        maxAgeGameDays: band.max,
        crossesEligible: 0,
        requiresGait: 0,
        idealVector: breed.ideal_vector,
        abilityWeights: null,
        noiseSd: config.values.show_noise_sd,
      });
    }
  }

  for (const trait of ABILITY_TRAITS) {
    const traitName = abilityTraitNames.find((t) => t.code === trait)?.name ?? trait;
    for (const band of bands) {
      out.push({
        classType: 'ability_test',
        name: `${band.label} ${traitName} Test`,
        breedId: null,
        disciplineCode: null,
        abilityTraitCode: trait,
        ageBand: band.band,
        classKey: classKeyFor('ability_test', null, null, trait, band.band),
        teachingText: null,
        minAgeGameDays: band.min,
        maxAgeGameDays: band.max,
        crossesEligible: 1,
        requiresGait: 0,
        idealVector: null,
        abilityWeights: JSON.stringify({ v: 1, traits: { [trait]: 1 } }),
        noiseSd: config.values.show_noise_sd,
      });
    }
  }

  return out;
}

export interface CatalogueRowStatus {
  spec: CatalogueClassSpec;
  /** Non-null when a live class matching this catalogue entry and the horse's own current rank is
   * already open - the "join" case. Null means entering would mint a new class - the "start" case. */
  liveClassId: number | null;
  entryCount: number;
  /** Days from now until judging - either the live class's real deadline, or the window a freshly
   * minted one would use (show_entry_window_game_days, unchanged from the calendar system by the
   * operator's own decision, 2026-08-05: "30 game days. that's one real day."). */
  judgedInDays: number;
  result: { ok: true } | { ok: false; reason: EligibilityReason };
}

/**
 * §7.5a.1's required fix, applied to the catalogue rather than to a list of already-existing open
 * classes: every per-horse fact (genotype, phenotype, barring, incidents, availability) is computed
 * once, and every per-catalogue-row fact (which live class matches, its entry count and deadline,
 * this stable's own count in it) is fetched in a handful of batched queries rather than one round
 * trip per row - the horse page's "Enter in a show" card now costs a small constant number of
 * queries regardless of how large the catalogue grows, closing the O(classes) cost the fix names.
 */
export async function buildCatalogueStatusForHorse(
  env: Env,
  horse: HorseRow,
  gameDay: number,
  gameDaysPerYear: number,
  config: Config
): Promise<CatalogueRowStatus[]> {
  const catalogue = await buildShowCatalogue(env, config);

  const genotype = parseGenotype(horse.genotype);
  const ageGameDays = gameDay - horse.born_game_day;
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageGameDays, gameDaysPerYear, patternSeed, config.values.pattern_penetrance);
  const [barredByCondition, barringFlags, ranks, openEntries] = await Promise.all([
    isBarredFromShowing(env, horse.id, genotype, gameDay),
    acquiredBarringFlags(env, horse.id),
    horseClassRanksMap(env, horse.id),
    listOpenEntriesForHorse(env, horse.id),
  ]);
  const openEntryClassIds = new Set(openEntries.map((e) => e.classId));

  // Every currently-open class in the game, in one query - matched against the catalogue in memory
  // below rather than one WHERE lookup per row.
  const liveRows = await env.DB.prepare(
    `SELECT sc.id, sc.class_key, sc.rank, sc.max_entries_per_stable, s.scheduled_game_day,
            (SELECT COUNT(*) FROM show_entries se WHERE se.class_id = sc.id) AS entry_count
     FROM show_classes sc JOIN shows s ON s.id = sc.show_id
     WHERE sc.status = 'scheduled'`
  ).all<{ id: number; class_key: string; rank: ClassRank; max_entries_per_stable: number; scheduled_game_day: number; entry_count: number }>();
  const liveByKey = new Map((liveRows.results ?? []).map((r) => [`${r.class_key}:${r.rank}`, r]));

  const liveClassIds = (liveRows.results ?? []).map((r) => r.id);
  const stableCountByClassId = new Map<number, number>();
  if (liveClassIds.length > 0) {
    const stableCountRows = await env.DB
      .prepare(
        `SELECT class_id, COUNT(*) AS n FROM show_entries WHERE entered_by_stable_id = ? AND class_id IN (${liveClassIds.map(() => '?').join(',')}) GROUP BY class_id`
      )
      .bind(horse.owner_stable_id, ...liveClassIds)
      .all<{ class_id: number; n: number }>();
    for (const row of stableCountRows.results ?? []) stableCountByClassId.set(row.class_id, row.n);
  }

  return catalogue.map((spec) => {
    const targetRank: ShowRank = spec.classType === 'breed_conformation' || spec.classType === 'discipline' ? (ranks.get(spec.classKey) ?? 'novice') : 'novice';
    const liveRankKey = spec.classType === 'breed_conformation' || spec.classType === 'discipline' ? targetRank : 'none';
    const live = liveByKey.get(`${spec.classKey}:${liveRankKey}`) ?? null;

    const stableCount = live ? (stableCountByClassId.get(live.id) ?? 0) : 0;
    const alreadyEntered = live ? openEntryClassIds.has(live.id) : false;
    const maxEntriesPerStable = live ? live.max_entries_per_stable : config.values.show_max_entries_per_stable;

    const result = checkEligibility(
      {
        breedId: horse.breed_id,
        isCross: horse.is_cross === 1,
        ageGameDays,
        sex: horse.sex,
        gaited: phenotype.gaited,
        alreadyEntered,
        barredByCondition,
        hasOpenAcuteIncident: barringFlags.hasOpenAcuteIncident,
        hasDegenerativeIncident: barringFlags.hasDegenerativeIncident,
        availability: availabilityForHorse(horse, config.values, gameDay),
        rank: targetRank,
      },
      {
        breedId: spec.breedId,
        minAgeGameDays: spec.minAgeGameDays,
        maxAgeGameDays: spec.maxAgeGameDays,
        sexRestriction: null,
        crossesEligible: spec.crossesEligible === 1,
        requiresGait: spec.requiresGait === 1,
        maxEntriesPerStable,
        // Catalogue-level eligibility never rank-gates on its own - a request always targets the
        // horse's OWN current rank (targetRank above), so a mismatch can only ever be reported by
        // /shows/:id's browse-any-open-class form, never by this card (§7.5's own reasoning,
        // engines/showing/eligibility.ts's EligibilityReason.wrong_rank comment).
        rank: 'none',
      },
      stableCount
    );

    return {
      spec,
      liveClassId: live?.id ?? null,
      entryCount: live?.entry_count ?? 0,
      judgedInDays: live ? live.scheduled_game_day - gameDay : config.values.show_entry_window_game_days,
      result,
    };
  });
}

/** Finds (or, on a first request, mints) the one `shows` row every on-demand class created for the
 * same deadline day shares - the calendar system's own "one show, many classes" shape, reused so a
 * flurry of same-day requests land together rather than each getting its own single-class show. The
 * shows table's own UNIQUE(scheduled_game_day, tier) index is what makes this race-safe: two
 * concurrent requests either both see the row after one of them inserts it, or one insert wins and
 * the loser's catch reads back the winner's row. */
async function getOrCreateShowForDay(env: Env, scheduledGameDay: number, gameDay: number): Promise<ShowRow> {
  const existing = await env.DB.prepare('SELECT * FROM shows WHERE scheduled_game_day = ? AND tier = \'local\'').bind(scheduledGameDay).first<ShowRow>();
  if (existing) return existing;

  const { venue, name } = onDemandCalendarEntryFor(scheduledGameDay);
  const seed = randomSeed();
  const nowSeconds = nowUtcSeconds();
  try {
    const result = await env.DB
      .prepare(
        `INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts)
         VALUES (?, 'local', ?, ?, ?, 'entries_open', ?, ?, ?)`
      )
      .bind(name, venue, scheduledGameDay, scheduledGameDay, seed, gameDay, nowSeconds)
      .run();
    const created = await env.DB.prepare('SELECT * FROM shows WHERE id = ?').bind(result.meta.last_row_id).first<ShowRow>();
    if (!created) throw new Error('getOrCreateShowForDay: insert succeeded but the new row could not be read back');
    return created;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const raced = await env.DB.prepare('SELECT * FROM shows WHERE scheduled_game_day = ? AND tier = \'local\'').bind(scheduledGameDay).first<ShowRow>();
    if (raced) return raced;
    throw err;
  }
}

/** Mints exactly one new class for this catalogue spec and rank, in its own (found-or-created)
 * show. Returns null on a unique-index collision (idx_show_classes_open_key, migration 0165) -
 * another request minted the identical (class_key, rank) between requestClassEntry's own lookup and
 * this insert - the caller re-reads and joins what won the race rather than erroring. */
async function mintClassForSpec(env: Env, spec: CatalogueClassSpec, rank: ClassRank, gameDay: number, config: Config): Promise<number | null> {
  const scheduledGameDay = gameDay + config.values.show_entry_window_game_days;
  const show = await getOrCreateShowForDay(env, scheduledGameDay, gameDay);

  const needsConformationJudges = spec.classType === 'breed_conformation' || spec.classType === 'young_conformation';
  const judgePool = needsConformationJudges ? await getJudges(env, 'conformation') : await getJudges(env, 'discipline');
  if (judgePool.length === 0) {
    throw new Error(`mintClassForSpec: no active ${needsConformationJudges ? 'conformation' : 'discipline'} judges are seeded`);
  }
  const seed = randomSeed();
  const judge = judgePool[makeRng(deriveSeed(seed, 'judge')).int(judgePool.length)];
  const prizeSchedule = JSON.stringify(config.values.show_prize_schedule);

  try {
    const result = await env.DB
      .prepare(
        `INSERT INTO show_classes (
           show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, class_key, rank,
           min_age_game_days, max_age_game_days, sex_restriction, crosses_eligible, requires_gait, target_field_size,
           max_entries_per_stable, judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?, ?)`
      )
      .bind(
        show.id,
        spec.name,
        spec.classType,
        spec.breedId,
        spec.disciplineCode,
        spec.abilityTraitCode,
        spec.ageBand,
        spec.classKey,
        rank,
        spec.minAgeGameDays,
        spec.maxAgeGameDays,
        spec.crossesEligible,
        spec.requiresGait,
        config.values.show_target_field_size,
        config.values.show_max_entries_per_stable,
        judge.id,
        spec.idealVector,
        spec.abilityWeights,
        config.values.show_ideal_falloff,
        spec.noiseSd,
        deriveSeed(seed, 'class'),
        prizeSchedule
      )
      .run();
    return result.meta.last_row_id;
  } catch (err) {
    if (isUniqueConstraintError(err)) return null;
    throw err;
  }
}

/**
 * The horse page's "Enter in Show Jumping" button (§7.5a). Joins the live class matching this
 * catalogue entry and the horse's own current rank if one is open and this stable has room in it;
 * mints exactly one new class otherwise. `classKey` is a CatalogueClassSpec.classKey (also the value
 * the picker's hidden form field carries) - identical to what buildCatalogueStatusForHorse already
 * returned this same horse for this same row, so a stale page can never target the wrong catalogue
 * entry, only a now-stale eligibility answer (re-checked here exactly as enterHorseInClass always
 * has, "never trust the submitted value").
 */
export async function requestClassEntry(
  env: Env,
  params: { classKey: string; horseId: number; gameDay: number; gameDaysPerYear: number; conformationConfig: RealizationConfig; config: Config }
): Promise<EnterHorseResult> {
  const horse = await getHorse(env, params.horseId);
  if (!horse) return { ok: false, reason: 'not_found' };

  const catalogue = await buildShowCatalogue(env, params.config);
  const spec = catalogue.find((c) => c.classKey === params.classKey);
  if (!spec) return { ok: false, reason: 'not_found' };

  // §7.5a: "there is no way to create one without an entry landing in it" - checked here, against
  // exactly the same live-class-aware answer the horse page's own catalogue card already gave this
  // horse for this row (buildCatalogueStatusForHorse), before any write happens. A stale or forged
  // request that could never actually enter (too young, already barred, its stable already at the
  // cap, ...) is refused here and never mints an empty class - "never trust the submitted value"
  // (CLAUDE.md §11) applied to a class that might not exist yet, not only to one that already does.
  const status = await buildCatalogueStatusForHorse(env, horse, params.gameDay, params.gameDaysPerYear, params.config);
  const row = status.find((r) => r.spec.classKey === params.classKey);
  if (!row || !row.result.ok) return row ? row.result : { ok: false, reason: 'not_found' };

  const targetRank: ClassRank =
    spec.classType === 'breed_conformation' || spec.classType === 'discipline' ? await horseRankForClass(env, horse.id, spec.classKey) : 'none';

  // At most two passes: the first either joins the live class the check above already found, or
  // mints one (it found none because there wasn't one). If the mint loses a race (mintClassForSpec
  // returns null - another request minted the identical class_key+rank first), the second pass
  // re-reads and joins whatever the winner created.
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await env.DB
      .prepare(`SELECT id FROM show_classes WHERE class_key = ? AND rank = ? AND status = 'scheduled'`)
      .bind(spec.classKey, targetRank)
      .first<{ id: number }>();
    const classId = live ? live.id : await mintClassForSpec(env, spec, targetRank, params.gameDay, params.config);
    if (classId === null) continue;

    return enterHorseInClass(env, {
      classId,
      horseId: horse.id,
      gameDay: params.gameDay,
      gameDaysPerYear: params.gameDaysPerYear,
      conformationConfig: params.conformationConfig,
      config: params.config,
    });
  }
  return { ok: false, reason: 'class_closed' };
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

/**
 * Slice 0025 stage 4 §7.5a.1: the NPC top-up's own batched eligibility check - every query
 * checkHorseEligibilityForClass would otherwise make once per candidate horse (barredByCondition,
 * acquiredBarringFlags, this class's own rank, and how many of each candidate's stable's horses are
 * already in) collapses to a handful of queries for the whole candidate pool, mirroring
 * checkHorseEligibilityForClass's own rule-check exactly (both end at the same checkEligibility
 * call) so there is still exactly one place these rules are evaluated - only how the inputs are
 * gathered differs.
 */
async function eligibleNpcHorsesForClass(
  env: Env,
  cls: ShowClassRow,
  candidates: HorseRow[],
  alreadyIn: Set<number>,
  gameDay: number,
  gameDaysPerYear: number,
  config: Config
): Promise<HorseRow[]> {
  const pool = candidates.filter((h) => !alreadyIn.has(h.id));
  if (pool.length === 0) return [];

  const genotypeByHorseId = new Map(pool.map((h) => [h.id, parseGenotype(h.genotype)]));
  const [barredMap, barringFlagsMap, rankMap, countRows] = await Promise.all([
    isBarredFromShowingMap(env, genotypeByHorseId, gameDay),
    acquiredBarringFlagsMap(env, pool.map((h) => h.id)),
    cls.rank === 'none' ? Promise.resolve(new Map<number, ShowRank>()) : rankMapForHorsesInClassKey(env, pool.map((h) => h.id), cls.class_key),
    env.DB.prepare('SELECT entered_by_stable_id, COUNT(*) AS n FROM show_entries WHERE class_id = ? GROUP BY entered_by_stable_id').bind(cls.id).all<{
      entered_by_stable_id: number;
      n: number;
    }>(),
  ]);
  const stableCountMap = new Map((countRows.results ?? []).map((r) => [r.entered_by_stable_id, r.n]));

  const eligible: HorseRow[] = [];
  for (const horse of pool) {
    const genotype = genotypeByHorseId.get(horse.id)!;
    const ageGameDays = gameDay - horse.born_game_day;
    const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
    const phenotype = expressPhenotype(genotype, ageGameDays, gameDaysPerYear, patternSeed, config.values.pattern_penetrance);
    const flags = barringFlagsMap.get(horse.id) ?? { hasOpenAcuteIncident: false, hasDegenerativeIncident: false };
    const result = checkEligibility(
      {
        breedId: horse.breed_id,
        isCross: horse.is_cross === 1,
        ageGameDays,
        sex: horse.sex,
        gaited: phenotype.gaited,
        // Already excluded from `pool` above - the same rule checkHorseEligibilityForClass enforces
        // with a live getEntryByClassAndHorse query, just pre-filtered here instead.
        alreadyEntered: false,
        barredByCondition: barredMap.get(horse.id) ?? false,
        hasOpenAcuteIncident: flags.hasOpenAcuteIncident,
        hasDegenerativeIncident: flags.hasDegenerativeIncident,
        availability: availabilityForHorse(horse, config.values, gameDay),
        rank: rankMap.get(horse.id) ?? 'novice',
      },
      {
        breedId: cls.breed_id,
        minAgeGameDays: cls.min_age_game_days,
        maxAgeGameDays: cls.max_age_game_days,
        sexRestriction: cls.sex_restriction,
        crossesEligible: cls.crosses_eligible === 1,
        requiresGait: cls.requires_gait === 1,
        maxEntriesPerStable: cls.max_entries_per_stable,
        rank: cls.rank,
      },
      stableCountMap.get(horse.owner_stable_id) ?? 0
    );
    if (result.ok) eligible.push(horse);
  }
  return eligible;
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
    // (the shuffle, the is_npc flag on the resulting show_entries row, the never-top-up-an-empty-
    // field rule above) is unchanged. Slice 0025 §7.5a.1: the eligibility check itself is now
    // eligibleNpcHorsesForClass, which batches every query that used to run once per candidate
    // horse down to a handful for the whole pool - this loop is the dominant cost of a judged tick
    // (§7.6), and it is also where rank now has to be checked (§7.5: "let the npcs compete like real
    // players" means an NPC's own current rank gates it exactly the way a player's does).
    const candidates = await listNpcStableHorses(env);
    const eligible = await eligibleNpcHorsesForClass(env, cls, candidates, alreadyIn, gameDay, gameDaysPerYear, config);
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

  // Slice 0025 stage 4 §7.5: rank progression, only for the two rank-tracked class types - every
  // placed horse in a breed_conformation/discipline class advances its own counters, whether it's a
  // player's horse or the show barn's own (NPCs carry ranks too - "let the npcs compete like real
  // players"). young_conformation/ability_test never reach this block (branches on class_type, which
  // is what horse_class_ranks itself is keyed by, not on cls.rank).
  if (cls.class_type === 'breed_conformation' || cls.class_type === 'discipline') {
    const rankType = cls.class_type;
    const existingRankRows = await env.DB
      .prepare(`SELECT * FROM horse_class_ranks WHERE class_key = ? AND horse_id IN (${allHorseIds.map(() => '?').join(',')})`)
      .bind(cls.class_key, ...allHorseIds)
      .all<HorseClassRankRow>();
    const rankRowByHorseId = new Map((existingRankRows.results ?? []).map((r) => [r.horse_id, r]));
    for (const horseId of allHorseIds) {
      const placing = placingByHorseId.get(horseId);
      if (placing === undefined) continue;
      const next = nextRankProgressionRow(
        rankRowByHorseId.get(horseId) ?? null,
        placing,
        config.values.show_rank_top3_required,
        config.values.show_rank_win_required
      );
      statements.push(
        buildRankProgressionUpsertStatement(env, {
          horseId,
          classType: rankType,
          breedId: cls.breed_id,
          disciplineCode: cls.discipline_code,
          classKey: cls.class_key,
          rank: next.rank,
          top3: next.top3,
          wins: next.wins,
          gameDay,
        })
      );
    }
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
