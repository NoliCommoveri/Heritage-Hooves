// Reads the single config row and caches it in module scope for 60 seconds.
//
// Worker isolates do not share memory, so clearing this cache after a write clears it in one
// isolate only - a config change can take up to a minute to appear everywhere. That is fine for
// tuning numbers and would not be fine for anything a request depends on being current; nothing
// in this slice does. The `version` column exists so a later slice can switch to checking the
// version on each request if the delay becomes annoying - do not build that now.

import type { Env } from '../types';
import { nowUtcSeconds } from './time';

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
