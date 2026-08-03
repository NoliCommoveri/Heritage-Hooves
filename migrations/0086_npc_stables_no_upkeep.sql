-- Slice 0015 §2.5/§5.4: an NPC stable has no income except show prize money and no way to respond
-- to a bill, so charging it board is a one-way ratchet with nobody behind the wheel - src/db/upkeep
-- ts's chargeUpkeep is changed in the same commit as this migration to skip is_npc = 1 stables.
-- This migration is the one-off correction: it brings every already-negative NPC balance back to
-- zero, as a paired 'adjustment' ledger row plus the balance write (never a bare UPDATE), so
-- src/db/ledger.ts's balance-equals-sum-of-ledger invariant survives.
INSERT INTO ledger (stable_id, amount, kind, reference_type, reference_id, description, game_day, created_real_ts)
SELECT id, -balance, 'adjustment', 'stable', id, 'Balance reset to zero: NPC stables do not pay board (slice 0015).', (SELECT game_day FROM world WHERE id = 1), unixepoch()
FROM stables
WHERE is_npc = 1 AND balance != 0;

UPDATE stables SET balance = 0 WHERE is_npc = 1 AND balance != 0;
