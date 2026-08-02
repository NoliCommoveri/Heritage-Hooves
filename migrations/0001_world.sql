-- The single row holding the game clock: the day, whether it's paused, and the tick schedule.
CREATE TABLE world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  game_day INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  tick_seq INTEGER NOT NULL DEFAULT 0,
  season_index INTEGER NOT NULL DEFAULT 0,
  -- tick_times_local: JSON array of "HH:MM" strings in tick_timezone, e.g. ["07:00","12:00","19:00"].
  -- Keep these out of 02:00-03:00 local time; that hour does not exist on the spring-forward morning.
  tick_times_local TEXT NOT NULL,
  tick_timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  last_tick_local_date TEXT,
  last_tick_slot_local TEXT,
  last_tick_real_ts INTEGER,
  started_real_ts INTEGER NOT NULL
);
