-- One row per foal (slice 0003 §6): a covering that conceives twins produces two of these, each
-- with its own independent genotype roll. gestation_days is snapshotted per CLAUDE.md §5.5 -
-- changing gestation_days_mean/sd in config later must never move a mare already in foal.
CREATE TABLE pregnancies (
  id INTEGER PRIMARY KEY,
  covering_id INTEGER NOT NULL REFERENCES coverings (id),
  dam_id INTEGER NOT NULL REFERENCES horses (id),
  sire_id INTEGER NOT NULL REFERENCES horses (id),
  conceived_game_day INTEGER NOT NULL,
  gestation_days INTEGER NOT NULL,
  due_game_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'foaled')),
  -- rolled_genotype: the foal's full genotype blob (same shape as horses.genotype), rolled at
  -- conception (slice 0003 §3.9) so the draw is reproducible and a future lethal-homozygote check
  -- can happen here rather than at birth. Copied verbatim into horses.genotype at foaling.
  rolled_genotype TEXT NOT NULL,
  -- rolled_coi: the foal's inbreeding coefficient, computed once at conception from the same
  -- pedigree context the "Check pairing" preview used, and copied verbatim into horses.coi at
  -- foaling - it is also what the conception roll's inbreeding-fertility factor reads (slice 0003 §4.6).
  rolled_coi REAL NOT NULL,
  -- rng_seed: this pregnancy's own seed, distinct from foal_rng_seed. Drives only the gestation
  -- length draw (deriveSeed(rng_seed, "gestation")) - see slice 0003 §9.
  rng_seed INTEGER NOT NULL,
  -- foal_rng_seed: minted at conception, becomes horses.rng_seed unchanged at foaling. Drives the
  -- genotype roll and everything the foal itself will ever derive (slice 0003 §3.9).
  foal_rng_seed INTEGER NOT NULL,
  foal_id INTEGER REFERENCES horses (id),
  last_processed_tick_seq INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- The only query the tick makes against this table: pregnancies due on or before today that
-- haven't foaled yet.
CREATE INDEX idx_pregnancies_due ON pregnancies (due_game_day) WHERE status = 'in_progress';
-- The only query a screen makes: does this mare have an open pregnancy.
CREATE INDEX idx_pregnancies_dam_id ON pregnancies (dam_id);
