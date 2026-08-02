-- One row per tick that actually ran, for diagnosing whether ticks fire at the right local time.
-- Invocations that find no slot due write no row at all.
CREATE TABLE tick_run (
  id INTEGER PRIMARY KEY,
  tick_seq INTEGER NOT NULL,
  stage TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  intended_local_time TEXT,
  fired_local_time TEXT NOT NULL,
  local_date TEXT NOT NULL,
  started_real_ts INTEGER,
  completed_real_ts INTEGER,
  game_day_before INTEGER NOT NULL,
  game_day_after INTEGER,
  rows_touched INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_text TEXT
);

-- The admin page lists recent runs newest first.
CREATE INDEX idx_tick_run_tick_seq ON tick_run (tick_seq DESC);
