import type { Env } from '../types';
import { splitSqlStatements } from '../lib/sql';

import m0001 from '../../migrations/0001_world.sql';
import m0002 from '../../migrations/0002_config.sql';
import m0003 from '../../migrations/0003_config_audit.sql';
import m0004 from '../../migrations/0004_tick_run.sql';
import m0005 from '../../migrations/0005_accounts.sql';
import m0006 from '../../migrations/0006_stables.sql';
import m0007 from '../../migrations/0007_stable_prefix_history.sql';
import m0008 from '../../migrations/0008_seed_world.sql';
import m0009 from '../../migrations/0009_seed_config.sql';
import m0010 from '../../migrations/0010_breeds.sql';
import m0011 from '../../migrations/0011_loci.sql';
import m0012 from '../../migrations/0012_horses.sql';
import m0013 from '../../migrations/0013_horse_ancestors.sql';
import m0014 from '../../migrations/0014_seed_breeds.sql';
import m0015 from '../../migrations/0015_seed_loci.sql';
import m0016 from '../../migrations/0016_config_breeding.sql';
import m0017 from '../../migrations/0017_horses_cycle_anchor.sql';
import m0018 from '../../migrations/0018_coverings.sql';
import m0019 from '../../migrations/0019_pregnancies.sql';
import m0020 from '../../migrations/0020_config_fertility.sql';
import m0021 from '../../migrations/0021_backfill_cycle_anchor.sql';

export interface MigrationFile {
  name: string;
  sql: string;
}

/**
 * Every migration file, bundled into the Worker as text (see wrangler.toml's [[rules]] entry) so
 * /admin/migrations can apply them from a button click instead of a terminal. When a new file is
 * added to /migrations, add a matching import and entry here too, in order - this list is what
 * the admin page sees, not the directory itself.
 *
 * The tracking table name (d1_migrations) and the `name` values (bare filename) exactly match
 * what `wrangler d1 migrations apply` uses on its own, so this path and the CLI path share one
 * history and never redo each other's work - use whichever is available.
 */
export const MIGRATIONS: MigrationFile[] = [
  { name: '0001_world.sql', sql: m0001 },
  { name: '0002_config.sql', sql: m0002 },
  { name: '0003_config_audit.sql', sql: m0003 },
  { name: '0004_tick_run.sql', sql: m0004 },
  { name: '0005_accounts.sql', sql: m0005 },
  { name: '0006_stables.sql', sql: m0006 },
  { name: '0007_stable_prefix_history.sql', sql: m0007 },
  { name: '0008_seed_world.sql', sql: m0008 },
  { name: '0009_seed_config.sql', sql: m0009 },
  { name: '0010_breeds.sql', sql: m0010 },
  { name: '0011_loci.sql', sql: m0011 },
  { name: '0012_horses.sql', sql: m0012 },
  { name: '0013_horse_ancestors.sql', sql: m0013 },
  { name: '0014_seed_breeds.sql', sql: m0014 },
  { name: '0015_seed_loci.sql', sql: m0015 },
  { name: '0016_config_breeding.sql', sql: m0016 },
  { name: '0017_horses_cycle_anchor.sql', sql: m0017 },
  { name: '0018_coverings.sql', sql: m0018 },
  { name: '0019_pregnancies.sql', sql: m0019 },
  { name: '0020_config_fertility.sql', sql: m0020 },
  { name: '0021_backfill_cycle_anchor.sql', sql: m0021 },
];

const MIGRATIONS_TABLE = 'd1_migrations';

async function ensureMigrationsTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}(
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT UNIQUE,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
     )`
  ).run();
}

export async function getAppliedMigrationNames(env: Env): Promise<Set<string>> {
  await ensureMigrationsTable(env);
  const result = await env.DB.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all<{ name: string }>();
  return new Set((result.results ?? []).map((r) => r.name));
}

export interface MigrationStatus {
  name: string;
  applied: boolean;
}

export async function listMigrationStatus(env: Env): Promise<MigrationStatus[]> {
  const applied = await getAppliedMigrationNames(env);
  return MIGRATIONS.map((m) => ({ name: m.name, applied: applied.has(m.name) }));
}

export interface ApplyResult {
  applied: string[];
  failed?: { name: string; error: string };
}

/**
 * Applies every migration not yet recorded in d1_migrations, in order, stopping at the first
 * failure. Each migration's own statements plus its tracking-row insert run in a single D1 batch
 * (an implicit transaction, same pattern as createStableWithPrefix), so a given migration either
 * lands completely or not at all - but batches are not chained together, so if migration 3 of 5
 * fails, 1 and 2 stay applied. That's intentional: it matches what re-running the CLI migration
 * command would do, and the status table always shows exactly where things stand.
 */
export async function applyPendingMigrations(env: Env): Promise<ApplyResult> {
  const applied = await getAppliedMigrationNames(env);
  const appliedNow: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    const statements = splitSqlStatements(migration.sql).map((s) => env.DB.prepare(s));
    statements.push(env.DB.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`).bind(migration.name));

    try {
      await env.DB.batch(statements);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { applied: appliedNow, failed: { name: migration.name, error: message } };
    }
    appliedNow.push(migration.name);
  }

  return { applied: appliedNow };
}
