-- Amendment 0017a §5.8: the consignment dealer's tunables. Every number here is a guess, the same
-- caveat 0017 §5.4 gives its own table - nobody has watched this run yet.
--
-- No consignment_age_min/max_game_days key: §5.8 says "reuse founding", so runConsignments reads
-- founding_age_min_game_days/founding_age_max_game_days directly rather than carrying a second,
-- easy-to-drift copy of the same two numbers.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.consignment_cadence_game_days', 90,
      '$.consignment_listing_game_days', 90,
      '$.consignment_batch_min', 1,
      '$.consignment_batch_max', 2,
      '$.consignment_test_count_weights', json('{"0":55,"2":25,"3":13,"5":7}'),
      '$.consignment_price_multiplier', 1.15,
      '$.consignment_breed_codes', json('["QH"]')
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
