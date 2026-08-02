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
