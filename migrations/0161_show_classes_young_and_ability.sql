-- Slice 0025 stage 3 (docs/slices/0025-difficulty-foals-shows-and-evaluation.md §7.3/§7.4): widens
-- show_classes to hold two more class types - 'young_conformation' (an in-hand conformation class
-- restricted to a yearling or two-year-old age band, judged against the same breed ideal_vector an
-- adult breed_conformation class uses) and 'ability_test' (a single ability trait, entered against
-- other horses of the same age band, placed and ribboned exactly like any other class). Both exist
-- because a foal or yearling cannot enter any class built before this slice - every existing class's
-- min_age_game_days sits at or above min_breeding_age_game_days (three game years) - and the
-- children's own complaint was that a young horse cannot be shown or evaluated at all.
--
-- SQLite cannot ALTER a CHECK constraint, so this is the same rebuild migration 0064 already used to
-- add the 'discipline' type - see that file's header for why show_entries has to be moved out of the
-- way and back (its own foreign key into show_classes blocks a DROP TABLE otherwise). Nothing about
-- show_entries' own shape changes here; it is only round-tripped.
CREATE TABLE show_entries_hold AS SELECT * FROM show_entries;

DROP TABLE show_entries;

CREATE TABLE show_classes_new (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows (id),
  name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK (class_type IN ('breed_conformation', 'discipline', 'young_conformation', 'ability_test')),
  breed_id INTEGER REFERENCES breeds (id),
  discipline_code TEXT,
  -- ability_trait_code: which of ABILITY_TRAITS (src/engines/conformation/traits.ts) an
  -- 'ability_test' class measures, e.g. 'speed'. Null for every other class_type - a 'discipline'
  -- class already carries its own weighted mix of every ability trait via ability_weights, and this
  -- column is specifically for a class that measures exactly one of them alone.
  ability_trait_code TEXT,
  -- age_band: the two young-horse bands the slice names - 'yearling' (1-2 years) and 'two_year_old'
  -- (2-3 years) - not three, and not open-ended the way an adult class is. Non-null for exactly the
  -- two new class_types; min_age_game_days/max_age_game_days already carry the real numbers a
  -- class is judged and filtered by, so this column is display/grouping metadata, not a second
  -- source of truth for eligibility.
  age_band TEXT CHECK (age_band IN ('yearling', 'two_year_old')),
  min_age_game_days INTEGER NOT NULL,
  max_age_game_days INTEGER,
  sex_restriction TEXT CHECK (sex_restriction IN ('mare', 'stallion', 'gelding')),
  crosses_eligible INTEGER NOT NULL DEFAULT 0,
  requires_gait INTEGER NOT NULL DEFAULT 0,
  target_field_size INTEGER NOT NULL,
  max_entries_per_stable INTEGER NOT NULL,
  judge_id INTEGER NOT NULL REFERENCES judges (id),
  ideal_vector TEXT,
  ability_weights TEXT,
  ideal_falloff REAL NOT NULL,
  noise_sd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'judged')),
  judged_game_day INTEGER,
  rng_seed INTEGER NOT NULL,
  prize_schedule TEXT NOT NULL DEFAULT '[]',
  CHECK (
    (class_type = 'breed_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NULL)
    OR
    (class_type = 'discipline' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND discipline_code IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NULL)
    OR
    (class_type = 'young_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NOT NULL)
    OR
    (class_type = 'ability_test' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND breed_id IS NULL AND discipline_code IS NULL AND ability_trait_code IS NOT NULL AND age_band IS NOT NULL)
  )
);

INSERT INTO show_classes_new (
  id, show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, min_age_game_days, max_age_game_days,
  sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
  judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day,
  rng_seed, prize_schedule
)
SELECT
  id, show_id, name, class_type, breed_id, discipline_code, NULL, NULL, min_age_game_days, max_age_game_days,
  sex_restriction, crosses_eligible, requires_gait, target_field_size, max_entries_per_stable,
  judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status, judged_game_day,
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
  trait_snapshot TEXT NOT NULL,
  raw_score REAL,
  noise_applied REAL,
  final_score REAL,
  score_breakdown TEXT,
  placing INTEGER,
  scored_game_day INTEGER,
  prize_paid INTEGER NOT NULL DEFAULT 0,
  care_modifier_applied REAL NOT NULL DEFAULT 1.0,
  age_modifier_applied REAL NOT NULL DEFAULT 1.0,
  UNIQUE (class_id, horse_id)
);

INSERT INTO show_entries (
  id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot,
  raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day, prize_paid,
  care_modifier_applied, age_modifier_applied
)
SELECT
  id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot,
  raw_score, noise_applied, final_score, score_breakdown, placing, scored_game_day, prize_paid,
  care_modifier_applied, age_modifier_applied
FROM show_entries_hold;

DROP TABLE show_entries_hold;

CREATE INDEX idx_show_entries_horse_id ON show_entries (horse_id);
