-- The consignment dealer used to mint a randomised 1-2 horses total, one breed picked at random per
-- horse. It now mints a fixed count of every breed currently in play each batch, so replace the old
-- min/max-total tunables with a single per-breed count (src/db/consignment.ts's mintConsignmentBatch).
-- 2 keeps the previous "one or two" batch feel per breed rather than across the whole batch.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      json_remove("values", '$.consignment_batch_min', '$.consignment_batch_max'),
      '$.consignment_horses_per_breed', 2
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
