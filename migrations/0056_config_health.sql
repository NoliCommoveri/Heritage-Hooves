-- Live tunables for testing and the lethal death window - slice 0010 §5.4. genotype_test_cost and
-- genotype_panel_cost are read live at the point of purchase (CLAUDE.md §5.5) - a price change
-- affects the next test, never re-prices a receipt. lethal_foal_death_game_days is the one read
-- once and snapshotted onto horse_conditions.terminal_game_day at birth, so retuning it never moves
-- the death date of a foal already born.
--
-- The arithmetic behind the two prices (slice 0010 §5.4): a founding stable starts with 10,000 and
-- three horses, paying 60 a tick in upkeep. A show win pays 600. A full panel at 700 is roughly one
-- win; panelling all three founding horses at 2,100 is a real decision that does not end the
-- stable. Single tests at 250 mean the panel saves 300 over testing four conditions separately.
-- These are a starting point to be tuned by observation - see /admin/health.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.genotype_test_cost', 250,
      '$.genotype_panel_cost', 700,
      '$.lethal_foal_death_game_days', 30
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
