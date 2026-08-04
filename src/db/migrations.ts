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
import m0022 from '../../migrations/0022_import_offers.sql';
import m0023 from '../../migrations/0023_import_candidates.sql';
import m0024 from '../../migrations/0024_seed_breed_pools.sql';
import m0025 from '../../migrations/0025_config_founding.sql';
import m0026 from '../../migrations/0026_breeds_image_count.sql';
import m0027 from '../../migrations/0027_horses_image.sql';
import m0028 from '../../migrations/0028_quantitative_traits.sql';
import m0029 from '../../migrations/0029_seed_quantitative_traits.sql';
import m0030 from '../../migrations/0030_horses_environmental_noise.sql';
import m0031 from '../../migrations/0031_config_conformation.sql';
import m0032 from '../../migrations/0032_judges.sql';
import m0033 from '../../migrations/0033_seed_judges.sql';
import m0034 from '../../migrations/0034_breeds_ideal_vector.sql';
import m0035 from '../../migrations/0035_seed_qh_ideal_vector.sql';
import m0036 from '../../migrations/0036_shows.sql';
import m0037 from '../../migrations/0037_show_classes.sql';
import m0038 from '../../migrations/0038_show_entries.sql';
import m0039 from '../../migrations/0039_horse_show_summary.sql';
import m0040 from '../../migrations/0040_npc_show_barn.sql';
import m0041 from '../../migrations/0041_config_shows.sql';
import m0042 from '../../migrations/0042_ledger.sql';
import m0043 from '../../migrations/0043_stables_upkeep.sql';
import m0044 from '../../migrations/0044_ledger_opening_backfill.sql';
import m0045 from '../../migrations/0045_show_classes_prizes.sql';
import m0046 from '../../migrations/0046_config_economy.sql';
import m0047 from '../../migrations/0047_accounts_actions.sql';
import m0048 from '../../migrations/0048_events.sql';
import m0049 from '../../migrations/0049_config_turns_events.sql';
import m0050 from '../../migrations/0050_seed_disease_loci.sql';
import m0051 from '../../migrations/0051_breed_pools_disease_loci.sql';
import m0052 from '../../migrations/0052_conditions.sql';
import m0053 from '../../migrations/0053_seed_conditions.sql';
import m0054 from '../../migrations/0054_horse_conditions.sql';
import m0055 from '../../migrations/0055_horse_knowledge.sql';
import m0056 from '../../migrations/0056_config_health.sql';
import m0057 from '../../migrations/0057_ledger_add_vet_kind.sql';
import m0058 from '../../migrations/0058_horses_ageing.sql';
import m0059 from '../../migrations/0059_breeding_cancellation.sql';
import m0060 from '../../migrations/0060_config_ageing.sql';
import m0061 from '../../migrations/0061_quantitative_traits_agility.sql';
import m0062 from '../../migrations/0062_disciplines.sql';
import m0063 from '../../migrations/0063_seed_disciplines.sql';
import m0064 from '../../migrations/0064_show_classes_discipline.sql';
import m0065 from '../../migrations/0065_show_entries_trait_snapshot.sql';
import m0066 from '../../migrations/0066_config_disciplines.sql';
import m0067 from '../../migrations/0067_horses_care.sql';
import m0068 from '../../migrations/0068_horses_care_backfill.sql';
import m0069 from '../../migrations/0069_stables_feed_level.sql';
import m0070 from '../../migrations/0070_ledger_add_farrier_kind.sql';
import m0071 from '../../migrations/0071_show_entries_care_modifier.sql';
import m0072 from '../../migrations/0072_config_care.sql';
import m0073 from '../../migrations/0073_horses_location.sql';
import m0074 from '../../migrations/0074_config_location.sql';
import m0075 from '../../migrations/0075_show_entries_age_modifier.sql';
import m0076 from '../../migrations/0076_config_age_decline.sql';
import m0077 from '../../migrations/0077_horse_conditions_management.sql';
import m0078 from '../../migrations/0078_conditions_management_text.sql';
import m0079 from '../../migrations/0079_seed_condition_management_text.sql';
import m0080 from '../../migrations/0080_config_condition_management.sql';
import m0081 from '../../migrations/0081_quantitative_traits_robustness.sql';
import m0082 from '../../migrations/0082_config_robustness.sql';
import m0083 from '../../migrations/0083_npc_policy.sql';
import m0084 from '../../migrations/0084_npc_ceiling_schedule.sql';
import m0085 from '../../migrations/0085_npc_stables_and_policies.sql';
import m0086 from '../../migrations/0086_npc_stables_no_upkeep.sql';
import m0087 from '../../migrations/0087_accounts_pin_hash.sql';
import m0088 from '../../migrations/0088_pin_attempts.sql';
import m0089 from '../../migrations/0089_config_admin_and_ui.sql';
import m0090 from '../../migrations/0090_listings.sql';
import m0091 from '../../migrations/0091_ledger_add_market_kinds.sql';
import m0092 from '../../migrations/0092_config_market.sql';
import m0093 from '../../migrations/0093_npc_policy_market_columns.sql';
import m0094 from '../../migrations/0094_config_npc_market.sql';
import m0095 from '../../migrations/0095_config_market_colour.sql';
import m0096 from '../../migrations/0096_consignment_injections.sql';
import m0097 from '../../migrations/0097_consignment_dealer_stable.sql';
import m0098 from '../../migrations/0098_config_consignment.sql';
import m0099 from '../../migrations/0099_buy_offers.sql';
import m0100 from '../../migrations/0100_config_npc_buying.sql';
import m0101 from '../../migrations/0101_config_founding_specialists.sql';
import m0102 from '../../migrations/0102_consignment_injection_eligible_from.sql';
import m0103 from '../../migrations/0103_stud_listings.sql';
import m0104 from '../../migrations/0104_stud_bookings.sql';
import m0105 from '../../migrations/0105_ledger_add_stud_kinds.sql';
import m0106 from '../../migrations/0106_config_stud.sql';

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
  { name: '0022_import_offers.sql', sql: m0022 },
  { name: '0023_import_candidates.sql', sql: m0023 },
  { name: '0024_seed_breed_pools.sql', sql: m0024 },
  { name: '0025_config_founding.sql', sql: m0025 },
  { name: '0026_breeds_image_count.sql', sql: m0026 },
  { name: '0027_horses_image.sql', sql: m0027 },
  { name: '0028_quantitative_traits.sql', sql: m0028 },
  { name: '0029_seed_quantitative_traits.sql', sql: m0029 },
  { name: '0030_horses_environmental_noise.sql', sql: m0030 },
  { name: '0031_config_conformation.sql', sql: m0031 },
  { name: '0032_judges.sql', sql: m0032 },
  { name: '0033_seed_judges.sql', sql: m0033 },
  { name: '0034_breeds_ideal_vector.sql', sql: m0034 },
  { name: '0035_seed_qh_ideal_vector.sql', sql: m0035 },
  { name: '0036_shows.sql', sql: m0036 },
  { name: '0037_show_classes.sql', sql: m0037 },
  { name: '0038_show_entries.sql', sql: m0038 },
  { name: '0039_horse_show_summary.sql', sql: m0039 },
  { name: '0040_npc_show_barn.sql', sql: m0040 },
  { name: '0041_config_shows.sql', sql: m0041 },
  { name: '0042_ledger.sql', sql: m0042 },
  { name: '0043_stables_upkeep.sql', sql: m0043 },
  { name: '0044_ledger_opening_backfill.sql', sql: m0044 },
  { name: '0045_show_classes_prizes.sql', sql: m0045 },
  { name: '0046_config_economy.sql', sql: m0046 },
  { name: '0047_accounts_actions.sql', sql: m0047 },
  { name: '0048_events.sql', sql: m0048 },
  { name: '0049_config_turns_events.sql', sql: m0049 },
  { name: '0050_seed_disease_loci.sql', sql: m0050 },
  { name: '0051_breed_pools_disease_loci.sql', sql: m0051 },
  { name: '0052_conditions.sql', sql: m0052 },
  { name: '0053_seed_conditions.sql', sql: m0053 },
  { name: '0054_horse_conditions.sql', sql: m0054 },
  { name: '0055_horse_knowledge.sql', sql: m0055 },
  { name: '0056_config_health.sql', sql: m0056 },
  { name: '0057_ledger_add_vet_kind.sql', sql: m0057 },
  { name: '0058_horses_ageing.sql', sql: m0058 },
  { name: '0059_breeding_cancellation.sql', sql: m0059 },
  { name: '0060_config_ageing.sql', sql: m0060 },
  { name: '0061_quantitative_traits_agility.sql', sql: m0061 },
  { name: '0062_disciplines.sql', sql: m0062 },
  { name: '0063_seed_disciplines.sql', sql: m0063 },
  { name: '0064_show_classes_discipline.sql', sql: m0064 },
  { name: '0065_show_entries_trait_snapshot.sql', sql: m0065 },
  { name: '0066_config_disciplines.sql', sql: m0066 },
  { name: '0067_horses_care.sql', sql: m0067 },
  { name: '0068_horses_care_backfill.sql', sql: m0068 },
  { name: '0069_stables_feed_level.sql', sql: m0069 },
  { name: '0070_ledger_add_farrier_kind.sql', sql: m0070 },
  { name: '0071_show_entries_care_modifier.sql', sql: m0071 },
  { name: '0072_config_care.sql', sql: m0072 },
  { name: '0073_horses_location.sql', sql: m0073 },
  { name: '0074_config_location.sql', sql: m0074 },
  { name: '0075_show_entries_age_modifier.sql', sql: m0075 },
  { name: '0076_config_age_decline.sql', sql: m0076 },
  { name: '0077_horse_conditions_management.sql', sql: m0077 },
  { name: '0078_conditions_management_text.sql', sql: m0078 },
  { name: '0079_seed_condition_management_text.sql', sql: m0079 },
  { name: '0080_config_condition_management.sql', sql: m0080 },
  { name: '0081_quantitative_traits_robustness.sql', sql: m0081 },
  { name: '0082_config_robustness.sql', sql: m0082 },
  { name: '0083_npc_policy.sql', sql: m0083 },
  { name: '0084_npc_ceiling_schedule.sql', sql: m0084 },
  { name: '0085_npc_stables_and_policies.sql', sql: m0085 },
  { name: '0086_npc_stables_no_upkeep.sql', sql: m0086 },
  { name: '0087_accounts_pin_hash.sql', sql: m0087 },
  { name: '0088_pin_attempts.sql', sql: m0088 },
  { name: '0089_config_admin_and_ui.sql', sql: m0089 },
  { name: '0090_listings.sql', sql: m0090 },
  { name: '0091_ledger_add_market_kinds.sql', sql: m0091 },
  { name: '0092_config_market.sql', sql: m0092 },
  { name: '0093_npc_policy_market_columns.sql', sql: m0093 },
  { name: '0094_config_npc_market.sql', sql: m0094 },
  { name: '0095_config_market_colour.sql', sql: m0095 },
  { name: '0096_consignment_injections.sql', sql: m0096 },
  { name: '0097_consignment_dealer_stable.sql', sql: m0097 },
  { name: '0098_config_consignment.sql', sql: m0098 },
  { name: '0099_buy_offers.sql', sql: m0099 },
  { name: '0100_config_npc_buying.sql', sql: m0100 },
  { name: '0101_config_founding_specialists.sql', sql: m0101 },
  { name: '0102_consignment_injection_eligible_from.sql', sql: m0102 },
  { name: '0103_stud_listings.sql', sql: m0103 },
  { name: '0104_stud_bookings.sql', sql: m0104 },
  { name: '0105_ledger_add_stud_kinds.sql', sql: m0105 },
  { name: '0106_config_stud.sql', sql: m0106 },
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
