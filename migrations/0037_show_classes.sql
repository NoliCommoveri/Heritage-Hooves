-- One class within a show (slice 0008 §5.4). Every rule the class is judged by is snapshotted here
-- at creation time (CLAUDE.md §5.5) - the ideal vector, the falloff, the noise standard deviation,
-- the age limits, the field size, the entry cap - so a class judged under a since-retuned standard
-- stays explainable years later. Nothing in the judging stage reads config for a scoring parameter;
-- it reads this row.
CREATE TABLE show_classes (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows (id),
  name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK (class_type IN ('breed_conformation')),
  breed_id INTEGER REFERENCES breeds (id),
  -- discipline_code: always null in this slice (§3 - performance/gaited classes are not built).
  discipline_code TEXT,
  min_age_game_days INTEGER NOT NULL,
  max_age_game_days INTEGER,
  sex_restriction TEXT CHECK (sex_restriction IN ('mare', 'stallion', 'gelding')),
  crosses_eligible INTEGER NOT NULL DEFAULT 0,
  requires_gait INTEGER NOT NULL DEFAULT 0,
  target_field_size INTEGER NOT NULL,
  max_entries_per_stable INTEGER NOT NULL,
  judge_id INTEGER NOT NULL REFERENCES judges (id),
  -- ideal_vector: a copy of breeds.ideal_vector at the moment this class was created - see that
  -- column's migration comment for the shape. Never re-read from breeds after creation.
  ideal_vector TEXT NOT NULL,
  ideal_falloff REAL NOT NULL,
  noise_sd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'judged')),
  judged_game_day INTEGER,
  rng_seed INTEGER NOT NULL
);

CREATE INDEX idx_show_classes_show_id ON show_classes (show_id);
-- The tick's judging stage: every not-yet-judged class whose show's day has arrived.
CREATE INDEX idx_show_classes_status ON show_classes (status);
