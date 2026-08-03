-- Slice 0014 §4.1: the age-decline curve's three numbers. Live - read fresh on every scoring run
-- and every page view; nothing here is snapshotted onto a horse (what's snapshotted is the modifier
-- a judged entry actually scored with, show_entries.age_modifier_applied). Flat at 1.0 until
-- age_decline_start_game_days (5760 = 16 years, below veteran_age_game_days on purpose - see
-- src/engines/ageing/performance.ts), a straight line down to age_modifier_floor (0.85) at
-- age_decline_floor_game_days (9000 = 25 years), flat at the floor beyond that.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.age_decline_start_game_days', 5760,
      '$.age_decline_floor_game_days', 9000,
      '$.age_modifier_floor', 0.85
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
