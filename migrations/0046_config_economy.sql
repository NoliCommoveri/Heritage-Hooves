-- Live tunables for the money side of the economy (slice 0009 §4.7, Part A - money moves. Part B's
-- turn/event tunables land in a later migration). Both deliberately gentle: prize money from one
-- show a real day is the only income in the game until the market stage lands. See CLAUDE.md's
-- dated entry on this slice for the arithmetic behind these numbers.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.upkeep_per_horse_per_game_day', 2,
      '$.show_prize_schedule', json('[600, 350, 200, 120, 80, 50]')
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
