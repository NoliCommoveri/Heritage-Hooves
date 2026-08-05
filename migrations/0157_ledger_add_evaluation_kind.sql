-- Widens ledger.kind's CHECK constraint to include 'evaluation' - the paid conformation evaluation
-- (migration 0155, src/db/evaluations.ts).
--
-- Its own kind rather than reusing 'vet' because the ledger is a thing a child reads, and a line
-- saying "vet" for something no vet did is exactly the drift the market kinds were split up to
-- avoid. It is also the one purchase in the game that is deliberately repeatable, so an operator
-- watching where a stable's money goes wants to see it named separately.
--
-- Same table-rebuild shape as 0128_ledger_add_pet_home_kind.sql and its predecessors - SQLite cannot
-- ALTER a CHECK constraint, and nothing has a foreign key pointing into ledger.
CREATE TABLE ledger_new (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment', 'vet', 'farrier', 'sale', 'purchase', 'commission', 'stud_fee_paid', 'stud_fee_received', 'pet_home_payout', 'evaluation')),
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
