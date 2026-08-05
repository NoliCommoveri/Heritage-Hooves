-- Operator report, 2026-08-05: dead and retired-away horses were cluttering the main barn view -
-- slice 0011 §8.1 deliberately kept an ended horse visible there (marked Died/Retired away) for
-- barn_shows_ended_game_days (180) after it ended, so the moment wasn't lost. The operator wants
-- the stable view clear instead; the horse is still reachable from /stables/:id/past
-- (listPastHorses, src/db/horses.ts) with no cutoff, and its ending is still announced in the
-- events feed. Retuning the live tunable to 0 (json_set, same pattern as 0101's cadence retune)
-- rather than changing listStableHorsesWithDead's own logic - a horse still shows on the game day
-- it actually ends, then drops out of the barn list from the next day on.
UPDATE config
SET version = version + 1,
    "values" = json_set("values", '$.barn_shows_ended_game_days', 0),
    updated_real_ts = unixepoch()
WHERE id = 1;
