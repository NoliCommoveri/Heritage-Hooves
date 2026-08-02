-- One row per candidate horse offered within an import_offers batch. Schema doc §10.2; slice 0005
-- §6.3. Written when the offer's breed is chosen (status 'pending' -> 'open'); claiming ticks
-- 'chosen' and fills 'horse_id' for the ones kept, and leaves the rest as unclaimed rows the child
-- never sees again.
CREATE TABLE import_candidates (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES import_offers (id),
  -- slot_index: 0-based, and the sub-seed label depends on it (deriveSeed(offer.rng_seed,
  -- 'candidate_<slot_index>')) - see src/db/founding.ts.
  slot_index INTEGER NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('mare', 'stallion')),
  age_game_days INTEGER NOT NULL,
  -- genotype: TEXT JSON, the same blob shape horses.genotype uses (see migrations/0012_horses.sql).
  genotype TEXT NOT NULL,
  origin_prefix TEXT NOT NULL,
  name_part TEXT NOT NULL,
  -- rng_seed: this becomes horses.rng_seed unchanged on claim, mirroring
  -- pregnancies.foal_rng_seed -> horses.rng_seed (slice 0003) - a claimed horse's entire genetic
  -- history stays reproducible from the offer seed alone.
  rng_seed INTEGER NOT NULL,
  chosen INTEGER NOT NULL DEFAULT 0,
  horse_id INTEGER REFERENCES horses (id)
);

-- The only query the founding-offer screen makes: every candidate in one offer.
CREATE INDEX idx_import_candidates_offer_id ON import_candidates (offer_id);
