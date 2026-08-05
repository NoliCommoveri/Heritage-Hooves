-- Slice 0026 stage 1: live tunables for gelding. All first guesses (§6), editable at
-- /admin/config.
--
-- gelding_cost: the turn-and-money price of the action itself (§1.1).
-- gelding_recovery_game_days: how long a freshly gelded horse is unavailable for showing (§1.3).
-- show_gelding_noise_relief: multiplies a gelding's NEGATIVE show noise only - see
-- geldingAdjustedNoise, src/engines/showing/noise.ts (§1.4). Live, not snapshotted onto a class,
-- unlike noise_sd beside it.
-- market_gelding_factor: appraise()'s flat multiplier for sex = 'gelding' (§1.5).
-- market_rank_factors: appraise()'s multiplier keyed by the horse's own highest-held show rank
-- (§1.5) - a horse with no horse_class_ranks row reads 'novice', i.e. 1.0.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.gelding_cost', 400,
      '$.gelding_recovery_game_days', 30,
      '$.show_gelding_noise_relief', 0.75,
      '$.market_gelding_factor', 0.75,
      '$.market_rank_factors', json('{"novice":1.0,"open":1.15,"champion":1.35}')
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
