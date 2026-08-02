-- A business: holds horses (later), money, capacity, and a permanent breeding prefix.
-- account_id is null for NPC stables; none are created in this slice.
CREATE TABLE stables (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts (id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE COLLATE NOCASE,
  prefix_set_game_day INTEGER NOT NULL,
  prefix_locked INTEGER NOT NULL DEFAULT 0,
  is_npc INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  last_processed_tick_seq INTEGER NOT NULL DEFAULT 0,
  created_game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK ((is_npc = 1 AND account_id IS NULL) OR (is_npc = 0 AND account_id IS NOT NULL))
);

-- The stable picker's only query: list a given account's stables.
CREATE INDEX idx_stables_account_id ON stables (account_id);
