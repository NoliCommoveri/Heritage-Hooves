-- Permanent, survives the horse (slice 0008 §5.6) - a separate table rather than columns on
-- horses because the ageing-and-death stage (not built yet) will prune horse rows, and a show
-- record that vanished with the horse would make a future hall of fame meaningless. It is also the
-- table a later registry stage would evaluate against.
--
-- Updated incrementally (starts = starts + 1, and so on) rather than recomputed from show_entries,
-- which is NOT idempotent on its own - its safety comes entirely from the judging stage's single
-- atomic env.DB.batch() (CLAUDE.md §5.4), not from anything in this schema. Do not move the summary
-- update out of that batch.
CREATE TABLE horse_show_summary (
  horse_id INTEGER PRIMARY KEY REFERENCES horses (id),
  starts INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  -- placings: JSON object of position -> count, e.g. {"1":3,"2":1,"4":2}.
  placings TEXT NOT NULL DEFAULT '{}',
  best_placing INTEGER,
  last_shown_game_day INTEGER
);
