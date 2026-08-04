// NPC stallions at stud (slice 0017 §13.4's third question, decided by the operator on 4 Aug 2026:
// build this in the same session as the player-to-player mechanism rather than deferring it - see
// src/db/stud.ts's own header). Every eligible NPC stallion is offered automatically; this file owns
// deciding which ones and at what fee. There is no second booking path - a player booking to an NPC
// stallion runs through src/db/stud.ts's bookStud exactly as a booking to another player's stallion
// does.
//
// **The NPC ceiling is a hard filter on who may be offered, not just on who a stable chooses to
// breed.** slice 0015 §2.4's npc_ceiling_schedule already bounds what selectBreedingPairs will pick
// as breeding stock; stud is a different exposure. Buying an NPC horse (Part B) only ever hands a
// player that horse's own (ceiling-bound) quality. Breeding to one *combines* it with the player's
// own stock, so an above-ceiling stallion offered at stud would let a player's breeding program
// inherit quality the ceiling exists to keep out of NPC hands - exactly the route around the
// ceiling slice 0017 §13.4 names. ensureListingForStallion below checks qualityFor against the same
// ceiling row runNpcBreedingDecisions already reads, and withdraws a listing the moment a stallion's
// realised quality (age, noise, a retuned ideal vector) puts him over it.
//
// Unlike buy_offers' upsertActiveOfferForStable (src/db/buyOffers.ts), a listing's fee and
// season_cap are NOT refreshed every tick once created - they are set once, the same way a player's
// own "offer at stud" form sets them once. A buy offer's price tracks the posting stable's current
// wealth and target on purpose (it is standing demand); a stud fee reads more like a price an owner
// picked, and churning it under a mare owner mid-decision would be a worse experience than a slowly
// stale number.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { getStableById, type StableRow } from './stables';
import { getBreeds, type BreedRow } from './breeds';
import { getDisciplines, type DisciplineRow } from './disciplines';
import { listStableHorses, type HorseRow } from './horses';
import { listNpcPolicies, resolveSelectionTarget, activeNpcCeilingRow, type NpcPolicyRow } from './npcBreeding';
import { qualityFor } from './npcMarket';
import type { SelectionTarget } from '../engines/npc/selection';
import { availabilityForHorse } from './care';
import { appraiseHorseForStable } from './listings';
import { createStudListing, getActiveStudListingForHorse, withdrawStudListing } from './stud';

async function ensureListingForStallion(
  env: Env,
  params: { stable: StableRow; stallion: HorseRow; ceiling: number; target: SelectionTarget; gameDay: number; config: Config }
): Promise<void> {
  const cfg = params.config.values;
  const quality = qualityFor(params.stallion, params.target, params.gameDay, params.config);
  const existing = await getActiveStudListingForHorse(env, params.stallion.id);

  if (quality > params.ceiling) {
    if (existing) await withdrawStudListing(env, existing.id, params.stable.id, params.gameDay);
    return;
  }
  if (existing) return;

  const appraisal = await appraiseHorseForStable(env, params.stallion, params.stable.id, params.gameDay, cfg);
  const fee = Math.min(cfg.stud_max_fee, Math.max(10, Math.round((appraisal.value * cfg.npc_stud_fee_fraction) / 10) * 10));
  await createStudListing(env, { stallionId: params.stallion.id, stableId: params.stable.id, fee, seasonCap: cfg.npc_stud_season_cap, gameDay: params.gameDay });
}

async function runOneStablePolicy(
  env: Env,
  policy: NpcPolicyRow,
  gameDay: number,
  config: Config,
  ceilingByKind: { conformation: number; ability: number },
  breedById: Map<number, BreedRow>,
  disciplineByCode: Map<string, DisciplineRow>
): Promise<void> {
  const stable = await getStableById(env, policy.stable_id);
  if (!stable) return;
  const target = resolveSelectionTarget(policy, config, breedById, disciplineByCode);
  if (!target) return;
  const ceiling = target.kind === 'conformation' ? ceilingByKind.conformation : ceilingByKind.ability;

  const horses = await listStableHorses(env, stable.id);
  const stallions = horses.filter(
    (h) =>
      h.sex === 'stallion' &&
      gameDay - h.born_game_day >= config.values.min_breeding_age_game_days &&
      availabilityForHorse(h, config.values, gameDay).available
  );

  for (const stallion of stallions) {
    await ensureListingForStallion(env, { stable, stallion, ceiling, target, gameDay, config });
  }
}

/** The tick's new stage, run beside runNpcMarketListings (Part B) - both are an NPC stable's own
 * cycle decisions about its stock. Naturally idempotent: a stallion already listed is skipped
 * (getActiveStudListingForHorse), so no interval marker is needed, the same reasoning
 * runNpcMarketListings' own header comment gives. */
export async function runNpcStudListings(env: Env, gameDay: number, config: Config): Promise<void> {
  const policies = await listNpcPolicies(env);
  if (policies.length === 0) return;

  const [breeds, disciplines, ceilingRow] = await Promise.all([getBreeds(env), getDisciplines(env), activeNpcCeilingRow(env, gameDay)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));
  const ceilingByKind = { conformation: ceilingRow.conformation_ceiling, ability: ceilingRow.ability_ceiling };

  for (const policy of policies) {
    await runOneStablePolicy(env, policy, gameDay, config, ceilingByKind, breedById, disciplineByCode);
  }
}
