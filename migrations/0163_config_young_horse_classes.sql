-- Slice 0025 stage 3 §7.3: the two age-band boundaries a young-horse class (conformation in-hand or
-- ability test) is created with. "Yearling" is [young_horse_yearling_min_age_game_days,
-- young_horse_two_year_old_min_age_game_days - 1]; "two-year-old" is
-- [young_horse_two_year_old_min_age_game_days, show_conformation_min_age_game_days - 1] - the upper
-- bound is not its own config key, it is the adult conformation class's own min age (already 1080,
-- three game years) minus one, so a horse ages out of "two-year-old" on exactly the day it becomes
-- eligible for the adult class, with no gap and no one day double-eligible for both. 360 and 720 are
-- exactly one and two game years at today's game_days_per_year (360) - first guesses, like every
-- other age number in this slice.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.young_horse_yearling_min_age_game_days', 360,
      '$.young_horse_two_year_old_min_age_game_days', 720
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
