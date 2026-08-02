-- The registry of every prefix ever claimed by anybody, current or retired. The unique index on
-- prefix (not on stable_id) is what stops a retired prefix from ever being reissued: once a stable
-- renames, its old prefix disappears from `stables` but this table still remembers it was taken.
CREATE TABLE stable_prefix_history (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  prefix TEXT NOT NULL UNIQUE COLLATE NOCASE,
  from_game_day INTEGER NOT NULL,
  to_game_day INTEGER,
  claimed_by_account_id INTEGER,
  created_real_ts INTEGER NOT NULL
);

CREATE INDEX idx_stable_prefix_history_stable_id ON stable_prefix_history (stable_id);
