-- Live tunables for founding-stock batches (slice 0005 §2.3-§2.4, §4). Everything the generator
-- reads from these is snapshotted onto the offer at mint time (see import_offers) - changing these
-- afterwards must never alter a batch a child has not opened yet.
--
-- quality_bands: JSON, band name -> polygenic_one_chance (the probability any given polygenic
-- allele is a '1'). founding_quality_band names which band founding batches use by default.
-- Neither is numeric, so both are edited from D1's console rather than /admin/config's numeric
-- form (slice 0005 §10.1) - the admin founding-grant screen lets an admin pick a band per grant.
--
-- Numbers here follow slice 0005 exactly: three free horses per batch (two mares, one stallion)
-- chosen from six candidates (four mares, two stallions); four-to-eight game years old so founding
-- stock is breeding age on arrival; no expiry by default.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.founding_mare_candidates', 4,
      '$.founding_mare_claims', 2,
      '$.founding_stallion_candidates', 2,
      '$.founding_stallion_claims', 1,
      '$.founding_quality_band', 'mid',
      '$.quality_bands', json('{"low":0.42,"mid":0.50,"high":0.58}'),
      '$.founding_age_min_game_days', 1440,
      '$.founding_age_max_game_days', 2880,
      '$.founding_offer_expiry_game_days', 0
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
