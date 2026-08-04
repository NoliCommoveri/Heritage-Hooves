// Amendment 0017a §5 (Part E) - the consignment dealer. Not Part B (§5.1): Part B recycles horses
// that already exist and moves money into NPC hands; this mints new horses from outside the game and
// takes money out. The dealer stable itself has no npc_policy row (migrations/0097) so
// runNpcBreedingDecisions and runNpcMarketListings never touch it - it does not breed, show or buy.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng, type Rng } from '../lib/rng';
import { getBreedsInPlay } from './breeds';
import { getSpecializableAbilityTraits } from './disciplines';
import { parseAbilityBias } from '../engines/breeds/identity';
import type { StableRow } from './stables';
import { getHorse, buildFoundingHorseInsertStatements } from './horses';
import { getEnabledConditions, getLethalTriggers, buildKnowledgePurchaseStatements, buildLocusKnowledgePurchaseStatements, type ConditionRow } from './health';
import { appraiseHorseForStable, createListing } from './listings';
import { buildEventStatement } from './events';
import { parseAllelePool } from '../engines/founding/pool';
import { generateCandidate } from '../engines/founding/generate';
import type { LethalTrigger } from '../engines/founding/generate';
import { generateFoundingName } from '../engines/founding/names';
import { applyConsignmentInjection } from '../engines/founding/injection';
import type { Genotype } from '../engines/genetics/genotype';
import { LOCI } from '../engines/genetics/loci';
import { parseIdealVector } from '../engines/showing/score';
import type { TraitCode } from '../engines/genetics/polygenic';

/** The dealer's own stables.prefix (migrations/0097) - a magic string kept to one place. Consigned
 * horses never carry this prefix themselves; see buildFoundingHorseInsertStatements' breederPrefix
 * argument below, which is always the candidate's own generated origin prefix instead (§5.2). */
export const CONSIGNMENT_DEALER_PREFIX = 'Consignment Yard';

export async function getConsignmentDealerStable(env: Env): Promise<StableRow | null> {
  return env.DB.prepare('SELECT * FROM stables WHERE prefix = ?').bind(CONSIGNMENT_DEALER_PREFIX).first<StableRow>();
}

// ---------------------------------------------------------------------------
// The injection queue (§5.4/§5.5)
// ---------------------------------------------------------------------------

export type InjectionStatus = 'queued' | 'applied' | 'cancelled';
export type InjectionZygosity = 'het' | 'hom';
export type InjectionAppliesTo = 'one' | 'all';
export type InjectionSexPreference = 'any' | 'stallion' | 'mare';

export interface ConsignmentInjectionRow {
  id: number;
  locus_code: string;
  allele: string;
  zygosity: InjectionZygosity;
  applies_to: InjectionAppliesTo;
  sex_preference: InjectionSexPreference;
  status: InjectionStatus;
  queued_game_day: number;
  eligible_from_game_day: number | null;
  applied_game_day: number | null;
  applied_horse_id: number | null;
  note: string | null;
  created_real_ts: number;
}

export async function listQueuedInjections(env: Env): Promise<ConsignmentInjectionRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM consignment_injections WHERE status = 'queued' ORDER BY queued_game_day ASC, id ASC`).all<ConsignmentInjectionRow>();
  return result.results ?? [];
}

/** §5.5's injection history: every allele ever introduced, newest first. */
export async function listInjectionHistory(env: Env, limit = 100): Promise<ConsignmentInjectionRow[]> {
  const result = await env.DB.prepare(`SELECT * FROM consignment_injections ORDER BY id DESC LIMIT ?`).bind(limit).all<ConsignmentInjectionRow>();
  return result.results ?? [];
}

export interface QueueInjectionParams {
  locusCode: string;
  allele: string;
  zygosity: InjectionZygosity;
  appliesTo: InjectionAppliesTo;
  sexPreference: InjectionSexPreference;
  note: string | null;
  gameDay: number;
  config: Config;
}

export type QueueInjectionResult = { ok: true } | { ok: false; error: 'unknown_locus_or_allele' };

/**
 * §5.4 follow-up: which game day a freshly-queued injection may first be picked up by a batch.
 * runConsignments only ever mints once the dealer's cadence window has actually elapsed - see its
 * own `dueDay` calculation, mirrored here. Two cases:
 *  - No batch is due yet (dueDay is still in the future): the injection targets that same,
 *    genuinely-next batch, same as before this existed.
 *  - A batch is already due/overdue, and will mint on the very next tick with or without this
 *    injection: queuing now must not sweep it into that already-decided batch, so it's deferred
 *    to the one after (dueDay + cadence).
 * A dealer that has never minted has no "current" batch to be swept into, so its very first batch
 * is treated as next, not current.
 */
async function computeInjectionEligibleFromGameDay(env: Env, gameDay: number, cadenceGameDays: number): Promise<number> {
  const dealer = await getConsignmentDealerStable(env);
  if (!dealer) return gameDay; // migration not yet applied in this environment
  const last = await env.DB.prepare(`SELECT MAX(listed_game_day) AS d FROM listings WHERE seller_stable_id = ?`).bind(dealer.id).first<{ d: number | null }>();
  if (last?.d === null || last?.d === undefined) return gameDay;
  const dueDay = last.d + cadenceGameDays;
  return dueDay > gameDay ? dueDay : dueDay + cadenceGameDays;
}

/** §5.4/§5.5: colour and gait loci only (E, A, CR, G, DMRT3) - never a disease locus, and never a
 * free-text allele. Validated against LOCI here so a typo cannot become a queued row the tick would
 * later fail on. */
export async function queueInjection(env: Env, params: QueueInjectionParams): Promise<QueueInjectionResult> {
  const colourGaitCodes = new Set(['E', 'A', 'CR', 'G', 'DMRT3']);
  const locus = LOCI.find((l) => l.code === params.locusCode && colourGaitCodes.has(l.code));
  if (!locus || !locus.alleles.includes(params.allele)) return { ok: false, error: 'unknown_locus_or_allele' };

  const eligibleFromGameDay = await computeInjectionEligibleFromGameDay(env, params.gameDay, params.config.values.consignment_cadence_game_days);

  await env.DB.prepare(
    `INSERT INTO consignment_injections (locus_code, allele, zygosity, applies_to, sex_preference, status, queued_game_day, eligible_from_game_day, note, created_real_ts)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
  )
    .bind(params.locusCode, params.allele, params.zygosity, params.appliesTo, params.sexPreference, params.gameDay, eligibleFromGameDay, params.note, nowUtcSeconds())
    .run();
  return { ok: true };
}

/** A cancel link per queued row (§5.5) - guarded on status = 'queued' so a race with the tick
 * consuming it cannot un-cancel an already-applied injection. */
export async function cancelInjection(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`UPDATE consignment_injections SET status = 'cancelled' WHERE id = ? AND status = 'queued'`).bind(id).run();
}

// ---------------------------------------------------------------------------
// The tick stage (§5.7)
// ---------------------------------------------------------------------------

/** §5.3's guard: only sweep horses whose dealer listing is still open - a sold horse belongs to a
 * child and must never be removed. Setting the status is the whole operation; 0017 §8's
 * expireListings (called immediately after this stage, per tick.ts) closes the listing itself once
 * it sees expires_game_day <= gameDay, finishing the job on the same tick. Idempotent on
 * horses.status = 'alive', the same shape killDueLethalFoals already uses. */
async function sweepExpiredConsignmentListings(env: Env, dealerId: number, gameDay: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE horses SET status = 'removed', ended_game_day = ?, end_reason = 'consignment_unclaimed'
      WHERE status = 'alive' AND id IN (
        SELECT horse_id FROM listings WHERE seller_stable_id = ? AND status = 'open' AND expires_game_day <= ?
      )`
  )
    .bind(gameDay, dealerId, gameDay)
    .run();
}

function drawWeighted(rng: Rng, weights: Record<string, number>): number {
  const entries = Object.entries(weights).map(([k, w]) => [Number(k), w] as [number, number]);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return 0;
  let r = rng.next() * total;
  for (const [count, w] of entries) {
    r -= w;
    if (r <= 0) return count;
  }
  return entries[entries.length - 1][0];
}

interface MintedCandidate {
  sex: 'mare' | 'stallion';
  breedId: number;
  breedCode: string;
  pool: ReturnType<typeof parseAllelePool>;
  genotype: Genotype;
  ageGameDays: number;
  registeredName: string;
  originPrefix: string;
  candidateSeed: number;
  appliedInjectionId: number | null;
  appliedInjectionLocus: string | null;
}

async function resolveUniqueConsignmentName(env: Env, candidateSeed: number): Promise<{ registeredName: string; originPrefix: string }> {
  for (let attempt = 0; ; attempt++) {
    const { originPrefix, namePart } = generateFoundingName(candidateSeed, attempt);
    const registeredName = `${originPrefix} ${namePart}`;
    const existing = await env.DB.prepare('SELECT id FROM horses WHERE registered_name = ?').bind(registeredName).first<{ id: number }>();
    if (!existing) return { registeredName, originPrefix };
  }
}

/**
 * §5.4: applies at most one queued injection per candidate, first match by sex_preference and queue
 * order. `applies_to = 'one'` is removed from the working list the moment it matches, so it touches
 * exactly one horse ever, in this batch or a later one; `applies_to = 'all'` stays in the working
 * list and keeps matching every eligible candidate for the rest of THIS batch. Either way the row is
 * marked applied once, at the end of the batch (see runConsignments) - "consumed by the tick" (the
 * migration's own comment), never left queued to fire again next cycle. When the queue is empty this
 * simply does nothing - no fallback rarity weighting (§5.4's own rule).
 */
function pickInjectionFor(sex: 'mare' | 'stallion', working: ConsignmentInjectionRow[]): ConsignmentInjectionRow | undefined {
  const match = working.find((inj) => inj.sex_preference === 'any' || inj.sex_preference === sex);
  if (match && match.applies_to === 'one') {
    working.splice(working.indexOf(match), 1);
  }
  return match;
}

async function mintConsignmentCandidate(
  env: Env,
  batchSeed: number,
  index: number,
  breed: { id: number; code: string; founding_allele_pool: string; ideal_vector: string | null; ability_bias: string | null },
  workingInjections: ConsignmentInjectionRow[],
  appliedThisBatch: Map<number, number>,
  lethalTriggers: LethalTrigger[],
  eligibleAbilityTraits: TraitCode[],
  cfg: Config['values']
): Promise<MintedCandidate> {
  const candidateSeed = deriveSeed(batchSeed, `candidate_${String(index)}`);
  const pool = parseAllelePool(breed.founding_allele_pool);
  const sex: 'mare' | 'stallion' = makeRng(deriveSeed(candidateSeed, 'sex')).next() < 0.5 ? 'mare' : 'stallion';

  // Slice 0019 Parts A/B: the dealer runs every candidate through generateCandidate exactly like
  // founding.ts's chooseBreedForOffer, so it inherits the specialist for free (§6) - no separate
  // logic here, just the same two inputs threaded through.
  const generated = generateCandidate({
    pool,
    // §3.2: mid quality band, exactly like founding stock - the slant is colour/gait only, never
    // the polygenic draw. quality_bands is keyed by band name; 'mid' is the founding-stock band
    // name (slice 0005 §4) and is not itself a consignment-specific config key.
    polygenicOneChance: cfg.quality_bands.mid ?? 0.5,
    robustnessOneChance: cfg.robustness_one_chance,
    ageMinGameDays: cfg.founding_age_min_game_days,
    ageMaxGameDays: cfg.founding_age_max_game_days,
    seed: candidateSeed,
    lethalTriggers,
    breedIdealVector: breed.ideal_vector ? parseIdealVector(breed.ideal_vector) : null,
    eligibleAbilityTraits,
    abilitySpecialistPotential: cfg.founding_ability_specialist_potential,
    // Migration 0141: the dealer's stock leans the way its breed does, exactly like founding stock
    // - a consigned Warmblood is no more likely to outrun a Quarter Horse than a bred one is.
    abilityBias: parseAbilityBias(breed.ability_bias),
  });

  let genotype = generated.genotype;
  const injection = pickInjectionFor(sex, workingInjections);
  if (injection) {
    genotype = applyConsignmentInjection(genotype, { locusCode: injection.locus_code, allele: injection.allele, zygosity: injection.zygosity });
    appliedThisBatch.set(injection.id, 0); // horse id filled in by the caller once it knows it
  }

  const { registeredName, originPrefix } = await resolveUniqueConsignmentName(env, candidateSeed);

  return {
    sex,
    breedId: breed.id,
    breedCode: breed.code,
    pool,
    genotype,
    ageGameDays: generated.ageGameDays,
    registeredName,
    originPrefix,
    candidateSeed,
    appliedInjectionId: injection?.id ?? null,
    appliedInjectionLocus: injection?.locus_code ?? null,
  };
}

async function mintConsignmentBatch(
  env: Env,
  gameDay: number,
  tickSeq: number,
  config: Config,
  dealerId: number,
  conditions: ConditionRow[],
  respectInjectionEligibility: boolean
): Promise<void> {
  const cfg = config.values;
  // Whatever breeds are in play (src/db/breeds.ts's getBreedsInPlay, the same `breeds.enabled`
  // toggle /admin/breeds drives) - no second, independent allowlist. §5.8 originally intersected
  // this with a separate consignment_breed_codes config key, which is how the dealer stayed
  // Quarter-Horse-only after every other breed got an ideal_vector and became judge-able (2026-08-04
  // build-log entry names this drift by name). Removed rather than widened, so there is exactly one
  // control for "which breeds does the game admit right now" - the same reasoning stockShowBarn's
  // own breed-awareness fix just applied to the NPC show barn.
  const eligibleBreeds = await getBreedsInPlay(env);
  if (eligibleBreeds.length === 0) return;

  const lethalTriggers = await getLethalTriggers(env);
  const queuedInjections = await listQueuedInjections(env);
  // §5.4 follow-up: a scheduled (cadence-driven) mint only picks up injections eligible by now -
  // see computeInjectionEligibleFromGameDay. An explicit "mint now" admin action passes
  // respectInjectionEligibility = false instead, since it's a deliberate override of scheduling
  // altogether, not a regular cadence tick.
  const workingInjections = respectInjectionEligibility
    ? queuedInjections.filter((i) => i.eligible_from_game_day === null || i.eligible_from_game_day <= gameDay)
    : queuedInjections;
  const appliedThisBatch = new Map<number, number>(); // injection id -> last horse id it touched
  const eligibleAbilityTraits = await getSpecializableAbilityTraits(env);

  const batchSeed = randomSeed();
  const horsesPerBreed = cfg.consignment_horses_per_breed;
  const batchSize = eligibleBreeds.length * horsesPerBreed;

  let index = 0;
  for (const breed of eligibleBreeds) {
    for (let n = 0; n < horsesPerBreed; n++, index++) {
      const candidate = await mintConsignmentCandidate(
        env,
        batchSeed,
        index,
        breed,
        workingInjections,
        appliedThisBatch,
        lethalTriggers,
        eligibleAbilityTraits,
        cfg
      );

      const insertResult = await env.DB.batch(
        buildFoundingHorseInsertStatements(env, {
          stableId: dealerId,
          sex: candidate.sex,
          breedId: candidate.breedId,
          breedCode: candidate.breedCode,
          registeredName: candidate.registeredName,
          breederPrefix: candidate.originPrefix,
          bornGameDay: gameDay - candidate.ageGameDays,
          genotype: candidate.genotype,
          rngSeed: candidate.candidateSeed,
          worldTickSeq: tickSeq,
          estrousCycleTicks: cfg.estrous_cycle_ticks,
          conformationNoiseSd: cfg.conformation_noise_sd,
          conditions,
          lethalFoalDeathGameDays: cfg.lethal_foal_death_game_days,
          accountId: null,
          lifespanConfig: cfg,
          careStartAgeGameDays: cfg.care_start_age_game_days,
          currentGameDay: gameDay,
        })
      );
      const horseId = insertResult[0].meta.last_row_id;
      if (candidate.appliedInjectionId !== null) appliedThisBatch.set(candidate.appliedInjectionId, horseId);

      // §5.6: the dealer performs tests and writes real horse_knowledge rows, at cost_paid reflecting
      // the going price, but pays for NONE of it - no ledger row, no balance movement, because the
      // dealer's balance is a documented fiction (migrations/0097). This differs from Part B's own
      // NPC-listing tests on purpose (that stable's balance is real) - see that migration's comment.
      const knowledgeStatements = [];
      if (candidate.appliedInjectionLocus !== null) {
        // §5.4, non-negotiable: an injected locus is always pre-tested, or the injection is invisible
        // and nobody ever pays for the allele it introduced.
        knowledgeStatements.push(
          ...buildLocusKnowledgePurchaseStatements(env, {
            stableId: dealerId,
            horseId,
            gameDay,
            genotype: candidate.genotype,
            locusCodes: [candidate.appliedInjectionLocus],
            costByCode: { [candidate.appliedInjectionLocus]: cfg.genotype_test_cost },
          })
        );
      }
      const testCount = drawWeighted(makeRng(deriveSeed(candidate.candidateSeed, 'test_count')), cfg.consignment_test_count_weights);
      if (testCount > 0 && conditions.length > 0) {
        const chosen = makeRng(deriveSeed(candidate.candidateSeed, 'test_pick')).shuffle(conditions).slice(0, Math.min(testCount, conditions.length));
        const costByCode: Record<string, number> = {};
        chosen.forEach((c) => {
          costByCode[c.code] = cfg.genotype_test_cost;
        });
        knowledgeStatements.push(
          ...buildKnowledgePurchaseStatements(env, { stableId: dealerId, horseId, gameDay, genotype: candidate.genotype, conditions: chosen, costByCode })
        );
      }
      if (knowledgeStatements.length > 0) await env.DB.batch(knowledgeStatements);

      const horseRow = await getHorse(env, horseId);
      if (!horseRow) throw new Error('mintConsignmentBatch: horse vanished immediately after insert');
      const appraisal = await appraiseHorseForStable(env, horseRow, dealerId, gameDay, cfg);
      // §5.6: appraise() × consignment_price_multiplier only - no dealer-only carrier premium, since
      // §4.7 already makes colour a term inside appraise() itself, correctly, for every seller.
      const rawPrice = appraisal.value * cfg.consignment_price_multiplier;
      const price = Math.min(cfg.market_max_price, Math.max(10, Math.round(rawPrice / 10) * 10));

      await createListing(env, {
        horseId,
        sellerStableId: dealerId,
        price,
        guideValue: appraisal.value,
        gameDay,
        listingGameDays: cfg.consignment_listing_game_days,
      });
    }
  }

  const injectionUpdateStatements = [...appliedThisBatch.entries()].map(([injectionId, horseId]) =>
    env.DB
      .prepare(`UPDATE consignment_injections SET status = 'applied', applied_game_day = ?, applied_horse_id = ? WHERE id = ? AND status = 'queued'`)
      .bind(gameDay, horseId, injectionId)
  );
  if (injectionUpdateStatements.length > 0) await env.DB.batch(injectionUpdateStatements);

  // §5.7: one events row per account when a batch lands, so a 90-game-day gap doesn't come and go
  // unnoticed. events.stable_id is NOT NULL (there is no per-account events table), so this reaches
  // every active player-owned stable rather than literally one row per account - the closest
  // approximation the schema allows, and every one of those stables' owners sees it either way.
  const playerStables = await env.DB.prepare(`SELECT id, account_id FROM stables WHERE is_npc = 0 AND active = 1`).all<{
    id: number;
    account_id: number | null;
  }>();
  const eventStatements: D1PreparedStatement[] = [];
  for (const row of playerStables.results ?? []) {
    eventStatements.push(
      ...buildEventStatement(env, {
        stableId: row.id,
        accountId: row.account_id,
        gameDay,
        kind: 'consignment_batch',
        subjectHorseId: null,
        payload: { count: batchSize },
      })
    );
  }
  if (eventStatements.length > 0) await env.DB.batch(eventStatements);
}

/** /admin/consignment's own "next batch due" line - null means no batch has ever landed, so the
 * next tick mints one regardless of the day (see runConsignments' own "due immediately" comment). */
export async function nextConsignmentDueGameDay(env: Env, config: Config): Promise<number | null> {
  const dealer = await getConsignmentDealerStable(env);
  if (!dealer) return null;
  const last = await env.DB.prepare(`SELECT MAX(listed_game_day) AS d FROM listings WHERE seller_stable_id = ?`).bind(dealer.id).first<{ d: number | null }>();
  if (last?.d === null || last?.d === undefined) return null;
  return last.d + config.values.consignment_cadence_game_days;
}

/** /admin/consignment's "currently standing" list. */
export async function listStandingConsignmentListings(env: Env): Promise<{ horseName: string; price: number; expiresGameDay: number }[]> {
  const dealer = await getConsignmentDealerStable(env);
  if (!dealer) return [];
  const result = await env.DB.prepare(
    `SELECT h.registered_name, h.barn_name, h.sex, l.price, l.expires_game_day
       FROM listings l JOIN horses h ON h.id = l.horse_id
      WHERE l.seller_stable_id = ? AND l.status = 'open'
      ORDER BY l.id DESC`
  )
    .bind(dealer.id)
    .all<{ registered_name: string | null; barn_name: string | null; sex: 'mare' | 'stallion' | 'gelding'; price: number; expires_game_day: number }>();
  return (result.results ?? []).map((r) => ({
    horseName: r.registered_name ?? r.barn_name ?? (r.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt'),
    price: r.price,
    expiresGameDay: r.expires_game_day,
  }));
}

/**
 * The tick's new stage (§5.7), called inside the `paused === 0` branch immediately before
 * expireListings. Idempotency with no new column: runs only once gameDay has reached the dealer's
 * next due day, derived from the dealer's own most recent listing rather than a marker - a re-fired
 * tick finds the condition already false, because the first run moved the maximum (the same shape
 * 0017 §8's `status = 'open'` guard gives expireListings). A world that is paused mints nothing,
 * because this only ever runs from inside that branch.
 */
export async function runConsignments(env: Env, gameDay: number, tickSeq: number, config: Config): Promise<void> {
  const cadence = config.values.consignment_cadence_game_days;
  if (cadence <= 0) return;

  const dealer = await getConsignmentDealerStable(env);
  if (!dealer) return; // migration not yet applied in this environment

  const dealerId = dealer.id;
  const last = await env.DB.prepare(`SELECT MAX(listed_game_day) AS d FROM listings WHERE seller_stable_id = ?`).bind(dealerId).first<{ d: number | null }>();
  // No prior batch ever listed: due immediately, rather than waiting a full cadence from a
  // migration's deploy day - the operator should see the dealer working right away.
  const dueDay = last?.d === null || last?.d === undefined ? gameDay : last.d + cadence;
  if (gameDay < dueDay) return;

  await sweepExpiredConsignmentListings(env, dealerId, gameDay);
  // Slice 0022 Part A: getEnabledConditions already returns only genotype-testable (locus-based)
  // conditions now that the twelve acquired incidents live in their own table - nothing to filter
  // here.
  const conditions = await getEnabledConditions(env);
  await mintConsignmentBatch(env, gameDay, tickSeq, config, dealerId, conditions, true);
}

export type ForceConsignmentResult = { ok: true } | { ok: false; error: 'no_dealer' };

/**
 * /admin/consignment's "mint a batch now" button. Bypasses the cadence/dueDay check runConsignments
 * makes (§5.7) so a queued injection lands the same game day it's queued, rather than waiting up to
 * consignment_cadence_game_days for the next scheduled batch - an out-of-tick admin action, the same
 * shape adminHorsesRoute's founding-horse creation already uses (worldTickSeq passed straight from
 * ctx.world.tick_seq rather than a real tick run). Does NOT reset the cadence clock: it reads the
 * dealer's last listing day exactly like runConsignments does, so if this lands before the regular
 * due day, the next regular batch is still cadence days after whichever listing is now most recent.
 * Also ignores eligible_from_game_day (passes respectInjectionEligibility = false to
 * mintConsignmentBatch): it's a deliberate, explicit override of scheduling, so a queued injection
 * always lands here even if it was deferred past an already-due cadence batch.
 */
export async function forceConsignmentBatchNow(env: Env, gameDay: number, tickSeq: number, config: Config): Promise<ForceConsignmentResult> {
  const dealer = await getConsignmentDealerStable(env);
  if (!dealer) return { ok: false, error: 'no_dealer' };

  const dealerId = dealer.id;
  await sweepExpiredConsignmentListings(env, dealerId, gameDay);
  const conditions = (await getEnabledConditions(env)).filter((c) => c.locus_code !== null);
  await mintConsignmentBatch(env, gameDay, tickSeq, config, dealerId, conditions, false);
  return { ok: true };
}
