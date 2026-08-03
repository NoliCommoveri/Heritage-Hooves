-- Amendment 0017a §4.7: colour's two terms in appraise() - a config table mapping expressed colour
-- to a visible-value multiplier, and the premium/cap for a tested-and-not-visible allele. Numbers
-- are guesses (§7 of that document): the whole visible range is kept modest next to
-- market_quality_weight (4.0) on purpose - §8's risk is colour out-competing conformation as the
-- rational thing to breed for.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.market_visible_colour_factors', json('{
        "chestnut": 1.0,
        "bay": 1.0,
        "black": 1.05,
        "palomino": 1.2,
        "buckskin": 1.2,
        "smoky black": 1.05,
        "cremello": 1.35,
        "perlino": 1.35,
        "smoky cream": 1.3
      }'),
      '$.market_carried_allele_premium', 0.10,
      '$.market_carried_allele_cap', 1.5
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
