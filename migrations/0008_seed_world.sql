-- Create the single world row. The clock starts at day 0, unpaused, with three tick slots a day.
INSERT INTO world (id, game_day, paused, tick_seq, season_index, tick_times_local, tick_timezone, started_real_ts)
VALUES (1, 0, 0, 0, 0, '["07:00","12:00","19:00"]', 'America/Chicago', unixepoch());
