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
import { assignPlacings } from '../engines/showing/placing';
import { noiseForEntry } from '../engines/showing/noise';
import { conformationValues, noiseFor, type RealizationConfig } from '../engines/conformation/model';
import { parseGenotype } from '../engines/genetics/genotype';
import { expressPhenotype } from '../engines/genetics/expression';
import type { TraitCode } from '../engines/genetics/polygenic';
import { getHorse, horseDisplayName, listStableHorses, type HorseRow } from './horses';
import { getBreeds } from './breeds';
import { getJudges, getJudgeById } from './judges';
import { getShowBarnStable } from './npc';
import { getStableById } from './stables';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { buildEventStatement } from './events';
import { isBarredFromShowing } from './health';

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
  class_type: 'breed_conformation';
  breed_id: number | null;
  discipline_code: string | null;
  min_age_game_days: number;
  max_age_game_days: number | null;
  sex_restriction: 'mare' | 'stallion' | 'gelding' | null;
  crosses_eligible: number;
  requires_gait: number;
  target_field_size: number;
  max_entries_per_stable: number;
  judge_id: number;
  ideal_vector: string;
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
  conformation_snapshot: string;
  raw_score: number | null;
  noise_applied: number | null;
  final_score: number | null;
  score_breakdown: string | null;
  placing: number | null;
  scored_game_day: number | null;
  /** Slice 0009 §4.4. What was actually paid, snapshotted at judging - 0 if this entry didn't place
   * within the class's prize_schedule. */
  prize_paid: number;
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
}

export interface HorseResultRow {
  entry_id: number;
  show_id: number;
  show_name: string;
  class_id: number;
  class_name: string;
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

export async function listClassEntriesForDisplay(env: Env, classId: number): Promise<ClassEntryDisplayRow[]> {
  const result = await env.DB.prepare(
    `SELECT se.id, se.horse_id, se.is_npc, se.placing, se.final_score, h.registered_name, h.barn_name, h.sex
     FROM show_entries se JOIN horses h ON h.id = se.horse_id
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
            s.scheduled_game_day, se.placing, se.final_score
     FROM show_entries se
     JOIN show_classes sc ON sc.id = se.class_id
     JOIN shows s ON s.id = sc.show_id
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

function expressedTraitsFor(horse: HorseRow, gameDay: number, config: RealizationConfig, gameDaysPerYear: number): Partial<Record<TraitCode, number>> {
  const genotype = parseGenotype(horse.genotype);
  const ageYears = (gameDay - horse.born_game_day) / gameDaysPerYear;
  const noise = noiseFor(horse.rng_seed, horse.environmental_noise);
  const values = conformationValues(genotype, noise, ageYears, horse.coi, config);
  const expressed: Partial<Record<TraitCode, number>> = {};
  for (const v of values) expressed[v.code] = v.expressed;
  return expressed;
}

function conformationSnapshot(horse: HorseRow, gameDay: number, config: RealizationConfig, gameDaysPerYear: number): string {
  const traits = expressedTraitsFor(horse, gameDay, config, gameDaysPerYear);
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
  gameDaysPerYear: number
): Promise<{ ok: true } | { ok: false; reason: EligibilityReason }> {
  const [existing, stableCount] = await Promise.all([
    getEntryByClassAndHorse(env, cls.id, horse.id),
    countStableEntriesInClass(env, cls.id, horse.owner_stable_id),
  ]);
  const genotype = parseGenotype(horse.genotype);
  const ageGameDays = gameDay - horse.born_game_day;
  const phenotype = expressPhenotype(genotype, ageGameDays, gameDaysPerYear);
  const barredByCondition = await isBarredFromShowing(env, genotype);

  return checkEligibility(
    {
      breedId: horse.breed_id,
      isCross: horse.is_cross === 1,
      ageGameDays,
      sex: horse.sex,
      gaited: phenotype.gaited,
      alreadyEntered: existing !== null,
      barredByCondition,
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
  params: { classId: number; horseId: number; gameDay: number; gameDaysPerYear: number; conformationConfig: RealizationConfig }
): Promise<EnterHorseResult> {
  const cls = await getShowClass(env, params.classId);
  if (!cls || cls.status !== 'scheduled') return { ok: false, reason: 'class_closed' };
  const horse = await getHorse(env, params.horseId);
  if (!horse) return { ok: false, reason: 'not_found' };

  const eligibility = await checkHorseEligibilityForClass(env, cls, horse, params.gameDay, params.gameDaysPerYear);
  if (!eligibility.ok) return eligibility;

  const snapshot = conformationSnapshot(horse, params.gameDay, params.conformationConfig, params.gameDaysPerYear);

  try {
    await env.DB.prepare(
      `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, conformation_snapshot)
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

async function createShowIfMissing(env: Env, scheduledGameDay: number, gameDay: number, config: Config): Promise<void> {
  const breeds = await getBreeds(env);
  // §4.2: a class is only created for a breed whose ideal_vector is non-null. Today that is the
  // Quarter Horse and nothing else - when the other seven breeds get vectors, they get classes with
  // no code change here.
  const eligibleBreeds = breeds.filter((b) => b.ideal_vector !== null);
  if (eligibleBreeds.length === 0) return;

  const judges = await getJudges(env);
  if (judges.length === 0) throw new Error('createShowIfMissing: no active judges are seeded');

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
    const judge = judges[makeRng(deriveSeed(seed, `judge_${String(ordinal)}`)).int(judges.length)];

    statements.push(
      env.DB.prepare(
        `INSERT INTO show_classes (
           show_id, name, class_type, breed_id, discipline_code, min_age_game_days, max_age_game_days,
           sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
           judge_id, ideal_vector, ideal_falloff, noise_sd, status, judged_game_day, rng_seed, prize_schedule
         ) VALUES (
           (SELECT id FROM shows ORDER BY id DESC LIMIT 1), ?, 'breed_conformation', ?, NULL, ?, NULL,
           NULL, 0, 0, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?, ?
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
    const barn = await getShowBarnStable(env);
    if (barn) {
      const candidates = await listStableHorses(env, barn.id);
      const eligible: HorseRow[] = [];
      for (const horse of candidates) {
        if (alreadyIn.has(horse.id)) continue;
        const result = await checkHorseEligibilityForClass(env, cls, horse, gameDay, gameDaysPerYear);
        if (result.ok) eligible.push(horse);
      }
      const rng = makeRng(deriveSeed(cls.rng_seed, 'npc_field'));
      npcHorses.push(...rng.shuffle(eligible).slice(0, shortfall));
    }
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

  const ideal = parseIdealVector(cls.ideal_vector);
  const judge = await getJudgeById(env, cls.judge_id);
  const judgeWeights = judge ? parseJudgeWeights(judge.trait_weights) : {};
  const judgeCode = judge?.code ?? 'unknown';

  interface Scored {
    horseId: number;
    rawScore: number;
    noise: number;
    finalScore: number;
    breakdown: Record<string, unknown>;
  }

  const scored: Scored[] = [];
  for (const horseId of allHorseIds) {
    const horse = horseById.get(horseId);
    if (!horse) continue;
    const expressed = expressedTraitsFor(horse, gameDay, conformationConfig, gameDaysPerYear);
    const noise = noiseForEntry(cls.rng_seed, horse.id, cls.noise_sd);
    const result = scoreEntry({ expressed, ideal, judgeWeights, falloff: cls.ideal_falloff, noise });

    scored.push({
      horseId: horse.id,
      rawScore: result.rawScore,
      noise: result.noise,
      finalScore: result.finalScore,
      // Snake_case to match the documented shape (migrations/0038_show_entries.sql's comment and
      // slice 0008 §5.5) - the score_breakdown blob is read by a render route, not by TypeScript,
      // so it follows this codebase's JSON-column convention rather than result.traits' own
      // camelCase field names.
      breakdown: {
        v: 1,
        judge_code: judgeCode,
        traits: result.traits.map((t) => ({ code: t.code, expressed: t.expressed, target: t.target, weight: t.weight, trait_score: t.traitScore })),
        weight_sum: result.weightSum,
        raw_score: result.rawScore,
        noise: result.noise,
        final_score: result.finalScore,
      },
    });
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
    const snapshot = conformationSnapshot(horse, gameDay, conformationConfig, gameDaysPerYear);
    const entryId = nextEntryId++;
    entryIdByHorseId.set(horse.id, entryId);
    stableIdByHorseId.set(horse.id, horse.owner_stable_id);
    statements.push(
      env.DB.prepare(
        `INSERT INTO show_entries (
           id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, conformation_snapshot,
           raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        gameDay
      )
    );
  }

  for (const entry of existingEntries) {
    const s = scored.find((x) => x.horseId === entry.horse_id);
    if (!s) continue;
    const placing = placingByHorseId.get(entry.horse_id)!;
    statements.push(
      env.DB.prepare(
        `UPDATE show_entries SET raw_score = ?, noise_applied = ?, final_score = ?, score_breakdown = ?, placing = ?, scored_game_day = ?
         WHERE id = ? AND placing IS NULL`
      ).bind(s.rawScore, s.noise, s.finalScore, JSON.stringify(s.breakdown), placing, gameDay, entry.id)
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
