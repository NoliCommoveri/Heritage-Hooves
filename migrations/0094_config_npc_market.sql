-- Slice 0017 §11 (Part B): how aggressively an NPC stable lists surplus stock. Both live, both
-- guesses (build log, 3 Aug 2026 pattern) - watch /admin/npc's balance column and retune from
-- /admin/config with no deploy.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_market_capacity_buffer', 2,
      '$.npc_market_max_listings_per_tick', 2
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
