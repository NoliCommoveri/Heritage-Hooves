-- The live tunables for pregnancy, heat cycles and fertility (slice 0003 §3-§4, §6). All are live
-- tunables per CLAUDE.md §5.5, not snapshotted onto anything, because they only gate or weight a
-- future roll rather than being baked into an entity that already exists. gestation_days_mean/sd
-- and rng_seed-derived draws ARE snapshotted (onto pregnancies.gestation_days) - changing these
-- config values afterwards must never move a mare already in foal.
--
-- mare_fertility_age_knots / stallion_fertility_age_knots: JSON arrays of [age_years, factor],
-- linearly interpolated between knots, flat outside the ends (slice 0003 §4.2).
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.estrous_cycle_ticks', 4,
      '$.estrus_ticks', 1,
      '$.breeding_season_start_game_day', 30,
      '$.breeding_season_length_game_days', 180,
      '$.conception_base', 0.68,
      '$.conception_min', 0.05,
      '$.conception_max', 0.90,
      '$.mare_fertility_age_knots', json('[[3,0.85],[4,1.00],[10,1.00],[14,0.92],[17,0.75],[20,0.50],[25,0.30]]'),
      '$.stallion_fertility_age_knots', json('[[3,0.90],[4,1.00],[15,1.00],[18,0.92],[22,0.80],[28,0.60]]'),
      '$.fertility_gene_min', 0.75,
      '$.fertility_gene_max', 1.10,
      '$.inbreeding_fertility_penalty', 0.5,
      '$.gestation_days_mean', 340,
      '$.gestation_days_sd', 10,
      '$.twin_double_ovulation_rate', 0.15,
      '$.twin_both_continue_rate', 0.02
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
