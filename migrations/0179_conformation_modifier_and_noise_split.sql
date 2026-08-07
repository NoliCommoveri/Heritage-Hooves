-- Slice 0028 §2.3/§4 rule 6, migration 3 of 8: the demoted +/-1.0 modifier step, the tightened
-- conformation noise SD, ability's own (unchanged) noise SD split off so dropping the conformation
-- number doesn't silently tighten every discipline class's noise too, and the conformation panel's
-- price.
--
-- conformation_noise_sd moves from 6 (its value since migration 0031) to 0.5 - CONFORMATION traits
-- only, from here on; ability_noise_sd is a new key holding the 6 conformation_noise_sd used to
-- mean for everyone, so abilityValues' existing behaviour is completely unchanged by this migration.
-- conformation_test_cost is a first guess, priced low on purpose (§3.4/§3.5/§9 point 2: "the market
-- pays +2 generations if a child tests").
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.conformation_modifier_step', 0.10,
      '$.conformation_noise_sd', 0.5,
      '$.ability_noise_sd', 6,
      '$.conformation_test_cost', 150
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
