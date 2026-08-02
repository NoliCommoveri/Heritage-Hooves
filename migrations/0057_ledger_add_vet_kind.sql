-- Widens ledger.kind's CHECK constraint to include 'vet', for genotype test purchases (slice 0010
-- §5.5/§7.1). SQLite cannot ALTER a CHECK constraint, so this is a table rebuild: create the new
-- table, copy every row, drop the old one, rename, recreate the index.
--
-- Safe as a rebuild because nothing has a foreign key pointing INTO ledger - verified against every
-- migration in /migrations before writing this file, not just asserted. The migration runner
-- already guarantees this whole file lands in one env.DB.batch(), so it lands completely or not at
-- all.
--
-- The CHECK stays, deliberately, even though events.kind is free text with no CHECK (0048's own
-- comment explains why a future kind can attach there with no migration) - money is the one place a
-- typo'd value should fail loudly at the database rather than quietly become a row nobody queries.
-- The market stage will need another rebuild like this one for 'sale' and 'stud_fee' - a cheap
-- price for the constraint.
CREATE TABLE ledger_new (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment', 'vet')),
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
