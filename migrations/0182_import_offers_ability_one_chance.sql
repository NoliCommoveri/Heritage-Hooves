-- Slice 0028 §4 rule 8, migration 6 of 8: import_offers.polygenic_one_chance renamed to
-- ability_one_chance. After the quality-band split (migration 0178) this column only ever drives
-- the ABILITY polygenic draw at claim time (src/db/founding.ts's chooseBreedForOffer) - it has never
-- fed the conformation type-gene deal, which reads the offer's own quality_band column (already
-- snapshotted, unchanged by this migration) against the LIVE config.values.quality_bands instead.
-- The old name would otherwise sit there permanently misleading the next session.
ALTER TABLE import_offers RENAME COLUMN polygenic_one_chance TO ability_one_chance;
