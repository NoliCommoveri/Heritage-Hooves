-- Slice 0019 §4.1/§6: the founding-specialist tunables. founding_ability_specialist_potential is
-- new (15/20 - 75% of maximum, high but not maxed so the headroom stays the point, §4.1).
-- consignment_cadence_game_days drops 90 -> 60 (§6) so the dealer's flow roughly doubles to match
-- one player's simulated pace of 2 consigned horses per game year - both were measured together in
-- docs/analysis/stable-timeline.mjs to land a casual child's median at 6-8 real months (CLAUDE.md
-- §9's acceptance test). Both stay live tunables, editable at /admin/config afterwards.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.founding_ability_specialist_potential', 15,
      '$.consignment_cadence_game_days', 60
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
