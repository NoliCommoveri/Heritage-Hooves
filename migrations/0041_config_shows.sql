-- Live tunables for the show circuit (slice 0008 §5.8). show_interval_game_days/show_entry_window_game_days
-- and the barn tunables are live - read fresh whenever the tick creates a show or an admin stocks
-- the barn. The other five are read only at class-creation time and then copied onto the
-- show_classes row (CLAUDE.md §5.5) - changing them here only affects classes created afterwards,
-- never one already scheduled or judged.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.show_interval_game_days', 30,
      '$.show_entry_window_game_days', 30,
      '$.show_noise_sd', 5,
      '$.show_ideal_falloff', 2.0,
      '$.show_target_field_size', 8,
      '$.show_max_entries_per_stable', 3,
      '$.show_conformation_min_age_game_days', 1080,
      '$.npc_show_barn_quality_band', 'mid',
      '$.npc_show_barn_size', 6
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
