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
import m0107 from '../../migrations/0107_seed_breed_ideal_vectors.sql';
import m0108 from '../../migrations/0108_seed_disciplines_remaining.sql';
import m0109 from '../../migrations/0109_config_remove_consignment_breed_codes.sql';
import m0110 from '../../migrations/0110_quantitative_traits_head_profile.sql';
import m0111 from '../../migrations/0111_breeds_head_profile_ideal.sql';
import m0112 from '../../migrations/0112_judges_head_profile_weights.sql';
import m0113 from '../../migrations/0113_seed_colour_pattern_loci.sql';
import m0114 from '../../migrations/0114_breed_pools_colour_pattern_loci.sql';
import m0115 from '../../migrations/0115_config_pattern_penetrance.sql';
import m0116 from '../../migrations/0116_config_colour_patterns_market.sql';
import m0117 from '../../migrations/0117_condition_lethal_white.sql';
import m0118 from '../../migrations/0118_config_consignment_horses_per_breed.sql';
import m0122 from '../../migrations/0122_horse_conditions_acquired.sql';
import m0123 from '../../migrations/0123_horses_incident_check.sql';
import m0124 from '../../migrations/0124_config_acquired_conditions.sql';
import m0125 from '../../migrations/0125_seed_acquired_conditions.sql';
import m0126 from '../../migrations/0126_npc_policy_balance_floor.sql';
import m0127 from '../../migrations/0127_config_npc_finance.sql';
import m0128 from '../../migrations/0128_ledger_add_pet_home_kind.sql';
import m0129 from '../../migrations/0129_incident_types.sql';
import m0130 from '../../migrations/0130_seed_incident_types.sql';
import m0131 from '../../migrations/0131_horse_incidents.sql';
import m0132 from '../../migrations/0132_backfill_horse_incidents.sql';
import m0133 from '../../migrations/0133_delete_acquired_from_conditions.sql';
import m0134 from '../../migrations/0134_config_incident_history.sql';
import m0135 from '../../migrations/0135_config_conformation_labels.sql';
import m0136 from '../../migrations/0136_rename_qh_npc_stables.sql';
import m0137 from '../../migrations/0137_npc_stables_paso_fino_and_german_warmblood.sql';
import m0138 from '../../migrations/0138_breed_image_labels.sql';
import m0139 from '../../migrations/0139_judges_kind_and_ability_weights.sql';
import m0140 from '../../migrations/0140_seed_discipline_judges.sql';
import m0141 from '../../migrations/0141_breeds_ability_bias.sql';
import m0142 from '../../migrations/0142_seed_breed_ability_bias.sql';
import m0143 from '../../migrations/0143_breeds_discipline_aptitudes.sql';
import m0144 from '../../migrations/0144_seed_breed_discipline_aptitudes.sql';
import m0145 from '../../migrations/0145_seed_breed_disease_loci.sql';
import m0146 from '../../migrations/0146_breed_pools_disease_loci.sql';
import m0147 from '../../migrations/0147_seed_breed_conditions.sql';
import m0148 from '../../migrations/0148_conditions_signs_delay.sql';
import m0149 from '../../migrations/0149_seed_signs_delays.sql';
import m0150 from '../../migrations/0150_horse_conditions_signs.sql';
import m0151 from '../../migrations/0151_horse_conditions_drop_incident_columns.sql';
import m0152 from '../../migrations/0152_pssm1_breed_associations.sql';
import m0153 from '../../migrations/0153_accounts_difficulty.sql';
import m0154 from '../../migrations/0154_config_difficulty.sql';
import m0155 from '../../migrations/0155_horse_evaluations.sql';
import m0156 from '../../migrations/0156_config_evaluation.sql';
import m0157 from '../../migrations/0157_ledger_add_evaluation_kind.sql';
import m0158 from '../../migrations/0158_config_foal_upkeep.sql';
import m0159 from '../../migrations/0159_config_time_warp.sql';
import m0160 from '../../migrations/0160_ledger_add_time_warp_kind.sql';
import m0161 from '../../migrations/0161_show_classes_young_and_ability.sql';
import m0162 from '../../migrations/0162_horse_ability_words.sql';
import m0163 from '../../migrations/0163_config_young_horse_classes.sql';
import m0164 from '../../migrations/0164_barn_hides_ended_horses.sql';
import m0165 from '../../migrations/0165_show_classes_rank_and_key.sql';
import m0166 from '../../migrations/0166_horse_class_ranks.sql';
import m0167 from '../../migrations/0167_config_show_progression.sql';
import m0168 from '../../migrations/0168_npc_stable_gw_dressage.sql';
import m0169 from '../../migrations/0169_horses_gelded_game_day.sql';
import m0170 from '../../migrations/0170_config_gelding.sql';
import m0171 from '../../migrations/0171_ledger_add_gelding_kind.sql';
import m0172 from '../../migrations/0172_show_barn_split.sql';
import m0173 from '../../migrations/0173_config_show_barn_plan.sql';
import m0174 from '../../migrations/0174_accounts_paused.sql';
import m0175 from '../../migrations/0175_show_classes_allow_parallel.sql';
import m0176 from '../../migrations/0176_show_barn_novice_low_band.sql';
import m0177 from '../../migrations/0177_breeds_ideal_vector_ladder_snap.sql';
import m0178 from '../../migrations/0178_quality_bands_pair_specs.sql';
import m0179 from '../../migrations/0179_conformation_modifier_and_noise_split.sql';
import m0180 from '../../migrations/0180_conformation_label_edges.sql';
import m0181 from '../../migrations/0181_founding_and_consignment_quality_bands.sql';
import m0182 from '../../migrations/0182_import_offers_ability_one_chance.sql';
import m0183 from '../../migrations/0183_prenatal_care.sql';
import m0184 from '../../migrations/0184_npc_prenatal_care_and_tested_share.sql';
import m0185 from '../../migrations/0185_ledger_add_prenatal_care_kind.sql';
import m0186 from '../../migrations/0186_seed_type_gene_loci.sql';

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
  { name: '0107_seed_breed_ideal_vectors.sql', sql: m0107 },
  { name: '0108_seed_disciplines_remaining.sql', sql: m0108 },
  { name: '0109_config_remove_consignment_breed_codes.sql', sql: m0109 },
  { name: '0110_quantitative_traits_head_profile.sql', sql: m0110 },
  { name: '0111_breeds_head_profile_ideal.sql', sql: m0111 },
  { name: '0112_judges_head_profile_weights.sql', sql: m0112 },
  { name: '0113_seed_colour_pattern_loci.sql', sql: m0113 },
  { name: '0114_breed_pools_colour_pattern_loci.sql', sql: m0114 },
  { name: '0115_config_pattern_penetrance.sql', sql: m0115 },
  { name: '0116_config_colour_patterns_market.sql', sql: m0116 },
  { name: '0117_condition_lethal_white.sql', sql: m0117 },
  { name: '0118_config_consignment_horses_per_breed.sql', sql: m0118 },
  { name: '0122_horse_conditions_acquired.sql', sql: m0122 },
  { name: '0123_horses_incident_check.sql', sql: m0123 },
  { name: '0124_config_acquired_conditions.sql', sql: m0124 },
  { name: '0125_seed_acquired_conditions.sql', sql: m0125 },
  { name: '0126_npc_policy_balance_floor.sql', sql: m0126 },
  { name: '0127_config_npc_finance.sql', sql: m0127 },
  { name: '0128_ledger_add_pet_home_kind.sql', sql: m0128 },
  { name: '0129_incident_types.sql', sql: m0129 },
  { name: '0130_seed_incident_types.sql', sql: m0130 },
  { name: '0131_horse_incidents.sql', sql: m0131 },
  { name: '0132_backfill_horse_incidents.sql', sql: m0132 },
  { name: '0133_delete_acquired_from_conditions.sql', sql: m0133 },
  { name: '0134_config_incident_history.sql', sql: m0134 },
  { name: '0135_config_conformation_labels.sql', sql: m0135 },
  { name: '0136_rename_qh_npc_stables.sql', sql: m0136 },
  { name: '0137_npc_stables_paso_fino_and_german_warmblood.sql', sql: m0137 },
  { name: '0138_breed_image_labels.sql', sql: m0138 },
  { name: '0139_judges_kind_and_ability_weights.sql', sql: m0139 },
  { name: '0140_seed_discipline_judges.sql', sql: m0140 },
  { name: '0141_breeds_ability_bias.sql', sql: m0141 },
  { name: '0142_seed_breed_ability_bias.sql', sql: m0142 },
  { name: '0143_breeds_discipline_aptitudes.sql', sql: m0143 },
  { name: '0144_seed_breed_discipline_aptitudes.sql', sql: m0144 },
  { name: '0145_seed_breed_disease_loci.sql', sql: m0145 },
  { name: '0146_breed_pools_disease_loci.sql', sql: m0146 },
  { name: '0147_seed_breed_conditions.sql', sql: m0147 },
  { name: '0148_conditions_signs_delay.sql', sql: m0148 },
  { name: '0149_seed_signs_delays.sql', sql: m0149 },
  { name: '0150_horse_conditions_signs.sql', sql: m0150 },
  { name: '0151_horse_conditions_drop_incident_columns.sql', sql: m0151 },
  { name: '0152_pssm1_breed_associations.sql', sql: m0152 },
  { name: '0153_accounts_difficulty.sql', sql: m0153 },
  { name: '0154_config_difficulty.sql', sql: m0154 },
  { name: '0155_horse_evaluations.sql', sql: m0155 },
  { name: '0156_config_evaluation.sql', sql: m0156 },
  { name: '0157_ledger_add_evaluation_kind.sql', sql: m0157 },
  { name: '0158_config_foal_upkeep.sql', sql: m0158 },
  { name: '0159_config_time_warp.sql', sql: m0159 },
  { name: '0160_ledger_add_time_warp_kind.sql', sql: m0160 },
  { name: '0161_show_classes_young_and_ability.sql', sql: m0161 },
  { name: '0162_horse_ability_words.sql', sql: m0162 },
  { name: '0163_config_young_horse_classes.sql', sql: m0163 },
  { name: '0164_barn_hides_ended_horses.sql', sql: m0164 },
  { name: '0165_show_classes_rank_and_key.sql', sql: m0165 },
  { name: '0166_horse_class_ranks.sql', sql: m0166 },
  { name: '0167_config_show_progression.sql', sql: m0167 },
  { name: '0168_npc_stable_gw_dressage.sql', sql: m0168 },
  { name: '0169_horses_gelded_game_day.sql', sql: m0169 },
  { name: '0170_config_gelding.sql', sql: m0170 },
  { name: '0171_ledger_add_gelding_kind.sql', sql: m0171 },
  { name: '0172_show_barn_split.sql', sql: m0172 },
  { name: '0173_config_show_barn_plan.sql', sql: m0173 },
  { name: '0174_accounts_paused.sql', sql: m0174 },
  { name: '0175_show_classes_allow_parallel.sql', sql: m0175 },
  { name: '0176_show_barn_novice_low_band.sql', sql: m0176 },
  { name: '0177_breeds_ideal_vector_ladder_snap.sql', sql: m0177 },
  { name: '0178_quality_bands_pair_specs.sql', sql: m0178 },
  { name: '0179_conformation_modifier_and_noise_split.sql', sql: m0179 },
  { name: '0180_conformation_label_edges.sql', sql: m0180 },
  { name: '0181_founding_and_consignment_quality_bands.sql', sql: m0181 },
  { name: '0182_import_offers_ability_one_chance.sql', sql: m0182 },
  { name: '0183_prenatal_care.sql', sql: m0183 },
  { name: '0184_npc_prenatal_care_and_tested_share.sql', sql: m0184 },
  { name: '0185_ledger_add_prenatal_care_kind.sql', sql: m0185 },
  { name: '0186_seed_type_gene_loci.sql', sql: m0186 },
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
