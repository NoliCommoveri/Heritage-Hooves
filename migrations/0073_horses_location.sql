-- Where a horse actually is: in the barn, in work, or turned out at pasture. Not part of slice
-- 0013 as written - added at the operator's request once care was built, because "care" only means
-- something if a horse can also be somewhere care does not apply.
--
-- 'barn'    - the normal state. Care timers run, board is charged, it can be bred and shown.
-- 'pasture' - it still ages, still grows, still carries every gene it carried before, and still
--             dies of old age on the day its lifespan says. But its care timers are frozen, its
--             board is multiplied by config.values.pasture_upkeep_multiplier (0 today - it eats
--             grass), and it cannot be bred or entered in a show until brought back in.
--
-- No CHECK constraint: `horses` is the most foreign-keyed table in the schema (0064's own comment
-- on what rebuilding it costs), and a CHECK on a NOT NULL DEFAULT column can only be changed by
-- rebuilding. The value set is closed in TypeScript instead, which is where every other closed set
-- in this codebase lives.
ALTER TABLE horses ADD COLUMN location TEXT NOT NULL DEFAULT 'barn';

-- The game day this horse last moved between barn and pasture. NULL means it has never moved -
-- true for every horse alive when this migration runs, and for every foal born in the barn since.
--
-- One column, two jobs, which is deliberate rather than lazy:
--   * While at pasture, it is when the care timers stopped. Bringing a horse in stamps
--     last_farrier_game_day / last_vet_game_day forward by (game_day - this), so a horse that spent
--     two game years out does not come home four intervals overdue for a mechanic that was not
--     running while it was gone. That is the same unfairness migration 0068's backfill exists to
--     prevent for every horse alive when care itself shipped.
--   * While in the barn, it is when the settling period started. A horse is not available for
--     breeding or showing until game_day >= this + config.values.pasture_settle_game_days.
-- A NULL therefore reads as both "no frozen time to credit back" and "settled long ago", which are
-- the right answers for a horse that has never left the barn.
ALTER TABLE horses ADD COLUMN location_changed_game_day INTEGER;

-- The tick's care stage, the barn round and the upkeep count all filter alive horses by location
-- within one stable. Partial on the pasture side because that is the selective half - most horses
-- are in the barn, so "find the ones that are out" is the query that benefits (CLAUDE.md §7: added
-- for a query that is actually made, with the reason written down next to it).
CREATE INDEX idx_horses_pasture ON horses (owner_stable_id) WHERE location = 'pasture';
