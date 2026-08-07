-- Slice 0028 §2.6/§9 point 1, migration 5 of 8: founding stock mints at LOW from here on (§2.6:
-- "Founding stock mints at band low. mid is the consignment dealer's and the show barn's working
-- band; high is what a Champion field is made of.") - founding_quality_band moves from 'mid' (its
-- value since migration 0025) to 'low'.
--
-- consignment_quality_band is a new key, splitting the dealer off founding_quality_band so the two
-- can be retuned independently - src/db/consignment.ts used to read quality_bands.mid via a
-- hardcoded literal (amendment 0017a §5.8's own comment named this), which this key replaces.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.founding_quality_band', 'low',
      '$.consignment_quality_band', 'mid'
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
