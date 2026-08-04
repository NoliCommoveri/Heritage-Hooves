// An NPC stable's own breeding decision (slice 0015 §2.3/§4.2/§6) - the database layer around
// src/engines/npc/selection.ts's pure selectBreedingPairs. Also owns the two tables that make it
// tunable from the browser (npc_policy, npc_ceiling_schedule), since nothing else in the codebase
// reads or writes them yet (Part A only shipped the migrations and the engine).
//
// Reuses, rather than re-derives, exactly the functions a player's own booking route already
// applies (CLAUDE.md §13's "no parallel path" rule, applied to eligibility rather than scoring):
// availabilityForHorse, isInBreedingSeason, getActivePregnancyForMare, getBookedCoveringForMare,
// coefficientOfInbreeding, and bookCovering itself. If a future session changes an eligibility
// rule in one place, both a player's booking screen and NPC breeding pick it up.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { nowUtcSeconds } from '../lib/time';
import { deriveSeed } from '../lib/rng';
import { canTakeOnCost } from '../lib/money';
import { getStableById } from './stables';
import { getBreeds, type BreedRow } from './breeds';
import { getDisciplines, type DisciplineRow } from './disciplines';
import { listStableHorses, countAliveHorses, loadPedigreeContextForMany, type HorseRow } from './horses';
import { getActivePregnancyForMare } from './pregnancies';
import { getBookedCoveringForMare, bookCovering } from './coverings';
import { getSeasonTradeSummary } from './ledger';
import { isInBreedingSeason } from '../engines/breeding/season';
import { availabilityForHorse } from './care';
import { parseGenotype } from '../engines/genetics/genotype';
import { noiseFor, conformationValues, abilityValues } from '../engines/conformation/model';
import { coefficientOfInbreeding } from '../engines/genetics/pedigree';
import { parseAbilityWeights } from '../engines/showing/abilityScore';
import { parseIdealVector } from '../engines/showing/score';
import type { TraitCode } from '../engines/genetics/polygenic';
import { selectBreedingPairs, type BreedingCandidate, type SelectionTarget } from '../engines/npc/selection';

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique constraint failed/i.test(err.message);
}

export interface NpcPolicyRow {
  stable_id: number;
  personality_code: string;
  target_kind: 'conformation' | 'ability';
  target_breed_id: number | null;
  target_discipline_code: string | null;
  selection_noise_sd: number;
  retention_bias: number;
  breeding_interval_game_days: number;
  max_pairs_per_cycle: number;
  last_bred_game_day: number | null;
  /** Slice 0017 §11 (Part B): the market's per-personality asking-price multiplier and modest
   * seeded spread - src/db/npcMarket.ts's own tunables, kept on this row because they are a
   * property of the personality, not a game-wide config value (see migrations/0093). */
  market_price_multiplier: number;
  market_price_spread: number;
  /** NPC solvency (migrations/0118, src/db/npcFinance.ts): the balance this stable is topped back
   * up to once every npc_balance_floor_interval_game_days if it has fallen below, and the marker
   * saying when that last happened. 0 disables the floor for this stable; a NULL marker means
   * "never topped up" and reads as immediately due. Same shape as last_bred_game_day above. */
  balance_floor: number;
  last_floor_topup_game_day: number | null;
}

export async function listNpcPolicies(env: Env): Promise<NpcPolicyRow[]> {
  const result = await env.DB.prepare('SELECT * FROM npc_policy ORDER BY stable_id ASC').all<NpcPolicyRow>();
  return result.results ?? [];
}

export async function getNpcPolicy(env: Env, stableId: number): Promise<NpcPolicyRow | null> {
  return env.DB.prepare('SELECT * FROM npc_policy WHERE stable_id = ?').bind(stableId).first<NpcPolicyRow>();
}

export interface NpcCeilingScheduleRow {
  id: number;
  game_day_from: number;
  conformation_ceiling: number;
  ability_ceiling: number;
}

export async function listNpcCeilingSchedule(env: Env): Promise<NpcCeilingScheduleRow[]> {
  const result = await env.DB.prepare('SELECT * FROM npc_ceiling_schedule ORDER BY game_day_from ASC').all<NpcCeilingScheduleRow>();
  return result.results ?? [];
}

/** §2.4: the applicable row at a given game_day is the one with the largest game_day_from <=
 * game_day. Read fresh every cycle, never cached on npc_policy - the whole point is that the
 * ceiling moves under a stable that never changes anything about itself. */
export async function activeNpcCeilingRow(env: Env, gameDay: number): Promise<NpcCeilingScheduleRow> {
  const row = await env.DB.prepare('SELECT * FROM npc_ceiling_schedule WHERE game_day_from <= ? ORDER BY game_day_from DESC LIMIT 1')
    .bind(gameDay)
    .first<NpcCeilingScheduleRow>();
  if (!row) throw new Error('activeNpcCeilingRow: no npc_ceiling_schedule row applies at this game day - has migrations/0084 been applied?');
  return row;
}

/** §7.3's ceiling-schedule editor: adds a new row when id is omitted, otherwise edits an existing
 * one's three numbers in place. A plain form over a table (CLAUDE.md §13), not a polished editor. */
export async function upsertNpcCeilingScheduleRow(
  env: Env,
  params: { id?: number; gameDayFrom: number; conformationCeiling: number; abilityCeiling: number }
): Promise<void> {
  if (params.id !== undefined) {
    await env.DB.prepare('UPDATE npc_ceiling_schedule SET game_day_from = ?, conformation_ceiling = ?, ability_ceiling = ? WHERE id = ?')
      .bind(params.gameDayFrom, params.conformationCeiling, params.abilityCeiling, params.id)
      .run();
    return;
  }
  await env.DB.prepare('INSERT INTO npc_ceiling_schedule (game_day_from, conformation_ceiling, ability_ceiling) VALUES (?, ?, ?)')
    .bind(params.gameDayFrom, params.conformationCeiling, params.abilityCeiling)
    .run();
}

/** How many pairs an NPC stable's last cycle actually booked (/admin/npc's own display column,
 * §7.3) - derived from the coverings its own bookCovering calls wrote on that game day, rather than
 * a new counter column, since bookCovering already stamps stable_id and booked_game_day on every
 * row it creates. Null lastBredGameDay (never bred) reads as 0 with no query. */
async function countPairsBookedOnDay(env: Env, stableId: number, gameDay: number | null): Promise<number> {
  if (gameDay === null) return 0;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM coverings WHERE stable_id = ? AND booked_game_day = ?')
    .bind(stableId, gameDay)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface NpcStableAdminRow {
  stableId: number;
  stableName: string;
  personalityCode: string;
  targetLabel: string;
  aliveCount: number;
  capacity: number;
  balance: number;
  breedingIntervalGameDays: number;
  maxPairsPerCycle: number;
  lastBredGameDay: number | null;
  nextCycleDueGameDay: number | null;
  pairsLastCycle: number;
  marketPriceMultiplier: number;
  /** Slice 0017 §12 (Part C)'s named mitigation 1: what this stable has spent buying and earned
   * selling since the current game year started, read from the ledger's own 'purchase'/'sale' kinds
   * - so an operator can see a stable's buying power drying up before the children feel it. */
  spentBuyingThisSeason: number;
  /** NPC solvency (src/db/npcFinance.ts): the balance this stable is restored to when its floor
   * next falls due, and the game day that happens. 0 and null mean the floor is switched off for
   * this stable. */
  balanceFloor: number;
  nextFloorTopupGameDay: number | null;
  earnedSellingThisSeason: number;
}

/** /admin/npc's per-stable table (§7.3). One pass over every npc_policy row - three stables at
 * launch (§2.1), so no batching concern yet (§4.2's own closing note). gameDay/gameDaysPerYear are
 * only used to bound the season summary (§12) - everything else here is unchanged from slice 0015. */
export async function listNpcStablesForAdmin(
  env: Env,
  gameDay: number,
  gameDaysPerYear: number,
  floorIntervalGameDays: number
): Promise<NpcStableAdminRow[]> {
  const [policies, breeds, disciplines] = await Promise.all([listNpcPolicies(env), getBreeds(env), getDisciplines(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));
  const seasonStartGameDay = Math.floor(gameDay / gameDaysPerYear) * gameDaysPerYear;

  const rows: NpcStableAdminRow[] = [];
  for (const policy of policies) {
    const stable = await getStableById(env, policy.stable_id);
    if (!stable) continue;
    const [aliveCount, pairsLastCycle, tradeSummary] = await Promise.all([
      countAliveHorses(env, policy.stable_id),
      countPairsBookedOnDay(env, policy.stable_id, policy.last_bred_game_day),
      getSeasonTradeSummary(env, policy.stable_id, seasonStartGameDay),
    ]);
    const targetLabel =
      policy.target_kind === 'conformation'
        ? (policy.target_breed_id !== null ? breedById.get(policy.target_breed_id)?.name : undefined) ?? 'unknown breed'
        : (policy.target_discipline_code !== null ? disciplineByCode.get(policy.target_discipline_code)?.name : undefined) ?? 'unknown discipline';

    rows.push({
      stableId: stable.id,
      stableName: stable.name,
      personalityCode: policy.personality_code,
      targetLabel,
      aliveCount,
      capacity: stable.capacity,
      balance: stable.balance,
      breedingIntervalGameDays: policy.breeding_interval_game_days,
      maxPairsPerCycle: policy.max_pairs_per_cycle,
      lastBredGameDay: policy.last_bred_game_day,
      nextCycleDueGameDay: policy.last_bred_game_day === null ? null : policy.last_bred_game_day + policy.breeding_interval_game_days,
      pairsLastCycle,
      marketPriceMultiplier: policy.market_price_multiplier,
      spentBuyingThisSeason: tradeSummary.spentBuying,
      earnedSellingThisSeason: tradeSummary.earnedSelling,
      balanceFloor: policy.balance_floor,
      // Null means "due on the next tick" - either it has never been topped up, or its interval has
      // already elapsed. The renderer distinguishes "off" from "due now" by balanceFloor, not by
      // this being null.
      nextFloorTopupGameDay:
        policy.last_floor_topup_game_day === null || gameDay - policy.last_floor_topup_game_day >= floorIntervalGameDays
          ? null
          : policy.last_floor_topup_game_day + floorIntervalGameDays,
    });
  }
  return rows;
}

export type FoundNpcStableResult = { ok: true; stableId: number } | { ok: false; error: 'prefix_taken' };

/** §7.3's "Found a new NPC stable" control - the admin equivalent of migration 0085, so a fourth or
 * fifth personality (§2.1's deferred colour barn/preservationist/health barn, once warranted)
 * doesn't need a deploy. Writes the stables row, its stable_prefix_history row and its npc_policy
 * row in one batch; refuses a prefix already in use rather than surfacing a raw constraint error. */
export async function foundNpcStable(
  env: Env,
  params: {
    name: string;
    prefix: string;
    personalityCode: string;
    targetKind: 'conformation' | 'ability';
    targetBreedId: number | null;
    targetDisciplineCode: string | null;
    selectionNoiseSd: number;
    retentionBias: number;
    breedingIntervalGameDays: number;
    maxPairsPerCycle: number;
    capacity: number;
    marketPriceMultiplier: number;
    marketPriceSpread: number;
    /** src/db/npcFinance.ts's income floor. Passed explicitly rather than left to the column's
     * DEFAULT 0, because a stable founded with the floor silently switched off would look identical
     * to a healthy one right up until it ran out of money and went quiet. 0 to switch it off on
     * purpose. */
    balanceFloor: number;
    gameDay: number;
  }
): Promise<FoundNpcStableResult> {
  const nowSeconds = nowUtcSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
         VALUES (NULL, ?, ?, ?, 1, 1, 0, ?, ?, ?, 1)`
      ).bind(params.name, params.prefix, params.gameDay, params.capacity, params.gameDay, nowSeconds),
      env.DB.prepare(
        `INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
         VALUES ((SELECT id FROM stables ORDER BY id DESC LIMIT 1), ?, ?, NULL, NULL, ?)`
      ).bind(params.prefix, params.gameDay, nowSeconds),
      env.DB.prepare(
        `INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
         VALUES ((SELECT id FROM stables ORDER BY id DESC LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        params.personalityCode,
        params.targetKind,
        params.targetBreedId,
        params.targetDisciplineCode,
        params.selectionNoiseSd,
        params.retentionBias,
        params.breedingIntervalGameDays,
        params.maxPairsPerCycle,
        params.marketPriceMultiplier,
        params.marketPriceSpread,
        params.balanceFloor
      ),
    ]);
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'prefix_taken' };
    throw err;
  }
  const created = await env.DB.prepare('SELECT id FROM stables WHERE prefix = ?').bind(params.prefix).first<{ id: number }>();
  return { ok: true, stableId: created!.id };
}

// ---------------------------------------------------------------------------
// The tick stage (§4.2/§6.1)
// ---------------------------------------------------------------------------

/** Exported for src/db/npcMarket.ts (slice 0017 §11): the same "what is this policy chasing"
 * resolution the breeding stage uses, reused rather than re-derived, so a policy's target always
 * means the same thing whether it's picking a covering or picking which horse to sell. */
export function resolveSelectionTarget(policy: NpcPolicyRow, config: Config, breedById: Map<number, BreedRow>, disciplineByCode: Map<string, DisciplineRow>): SelectionTarget | null {
  if (policy.target_kind === 'conformation') {
    const breed = policy.target_breed_id !== null ? breedById.get(policy.target_breed_id) : undefined;
    if (!breed?.ideal_vector) return null;
    return {
      kind: 'conformation',
      ideal: parseIdealVector(breed.ideal_vector),
      judgeWeights: {},
      falloff: config.values.show_ideal_falloff,
    };
  }
  const discipline = policy.target_discipline_code !== null ? disciplineByCode.get(policy.target_discipline_code) : undefined;
  if (!discipline) return null;
  return { kind: 'ability', weights: parseAbilityWeights(discipline.ability_weights) };
}

/** Exported for src/db/npcMarket.ts - the same expressed-trait computation, so a policy's market
 * ranking of its own stock is read off the identical values its breeding selection already uses. */
export function expressedFor(horse: HorseRow, kind: 'conformation' | 'ability', gameDay: number, config: Config): Partial<Record<TraitCode, number>> {
  const genotype = parseGenotype(horse.genotype);
  const ageYears = (gameDay - horse.born_game_day) / config.values.game_days_per_year;
  const noise = noiseFor(horse.rng_seed, horse.environmental_noise);
  const values = kind === 'conformation' ? conformationValues(genotype, noise, ageYears, horse.coi, config.values) : abilityValues(genotype, noise, ageYears, horse.coi, config.values);
  const expressed: Partial<Record<TraitCode, number>> = {};
  for (const v of values) expressed[v.code] = v.expressed;
  return expressed;
}

/** §4.2 step 4: the same predicates validateBooking (src/routes/horses.ts) applies to a player's
 * booking, minus the stable-capacity/debt checks (handled once per stable, not once per horse, by
 * the caller below - §2.5/§2.6). */
async function eligibleMaresAndStallions(env: Env, horses: HorseRow[], config: Config, gameDay: number): Promise<{ mares: HorseRow[]; stallions: HorseRow[] }> {
  const mares: HorseRow[] = [];
  const stallions: HorseRow[] = [];

  for (const horse of horses) {
    if (horse.sex !== 'mare' && horse.sex !== 'stallion') continue;
    if (!availabilityForHorse(horse, config.values, gameDay).available) continue;
    if (gameDay - horse.born_game_day < config.values.min_breeding_age_game_days) continue;

    if (horse.sex === 'stallion') {
      stallions.push(horse);
      continue;
    }

    if (horse.last_foaled_game_day !== null && gameDay - horse.last_foaled_game_day < config.values.mare_recovery_game_days) continue;
    const [activePregnancy, activeCovering] = await Promise.all([getActivePregnancyForMare(env, horse.id), getBookedCoveringForMare(env, horse.id)]);
    if (activePregnancy || activeCovering) continue;
    mares.push(horse);
  }

  return { mares, stallions };
}

async function runOnePolicy(
  env: Env,
  policy: NpcPolicyRow,
  gameDay: number,
  tickSeq: number,
  config: Config,
  ceiling: NpcCeilingScheduleRow,
  breedById: Map<number, BreedRow>,
  disciplineByCode: Map<string, DisciplineRow>
): Promise<void> {
  const due = policy.last_bred_game_day === null || gameDay - policy.last_bred_game_day >= policy.breeding_interval_game_days;
  if (!due) return;

  // §4.2 steps 2-9. A stable that is due but skipped here (debt, at capacity, out of season, or
  // nothing eligible) still has its marker advanced below - §6.3's "processed regardless of
  // whether it produced any pairs", and the reason /admin/npc's "restore the balance" case (§10
  // point 5) waits for the *next* interval rather than firing on the very next tick.
  const stable = await getStableById(env, policy.stable_id);
  const cfg = config.values;
  if (stable && canTakeOnCost(stable.balance) && (await countAliveHorses(env, policy.stable_id)) < stable.capacity) {
    if (isInBreedingSeason(gameDay, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year)) {
      const target = resolveSelectionTarget(policy, config, breedById, disciplineByCode);
      if (target) {
        const horses = await listStableHorses(env, policy.stable_id);
        const { mares, stallions } = await eligibleMaresAndStallions(env, horses, config, gameDay);

        if (mares.length > 0 && stallions.length > 0) {
          // §4.2 step 7: one batched pedigree load for the whole candidate set, not one per pair.
          const pedigree = await loadPedigreeContextForMany(env, [...mares.map((h) => h.id), ...stallions.map((h) => h.id)]);
          const coiExceeded = new Set<string>();
          for (const mare of mares) {
            for (const stallion of stallions) {
              if (coefficientOfInbreeding(stallion.id, mare.id, pedigree) > cfg.coi_warn_threshold) {
                coiExceeded.add(`${String(mare.id)}:${String(stallion.id)}`);
              }
            }
          }

          const mareCandidates: BreedingCandidate[] = mares.map((h) => ({ horseId: h.id, expressed: expressedFor(h, target.kind, gameDay, config) }));
          const stallionCandidates: BreedingCandidate[] = stallions.map((h) => ({ horseId: h.id, expressed: expressedFor(h, target.kind, gameDay, config) }));

          // §8: the seed derives from the stable's own id and the cycle's game day - two ticks with
          // the same stable, same stock, same game_day produce the identical ranking.
          const seed = deriveSeed(policy.stable_id, `npc_breeding_cycle_${String(gameDay)}`);

          const result = selectBreedingPairs({
            mares: mareCandidates,
            stallions: stallionCandidates,
            target,
            ceiling: target.kind === 'conformation' ? ceiling.conformation_ceiling : ceiling.ability_ceiling,
            selectionNoiseSd: policy.selection_noise_sd,
            retentionBias: policy.retention_bias,
            maxPairs: policy.max_pairs_per_cycle,
            coiExceeded,
            seed,
          });

          for (const pair of result.pairs) {
            await bookCovering(env, { stableId: policy.stable_id, mareId: pair.mareId, stallionId: pair.stallionId, gameDay, tickSeq });
          }
        }
      }
    }
  }

  await env.DB.prepare('UPDATE npc_policy SET last_bred_game_day = ? WHERE stable_id = ?').bind(gameDay, policy.stable_id).run();
}

/** The tick's new stage (§6.1/§6.2), run immediately before resolveDueCoverings - a covering this
 * stage books resolves the same way, and on the same or a later tick, as a covering a player books
 * through the route. */
export async function runNpcBreedingDecisions(env: Env, gameDay: number, tickSeq: number, config: Config): Promise<void> {
  const policies = await listNpcPolicies(env);
  if (policies.length === 0) return;

  const [ceiling, breeds, disciplines] = await Promise.all([activeNpcCeilingRow(env, gameDay), getBreeds(env), getDisciplines(env)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineByCode = new Map(disciplines.map((d) => [d.code, d]));

  for (const policy of policies) {
    await runOnePolicy(env, policy, gameDay, tickSeq, config, ceiling, breedById, disciplineByCode);
  }
}
