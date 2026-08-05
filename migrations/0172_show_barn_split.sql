-- Slice 0026 stage 4 §4.1/§4.2: splits the show-barn role off Apples and Oats Ranch, which has been
-- doing double duty since migration 0085 gave it an npc_policy row (making it the Quarter Horse
-- volume breeder) on top of the show-field-padding role migration 0040 originally gave it. Apples
-- and Oats Ranch keeps its npc_policy row and stays the volume breeder, nothing else about it
-- changes. This migration creates a new, separate stable to take over the show-barn role.
--
-- Departure from the slice document, flagged per CLAUDE.md §2: §4.2 says to reuse the exact name/
-- prefix migration 0040 originally seeded ('Fair Meadow Show Barn' / 'Fair Meadow'), calling the
-- prefix "free again" now that migration 0136 renamed the stable holding it away. It is not free -
-- stable_prefix_history.prefix is UNIQUE with no scoping to "currently active" (that table's own
-- header comment: "once a stable renames, its old prefix disappears from `stables` but this table
-- still remembers it was taken" - a retired prefix is never reissued, by design, so two horses
-- decades apart can never share a confusingly identical registered-name prefix). Migration 0136
-- already closed 'Fair Meadow' there permanently. Reusing it here would fail this migration outright
-- (confirmed against the real unique constraint). Named/prefixed 'Fair Meadow Show Barn' instead -
-- name and prefix identical, the same shape migration 0168 used for Dressur Stables - which has
-- never been claimed by anything.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Fair Meadow Show Barn', 'Fair Meadow Show Barn', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 100, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Fair Meadow Show Barn'), 'Fair Meadow Show Barn', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());
