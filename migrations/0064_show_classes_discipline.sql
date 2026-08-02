-- Slice 0012 §6.4: widens show_classes to hold a discipline class alongside a breed-conformation
-- one. SQLite cannot ALTER a CHECK constraint or drop a NOT NULL, so this is a genuine rebuild -
-- migration 0057 is the worked precedent for the mechanics (create-copy-drop-rename), but that
-- rebuild was safe specifically because nothing had a live foreign key into `ledger`. show_entries
-- DOES have one into show_classes (class_id), and D1 enforces foreign keys - dropping a table that
-- another table currently references fails immediately with "FOREIGN KEY constraint failed"
-- (verified against a live `wrangler d1 execute --local` scratch test before writing this file;
-- PRAGMA foreign_keys=OFF is also not an option, since it is a no-op once a transaction has begun
-- and every migration's statements land in one D1 batch, i.e. one transaction).
--
-- So show_entries is moved out of the way first: copied to a plain holding table with no
-- constraints of its own (CREATE TABLE ... AS SELECT copies data, not constraints), dropped (which
-- is always safe - nothing references show_entries), then show_classes is rebuilt with nothing
-- pointing at it, then show_entries is recreated in its ORIGINAL shape (the trait_snapshot rename
-- is a separate migration, 0065 - this file only touches show_classes) and reloaded from the
-- holding table. Column name and FK are identical to 0038's original; this is not a schema change
-- to show_entries, only a mechanically forced round-trip.
CREATE TABLE show_entries_hold AS SELECT * FROM show_entries;

DROP TABLE show_entries;

CREATE TABLE show_classes_new (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows (id),
  name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK (class_type IN ('breed_conformation', 'discipline')),
  breed_id INTEGER REFERENCES breeds (id),
  discipline_code TEXT,
  min_age_game_days INTEGER NOT NULL,
  max_age_game_days INTEGER,
  sex_restriction TEXT CHECK (sex_restriction IN ('mare', 'stallion', 'gelding')),
  crosses_eligible INTEGER NOT NULL DEFAULT 0,
  requires_gait INTEGER NOT NULL DEFAULT 0,
  target_field_size INTEGER NOT NULL,
  max_entries_per_stable INTEGER NOT NULL,
  judge_id INTEGER NOT NULL REFERENCES judges (id),
  -- ideal_vector: a copy of breeds.ideal_vector at creation. Null for a discipline class - see the
  -- CHECK below, which makes the pairing impossible to get wrong.
  ideal_vector TEXT,
  -- ability_weights: a copy of disciplines.ability_weights at creation. Null for a
  -- breed_conformation class.
  ability_weights TEXT,
  ideal_falloff REAL NOT NULL,
  noise_sd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'judged')),
  judged_game_day INTEGER,
  rng_seed INTEGER NOT NULL,
  prize_schedule TEXT NOT NULL DEFAULT '[]',
  CHECK (
    (class_type = 'breed_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL)
    OR
    (class_type = 'discipline' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND discipline_code IS NOT NULL)
  )
);

INSERT INTO show_classes_new (
  id, show_id, name, class_type, breed_id, discipline_code, min_age_game_days, max_age_game_days,
  sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
  judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day,
  rng_seed, prize_schedule
)
SELECT
  id, show_id, name, class_type, breed_id, discipline_code, min_age_game_days, max_age_game_days,
  sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
  judge_id, ideal_vector, NULL, ideal_falloff, noise_sd, status, judged_game_day,
  rng_seed, prize_schedule
FROM show_classes;

DROP TABLE show_classes;

ALTER TABLE show_classes_new RENAME TO show_classes;

CREATE INDEX idx_show_classes_show_id ON show_classes (show_id);
CREATE INDEX idx_show_classes_status ON show_classes (status);

CREATE TABLE show_entries (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES show_classes (id),
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  entered_by_stable_id INTEGER NOT NULL REFERENCES stables (id),
  is_npc INTEGER NOT NULL DEFAULT 0,
  entered_game_day INTEGER NOT NULL,
  conformation_snapshot TEXT NOT NULL,
  raw_score REAL,
  noise_applied REAL,
  final_score REAL,
  score_breakdown TEXT,
  placing INTEGER,
  scored_game_day INTEGER,
  prize_paid INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_id, horse_id)
);

INSERT INTO show_entries (
  id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, conformation_snapshot,
  raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day, prize_paid
)
SELECT
  id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, conformation_snapshot,
  raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day, prize_paid
FROM show_entries_hold;

DROP TABLE show_entries_hold;

CREATE INDEX idx_show_entries_horse_id ON show_entries (horse_id);
