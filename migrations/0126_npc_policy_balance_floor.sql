-- An NPC stable's income floor: the balance it is topped back up to once a game year if it has
-- fallen below, so a stable that has a bad run never goes permanently silent on buying and listing.

-- The floor itself. 0 disables the mechanism for that stable - there is no separate on/off flag,
-- setting this to 0 is how you switch it off.
ALTER TABLE npc_policy ADD COLUMN balance_floor INTEGER NOT NULL DEFAULT 0;

-- The idempotency marker (CLAUDE.md §5.4), the same shape last_bred_game_day already uses. NULL
-- means "never topped up", which runNpcBalanceFloor treats as immediately due - that is what gives
-- the three existing stables, all sitting at a balance of 0, an opening balance on the next tick
-- without a separate backfill migration.
ALTER TABLE npc_policy ADD COLUMN last_floor_topup_game_day INTEGER;

-- Differentiated by personality, the same way migrations/0093 differentiates asking prices. The two
-- specialists buy real outcross stock and need buying power; the volume breeder prices its surplus
-- low, sells more of it, and needs less. All three are guesses - watch /admin/npc and retune.
UPDATE npc_policy SET balance_floor = 5000 WHERE personality_code = 'conformation_specialist';
UPDATE npc_policy SET balance_floor = 5000 WHERE personality_code = 'discipline_barn';
UPDATE npc_policy SET balance_floor = 3000 WHERE personality_code = 'volume_breeder';
