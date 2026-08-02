-- The mating event (slice 0003 §6). Booked immediately; resolved by the tick on the mare's next
-- in-season tick. A covering can produce zero, one or two pregnancies (twins) - that's why the
-- mating event and the pregnancy are separate tables, amending schema doc §5.1 which has no
-- concept of a covering.
CREATE TABLE coverings (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  mare_id INTEGER NOT NULL REFERENCES horses (id),
  stallion_id INTEGER NOT NULL REFERENCES horses (id),
  booked_game_day INTEGER NOT NULL,
  booked_tick_seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'resolved_conceived', 'resolved_failed')),
  -- rng_seed: minted at booking, drives this covering's conception roll and (if it conceives) the
  -- double-ovulation / twin-continues rolls. Never the foal's own seed - see pregnancies.foal_rng_seed.
  rng_seed INTEGER NOT NULL,
  resolved_game_day INTEGER,
  resolved_tick_seq INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- The only query the tick makes against this table: coverings still waiting to be resolved.
CREATE INDEX idx_coverings_booked ON coverings (status) WHERE status = 'booked';
-- The only query a screen makes: does this mare already have an open covering.
CREATE INDEX idx_coverings_mare_id ON coverings (mare_id);
