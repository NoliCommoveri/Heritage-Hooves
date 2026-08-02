-- Live tunables for turns and the events feed (slice 0009 Part B, §5.5/§6.4). actions_per_tick and
-- the tick schedule (world.tick_times_local) are deliberately kept as two independent numbers -
-- CLAUDE.md §6a/§14: changing how often the tick fires should never silently change how much play
-- a day contains. events_retention_game_days is one number covering both read and unread events -
-- a notice board, not an archive (see the events tick stage's own comment for the reasoning).
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.actions_per_tick', 6,
      '$.events_retention_game_days', 720
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
