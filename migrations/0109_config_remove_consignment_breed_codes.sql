-- The consignment dealer now mints whatever breeds are in play (breeds.enabled, the same toggle
-- /admin/breeds drives) directly, rather than intersecting with this separate allowlist - see
-- src/db/consignment.ts's mintConsignmentBatch and the 2026-08-04 build-log entry for why a second,
-- independent "which breeds" control was the reason the dealer stayed Quarter-Horse-only after
-- every other breed got a conformation standard. Nothing in code reads this key anymore; removed
-- rather than left stale so a future session doesn't wonder whether it still does something.
UPDATE config
SET version = version + 1,
    "values" = json_remove("values", '$.consignment_breed_codes'),
    updated_real_ts = unixepoch()
WHERE id = 1;
