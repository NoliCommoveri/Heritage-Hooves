-- Slice 0028 §2.2, migration 4 of 8: the label edges move to the midpoints between the ladder's own
-- achievable distances (0/8/16/24 points off standard), from 90/75/55/30 (migration 0135) to
-- 88/72/56/40. At the midpoints the word a player reads matches the genotype it should name 100% of
-- the time, up from 97% - a pure improvement, and the reason it costs one extra json_set rather than
-- a design discussion.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.conformation_label_outstanding_min', 88,
      '$.conformation_label_good_min', 72,
      '$.conformation_label_acceptable_min', 56,
      '$.conformation_label_weak_min', 40
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
