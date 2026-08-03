-- The two tunables the location flag needs. Both live (CLAUDE.md §5.5) - they affect future
-- computation only, so nothing here is snapshotted onto a horse.
--
-- pasture_upkeep_multiplier: what a pastured horse's board is multiplied by. 0 means a horse at
--   grass costs nothing to keep, which is what the operator asked for. Written as a multiplier
--   rather than a hardcoded skip because free pasture is the one number here most likely to need
--   correcting: it makes board optional for any horse not actively campaigned, and slice 0013
--   §13.1 was already watching whether running costs were landing right. If balances stop falling
--   at all, raise this to 0.3 on /admin/config - no deploy, no migration.
--
-- pasture_settle_game_days: how long a horse coming in from pasture is "settling in" before it can
--   be bred or shown. 30 game days is about one real day at the default tick schedule, and one
--   show interval - so bringing a horse in is a decision made at the previous show rather than the
--   morning of the next one. This is the number that stops free pasture being free storage: with
--   it at 0, a player would park every horse outside, pay nothing, and bring one in the morning of
--   a show at no cost at all. Do not set it to 0 without replacing the trade-off with another one.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.pasture_upkeep_multiplier', 0.0,
      '$.pasture_settle_game_days', 30
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
