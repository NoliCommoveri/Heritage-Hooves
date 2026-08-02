-- One 'opening' ledger row per stable that already exists, so the balance-equals-sum-of-ledger
-- invariant (slice 0009 §4.1/§4.5) holds for stables founded before this slice too. Its own file,
-- separate from migrations/0042_ledger.sql which only creates the table (CLAUDE.md §8).
INSERT INTO ledger (stable_id, amount, kind, reference_type, reference_id, description, game_day, created_real_ts)
SELECT id, balance, 'opening', NULL, NULL, 'Starting balance.', created_game_day, unixepoch()
FROM stables;
