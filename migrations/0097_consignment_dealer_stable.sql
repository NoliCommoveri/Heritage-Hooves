-- Amendment 0017a §5.2: the consignment dealer's stable row, the same pattern
-- migrations/0085_npc_stables_and_policies.sql already establishes for Cedar Hollow - a stables row
-- and its stable_prefix_history row inserted together so no player can ever claim this prefix.
--
-- Deliberately NO npc_policy row: that is what keeps runNpcBreedingDecisions and runNpcMarketListings
-- from ever touching it. The dealer does not breed, does not show, and does not buy - it only mints
-- consignment batches (the tick's runConsignments stage) and lists them.
--
-- Its balance is a FICTION. Consigned horses are minted directly onto this stable and sold from it,
-- but nothing ever tops it up and nothing is ever paid out of it for real - see runConsignments and
-- src/db/consignment.ts for where a future session might otherwise be tempted to unify this with
-- Part B's NPC stables, whose balances ARE real and matter for Part C's economy. Capacity is set
-- generously; nothing charges for it, and the tick's own sweep never lets a standing consignment
-- outgrow it in practice.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'The Consignment Yard', 'Consignment Yard', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 200, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Consignment Yard'), 'Consignment Yard', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());
