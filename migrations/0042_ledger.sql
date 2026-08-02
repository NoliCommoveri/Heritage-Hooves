-- The money truth table (slice 0009 §4.1/§4.2). stables.balance is a denormalized cache; this is
-- the ledger it is a cache of - the invariant is "for every stable, balance equals the sum of that
-- stable's ledger.amount rows, plus nothing else." Every row here is written by
-- buildLedgerStatements in src/db/ledger.ts, the one function in the whole codebase allowed to
-- change stables.balance - see that file's own comment for why a second writer must never exist.
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- amount: signed. Negative is money leaving the stable. Integer, never a float (CLAUDE.md §7).
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'upkeep', 'prize', 'adjustment')),
  -- reference_type/reference_id: what caused this movement, for tracing back - 'show_entry' |
  -- 'stable' | 'tick' | 'account'. No real foreign key, since which table reference_id points into
  -- depends on reference_type.
  reference_type TEXT,
  reference_id INTEGER,
  -- description: one short sentence a child can read, e.g. "Board for 4 horses, 10 days."
  description TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL,
  -- counterparty_stable_id/same_account: nullable/0, untouched until the market stage gives money a
  -- second party to move between (schema §2.4). Nothing writes them in this slice.
  counterparty_stable_id INTEGER REFERENCES stables (id),
  same_account INTEGER NOT NULL DEFAULT 0
);

-- The Money page's only query: one stable's ledger, newest first.
CREATE INDEX idx_ledger_stable_id ON ledger (stable_id, id DESC);
