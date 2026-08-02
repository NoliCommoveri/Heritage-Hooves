-- Live tunables for conformation display (slice 0006 §5.3). conformation_noise_sd is read only at
-- the moment a horse is born or a founding candidate is generated, and the realised roll is
-- snapshotted onto horses.environmental_noise (§2.4) - changing it here only affects horses born
-- afterwards. The other three are read fresh on every page view: raising or lowering
-- inbreeding_depression_factor re-scores every already-inbred horse in the game at once, which is
-- intended but worth tuning early and then leaving alone (§2.4 - see the warning on /admin/config).
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.conformation_noise_sd', 6,
      '$.conformation_maturity_years', 5,
      '$.conformation_realization_at_birth', 0.55,
      '$.inbreeding_depression_factor', 1.0
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
