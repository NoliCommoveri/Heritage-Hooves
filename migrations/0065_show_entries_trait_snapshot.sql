-- Slice 0012 §6.5: conformation_snapshot never actually held only conformation traits - the blob
-- shape was always trait-agnostic ({ "v": 1, "traits": {...}, "age_years": ..., "coi": ... }), only
-- the column name said otherwise. Renamed to trait_snapshot now that a discipline entry's snapshot
-- holds ability traits instead. Cosmetic, but worth its own migration: a column called
-- conformation_snapshot holding {"speed": 62} is exactly the kind of thing that misleads a session
-- with no memory of this one (CLAUDE.md §11).
--
-- A plain RENAME COLUMN, not a rebuild - show_entries has no foreign key pointing into it from any
-- other table, so nothing else needs to move out of the way first (contrast 0064, which does).
ALTER TABLE show_entries RENAME COLUMN conformation_snapshot TO trait_snapshot;
