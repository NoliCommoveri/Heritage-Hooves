-- docs/fixes/breed-disease-panels.md, "Signs take time to show": signs_game_day is snapshotted at
-- write time (CLAUDE.md §5.5) from a sub-seed off the horse's own rng_seed (§5.2) - never
-- Math.random() - so retuning a condition's delay range later never moves a date already rolled for
-- a horse that already exists. NULL for a signs_visible = 0 condition (nothing ever reads it there)
-- and, deliberately, for every horse_conditions row written before this migration - no backfill, the
-- same choice migrations/0050's own comment made for its four disease loci. visibleAffectedConditions
-- and isBarredFromShowing both treat NULL as already due, so an already-showing horse keeps showing;
-- nothing regresses for stock that predates this column.
--
-- signs_noticed_game_day is the idempotency marker the tick's noticeDueConditionSigns stage writes
-- once, the same NULL-until-written shape last_evaluated_game_day already uses elsewhere.
ALTER TABLE horse_conditions ADD COLUMN signs_game_day INTEGER;
ALTER TABLE horse_conditions ADD COLUMN signs_noticed_game_day INTEGER;
