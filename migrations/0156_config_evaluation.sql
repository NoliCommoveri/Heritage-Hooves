-- Live tunables for the paid conformation evaluation (migration 0155). All read at the point of
-- purchase, never snapshotted onto anything but the resulting row's own cost_paid and verdicts.
--
--   evaluation_cost                 what one evaluation costs. Repeatable at full price - the
--                                   operator's decision - so this is the price of every purchase,
--                                   not just the first. Set low: a child evaluating a whole crop of
--                                   foals should not go broke looking.
--   evaluation_max_spread_bands     how vague a newborn's verdict is, in label steps either side.
--                                   2 means a weanling reads across roughly five words' worth of
--                                   uncertainty ("Weak to Outstanding"); it narrows linearly to 0 by
--                                   evaluation_certain_age_years, where a single word is given.
--   evaluation_certain_age_years    the age at which an evaluation stops hedging. Defaults to the
--                                   same 3 years min_breeding_age_game_days uses, so an evaluation
--                                   becomes exact at exactly the point a horse could have shown for
--                                   itself and earned the same words for free.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.evaluation_cost', 200,
      '$.evaluation_max_spread_bands', 2,
      '$.evaluation_certain_age_years', 3
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
