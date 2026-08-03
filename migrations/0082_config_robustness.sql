-- Slice 0014 §2.8: the fixed draw chance for the three robustness traits in founding generation,
-- regardless of quality band - so a top-band founding horse is not automatically sound as well as
-- beautiful. See src/engines/founding/generate.ts and ROBUSTNESS_TRAITS.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.robustness_one_chance', 0.5
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
