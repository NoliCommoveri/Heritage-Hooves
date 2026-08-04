// The mating event (slice 0003 §6). Booking is a plain insert made from the breeding screen;
// resolution is the tick's first breeding stage (slice 0003 §10.1), run once per mare per tick on
// whichever tick her cycle brings her into season.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import type { Config } from '../lib/config-cache';
import { writeConfig } from '../lib/config-cache';
import { getHorse, horseDisplayName, loadPedigreeContext } from './horses';
import { getStableById } from './stables';
import { buildPregnancyInsertStatement } from './pregnancies';
import { parseGenotype } from '../engines/genetics/genotype';
import { combine } from '../engines/genetics/inheritance';
import { coefficientOfInbreeding } from '../engines/genetics/pedigree';
import { fertilityPotential, conceptionChance, type ConceptionBreakdown } from '../engines/breeding/fertility';
import { rollTwins } from '../engines/breeding/twins';
import { buildEventStatement } from './events';

export interface CoveringRow {
  id: number;
  stable_id: number;
  mare_id: number;
  stallion_id: number;
  booked_game_day: number;
  booked_tick_seq: number;
  status: 'booked' | 'resolved_conceived' | 'resolved_failed';
  rng_seed: number;
  resolved_game_day: number | null;
  resolved_tick_seq: number | null;
  created_real_ts: number;
  /** Slice 0011 §5.2. Null means live. A row is only ever live when BOTH status says so AND this
   * is null - see the comment on resolveDueCoverings' query below. */
  cancelled_game_day: number | null;
  cancelled_reason: string | null;
}

export async function getBookedCoveringForMare(env: Env, mareId: number): Promise<CoveringRow | null> {
  return env.DB.prepare(`SELECT * FROM coverings WHERE mare_id = ? AND status = 'booked' ORDER BY id DESC LIMIT 1`)
    .bind(mareId)
    .first<CoveringRow>();
}

/** Slice 0011 §6.2: every still-live booking this horse appears in, on either side - a mare has at
 * most one (validateBooking already prevents a second), a stallion can have several. Used by the
 * retire-away confirmation page to name what retiring cancels. */
export async function listBookedCoveringsInvolvingHorse(env: Env, horseId: number): Promise<CoveringRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM coverings WHERE (mare_id = ? OR stallion_id = ?) AND status = 'booked' AND cancelled_game_day IS NULL`
  )
    .bind(horseId, horseId)
    .all<CoveringRow>();
  return result.results ?? [];
}

export interface BookCoveringParams {
  stableId: number;
  mareId: number;
  stallionId: number;
  gameDay: number;
  tickSeq: number;
}

/**
 * The insert statement bookCovering below runs on its own - split out for slice 0017 Part D
 * (src/db/stud.ts's bookStud), which needs this landing in the *same* env.DB.batch() as the stud
 * fee's ledger rows and the stud_bookings row, so a covering can never be created without the money
 * that paid for it, or vice versa.
 */
export function buildBookCoveringStatement(env: Env, params: BookCoveringParams): D1PreparedStatement {
  const seed = randomSeed();
  const nowSeconds = nowUtcSeconds();
  return env.DB
    .prepare(
      `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (?, ?, ?, ?, ?, 'booked', ?, ?)`
    )
    .bind(params.stableId, params.mareId, params.stallionId, params.gameDay, params.tickSeq, seed, nowSeconds);
}

export async function bookCovering(env: Env, params: BookCoveringParams): Promise<{ id: number }> {
  const result = await buildBookCoveringStatement(env, params).run();
  return { id: result.meta.last_row_id };
}

/**
 * Given a mare's age, a stallion's age and a hypothetical pairing's COI, the conception chance a
 * viewer who owns both horses can honestly be shown: mareFertilityFactor/stallionFertilityFactor
 * are unknown-average (1.0), because the actual fertility trait is truth a player hasn't paid to
 * learn (slice 0003 §5). Used by the breeding screen's "Check pairing" estimate - never by the
 * conception roll itself.
 */
export function estimateConceptionChance(
  mareAgeYears: number,
  stallionAgeYears: number,
  foalCoi: number,
  config: Config
): ConceptionBreakdown {
  return conceptionChance(
    {
      mareAgeYears,
      stallionAgeYears,
      mareFertilityFactor: 1.0,
      stallionFertilityFactor: 1.0,
      conditionFactor: 1.0,
      methodFactor: 1.0,
      foalCoi,
    },
    config.values
  );
}

/**
 * The tick's first breeding stage (slice 0003 §10.1). Finds every booked covering whose mare is in
 * season this tick (SQL does the cycle-phase arithmetic directly: cycle_anchor_tick_seq is always
 * <= tickSeq, so a plain SQL `%` is safe - no negative-modulo case to handle), rolls conception for
 * each, and on success rolls twins and creates one or two pregnancies with their genetics already
 * rolled (slice 0003 §3.9).
 */
export async function resolveDueCoverings(env: Env, gameDay: number, tickSeq: number, config: Config): Promise<void> {
  // Slice 0011 §5.2: a row is live when status says so AND cancelled_game_day IS NULL - both
  // halves, every time. Without the second half, a dead mare's booked covering would still resolve
  // on her next in-season tick.
  const due = await env.DB.prepare(
    `SELECT c.* FROM coverings c
     JOIN horses m ON m.id = c.mare_id
     WHERE c.status = 'booked'
       AND c.cancelled_game_day IS NULL
       AND m.cycle_anchor_tick_seq IS NOT NULL
       AND ((? - m.cycle_anchor_tick_seq) % ?) < ?`
  )
    .bind(tickSeq, config.values.estrous_cycle_ticks, config.values.estrus_ticks)
    .all<CoveringRow>();

  // The admin "force twins" control (slice 0003 §7): consumed by whichever covering is the first
  // to actually conceive this tick, then cleared so it only ever fires once.
  const forceTwinsAvailable = config.flags.force_next_twins === true;
  let forceTwinsConsumed = false;
  const consumeForceTwins = (): boolean => {
    if (forceTwinsAvailable && !forceTwinsConsumed) {
      forceTwinsConsumed = true;
      return true;
    }
    return false;
  };

  for (const covering of due.results ?? []) {
    await resolveOneCovering(env, covering, gameDay, tickSeq, config, consumeForceTwins);
  }

  if (forceTwinsConsumed) {
    await writeConfig(env, null, { flags: { force_next_twins: false } });
  }
}

async function resolveOneCovering(
  env: Env,
  covering: CoveringRow,
  gameDay: number,
  tickSeq: number,
  config: Config,
  consumeForceTwins: () => boolean
): Promise<void> {
  const [mare, stallion] = await Promise.all([getHorse(env, covering.mare_id), getHorse(env, covering.stallion_id)]);
  if (!mare || !stallion) throw new Error(`resolveOneCovering: mare or stallion missing for covering ${String(covering.id)}`);

  const pedigreeHorses = await loadPedigreeContext(env, stallion.id, mare.id);
  // Same value the "Check pairing" preview showed - loaded from the same pedigree context, per
  // slice 0003 §4.6.
  const coi = coefficientOfInbreeding(stallion.id, mare.id, pedigreeHorses);

  const gameDaysPerYear = config.values.game_days_per_year;
  const mareAgeYears = (gameDay - mare.born_game_day) / gameDaysPerYear;
  const stallionAgeYears = (gameDay - stallion.born_game_day) / gameDaysPerYear;

  // TRUTH - only ever read here, at the world resolving physics, never by anything shown to a
  // player or an NPC (slice 0003 §5).
  const mareFertility = fertilityPotential(
    { genotype: parseGenotype(mare.genotype), rng_seed: mare.rng_seed },
    config.values.fertility_gene_min,
    config.values.fertility_gene_max
  );
  const stallionFertility = fertilityPotential(
    { genotype: parseGenotype(stallion.genotype), rng_seed: stallion.rng_seed },
    config.values.fertility_gene_min,
    config.values.fertility_gene_max
  );

  const breakdown = conceptionChance(
    {
      mareAgeYears,
      stallionAgeYears,
      mareFertilityFactor: mareFertility,
      stallionFertilityFactor: stallionFertility,
      conditionFactor: 1.0,
      methodFactor: 1.0,
      foalCoi: coi,
    },
    config.values
  );

  const conceptionRng = makeRng(deriveSeed(covering.rng_seed, 'conception'));
  const conceived = conceptionRng.next() < breakdown.p;

  const ownerStable = await getStableById(env, covering.stable_id);

  if (!conceived) {
    await env.DB.batch([
      env.DB
        .prepare(`UPDATE coverings SET status = 'resolved_failed', resolved_game_day = ?, resolved_tick_seq = ? WHERE id = ? AND status = 'booked'`)
        .bind(gameDay, tickSeq, covering.id),
      ...buildEventStatement(env, {
        stableId: covering.stable_id,
        accountId: ownerStable?.account_id ?? null,
        gameDay,
        kind: 'covering_missed',
        subjectHorseId: mare.id,
        payload: { mare_name: horseDisplayName(mare), stallion_name: horseDisplayName(stallion) },
      }),
    ]);
    return;
  }

  let twins: boolean;
  if (consumeForceTwins()) {
    twins = true;
  } else {
    const doubleOvulationRng = makeRng(deriveSeed(covering.rng_seed, 'double_ovulation'));
    const continueRng = makeRng(deriveSeed(covering.rng_seed, 'twin_continue'));
    twins = rollTwins(doubleOvulationRng, continueRng, config.values);
  }

  const sireGenotype = parseGenotype(stallion.genotype);
  const damGenotype = parseGenotype(mare.genotype);
  const foalCount = twins ? 2 : 1;

  // One batch: the covering's status flip and every pregnancy it produces land together, or not at
  // all. Without this, a crash between the two would either strand a conceived covering with no
  // pregnancy, or (on retry) create the pregnancy a second time for a covering already marked
  // resolved - either way an idempotency bug the tick must not have (CLAUDE.md §5.4).
  const statements = [
    env.DB.prepare(`UPDATE coverings SET status = 'resolved_conceived', resolved_game_day = ?, resolved_tick_seq = ? WHERE id = ? AND status = 'booked'`).bind(
      gameDay,
      tickSeq,
      covering.id
    ),
  ];
  let firstDueGameDay: number | null = null;
  for (let i = 0; i < foalCount; i++) {
    // Two independent genotype rolls for twins, each with its own foal_rng_seed - not identical
    // twins (slice 0003 §6).
    const foalRngSeed = randomSeed();
    const genotype = combine(sireGenotype, damGenotype, foalRngSeed);
    const pregnancyInsert = buildPregnancyInsertStatement(env, {
      coveringId: covering.id,
      damId: mare.id,
      sireId: stallion.id,
      conceivedGameDay: gameDay,
      genotype,
      coi,
      foalRngSeed,
      gestationDaysMean: config.values.gestation_days_mean,
      gestationDaysSd: config.values.gestation_days_sd,
    });
    statements.push(pregnancyInsert.statement);
    if (firstDueGameDay === null) firstDueGameDay = pregnancyInsert.dueGameDay;
  }

  // One covering_conceived event even for twins - it announces the covering taking, not the birth
  // (each foal gets its own foaled event later, at foalDuePregnancies).
  statements.push(
    ...buildEventStatement(env, {
      stableId: covering.stable_id,
      accountId: ownerStable?.account_id ?? null,
      gameDay,
      kind: 'covering_conceived',
      subjectHorseId: mare.id,
      payload: { mare_name: horseDisplayName(mare), stallion_name: horseDisplayName(stallion), due_game_day: firstDueGameDay },
    })
  );

  await env.DB.batch(statements);
}
