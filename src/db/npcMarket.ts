// An NPC stable's own decision to sell (slice 0017 §11, Part B). Sits beside runNpcBreedingDecisions
// in the tick (src/db/npcBreeding.ts) - both are an NPC stable's own cycle choices about its stock -
// but writes into the same `listings` table Part A already built, through the same createListing and
// appraiseHorseForStable functions a player's own listing form uses. There is no second sale path:
// a player buying an NPC horse runs through src/db/listings.ts's sellListing exactly as written.
//
// The trigger is capacity-only, not the two triggers §11 describes ("at or near capacity, or when a
// horse falls below what the policy wants to keep") - a deliberate simplification agreed for this
// build. When free stalls drop below npc_market_capacity_buffer (live config), the stable lists its
// own lowest-scoring horses against its personality's own target - the same scoring
// runNpcBreedingDecisions already uses to rank breeding candidates - until the buffer is restored or
// npc_market_max_listings_per_tick is reached. No separate always-on quality floor.
//
// Naturally idempotent: a horse already open-listed is excluded from the candidate pool and cannot
// be listed twice (idx_listings_one_open_per_horse), so this stage needs no interval marker the way
// npc_policy.last_bred_game_day gives runNpcBreedingDecisions one - it simply runs every tick and
// finds nothing to do once a stable is back under its buffer.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { deriveSeed, makeRng } from '../lib/rng';
import { getStableById } from './stables';
import { getBreeds, type BreedRow } from './breeds';
import { getDisciplines, type DisciplineRow } from './disciplines';
import { listStableHorses, countAliveHorses, horseDisplayName, type HorseRow } from './horses';
import { listNpcPolicies, resolveSelectionTarget, expressedFor, type NpcPolicyRow } from './npcBreeding';
import type { SelectionTarget } from '../engines/npc/selection';
import { scoreEntry } from '../engines/showing/score';
import { scoreAbilityEntry } from '../engines/showing/abilityScore';
import { getEnabledConditions, getKnowledgeForHorse, untestedConditions, buildKnowledgePurchaseStatements, type ConditionRow } from './health';
import { parseGenotype } from '../engines/genetics/genotype';
import { buildLedgerStatements } from './ledger';
import { openListingsBySellerStable, createListing, appraiseHorseForStable } from './listings';

/** The same target-scoring runOnePolicy's own scoreCandidate uses for breeding, minus the selection
 * noise and the retention roll - both are about picking who breeds, not about ranking who is worth
 * keeping, so a listing decision reads the horse's plain rawScore against the policy's target.
 * Exported for src/db/buyOffers.ts and src/db/npcBuying.ts (slice 0017 §12, Part C): the same
 * "how good is this horse against my own target" question a listing decision asks, asked again
 * from the buying side - reused rather than re-derived, the same rule this file's own header
 * comment already applies to appraiseHorseForStable and createListing. */
export function qualityFor(horse: HorseRow, target: SelectionTarget, gameDay: number, config: Config): number {
  const expressed = expressedFor(horse, target.kind, gameDay, config);
  if (target.kind === 'conformation') {
    return scoreEntry({ expressed, ideal: target.ideal ?? {}, judgeWeights: target.judgeWeights ?? {}, falloff: target.falloff ?? 0, noise: 0 }).rawScore;
  }
  return scoreAbilityEntry({ expressed, weights: target.weights ?? {}, noise: 0 }).rawScore;
}

/** §11: "an NPC stable pays for a full disease panel when it lists, writing real horse_knowledge
 * rows at the going price out of its own balance" - reuses the exact path the player test-purchase
 * route uses (buildKnowledgePurchaseStatements), so a tested-clear NPC horse is tested the same way
 * a player's is. If the stable cannot afford the panel it lists untested rather than skipping the
 * cycle - a tight NPC economy shouldn't also freeze the exit for its surplus stock. Returns the
 * amount actually spent, so the caller's running balance stays accurate across several horses in one
 * cycle without a re-read per horse. */
async function payForPanelIfAffordable(
  env: Env,
  params: { stableId: number; horse: HorseRow; gameDay: number; balance: number; panelCost: number; conditions: ConditionRow[] }
): Promise<number> {
  const knowledge = await getKnowledgeForHorse(env, params.stableId, params.horse.id);
  const untested = untestedConditions(params.conditions, knowledge);
  if (untested.length === 0 || params.balance < params.panelCost) return 0;

  const base = Math.floor(params.panelCost / untested.length);
  const costByCode: Record<string, number> = {};
  untested.forEach((c) => {
    costByCode[c.code] = base;
  });
  costByCode[untested[untested.length - 1].code] += params.panelCost - base * untested.length;

  await env.DB.batch([
    ...buildKnowledgePurchaseStatements(env, {
      stableId: params.stableId,
      horseId: params.horse.id,
      gameDay: params.gameDay,
      genotype: parseGenotype(params.horse.genotype),
      conditions: untested,
      costByCode,
    }),
    ...buildLedgerStatements(env, [
      {
        stableId: params.stableId,
        amount: -params.panelCost,
        kind: 'vet',
        referenceType: 'horse',
        referenceId: params.horse.id,
        description: `Panel testing before listing ${horseDisplayName(params.horse)}.`,
        gameDay: params.gameDay,
      },
    ]),
  ]);
  return params.panelCost;
}

/** §11's "modest random spread", seeded per listing rather than per stable - two horses listed by
 * the same stable on the same day must not ask the identical fraction over guide value. Returns a
 * multiplier in [1 - spread, 1 + spread]. */
function priceSpreadFactor(stableId: number, horseId: number, gameDay: number, spread: number): number {
  const roll = makeRng(deriveSeed(stableId, `npc_listing_price_${String(horseId)}_${String(gameDay)}`)).next();
  return 1 + (roll * 2 - 1) * spread;
}

async function runOneMarketPolicy(
  env: Env,
  policy: NpcPolicyRow,
  gameDay: number,
  config: Config,
  breedById: Map<number, BreedRow>,
  disciplineByCode: Map<string, DisciplineRow>,
  conditions: ConditionRow[]
): Promise<void> {
  const cfg = config.values;
  const stable = await getStableById(env, policy.stable_id);
  if (!stable) return;

  const aliveCount = await countAliveHorses(env, policy.stable_id);
  const freeStalls = stable.capacity - aliveCount;
  if (freeStalls >= cfg.npc_market_capacity_buffer) return;

  const target = resolveSelectionTarget(policy, config, breedById, disciplineByCode);
  if (!target) return;

  const toList = Math.min(cfg.npc_market_capacity_buffer - freeStalls, cfg.npc_market_max_listings_per_tick);
  if (toList <= 0) return;

  const [horses, openListings] = await Promise.all([listStableHorses(env, policy.stable_id), openListingsBySellerStable(env, policy.stable_id)]);
  const candidates = horses.filter((h) => !openListings.has(h.id) && gameDay - h.born_game_day >= cfg.min_breeding_age_game_days);
  if (candidates.length === 0) return;

  const ranked = candidates
    .map((horse) => ({ horse, quality: qualityFor(horse, target, gameDay, config) }))
    .sort((a, b) => a.quality - b.quality)
    .slice(0, toList);

  let balance = stable.balance;
  for (const { horse } of ranked) {
    balance -= await payForPanelIfAffordable(env, { stableId: stable.id, horse, gameDay, balance, panelCost: cfg.genotype_panel_cost, conditions });

    const appraisal = await appraiseHorseForStable(env, horse, stable.id, gameDay, cfg);
    const spread = priceSpreadFactor(stable.id, horse.id, gameDay, policy.market_price_spread);
    const rawPrice = appraisal.value * policy.market_price_multiplier * spread;
    const price = Math.min(cfg.market_max_price, Math.max(10, Math.round(rawPrice / 10) * 10));

    await createListing(env, {
      horseId: horse.id,
      sellerStableId: stable.id,
      price,
      guideValue: appraisal.value,
      gameDay,
      listingGameDays: cfg.market_listing_game_days,
    });
  }
}

/** The tick's new stage (§11), called immediately after runNpcBreedingDecisions. */
export async function runNpcMarketListings(env: Env, gameDay: number, config: Config): Promise<void> {
  const policies = await listNpcPolicies(env);
  if (policies.length === 0) return;

  const [breeds, disciplines, conditions] = await Promise.all([getBreeds(env), getDisciplines(env), getEnabledConditions(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));

  for (const policy of policies) {
    await runOneMarketPolicy(env, policy, gameDay, config, breedById, disciplineByCode, conditions);
  }
}
