-- Slice 0014 §5: the Part B tunables. unmanaged_condition_penalty stacks per unmanaged manageable
-- condition on the care modifier, caught by the existing care_modifier_min/max clamp (slice 0013
-- §2.4). condition_management_cost and condition_management_interval_game_days are read live, at
-- the moment a plan is bought or renewed - a price or interval change affects the next purchase,
-- never re-prices or re-dates a plan already bought.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.unmanaged_condition_penalty', -0.03,
      '$.condition_management_cost', 150,
      '$.condition_management_interval_game_days', 180
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
