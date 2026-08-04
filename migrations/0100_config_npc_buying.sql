-- Slice 0017 §12 (Part C): how eagerly an NPC stable buys, on both routes - a standing offer on the
-- board and shopping open player listings on the tick. All live, all guesses (build log, 3 Aug 2026
-- pattern) - watch /admin/npc's buying-power column and retune from /admin/config with no deploy.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_buying_capacity_buffer', 3,
      '$.npc_buying_max_purchases_per_tick', 1,
      '$.npc_buying_min_quality', 45,
      '$.npc_buy_offer_min_quality', 50,
      '$.npc_buying_budget_fraction', 0.5
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
