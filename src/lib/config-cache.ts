// Reads the single config row and caches it in module scope for 60 seconds.
//
// Worker isolates do not share memory, so clearing this cache after a write clears it in one
// isolate only - a config change can take up to a minute to appear everywhere. That is fine for
// tuning numbers and would not be fine for anything a request depends on being current; nothing
// in this slice does. The `version` column exists so a later slice can switch to checking the
// version on each request if the delay becomes annoying - do not build that now.

import type { Env } from '../types';
import { nowUtcSeconds } from './time';
import type { FeedLevelsConfig } from '../engines/care/modifier';
import type { PatternPenetrance } from '../engines/genetics/expression';

export interface ConfigValues {
  display_timezone: string;
  game_days_per_tick: number;
  game_days_per_year: number;
  max_stables_per_account: number;
  starting_stable_capacity: number;
  starting_balance: number;
  min_password_length: number;
  min_breeding_age_game_days: number;
  mare_recovery_game_days: number;
  coi_warn_threshold: number;
  /** Ticks, not game days - slice 0003 §2: a real 21-day cycle aliases badly against a 10-day tick. */
  estrous_cycle_ticks: number;
  estrus_ticks: number;
  breeding_season_start_game_day: number;
  breeding_season_length_game_days: number;
  conception_base: number;
  conception_min: number;
  conception_max: number;
  /** [age_years, factor] pairs, linearly interpolated, flat outside the ends. */
  mare_fertility_age_knots: [number, number][];
  stallion_fertility_age_knots: [number, number][];
  fertility_gene_min: number;
  fertility_gene_max: number;
  inbreeding_fertility_penalty: number;
  gestation_days_mean: number;
  gestation_days_sd: number;
  twin_double_ovulation_rate: number;
  twin_both_continue_rate: number;
  /** Slice 0005 §2.3/§4: a founding batch's shape and the age range its candidates arrive in. */
  founding_mare_candidates: number;
  founding_mare_claims: number;
  founding_stallion_candidates: number;
  founding_stallion_claims: number;
  /** The band name a fresh founding batch mints at by default - see quality_bands below. */
  founding_quality_band: string;
  /** Band name -> polygenic_one_chance (the probability any given polygenic allele is a '1'). */
  quality_bands: Record<string, number>;
  founding_age_min_game_days: number;
  founding_age_max_game_days: number;
  /** 0 means never (slice 0005 §6.2) - no tick stage sweeps offers yet; checked at claim time only. */
  founding_offer_expiry_game_days: number;
  /** Slice 0006 §4.2. Read only at birth/candidate-generation; the realised roll is then snapshotted
   * onto horses.environmental_noise, so changing this never moves a horse already alive. */
  conformation_noise_sd: number;
  /** Slice 0006 §4.3. Live - read fresh on every page view. */
  conformation_maturity_years: number;
  conformation_realization_at_birth: number;
  /** Live - see CLAUDE.md's conformation entry: changing this re-scores every already-inbred horse
   * in the game at once. */
  inbreeding_depression_factor: number;
  /** Slice 0008 §2.1/§5.8. Shows are scheduled in game days, not ticks, so the calendar survives a
   * change to how often the tick fires (CLAUDE.md §5.3). Live - changes when the *next* show is
   * created, never one already scheduled. */
  show_interval_game_days: number;
  /** How far ahead of the current game day a show is created and opens for entries. Live. */
  show_entry_window_game_days: number;
  /** Slice 0008 §4.5. Snapshotted onto show_classes at creation (CLAUDE.md §5.5). */
  show_noise_sd: number;
  /** Slice 0008 §4.4. Snapshotted onto show_classes at creation. */
  show_ideal_falloff: number;
  /** Slice 0008 §6.2. Snapshotted onto show_classes at creation - the tick tops a class's field up
   * to this many entries with show-barn horses. */
  show_target_field_size: number;
  /** Slice 0008 §5.4. Snapshotted onto show_classes at creation - the stand-in for the action
   * budget that does not exist yet. */
  show_max_entries_per_stable: number;
  /** Slice 0008 §5.4. Snapshotted onto show_classes at creation - the same number
   * min_breeding_age_game_days already uses (three game years). */
  show_conformation_min_age_game_days: number;
  /** Slice 0008 §5.8/§8.2. Live - read only when an admin stocks the NPC show barn. */
  npc_show_barn_quality_band: string;
  npc_show_barn_size: number;
  /** Slice 0009 §2.2/§4.3/§4.7. Live - read fresh by the tick's upkeep stage every time it runs. */
  upkeep_per_horse_per_game_day: number;
  /** Slice 0009 §4.4. JSON array, index 0 = first place. Snapshotted onto show_classes at creation
   * (CLAUDE.md §5.5) - changing this only affects classes created afterwards. */
  show_prize_schedule: number[];
  /** Slice 0009 Part B §5.5. Live - independent of world.tick_times_local on purpose (CLAUDE.md
   * §6a): changing the tick schedule must never silently change how much play a day contains. */
  actions_per_tick: number;
  /** Slice 0009 Part B §6.4. One number for both read and unread events - a notice board, not an
   * archive. Live - read fresh by the tick's event-retention stage every time it runs. */
  events_retention_game_days: number;
  /** Slice 0010 §5.4. Live - read fresh at the point of purchase; a price change affects the next
   * test, never re-prices a receipt already written. */
  genotype_test_cost: number;
  genotype_panel_cost: number;
  /** Slice 0010 §2.2/§5.4. Read once, at birth, and snapshotted onto horse_conditions.terminal_game_day
   * (CLAUDE.md §5.5) - retuning this never moves the death date of a foal already born. */
  lethal_foal_death_game_days: number;
  /** Slice 0011 §4.2/§5.3. Read once, at creation, and snapshotted onto horses.natural_death_game_day
   * (CLAUDE.md §5.5) - retuning any of these four never moves the death date of a horse already alive. */
  lifespan_mean_game_days: number;
  lifespan_sd_game_days: number;
  lifespan_min_game_days: number;
  lifespan_max_game_days: number;
  /** Slice 0011 §4.3/§4.4. Live - read fresh on every page view (ageState). Changing this only
   * changes who currently reads as failing and when the notice next fires; it moves no death date. */
  frailty_window_game_days: number;
  /** Slice 0011 §4.3/§4.4. Live - a plain fact about a horse's age, not a prediction. */
  veteran_age_game_days: number;
  /** Slice 0011 §8.1. Live - how long a dead or removed horse stays in the barn list before
   * dropping to /stables/:id/past only. */
  barn_shows_ended_game_days: number;
  /** Slice 0012 §6.6/§13.1. Live - how many discipline classes a show carries, alongside its
   * breed-conformation classes. Read fresh at show-creation time; disciplines.enabled and this cap
   * are the two levers for keeping seven-class shows from outrunning the action budget. */
  show_discipline_classes_per_show: number;
  /** Slice 0013 §4.2/§4.3. Live. Care timers do not run below this age - a horse's care_start_game_day
   * is born_game_day + this value, so a foal reads as "not yet" rather than overdue. */
  care_start_age_game_days: number;
  /** Slice 0013 §4.1/§4.3. Live - retuning any of these only changes the modifier computed on the
   * next read, never a horse's own stored dates. */
  farrier_interval_game_days: number;
  farrier_overdue_game_days: number;
  farrier_bonus: number;
  farrier_penalty: number;
  /** Read live, at the moment a call is made - a price change affects the next visit, never
   * re-prices a call already paid for. */
  farrier_cost: number;
  vet_wellness_interval_game_days: number;
  vet_wellness_overdue_game_days: number;
  vet_wellness_bonus: number;
  vet_wellness_penalty: number;
  vet_wellness_cost: number;
  /** Slice 0013 §2.5/§4.3. One JSON object so a level can be retuned or a fourth added without a
   * code change - see src/engines/care/modifier.ts's FeedLevelsConfig. */
  feed_levels: FeedLevelsConfig;
  /** The location flag (migrations/0074), not slice 0013. What a pastured horse's board is
   * multiplied by - 0 means a horse at grass costs nothing to keep. A multiplier rather than a
   * hardcoded skip so board can be made to cost something again from /admin/config, no deploy. */
  pasture_upkeep_multiplier: number;
  /** How long a horse coming in from pasture is "settling in" before it can be bred or shown. The
   * number that stops free pasture being free storage - see src/engines/care/location.ts. */
  pasture_settle_game_days: number;
  /** Slice 0013 §2.4. The clamp - not the components - is what guarantees the ±5% band. */
  care_modifier_min: number;
  care_modifier_max: number;
  /** Slice 0014 §4.1. Live - read fresh on every scoring run and every page view; nothing here is
   * snapshotted onto a horse. What is snapshotted is the modifier a judged entry actually scored
   * with (show_entries.age_modifier_applied). */
  age_decline_start_game_days: number;
  age_decline_floor_game_days: number;
  age_modifier_floor: number;
  /** Slice 0014 §5. The Part B management-plan tunables - a manageable-and-unmanaged condition's
   * penalty, a plan's cost, and how long a plan lasts before it must be renewed. */
  unmanaged_condition_penalty: number;
  condition_management_cost: number;
  condition_management_interval_game_days: number;
  /** Slice 0014 §2.8: the fixed draw chance for ROBUSTNESS_TRAITS in founding generation,
   * regardless of quality band - see src/engines/founding/generate.ts. */
  robustness_one_chance: number;
  /** Slice 0019 §4.1. Live - read at candidate-generation time. The ability specialist's potential
   * (out of 20) before its own +/-1 offset - high but not maxed, so the headroom stays the point
   * rather than the trait already sitting at the ceiling. */
  founding_ability_specialist_potential: number;
  /** Slice 0016 §4.2. Display only - the barn list's Foals tab. Nothing in breeding, showing, care
   * or ageing may read this; each of those already has its own age threshold. */
  foal_max_age_game_days: number;
  /** Slice 0016 §5.1/§10.2. How many judged shows /shows lists after the class-type/breed filter. */
  shows_recent_count: number;
  /** Slice 0016 §9.3/§9.4. Real seconds, not game days - a deliberate, named exception to CLAUDE.md
   * §5.3 (see the comparison site in src/lib/pin.ts's caller). */
  pin_max_attempts: number;
  pin_lockout_window_seconds: number;
  /** Slice 0016 §9.5. How long one admin-door unlock lasts, in real seconds. */
  admin_pin_grace_seconds: number;
  /** Slice 0017 §5.4. What the seller loses out of the proceeds of a completed sale, as a percent -
   * applied as Math.floor(price * pct / 100), integer arithmetic, never a float multiply. Live: a
   * rate change never re-prices a sale already written (listings.commission_paid snapshots it). */
  market_commission_percent: number;
  /** **Snapshotted** onto listings.expires_game_day at listing time (CLAUDE.md §5.5) - retuning
   * this must never move the expiry of a listing already posted. */
  market_listing_game_days: number;
  /** Live. A typo guard on the asking price, not a balance lever. */
  market_max_price: number;
  /** Live. Overview §10f's global price multiplier - the one lever that moves every guide value at
   * once, because the first pricing model will be wrong. Multiplies the appraisal only; it never
   * touches an asking price a player typed. */
  market_price_multiplier: number;
  /** Slice 0017 §4.3's appraisal coefficients. All live - read fresh every time a guide value is
   * computed, and nothing here is ever snapshotted onto a horse. What is snapshotted is the guide
   * value a listing was actually posted with (listings.guide_value). */
  market_base_value: number;
  market_quality_weight: number;
  market_foal_value_factor: number;
  /** Applied on horses.frailty_notice_game_day - the announced Failing notice - never on the rolled
   * lifespan, which the appraisal must never read in any form (slice 0017 §4.2). */
  market_failing_factor: number;
  market_clear_premium: number;
  market_clear_premium_cap: number;
  market_carrier_factor: number;
  market_affected_factor: number;
  market_win_bonus: number;
  market_place_bonus: number;
  market_record_cap: number;
  market_min_value: number;
  /** Slice 0017 §11 (Part B). Live. An NPC stable lists surplus once its free stalls drop below
   * this many; how many personality/spread/asking-price all come from npc_policy, not here (§11's
   * "a property of the personality, not a game-wide tunable"). */
  npc_market_capacity_buffer: number;
  /** Live. Caps how many horses one NPC stable lists in a single tick, so a sudden overflow (a
   * batch of foals all reaching capacity at once) doesn't dump the whole barn on the market. */
  npc_market_max_listings_per_tick: number;
  /** Amendment 0017a §4.7. Expressed colour name -> multiplier, live, read fresh every appraisal.
   * §8's risk: keep the whole range modest next to market_quality_weight (4.0), or breeding for
   * colour starts to out-compete breeding for conformation. */
  market_visible_colour_factors: Record<string, number>;
  market_carried_allele_premium: number;
  market_carried_allele_cap: number;
  /** Amendment 0017a §5.8. The consignment dealer's own tunables - all live, all guesses. No
   * consignment_age_min/max_game_days key: runConsignments reuses founding_age_min/max_game_days
   * directly rather than a second, easy-to-drift copy of the same two numbers (§5.3). */
  consignment_cadence_game_days: number;
  /** Snapshotted onto listings.expires_game_day at listing time (CLAUDE.md §5.5) - retuning this
   * must never move a standing consignment listing's expiry. */
  consignment_listing_game_days: number;
  consignment_batch_min: number;
  consignment_batch_max: number;
  /** disease-test count per consigned horse -> weight, e.g. {"0":55,"2":25,...}. */
  consignment_test_count_weights: Record<string, number>;
  consignment_price_multiplier: number;
  /** Slice 0017 §12 (Part C). Live. Both NPC-buying routes only run when an NPC stable's free
   * stalls are at least this many - the inverse of npc_market_capacity_buffer's "too full to keep
   * breeding" trigger: this one is "too empty to bother buying". */
  npc_buying_capacity_buffer: number;
  /** Live. Caps how many horses one NPC stable buys off the open market in a single tick. */
  npc_buying_max_purchases_per_tick: number;
  /** Live. The quality floor (scoreEntry/scoreAbilityEntry's own 0..100 rawScore, against the
   * buying stable's own target) an open listing must clear before runNpcMarketPurchases considers
   * it - keeps an NPC from hoovering up culls nobody else wants. */
  npc_buying_min_quality: number;
  /** Live. The quality floor named on a standing buy-offer's own criteria - shown to players so a
   * refusal on the sell-into-offer page reads as a real number, not a mystery. Deliberately a
   * separate key from npc_buying_min_quality: the two mechanisms can be tuned apart. */
  npc_buy_offer_min_quality: number;
  /** Live. The fraction of an NPC stable's current balance either buying mechanism will commit to
   * a single horse - keeps one purchase from draining a whole season's takings at once. */
  npc_buying_budget_fraction: number;
  /** Slice 0017 Part D (§13). Live. A typo guard on the stud fee field, the same job
   * market_max_price does for a sale's asking price. */
  stud_max_fee: number;
  /** Live. Only pre-fills the "offer at stud" form's season-cap field - nothing enforces it, an
   * owner can type any whole number. */
  stud_default_season_cap: number;
  /** Live. Shared by an NPC's own stud fee and the suggested-fee hint on a player's own offer form
   * (src/render/horses.ts's studCard) - one number for "what's a typical stud fee, as a fraction of
   * a horse's worth" rather than two that could drift apart. */
  npc_stud_fee_fraction: number;
  /** Live. How many bookings one NPC-listed stallion accepts per world.season_index. */
  npc_stud_season_cap: number;
  /** Slice 0021 §5.5. Locus code -> probability a present pattern allele actually shows. Read fresh
   * by every phenotype computation, never snapshotted onto a horse - a horse's apparent pattern can
   * shift if this is retuned, which is deliberate (§5.5: setting both to 1.0 disables the
   * mechanism). Only O and SW1 have entries; every other pattern/dilution locus is fully penetrant. */
  pattern_penetrance: PatternPenetrance;
}

export type ConfigFlags = Record<string, boolean>;

export interface Config {
  version: number;
  values: ConfigValues;
  flags: ConfigFlags;
}

interface CacheEntry {
  config: Config;
  expiresAtMs: number;
}

let cache: CacheEntry | null = null;
const CACHE_MS = 60_000;

interface ConfigRow {
  version: number;
  values: string;
  flags: string;
}

export async function getConfig(env: Env): Promise<Config> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.config;

  const row = await env.DB.prepare('SELECT version, "values", flags FROM config WHERE id = 1').first<ConfigRow>();
  if (!row) throw new Error('config row missing - migrations not applied?');

  const config: Config = {
    version: row.version,
    values: JSON.parse(row.values),
    flags: JSON.parse(row.flags),
  };
  cache = { config, expiresAtMs: now + CACHE_MS };
  return config;
}

export interface ConfigChanges {
  values?: Partial<ConfigValues>;
  /** Feature flags are booleans; there is no "unset" - a change is always a concrete true/false. */
  flags?: ConfigFlags;
}

export async function writeConfig(env: Env, accountId: number | null, changes: ConfigChanges): Promise<void> {
  const current = await getConfig(env);
  const nextValues: ConfigValues = { ...current.values, ...(changes.values ?? {}) };
  const nextFlags: ConfigFlags = { ...current.flags, ...(changes.flags ?? {}) };

  const worldRow = await env.DB.prepare('SELECT game_day FROM world WHERE id = 1').first<{ game_day: number }>();
  const gameDay = worldRow?.game_day ?? 0;
  const nowSeconds = nowUtcSeconds();

  const auditRows: { path: string; oldValue: string; newValue: string }[] = [];
  for (const key of Object.keys(changes.values ?? {}) as (keyof ConfigValues)[]) {
    const oldValue = current.values[key];
    const newValue = nextValues[key];
    if (oldValue !== newValue) {
      auditRows.push({ path: `values.${key}`, oldValue: JSON.stringify(oldValue), newValue: JSON.stringify(newValue) });
    }
  }
  for (const key of Object.keys(changes.flags ?? {})) {
    const oldValue = current.flags[key];
    const newValue = nextFlags[key];
    if (oldValue !== newValue) {
      auditRows.push({ path: `flags.${key}`, oldValue: JSON.stringify(oldValue ?? null), newValue: JSON.stringify(newValue) });
    }
  }

  const statements = [
    env.DB.prepare('UPDATE config SET version = version + 1, "values" = ?, flags = ?, updated_real_ts = ? WHERE id = 1').bind(
      JSON.stringify(nextValues),
      JSON.stringify(nextFlags),
      nowSeconds
    ),
    ...auditRows.map((row) =>
      env.DB
        .prepare(
          'INSERT INTO config_audit (changed_by_account_id, real_ts, game_day, path, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(accountId, nowSeconds, gameDay, row.path, row.oldValue, row.newValue)
    ),
  ];

  await env.DB.batch(statements);
  cache = null;
}
