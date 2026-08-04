-- Slice 0023: the operator renamed the three existing Quarter Horse NPC personality stables ahead
-- of a full world reset. A rename only touches `stables` (name/prefix) and `stable_prefix_history`
-- (closing the old claim, opening a new one) - npc_policy keys off stable_id and needs no change.
--
-- Fair Meadow (volume breeder, migrations 0040/0085) -> Apples and Oats Ranch
-- Cedar Hollow (conformation specialist, migration 0085) -> Bronco Valley
-- Willow Creek Barrels (discipline barn, targets Barrel Racing, migration 0085) -> Horseshoe Bay

UPDATE stable_prefix_history
SET to_game_day = (SELECT game_day FROM world WHERE id = 1)
WHERE stable_id = (SELECT id FROM stables WHERE prefix = 'Fair Meadow') AND to_game_day IS NULL;

UPDATE stables SET name = 'Apples and Oats Ranch', prefix = 'Apples and Oats Ranch' WHERE prefix = 'Fair Meadow';

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Apples and Oats Ranch'), 'Apples and Oats Ranch', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

UPDATE stable_prefix_history
SET to_game_day = (SELECT game_day FROM world WHERE id = 1)
WHERE stable_id = (SELECT id FROM stables WHERE prefix = 'Cedar Hollow') AND to_game_day IS NULL;

UPDATE stables SET name = 'Bronco Valley', prefix = 'Bronco Valley' WHERE prefix = 'Cedar Hollow';

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Bronco Valley'), 'Bronco Valley', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

UPDATE stable_prefix_history
SET to_game_day = (SELECT game_day FROM world WHERE id = 1)
WHERE stable_id = (SELECT id FROM stables WHERE prefix = 'Willow Creek Barrels') AND to_game_day IS NULL;

UPDATE stables SET name = 'Horseshoe Bay', prefix = 'Horseshoe Bay' WHERE prefix = 'Willow Creek Barrels';

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Horseshoe Bay'), 'Horseshoe Bay', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());
