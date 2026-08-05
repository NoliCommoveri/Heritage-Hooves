-- Operator, 2026-08-05, relaying a ten-year-old: foals "are absolutely useless for three game
-- years", and "wait six weeks and they'll be grown" is not an answer that works at ten. A player can
-- now pay to age ONE horse forward, six months at a time. Not a world speed-up and not skipping
-- ahead - every other horse in the game stands still.
--
--   time_warp_game_days   how much time one purchase buys. Six months at today's 360-day year.
--                         Repeatable, so this is a step size rather than a total.
--   time_warp_cost        money, on top of the one turn every warp also costs.
--
-- Three rules that live in code rather than here, recorded so the numbers above are read in the
-- right context (see src/db/timeWarp.ts):
--   * capped at min_breeding_age_game_days - a warp can bring a horse up to grown and no further,
--     never toward death and never through a mare's breeding years;
--   * the horse really is that much older, so its natural death moves forward by the same amount -
--     you bought time, and time costs time;
--   * the skipped months are not simulated: no board, no acquired incidents, no care timers. The
--     one exception is a lethal genetic condition already carried, which still kills on schedule -
--     that is a fact about the horse, not a chance event.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.time_warp_game_days', 180,
      '$.time_warp_cost', 400
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
