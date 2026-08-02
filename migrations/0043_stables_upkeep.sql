-- Upkeep is charged per horse per game day, from the world clock, never from tick_seq (slice 0009
-- §2.2) - a paused world must not accrue board. Every existing stable is stamped to the world's
-- current game_day in the same breath: without this, the first tick after this migration lands
-- would see every stable as owing board back to game day 0 and empty every balance in the game.
ALTER TABLE stables ADD COLUMN last_upkeep_game_day INTEGER NOT NULL DEFAULT 0;

UPDATE stables SET last_upkeep_game_day = (SELECT game_day FROM world WHERE id = 1);
