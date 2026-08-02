-- Slice 0011 §5.2: cancelling a booked covering or an in-progress pregnancy when the mare or
-- stallion involved dies or is retired away. An additive column rather than widening `status` -
-- SQLite can't alter a CHECK constraint without rebuilding the table (create/copy/drop/rename),
-- which is too much risk for a rare event in front of an operator with no way to recover from a
-- bad migration.
--
-- A row is live when its `status` says so AND `cancelled_game_day IS NULL` - both halves, every
-- time. src/db/coverings.ts's resolveDueCoverings and src/db/pregnancies.ts's foalDuePregnancies
-- both gain "AND cancelled_game_day IS NULL" on their due-selection queries.
ALTER TABLE coverings ADD COLUMN cancelled_game_day INTEGER;
ALTER TABLE coverings ADD COLUMN cancelled_reason TEXT; -- 'dam_died' | 'sire_died' | 'dam_removed' | 'sire_removed'
ALTER TABLE pregnancies ADD COLUMN cancelled_game_day INTEGER;
ALTER TABLE pregnancies ADD COLUMN cancelled_reason TEXT; -- 'dam_died' | 'sire_died' | 'dam_removed' | 'sire_removed'
