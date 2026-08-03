-- Slice 0014 §5/§7: management_state and management_until_game_day, named and promised by slice
-- 0010 §3.2 and now kept. Applies only to severity_class = 'manageable' rows (HYPP, PSSM1 today) -
-- lethal and degenerative conditions never read these columns.
--
-- No CHECK constraint on management_state, matching migrations/0073's own reasoning: a CHECK on a
-- NOT NULL DEFAULT column can only be changed later by rebuilding the table, so the closed set
-- ('unmanaged' / 'managed') is enforced in TypeScript instead, where every other closed set in this
-- codebase lives.
ALTER TABLE horse_conditions ADD COLUMN management_state TEXT NOT NULL DEFAULT 'unmanaged';
-- NULL means no plan has ever been bought. Currency is derived at read time against game_day -
-- nothing sweeps or writes this on a schedule (§5.4: no tick stage for the player-owned case).
ALTER TABLE horse_conditions ADD COLUMN management_until_game_day INTEGER;
