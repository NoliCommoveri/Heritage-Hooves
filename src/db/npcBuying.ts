// An NPC stable's own decision to buy (slice 0017 §12, Part C) - the two routes the operator asked
// for, both driven by the exact target-scoring npc_policy already carries for breeding and selling
// (src/db/npcBreeding.ts, src/db/npcMarket.ts). Sits beside those two in the tick, all three being
// an NPC stable's own cycle choices about its stock.
//
// Mechanism A, refreshNpcBuyOffers: keeps each NPC stable's one standing offer (buy_offers,
// src/db/buyOffers.ts) matching its current target, balance and free stalls - a player sells into
// it instantly from /market's Offers tab, no browsing period.
//
// Mechanism B, runNpcMarketPurchases: an NPC stable shops the open market itself and buys player
// listings that fit, through sellListing exactly as a player's own purchase runs. There is no
// second sale path for either mechanism - Part A's sale batch, unchanged, is what actually moves a
// horse in both.
//
// Both mechanisms only ever buy from a real player: `seller_account_id IS NOT NULL` on an open
// listing excludes every NPC seller (an NPC stable's own account_id is always null), so this file
// can never trigger NPC-to-NPC trading - money that would otherwise shuffle between two closed
// stables for no reason. Both mechanisms also exclude geldings - the entire point of NPC buying is
// outcross breeding stock (overview §10f), and a gelding can never be bred.
//
// **The named risk (§12):** NPC balances are real and never topped up automatically. A stable that
// overspends on either route simply stops buying until it earns more (Part B is its income) or an
// operator adjusts it by hand from /admin/money. Nothing here works around that - both routes read
// the stable's live balance and free stalls fresh every tick, so a broke or full stable naturally
// falls silent rather than erroring.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { canTakeOnCost } from '../lib/money';
import { getStableById } from './stables';
import { getBreeds, type BreedRow } from './breeds';
import { getDisciplines, type DisciplineRow } from './disciplines';
import { countAliveHorses, getHorse, horseDisplayName, type HorseRow } from './horses';
import { listNpcPolicies, resolveSelectionTarget, type NpcPolicyRow } from './npcBreeding';
import { qualityFor } from './npcMarket';
import { listOpenListings, sellListing, type OpenListingRow } from './listings';
import { upsertActiveOfferForStable, deactivateOfferForStable, type BuyOfferCriteria } from './buyOffers';
import type { SelectionTarget } from '../engines/npc/selection';

// ---------------------------------------------------------------------------
// Mechanism A: the standing offer (§12's "a standing offers board")
// ---------------------------------------------------------------------------

async function refreshOneOffer(
  env: Env,
  policy: NpcPolicyRow,
  gameDay: number,
  config: Config,
  breedById: Map<number, BreedRow>,
  disciplineByCode: Map<string, DisciplineRow>
): Promise<void> {
  const cfg = config.values;
  const stable = await getStableById(env, policy.stable_id);
  if (!stable || !canTakeOnCost(stable.balance)) {
    await deactivateOfferForStable(env, policy.stable_id);
    return;
  }

  const aliveCount = await countAliveHorses(env, policy.stable_id);
  const freeStalls = stable.capacity - aliveCount;
  if (freeStalls < cfg.npc_buying_capacity_buffer) {
    await deactivateOfferForStable(env, policy.stable_id);
    return;
  }

  const target = resolveSelectionTarget(policy, config, breedById, disciplineByCode);
  if (!target) {
    await deactivateOfferForStable(env, policy.stable_id);
    return;
  }

  const maxPrice = Math.min(cfg.market_max_price, Math.max(cfg.market_min_value, Math.floor(stable.balance * cfg.npc_buying_budget_fraction)));
  const criteria: BuyOfferCriteria = {
    v: 1,
    // Only a conformation specialist's offer is breed-restricted - an ability target scores any
    // breed the same way (resolveSelectionTarget's own rule, reused rather than re-decided here).
    breedId: target.kind === 'conformation' ? policy.target_breed_id : null,
    minAgeGameDays: cfg.min_breeding_age_game_days,
    maxAgeGameDays: null,
    minQuality: cfg.npc_buy_offer_min_quality,
  };
  await upsertActiveOfferForStable(env, { stableId: stable.id, criteria, maxPrice, gameDay });
}

/** The tick's stage for mechanism A. Naturally idempotent the same way runNpcMarketListings is - a
 * re-fired tick recomputes the identical offer and upsertActiveOfferForStable writes the same
 * numbers back over themselves, so no marker column is needed (CLAUDE.md §5.4). */
export async function refreshNpcBuyOffers(env: Env, gameDay: number, config: Config): Promise<void> {
  const policies = await listNpcPolicies(env);
  if (policies.length === 0) return;

  const [breeds, disciplines] = await Promise.all([getBreeds(env), getDisciplines(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));

  for (const policy of policies) {
    await refreshOneOffer(env, policy, gameDay, config, breedById, disciplineByCode);
  }
}

// ---------------------------------------------------------------------------
// Mechanism B: shopping the open market (§12's "NPC stables shopping open listings on the tick")
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  listing: OpenListingRow;
  horse: HorseRow;
  quality: number;
}

async function scoreCandidates(env: Env, listings: OpenListingRow[], target: SelectionTarget, gameDay: number, config: Config, minQuality: number): Promise<ScoredCandidate[]> {
  const scored: ScoredCandidate[] = [];
  for (const listing of listings) {
    // A listing's own row lacks the genetics columns qualityFor needs (rng_seed,
    // environmental_noise, coi) - a full horse read per candidate, same cost appraiseHorseForStable
    // already pays per listing view, and there are never more than a handful of open listings at
    // this game's scale.
    const horse = await getHorse(env, listing.horse_id);
    if (!horse || horse.status !== 'alive' || horse.owner_stable_id !== listing.seller_stable_id) continue;
    if (horse.sex === 'gelding') continue;
    const quality = qualityFor(horse, target, gameDay, config);
    if (quality < minQuality) continue;
    scored.push({ listing, horse, quality });
  }
  return scored;
}

async function runOnePurchasePolicy(
  env: Env,
  policy: NpcPolicyRow,
  gameDay: number,
  config: Config,
  breedById: Map<number, BreedRow>,
  disciplineByCode: Map<string, DisciplineRow>
): Promise<void> {
  const cfg = config.values;
  const stable = await getStableById(env, policy.stable_id);
  if (!stable || !canTakeOnCost(stable.balance)) return;

  const aliveCount = await countAliveHorses(env, policy.stable_id);
  let stallsLeft = stable.capacity - aliveCount;
  if (stallsLeft < cfg.npc_buying_capacity_buffer) return;

  const target = resolveSelectionTarget(policy, config, breedById, disciplineByCode);
  if (!target) return;

  // A conformation specialist only shops its own breed; an ability target scores any breed the
  // same way, so nothing narrows the search (same rule the standing offer's criteria.breedId uses).
  const breedFilter = target.kind === 'conformation' ? policy.target_breed_id : null;
  const listings = (await listOpenListings(env, breedFilter)).filter((l) => l.seller_account_id !== null && l.seller_stable_id !== policy.stable_id);
  if (listings.length === 0) return;

  const budgetCap = Math.floor(stable.balance * cfg.npc_buying_budget_fraction);
  const affordable = listings.filter((l) => l.price <= stable.balance && l.price <= budgetCap);
  if (affordable.length === 0) return;

  const scored = await scoreCandidates(env, affordable, target, gameDay, config, cfg.npc_buying_min_quality);
  if (scored.length === 0) return;

  // Best fit first, deterministically - no randomness involved (CLAUDE.md §5.2 governs draws that
  // decide game outcomes; ranking a stable's own shopping list by an already-computed score is
  // neither a draw nor an outcome). Ties keep listOpenListings' own newest-first order.
  scored.sort((a, b) => b.quality - a.quality);

  let runningBalance = stable.balance;
  let purchased = 0;
  for (const { listing, horse } of scored) {
    if (purchased >= cfg.npc_buying_max_purchases_per_tick || stallsLeft <= 0) break;
    if (listing.price > runningBalance) continue;

    const result = await sellListing(env, {
      listing,
      horseName: horseDisplayName(horse),
      buyerStableId: stable.id,
      buyerStableName: stable.name,
      buyerAccountId: null,
      sellerStableId: listing.seller_stable_id,
      sellerStableName: listing.seller_stable_name,
      sellerAccountId: listing.seller_account_id,
      gameDay,
      commissionPercent: cfg.market_commission_percent,
    });
    if (result.ok) {
      purchased += 1;
      stallsLeft -= 1;
      runningBalance -= listing.price;
    }
    // A 'gone' result means another buyer took it in between the read and this write (§7.3's same
    // race, now with an NPC on one side) - simply move on to the next candidate rather than retry.
  }
}

/** The tick's stage for mechanism B, run immediately after refreshNpcBuyOffers. Idempotency needs
 * no marker column: sellListing's own WHERE-guarded batch (src/db/listings.ts §7.3) means a horse
 * already sold this tick cannot be sold again, and a re-fired tick simply re-evaluates the (now
 * smaller) open market and finds fewer or no fits. */
export async function runNpcMarketPurchases(env: Env, gameDay: number, config: Config): Promise<void> {
  const policies = await listNpcPolicies(env);
  if (policies.length === 0) return;

  const [breeds, disciplines] = await Promise.all([getBreeds(env), getDisciplines(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));

  for (const policy of policies) {
    await runOnePurchasePolicy(env, policy, gameDay, config, breedById, disciplineByCode);
  }
}
