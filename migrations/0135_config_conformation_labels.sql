-- Slice 0022 §B2: band edges for the conformation card's plain-word verdict (Poor / Weak /
-- Acceptable / Good / Outstanding), as live tunables so the operator can move them without a
-- deploy. Each is the traitScore (0-100, the judge's own per-trait formula, scoreEntry's traitScore
-- before any judge weight) at or above which that word applies - starting proposal at today's
-- default show_ideal_falloff of 2.0, first guesses that want checking against real horses.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.conformation_label_outstanding_min', 90,
      '$.conformation_label_good_min', 75,
      '$.conformation_label_acceptable_min', 55,
      '$.conformation_label_weak_min', 30
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
