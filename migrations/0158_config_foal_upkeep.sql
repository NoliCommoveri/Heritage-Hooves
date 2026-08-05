-- Operator, 2026-08-05: "foals probably shouldn't cost upkeep. id throw them out in the pasture
-- myself to avoid it since they cant be shown or bred anyways." A young horse now costs nothing to
-- keep until it is old enough to do something.
--
-- One year, not three, on the operator's own instruction - the cutoff is "old enough to do
-- something", and slice 0025's yearling classes are what make one year that age. Set this to 0 to
-- charge board on every horse from birth, as the game did before today.
--
-- Live (CLAUDE.md §5.5): read fresh by chargeUpkeep on every tick, never snapshotted. Changing it
-- only changes what future ticks charge; no already-posted ledger row moves.
UPDATE config
SET version = version + 1,
    "values" = json_set("values", '$.upkeep_free_until_age_game_days', 360),
    updated_real_ts = unixepoch()
WHERE id = 1;
