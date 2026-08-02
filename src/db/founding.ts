// Offers and candidates: a private batch of founding-stock candidates a stable picks from. Slice
// 0005 §6. Founding stock and token-bought imports are one mechanism (schema doc §10.2) - the
// table names say "import", the screens never do (slice 0005 §6.1).

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed } from '../lib/rng';
import type { Config } from '../lib/config-cache';
import { getBreedById } from './breeds';
import { buildFoundingHorseInsertStatement, countAliveHorses } from './horses';
import { parseAllelePool } from '../engines/founding/pool';
import { generateCandidate } from '../engines/founding/generate';
import { generateFoundingName } from '../engines/founding/names';
import { parseGenotype, serializeGenotype } from '../engines/genetics/genotype';

export type ImportOfferSource = 'founding' | 'chore_grant' | 'admin_grant' | 'token_import';
export type ImportOfferStatus = 'pending' | 'open' | 'claimed' | 'expired';

export interface ImportOfferRow {
  id: number;
  stable_id: number;
  account_id: number | null;
  source: ImportOfferSource;
  granted_by_account_id: number | null;
  status: ImportOfferStatus;
  breed_id: number | null;
  quality_band: string;
  polygenic_one_chance: number;
  mare_candidates: number;
  mare_claims: number;
  stallion_candidates: number;
  stallion_claims: number;
  age_min_game_days: number;
  age_max_game_days: number;
  granted_game_day: number;
  generated_game_day: number | null;
  claimed_game_day: number | null;
  expires_game_day: number | null;
  rng_seed: number;
  created_real_ts: number;
}

export interface ImportCandidateRow {
  id: number;
  offer_id: number;
  slot_index: number;
  sex: 'mare' | 'stallion';
  age_game_days: number;
  genotype: string;
  origin_prefix: string;
  name_part: string;
  rng_seed: number;
  chosen: number;
  horse_id: number | null;
}

/**
 * A stable's most recent offer, whatever its status - this is what the founding page's four
 * states (slice 0005 §11: no offer / pending / open / claimed) are read from. A stable with no
 * offer at all and one whose only offer is already claimed both need distinguishing from one
 * that still has something to do, so status is left for the caller to switch on rather than
 * filtered here.
 */
export async function getLatestOfferForStable(env: Env, stableId: number): Promise<ImportOfferRow | null> {
  return env.DB.prepare('SELECT * FROM import_offers WHERE stable_id = ? ORDER BY id DESC LIMIT 1').bind(stableId).first<ImportOfferRow>();
}

/** Whether a stable has an offer still waiting on the player (pending breed choice, or open for
 * claiming) - a claimed or expired offer does not count. Drives the "New horses" subnav entry and
 * the stable-home callout (slice 0005 §11), both of which need this without the full row. */
export async function hasWaitingFoundingOffer(env: Env, stableId: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM import_offers WHERE stable_id = ? AND status IN ('pending', 'open') LIMIT 1`)
    .bind(stableId)
    .first<{ id: number }>();
  return row !== null;
}

export async function getOffer(env: Env, id: number): Promise<ImportOfferRow | null> {
  return env.DB.prepare('SELECT * FROM import_offers WHERE id = ?').bind(id).first<ImportOfferRow>();
}

export async function getCandidatesForOffer(env: Env, offerId: number): Promise<ImportCandidateRow[]> {
  const result = await env.DB.prepare('SELECT * FROM import_candidates WHERE offer_id = ? ORDER BY slot_index ASC').bind(offerId).all<ImportCandidateRow>();
  return result.results ?? [];
}

export async function listRecentOffers(env: Env, limit: number): Promise<ImportOfferRow[]> {
  const result = await env.DB.prepare('SELECT * FROM import_offers ORDER BY id DESC LIMIT ?').bind(limit).all<ImportOfferRow>();
  return result.results ?? [];
}

export interface MintOfferParams {
  stableId: number;
  accountId: number | null;
  source: ImportOfferSource;
  grantedByAccountId: number | null;
  gameDay: number;
  config: Config;
  /** Overrides config.values.founding_quality_band - the admin grant screen lets a band be chosen
   * per grant (slice 0005 §11). Falls back to the config default when omitted. */
  band?: string;
}

/**
 * Mints an offer pending, with no breed and no candidates yet (slice 0005 §6.4) - everything the
 * generator will read is snapshotted here at mint time (CLAUDE.md §5.5), so retuning batch sizes,
 * the age range or the quality bands afterwards never changes an offer a child has not opened.
 */
export async function mintOffer(env: Env, params: MintOfferParams): Promise<{ id: number }> {
  const v = params.config.values;
  const band = params.band ?? v.founding_quality_band;
  const polygenicOneChance = v.quality_bands[band];
  if (polygenicOneChance === undefined) throw new Error(`mintOffer: unknown quality band "${band}"`);

  const seed = randomSeed();
  const nowSeconds = nowUtcSeconds();
  const expiresGameDay = v.founding_offer_expiry_game_days > 0 ? params.gameDay + v.founding_offer_expiry_game_days : null;

  const result = await env.DB.prepare(
    `INSERT INTO import_offers (
       stable_id, account_id, source, granted_by_account_id, status, breed_id,
       quality_band, polygenic_one_chance, mare_candidates, mare_claims, stallion_candidates, stallion_claims,
       age_min_game_days, age_max_game_days, granted_game_day, generated_game_day, claimed_game_day,
       expires_game_day, rng_seed, created_real_ts
     ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
  )
    .bind(
      params.stableId,
      params.accountId,
      params.source,
      params.grantedByAccountId,
      band,
      polygenicOneChance,
      v.founding_mare_candidates,
      v.founding_mare_claims,
      v.founding_stallion_candidates,
      v.founding_stallion_claims,
      v.founding_age_min_game_days,
      v.founding_age_max_game_days,
      params.gameDay,
      expiresGameDay,
      seed,
      nowSeconds
    )
    .run();

  return { id: result.meta.last_row_id };
}

export type ChooseBreedResult = { ok: true } | { ok: false; error: 'not_pending' };

/**
 * The breed choice, committed (slice 0005 §6.4): candidates are generated right now, from the
 * offer's already-stored rng_seed, and written in the same batch as the status flip to 'open' and
 * the breed_id itself - so there is no window in which a second choose-breed request (a
 * double-submitted form, a re-fired request) could regenerate a different set of candidates for
 * the same offer. The WHERE status = 'pending' guard on the update makes that atomic.
 */
export async function chooseBreedForOffer(env: Env, offerId: number, breedId: number, gameDay: number): Promise<ChooseBreedResult> {
  const offer = await getOffer(env, offerId);
  if (!offer || offer.status !== 'pending') return { ok: false, error: 'not_pending' };

  const breed = await getBreedById(env, breedId);
  if (!breed) throw new Error(`chooseBreedForOffer: breed ${String(breedId)} not found`);
  const pool = parseAllelePool(breed.founding_allele_pool);

  const slots: ('mare' | 'stallion')[] = [
    ...Array<'mare'>(offer.mare_candidates).fill('mare'),
    ...Array<'stallion'>(offer.stallion_candidates).fill('stallion'),
  ];

  const statements = [
    env.DB.prepare(`UPDATE import_offers SET status = 'open', breed_id = ?, generated_game_day = ? WHERE id = ? AND status = 'pending'`).bind(
      breedId,
      gameDay,
      offerId
    ),
  ];

  slots.forEach((sex, index) => {
    // from import_offers.rng_seed: candidate_0, candidate_1, ... one per slot_index (slice 0005
    // §8). This becomes the candidate's own rng_seed, unchanged, if claimed.
    const candidateSeed = deriveSeed(offer.rng_seed, `candidate_${String(index)}`);
    const generated = generateCandidate({
      pool,
      polygenicOneChance: offer.polygenic_one_chance,
      ageMinGameDays: offer.age_min_game_days,
      ageMaxGameDays: offer.age_max_game_days,
      seed: candidateSeed,
    });
    const { originPrefix, namePart } = generateFoundingName(candidateSeed);

    statements.push(
      env.DB.prepare(
        `INSERT INTO import_candidates (offer_id, slot_index, sex, age_game_days, genotype, origin_prefix, name_part, rng_seed, chosen, horse_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
      ).bind(offerId, index, sex, generated.ageGameDays, serializeGenotype(generated.genotype), originPrefix, namePart, candidateSeed)
    );
  });

  await env.DB.batch(statements);
  return { ok: true };
}

/** Resolves a registered-name collision by walking generateFoundingName's own deterministic
 * sequence forward (slice 0005 §6.5) - never by inventing something ad hoc. horses.registered_name
 * is UNIQUE COLLATE NOCASE, so this comparison is already case-insensitive without extra work. */
async function resolveUniqueName(env: Env, candidate: ImportCandidateRow): Promise<{ registeredName: string; originPrefix: string }> {
  let attempt = 0;
  for (;;) {
    const { originPrefix, namePart } =
      attempt === 0 ? { originPrefix: candidate.origin_prefix, namePart: candidate.name_part } : generateFoundingName(candidate.rng_seed, attempt);
    const registeredName = `${originPrefix} ${namePart}`;
    const existing = await env.DB.prepare('SELECT id FROM horses WHERE registered_name = ?').bind(registeredName).first<{ id: number }>();
    if (!existing) return { registeredName, originPrefix };
    attempt++;
  }
}

export type ClaimOfferResult =
  | { ok: true }
  | { ok: false; error: 'not_open' }
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'wrong_mare_count'; expected: number }
  | { ok: false; error: 'wrong_stallion_count'; expected: number }
  | { ok: false; error: 'no_room'; stableName: string };

export interface ClaimOfferParams {
  offerId: number;
  stableId: number;
  stableName: string;
  stableCapacity: number;
  chosenCandidateIds: number[];
  gameDay: number;
  worldTickSeq: number;
  estrousCycleTicks: number;
}

/**
 * Validates, then writes the whole claim in one env.DB.batch(): the horse inserts, the
 * chosen/horse_id updates on the candidate rows, and the offer's status flip to 'claimed' (slice
 * 0005 §6.6). A half-claimed batch - some horses written, others not - is worse than a failed one.
 */
export async function claimOffer(env: Env, params: ClaimOfferParams): Promise<ClaimOfferResult> {
  const offer = await getOffer(env, params.offerId);
  if (!offer || offer.stable_id !== params.stableId || offer.status !== 'open') return { ok: false, error: 'not_open' };
  if (offer.expires_game_day !== null && params.gameDay > offer.expires_game_day) return { ok: false, error: 'expired' };

  const candidates = await getCandidatesForOffer(env, params.offerId);
  const chosenIds = new Set(params.chosenCandidateIds);
  const chosen = candidates.filter((c) => chosenIds.has(c.id));

  const mareCount = chosen.filter((c) => c.sex === 'mare').length;
  const stallionCount = chosen.filter((c) => c.sex === 'stallion').length;
  if (mareCount !== offer.mare_claims) return { ok: false, error: 'wrong_mare_count', expected: offer.mare_claims };
  if (stallionCount !== offer.stallion_claims) return { ok: false, error: 'wrong_stallion_count', expected: offer.stallion_claims };

  const aliveCount = await countAliveHorses(env, params.stableId);
  if (aliveCount + chosen.length > params.stableCapacity) return { ok: false, error: 'no_room', stableName: params.stableName };

  if (!offer.breed_id) throw new Error(`claimOffer: offer ${String(offer.id)} has no breed`);
  const breed = await getBreedById(env, offer.breed_id);
  if (!breed) throw new Error(`claimOffer: breed ${String(offer.breed_id)} not found`);

  const statements: D1PreparedStatement[] = [];
  for (const candidate of chosen) {
    const { registeredName, originPrefix } = await resolveUniqueName(env, candidate);
    statements.push(
      buildFoundingHorseInsertStatement(env, {
        stableId: params.stableId,
        sex: candidate.sex,
        breedId: breed.id,
        breedCode: breed.code,
        registeredName,
        breederPrefix: originPrefix,
        bornGameDay: params.gameDay - candidate.age_game_days,
        genotype: parseGenotype(candidate.genotype),
        rngSeed: candidate.rng_seed,
        worldTickSeq: params.worldTickSeq,
        estrousCycleTicks: params.estrousCycleTicks,
      })
    );
    statements.push(
      env.DB.prepare(`UPDATE import_candidates SET chosen = 1, horse_id = (SELECT id FROM horses ORDER BY id DESC LIMIT 1) WHERE id = ?`).bind(candidate.id)
    );
  }
  statements.push(
    env.DB.prepare(`UPDATE import_offers SET status = 'claimed', claimed_game_day = ? WHERE id = ? AND status = 'open'`).bind(params.gameDay, offer.id)
  );

  await env.DB.batch(statements);
  return { ok: true };
}
