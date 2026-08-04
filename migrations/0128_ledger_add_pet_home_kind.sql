-- Widens ledger.kind's CHECK constraint to include 'pet_home_payout' - a horse leaving the game to
-- a pet home rather than to a buyer inside it (src/db/petHome.ts).
--
-- One kind, not two, because there is one mechanic: a player sending a horse to a pet home and an
-- NPC stable's unsold listing going the same way are the same transaction at the same price, and
-- the operator asked for them to stay that way. A kind of its own rather than reusing 'sale' so the
-- ledger says plainly which money came from somebody inside the game buying a horse and which came
-- from the world beyond the five of them. getSeasonTradeSummary counts it toward /admin/npc's
-- earned-selling column, since it is still money earned by producing a horse worth something.
--
-- Same table-rebuild shape as 0105_ledger_add_stud_kinds.sql and its own predecessors - SQLite
-- cannot ALTER a CHECK constraint, and nothing has a foreign key pointing into ledger.
CREATE TABLE ledger_new (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment', 'vet', 'farrier', 'sale', 'purchase', 'commission', 'stud_fee_paid', 'stud_fee_received', 'pet_home_payout')),
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
