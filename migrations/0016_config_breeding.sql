-- Adds this slice's live tunables to the single config row. min_breeding_age_game_days and
-- mare_recovery_game_days are live tunables, not snapshotted onto anything, because they only
-- gate future breeding attempts rather than being baked into an entity that already exists.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.min_breeding_age_game_days', 1080,
      '$.mare_recovery_game_days', 30,
      '$.coi_warn_threshold', 0.125
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
