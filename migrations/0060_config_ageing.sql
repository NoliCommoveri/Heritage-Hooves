-- Slice 0011 §5.3: seven new tunables. The four lifespan values are read once, at horse creation,
-- and snapshotted onto horses.natural_death_game_day (CLAUDE.md §5.5) - retuning them never moves
-- the death date of a horse already alive. The other three are live: frailty_window_game_days and
-- veteran_age_game_days are read fresh on every page view (ageState in
-- src/engines/ageing/lifespan.ts), and barn_shows_ended_game_days is read fresh by the barn list.
--
-- The starting numbers and their reasoning are slice 0011 §4.2/§4.4: risk begins around eighteen
-- game years, few horses pass twenty-seven, and the frailty window (1.5 game years) is set by the
-- same reasoning slice 0010 §2.2 used for the 30-day GBED window - long enough to span a login gap
-- and leave room for a real last show season.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.lifespan_mean_game_days', 8280,
      '$.lifespan_sd_game_days', 1260,
      '$.lifespan_min_game_days', 5040,
      '$.lifespan_max_game_days', 11880,
      '$.frailty_window_game_days', 540,
      '$.veteran_age_game_days', 6480,
      '$.barn_shows_ended_game_days', 180
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
