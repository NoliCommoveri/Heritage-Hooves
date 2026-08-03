-- Live tunables for care (slice 0013 §4.3). All of them affect future computation only, so nothing
-- is snapshotted onto a horse - only the show entry's own care_modifier_applied is (previous
-- migration). feed_levels is one JSON object so a level can be retuned or a fourth added without a
-- code change: { "v": 1, "levels": { "<key>": { "name", "upkeep_multiplier", "care_delta" } } }.
-- care_notice_enabled lives in config.flags, not values, alongside force_next_twins - the existing
-- home for a plain on/off switch in this codebase.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.care_start_age_game_days', 1080,
      '$.farrier_interval_game_days', 45,
      '$.farrier_overdue_game_days', 135,
      '$.farrier_bonus', 0.01,
      '$.farrier_penalty', 0.03,
      '$.farrier_cost', 30,
      '$.vet_wellness_interval_game_days', 180,
      '$.vet_wellness_overdue_game_days', 540,
      '$.vet_wellness_bonus', 0.01,
      '$.vet_wellness_penalty', 0.02,
      '$.vet_wellness_cost', 90,
      '$.feed_levels', json('{"v":1,"levels":{"poor":{"name":"Poor","upkeep_multiplier":0.6,"care_delta":-0.02},"standard":{"name":"Standard","upkeep_multiplier":1.0,"care_delta":0.0},"premium":{"name":"Premium","upkeep_multiplier":2.0,"care_delta":0.02}}}'),
      '$.care_modifier_min', 0.95,
      '$.care_modifier_max', 1.05
    ),
    flags = json_set(flags, '$.care_notice_enabled', json('true')),
    updated_real_ts = unixepoch()
WHERE id = 1;
