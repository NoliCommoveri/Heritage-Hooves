-- Widens ledger.kind's CHECK constraint to include 'farrier' (slice 0013 §5.4) - a farrier call or
-- round is its own kind; wellness visits and Part B's (not built this session) management plans
-- ride on the existing 'vet' kind, and feed rides on the existing 'upkeep' kind, since it changes
-- the amount of an existing charge rather than creating a second one. SQLite cannot ALTER a CHECK
-- constraint, so this is the same table-rebuild shape as migrations/0057_ledger_add_vet_kind.sql -
-- copy every row, drop the old table, rename, recreate the index. Safe for the same reason that
-- migration gives: nothing has a foreign key pointing into ledger.
CREATE TABLE ledger_new (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment', 'vet', 'farrier')),
  reference_type TEXT,
  reference_id INTEGER,
  description TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL,
  counterparty_stable_id INTEGER REFERENCES stables (id),
  same_account INTEGER NOT NULL DEFAULT 0
);

INSERT INTO ledger_new (id, stable_id, amount, kind, reference_type, reference_id, description, game_day, created_real_ts, counterparty_stable_id, same_account)
SELECT id, stable_id, amount, kind, reference_type, reference_id, description, game_day, created_real_ts, counterparty_stable_id, same_account
FROM ledger;

DROP TABLE ledger;

ALTER TABLE ledger_new RENAME TO ledger;

CREATE INDEX idx_ledger_stable_id ON ledger (stable_id, id DESC);
