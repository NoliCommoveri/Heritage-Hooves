-- The numbers behind the three named difficulty levels (migration 0153). Named levels with editable
-- numbers was the operator's own instruction: the children pick from three words, the operator
-- retunes what those words mean without a deploy.
--
-- Kept as six flat decimal keys rather than one JSON blob on purpose - /admin/config already edits
-- flat numeric keys through a form the operator can use, and a blob would need a JSON editor they
-- have no way to validate.
--
--   *_incident_rate  multiplies the per-game-day onset probability, BEFORE the shared
--                    incident_probability_ceiling_per_game_day clamp, so the ceiling still means
--                    what it says at every level.
--   *_bad_outcome    multiplies the combined death + degenerative share of an incident's outcome
--                    table; whatever that scaling frees (or costs) is taken from the resolved and
--                    manageable shares in their existing proportion, so the table always sums to 1.
--
-- normal is 1.0/1.0 by definition - it is today's game, unchanged, and should stay 1.0 unless the
-- operator wants to move the baseline for everyone at once.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.difficulty_gentle_incident_rate', 0.35,
      '$.difficulty_gentle_bad_outcome', 0.3,
      '$.difficulty_normal_incident_rate', 1.0,
      '$.difficulty_normal_bad_outcome', 1.0,
      '$.difficulty_realistic_incident_rate', 1.35,
      '$.difficulty_realistic_bad_outcome', 1.25
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
