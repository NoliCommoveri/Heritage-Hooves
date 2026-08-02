-- The NPC show barn (slice 0008 §5.7/§2.2): one fixed stable of real, stored Quarter Horses that
-- fills out a class's field, scored by exactly the same code as a player's own horses (CLAUDE.md
-- §13's "no parallel scoring path" rule). It never breeds, ages out, dies, gets bought, sold, or
-- improves - src/db/npc.ts's stockShowBarn is the only thing that ever adds horses to it, and only
-- when an admin presses the button at /admin/shows.
--
-- Both this row and its stable_prefix_history row are inserted together so no player can ever claim
-- this prefix (CLAUDE.md §11's prefix-registry entry). capacity is generous headroom above the
-- default npc_show_barn_size so retuning that config upward later doesn't also need a capacity bump.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Fair Meadow Show Barn', 'Fair Meadow', 0, 1, 1, 0, 200, 0, unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables ORDER BY id DESC LIMIT 1), 'Fair Meadow', 0, NULL, NULL, unixepoch());
