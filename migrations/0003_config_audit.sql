-- Append-only history of every config value ever changed, one row per key changed per save.
CREATE TABLE config_audit (
  id INTEGER PRIMARY KEY,
  changed_by_account_id INTEGER,
  real_ts INTEGER NOT NULL,
  game_day INTEGER NOT NULL,
  path TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL
);
