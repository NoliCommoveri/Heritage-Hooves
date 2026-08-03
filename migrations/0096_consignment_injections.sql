-- Amendment 0017a §5.4. An allele the operator wants seeded into the next consignment batch.
-- Consumed by the tick, one row per injection, kept afterwards as the record of what was
-- deliberately introduced to the gene pool and when.
CREATE TABLE consignment_injections (
  id INTEGER PRIMARY KEY,
  locus_code TEXT NOT NULL,          -- must be a code in LOCI
  allele TEXT NOT NULL,              -- must be an allele that locus defines
  zygosity TEXT NOT NULL CHECK (zygosity IN ('het', 'hom')),
  applies_to TEXT NOT NULL CHECK (applies_to IN ('one', 'all')),
  sex_preference TEXT NOT NULL CHECK (sex_preference IN ('any', 'stallion', 'mare')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'applied', 'cancelled')),
  queued_game_day INTEGER NOT NULL,
  applied_game_day INTEGER,
  applied_horse_id INTEGER REFERENCES horses (id),
  note TEXT,
  created_real_ts INTEGER NOT NULL
);

-- The admin screen's own list, oldest queued first.
CREATE INDEX idx_consignment_injections_queued ON consignment_injections (queued_game_day) WHERE status = 'queued';
