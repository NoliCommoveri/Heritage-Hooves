-- Everything alive when care ships starts current, not neglected (slice 0013 §5.2). Without this,
-- every horse in the game reads as never-shod on the first tick after deploy and takes the full
-- penalty for a mechanic that did not exist yesterday. Dead and retired horses are left NULL on
-- purpose: nothing reads care for a horse that has ended, and writing to them would be writing
-- history that did not happen.
UPDATE horses
   SET last_farrier_game_day = (SELECT game_day FROM world WHERE id = 1),
       last_vet_game_day     = (SELECT game_day FROM world WHERE id = 1)
 WHERE status = 'alive';
