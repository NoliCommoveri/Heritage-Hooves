-- Slice 0028 §2.5, migration 2 of 8: quality_bands reshaped from one number per band
-- (polygenic_one_chance) to a band DEAL - a fixed profile of five pair-specs (bucket indices for
-- the two type-gene alleles of each conformation trait, src/engines/conformation/typeGene.ts's
-- dealForBand) plus ability_one_chance, the number that used to be shared with conformation and now
-- drives ability traits alone. Values unchanged (0.42/0.50/0.58) - this is a reshape, not a retune.
--
-- This split was forced, not cosmetic: the old single number was ALSO the ability allele frequency
-- breeds.ability_bias (migration 0141) offsets per trait - moving it for conformation's sake alone
-- would have silently undone slice 0024's breed ability leaning.
--
-- Pair-specs are §2.5's own table:
--   low:  0-0, 1-1, 1-2, 2-2, 3-3   (1 Outstanding, 1 Good, 2 Acceptable, 1 Weak)
--   mid:  0-0, 0-0, 1-1, 2-2, 3-3   (2 Outstanding, 1 Good, 1 Acceptable, 1 Weak)
--   high: 0-0, 0-0, 0-0, 1-1, 2-2   (3 Outstanding, 1 Good, 1 Acceptable, no Weak)
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.quality_bands',
      json(
        '{' ||
        '"low":{"pairs":[[0,0],[1,1],[1,2],[2,2],[3,3]],"ability_one_chance":0.42},' ||
        '"mid":{"pairs":[[0,0],[0,0],[1,1],[2,2],[3,3]],"ability_one_chance":0.50},' ||
        '"high":{"pairs":[[0,0],[0,0],[0,0],[1,1],[2,2]],"ability_one_chance":0.58}' ||
        '}'
      )
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
