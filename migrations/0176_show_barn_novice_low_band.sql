-- Slice 0028 §9.1: the show barn mints its Novice tier at the LOW quality band, not mid.
--
-- npc_show_barn_rank_plan has read novice/mid since migration 0173, so a child's founding horse met
-- a MID-band field in the very first class it was ever eligible for. Measured against the redesigned
-- conformation bands (docs/analysis/breeding-lab.mjs), that is a 3% chance of winning where a
-- low-band field gives 21%, and a ribbon in one start in six rather than one in two.
--
-- This is independent of the rest of slice 0028 and lands now: the band names it uses already exist
-- and keep their meaning after that slice reshapes what a band contains. Open and Champion are
-- unchanged - the point is that the three tiers are three different fields, which is the defect
-- slice 0028 §1 names in its closing paragraph.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_show_barn_rank_plan',
      json('[{"rank":"novice","count":2,"band":"low"},{"rank":"open","count":4,"band":"mid"},{"rank":"champion","count":4,"band":"high"}]')
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
