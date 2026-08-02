-- Backfill cycle_anchor_tick_seq for mares that already exist (0017 added the column as null for
-- everyone). Slice 0003 §3.2 rolls this from the mare's own seed via deriveSeed(rng_seed,
-- "cycle_slot") in application code; a plain SQL migration has no access to that algorithm, so this
-- uses rng_seed mod the cycle length instead - still deterministic and reproducible from a stored
-- value, and evenly spread across the cycle, which is all the backfill needs. New mares (created
-- after this slice) get the real deriveSeed draw - see createFoundingHorse / the foaling path.
UPDATE horses
SET cycle_anchor_tick_seq =
  (SELECT tick_seq FROM world WHERE id = 1)
  + (rng_seed % (SELECT CAST(json_extract("values", '$.estrous_cycle_ticks') AS INTEGER) FROM config WHERE id = 1))
WHERE sex = 'mare' AND cycle_anchor_tick_seq IS NULL;
