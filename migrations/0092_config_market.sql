-- Slice 0017 §5.4: the market's live tunables plus the one snapshotted duration
-- (market_listing_game_days, copied onto listings.expires_game_day at listing time - retuning it
-- must never move a listing already posted). Every number here is a guess, chosen so an average
-- adult horse appraises somewhere around 800-1,500 against a starting balance of 10,000. Nobody has
-- watched this economy run; expect to retune all of them from /admin/config with no deploy.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.market_commission_percent', 5,
      '$.market_listing_game_days', 90,
      '$.market_max_price', 1000000,
      '$.market_price_multiplier', 1.0,
      '$.market_base_value', 800,
      '$.market_quality_weight', 4.0,
      '$.market_foal_value_factor', 0.5,
      '$.market_failing_factor', 0.4,
      '$.market_clear_premium', 0.08,
      '$.market_clear_premium_cap', 1.4,
      '$.market_carrier_factor', 0.8,
      '$.market_affected_factor', 0.4,
      '$.market_win_bonus', 0.15,
      '$.market_place_bonus', 0.05,
      '$.market_record_cap', 2.5,
      '$.market_min_value', 50
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
