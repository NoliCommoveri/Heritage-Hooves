-- Slice 0021 Part D (§6.4): the market's two remaining colour/pattern tunables. 0115 already seeded
-- pattern_penetrance (Part C); this migration is the rest of what the slice's own §9 called
-- "0115_config_colour_patterns" before 0115 turned out to need splitting, since 0115 is applied and
-- forward-only.
--
-- market_visible_colour_factors already exists (0095) - json_set patches individual new keys onto
-- it so the ten colours already priced there are never retyped. Values are live-tunable guesses
-- (§12 open question 2), kept in the same modest 1.05-1.35 band 0095's own comment set out: colour
-- must never out-compete conformation (market_quality_weight is 4.0). Rare double-dilutions
-- (dun-on-cream) sit at the top of that band, in line with the existing cremello/perlino.
--
-- market_pattern_factor is new: one flat multiplier applied once when a horse shows ANY pattern at
-- all (tobiano, frame, splash, sabino, appaloosa), never stacked per pattern (§6.4) - a maximally
-- marked horse must not out-earn a well-bred one just by carrying more patterns.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.market_visible_colour_factors.bay dun', 1.15,
      '$.market_visible_colour_factors.red dun', 1.15,
      '$.market_visible_colour_factors.grullo', 1.25,
      '$.market_visible_colour_factors.amber champagne', 1.3,
      '$.market_visible_colour_factors.classic champagne', 1.3,
      '$.market_visible_colour_factors.gold champagne', 1.3,
      '$.market_visible_colour_factors.silver black', 1.2,
      '$.market_visible_colour_factors.silver bay', 1.2,
      '$.market_visible_colour_factors.dunalino', 1.35,
      '$.market_visible_colour_factors.dunskin', 1.35,
      '$.market_visible_colour_factors.blue roan', 1.15,
      '$.market_visible_colour_factors.red roan', 1.1,
      '$.market_visible_colour_factors.bay roan', 1.1,
      '$.market_pattern_factor', 1.15
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
