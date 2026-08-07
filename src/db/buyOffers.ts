// The standing offers board (slice 0017 §12, Part C): NPC demand, from schema doc §7.2. An NPC
// stable posts one active offer at a time describing what it wants and the most it will pay
// (src/db/npcBuying.ts's refreshNpcBuyOffers writes it); a player sells a horse that fits straight
// into it from here - no listing browsing period, no auction. There is no player-facing "post an
// offer" path: the board is NPC demand only.
//
// Selling into an offer is deliberately built as "create a listing, then sell it immediately" -
// createListing and sellListing from src/db/listings.ts, unchanged. That is the whole reason this
// file needs no second sale batch of its own: the commission, the knowledge copy, the covering and
// entry reassignment and the ledger rows are exactly what a fixed-price sale already writes, and
// /market/sold shows the result exactly as it shows any other sale. The only new thing this file
// owns is deciding whether a horse fits an offer at all.

import type { Env } from '../types';
import type { Config, ConfigValues } from '../lib/config-cache';
import { nowUtcSeconds } from '../lib/time';
import type { StableRow } from './stables';
import { getBreeds, getBreedById, type BreedRow } from './breeds';
import { getDisciplines } from './disciplines';
import { countAliveHorses, type HorseRow } from './horses';
import { getNpcPolicy, resolveSelectionTarget } from './npcBreeding';
import { qualityFor } from './npcMarket';
import { createListing, getListing, sellListing, appraiseHorseForStable } from './listings';

export interface BuyOfferCriteria {
  v: 1;
  /** Null means not breed-restricted - true for every ability-kind (discipline barn) offer, since
   * scoreAbilityEntry doesn't need a breed match. Set for a conformation-specialist's offer. */
  breedId: number | null;
  minAgeGameDays: number | null;
  maxAgeGameDays: number | null;
  /** rawScore, 0..100, against the posting stable's own target (§4.4's "quality of zero is not a
   * bad horse" concern doesn't apply here - an offer is only ever posted once a target resolves). */
  minQuality: number;
}

export interface BuyOfferRow {
  id: number;
  stable_id: number;
  criteria: string;
  max_price: number;
  active: number;
  created_game_day: number;
  created_real_ts: number;
}

export function parseCriteria(json: string): BuyOfferCriteria {
  return JSON.parse(json) as BuyOfferCriteria;
}

function serializeCriteria(c: BuyOfferCriteria): string {
  return JSON.stringify(c);
}

/** /market's Offers tab and the offer detail page - the offer joined with enough about the posting
 * stable to explain it in English without a second round trip per row. */
export interface ActiveBuyOfferView extends BuyOfferRow {
  buyer_stable_name: string;
  personality_code: string;
  target_kind: 'conformation' | 'ability';
  target_breed_id: number | null;
  target_discipline_code: string | null;
}

const ACTIVE_OFFER_SELECT = `
  SELECT o.*, s.name AS buyer_stable_name, p.personality_code, p.target_kind, p.target_breed_id, p.target_discipline_code
    FROM buy_offers o
    JOIN stables s ON s.id = o.stable_id
    JOIN npc_policy p ON p.stable_id = o.stable_id`;

export async function listActiveBuyOffers(env: Env): Promise<ActiveBuyOfferView[]> {
  const result = await env.DB.prepare(`${ACTIVE_OFFER_SELECT} WHERE o.active = 1 ORDER BY o.id DESC`).all<ActiveBuyOfferView>();
  return result.results ?? [];
}

export async function getActiveBuyOffer(env: Env, id: number): Promise<ActiveBuyOfferView | null> {
  return env.DB.prepare(`${ACTIVE_OFFER_SELECT} WHERE o.id = ? AND o.active = 1`).bind(id).first<ActiveBuyOfferView>();
}

/** A plain-English label for what an offer is chasing, built from the same target-resolution info
 * every row already carries - "Quarter Horses" for a conformation specialist, "Barrel Racing
 * prospects" for a discipline barn. Falls back to something legible if the target has since gone
 * missing (a breed disabled after the offer was posted, say) rather than showing nothing. */
export function offerWantsLabel(offer: ActiveBuyOfferView, breedById: Map<number, BreedRow>, disciplineNameByCode: Map<string, string>): string {
  if (offer.target_kind === 'conformation') {
    const breed = offer.target_breed_id !== null ? breedById.get(offer.target_breed_id) : undefined;
    return breed ? `${breed.name}s` : 'horses of a breed no longer in play';
  }
  const name = offer.target_discipline_code !== null ? disciplineNameByCode.get(offer.target_discipline_code) : undefined;
  return name ? `${name} prospects` : 'prospects for a discipline no longer offered';
}

/** The criteria line in English, for the offer detail page and the Offers tab. */
export function criteriaLabel(criteria: BuyOfferCriteria, gameDaysPerYear: number): string {
  const parts: string[] = ['a mare or a stallion (not a gelding)'];
  if (criteria.minAgeGameDays !== null) {
    parts.push(`at least ${String(Math.round(criteria.minAgeGameDays / gameDaysPerYear))} years old`);
  }
  if (criteria.maxAgeGameDays !== null) {
    parts.push(`no older than ${String(Math.round(criteria.maxAgeGameDays / gameDaysPerYear))} years`);
  }
  parts.push(`scoring at least ${String(Math.round(criteria.minQuality))} against what this stable is breeding for`);
  return parts.join(', ');
}

/** §12's "read fresh, deactivate or upsert in place" refresh, called from npcBuying.ts's tick
 * stage. Kept in this file because it is the one place that knows the buy_offers table's own
 * upsert shape; npcBuying.ts decides *whether* a stable wants an offer, this decides *how it is
 * written*. Updates an existing active row's criteria and price in place (same id, same
 * created_game_day) rather than closing and reopening one every tick - a player mid-way through
 * looking at an offer should not find its link dead a moment later because nothing about it
 * actually changed. */
export async function upsertActiveOfferForStable(env: Env, params: { stableId: number; criteria: BuyOfferCriteria; maxPrice: number; gameDay: number }): Promise<void> {
  const existing = await env.DB.prepare('SELECT id FROM buy_offers WHERE stable_id = ? AND active = 1').bind(params.stableId).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare('UPDATE buy_offers SET criteria = ?, max_price = ? WHERE id = ?')
      .bind(serializeCriteria(params.criteria), params.maxPrice, existing.id)
      .run();
    return;
  }
  await env.DB.prepare('INSERT INTO buy_offers (stable_id, criteria, max_price, active, created_game_day, created_real_ts) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(params.stableId, serializeCriteria(params.criteria), params.maxPrice, params.gameDay, nowUtcSeconds())
    .run();
}

/** The other half of the refresh: a stable that no longer wants to buy (full, broke, or its target
 * has gone missing) withdraws its own standing offer. */
export async function deactivateOfferForStable(env: Env, stableId: number): Promise<void> {
  await env.DB.prepare('UPDATE buy_offers SET active = 0 WHERE stable_id = ? AND active = 1').bind(stableId).run();
}

export interface OfferEvaluation {
  eligible: boolean;
  quality: number | null;
  /** Every reason this horse does not fit, in the order checked - the offer detail page's own
   * "why not" list (mirrors src/routes/market.ts's buyRefusal, one sentence per failed check
   * rather than stopping at the first). Empty when eligible. */
  reasons: string[];
}

/**
 * Whether a specific horse fits a specific offer, and its score against the posting stable's own
 * target if it does. Reads the posting stable's live npc_policy rather than trusting anything
 * cached on the offer row - a policy retuned from /admin/npc after the offer was posted should be
 * reflected the moment a player looks, not on the next tick's refresh.
 */
export async function evaluateOfferForHorse(env: Env, offer: BuyOfferRow, horse: HorseRow, gameDay: number, config: Config): Promise<OfferEvaluation> {
  const reasons: string[] = [];
  const criteria = parseCriteria(offer.criteria);

  if (horse.status !== 'alive') reasons.push('This horse is no longer alive.');
  if (horse.sex === 'gelding') reasons.push('This offer is for breeding stock - a gelding cannot be bred.');

  const ageGameDays = gameDay - horse.born_game_day;
  if (criteria.minAgeGameDays !== null && ageGameDays < criteria.minAgeGameDays) {
    reasons.push(`Too young - this offer wants at least ${String(Math.round(criteria.minAgeGameDays / config.values.game_days_per_year))} years old.`);
  }
  if (criteria.maxAgeGameDays !== null && ageGameDays > criteria.maxAgeGameDays) {
    reasons.push(`Too old - this offer wants no older than ${String(Math.round(criteria.maxAgeGameDays / config.values.game_days_per_year))} years.`);
  }
  if (criteria.breedId !== null && horse.breed_id !== criteria.breedId) {
    const wanted = await getBreedById(env, criteria.breedId);
    reasons.push(`Wrong breed - this offer only wants ${wanted?.name ?? 'a specific breed'}.`);
  }

  const policy = await getNpcPolicy(env, offer.stable_id);
  if (!policy) {
    reasons.push('This offer is no longer available.');
    return { eligible: false, quality: null, reasons };
  }

  const [breeds, disciplines] = await Promise.all([getBreeds(env), getDisciplines(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const target = resolveSelectionTarget(policy, config, breedById, new Map(disciplines.map((d) => [d.code, d])));
  if (!target) {
    reasons.push('This offer is no longer available.');
    return { eligible: false, quality: null, reasons };
  }

  // Quality only computed when every other check has already passed - scoring a horse that is
  // already disqualified on breed or age teaches nothing and costs a conformation calculation for
  // nothing.
  if (reasons.length > 0) return { eligible: false, quality: null, reasons };

  const quality = qualityFor(horse, target, gameDay, config, breedById);
  if (quality < criteria.minQuality) {
    reasons.push(`Doesn't score highly enough yet - this offer wants at least ${String(Math.round(criteria.minQuality))}, and this horse scores ${String(Math.round(quality))}.`);
    return { eligible: false, quality, reasons };
  }

  return { eligible: true, quality, reasons: [] };
}

/** The buyer-side guards §7.1 checks for a fixed-price sale, re-derived here for an NPC buyer: a
 * standing offer's price is fixed, but the posting stable's balance and free stalls are not, and
 * both can have moved since the offer was posted. Mirrors src/routes/market.ts's buyRefusal in
 * shape - a plain sentence naming the horse, checked fresh right before the sale rather than
 * trusted from whatever rendered the page. */
export async function buyerRefusalForOffer(env: Env, stable: StableRow, price: number): Promise<string | undefined> {
  if (stable.balance < price) return `${stable.name} can no longer afford this - it has ${String(stable.balance)} and this offer pays ${String(price)}. Somebody may have already sold into it.`;
  const aliveCount = await countAliveHorses(env, stable.id);
  if (aliveCount >= stable.capacity) return `${stable.name} has no room for another horse right now.`;
  return undefined;
}

export type SellIntoOfferResult = { ok: true } | { ok: false; error: 'already_listed' | 'gone' };

/**
 * The sale itself: creates a listing on the seller's behalf at the offer's own price, then buys it
 * immediately as the offering stable. Reuses createListing and sellListing unchanged (this file's
 * own header explains why) - the only new failure mode is 'already_listed', when the horse already
 * has an open listing of its own (withdraw it first, the same rule a second open listing would hit
 * anywhere else, per idx_listings_one_open_per_horse).
 */
export async function sellIntoOffer(
  env: Env,
  params: {
    offer: BuyOfferRow;
    horse: HorseRow;
    horseName: string;
    sellerStableId: number;
    sellerStableName: string;
    sellerAccountId: number | null;
    buyerStable: StableRow;
    gameDay: number;
    config: ConfigValues;
  }
): Promise<SellIntoOfferResult> {
  const appraisal = await appraiseHorseForStable(env, params.horse, params.sellerStableId, params.gameDay, params.config);

  const created = await createListing(env, {
    horseId: params.horse.id,
    sellerStableId: params.sellerStableId,
    price: params.offer.max_price,
    guideValue: appraisal.value,
    gameDay: params.gameDay,
    listingGameDays: params.config.market_listing_game_days,
  });
  if (!created.ok) return { ok: false, error: 'already_listed' };

  // Just created above in this same call, so this read cannot miss - but the type is still
  // nullable, and a silent cast here would hide a real bug rather than surface one.
  const listing = await getListing(env, created.listingId);
  if (!listing) throw new Error('sellIntoOffer: listing vanished immediately after being created');
  const result = await sellListing(env, {
    listing,
    horseName: params.horseName,
    buyerStableId: params.buyerStable.id,
    buyerStableName: params.buyerStable.name,
    buyerAccountId: null,
    sellerStableId: params.sellerStableId,
    sellerStableName: params.sellerStableName,
    sellerAccountId: params.sellerAccountId,
    gameDay: params.gameDay,
    commissionPercent: params.config.market_commission_percent,
  });
  if (!result.ok) return { ok: false, error: 'gone' };
  return { ok: true };
}
