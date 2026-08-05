-- Slice 0025 stage 4 (docs/slices/0025-difficulty-foals-shows-and-evaluation.md §7.5): the
-- Novice/Open/Champion progression, tracked independently per class type (breed or discipline).
-- Adds two columns to show_classes:
--
-- `rank` - 'novice' | 'open' | 'champion' for a breed_conformation/discipline class (which rank of
-- horse this particular class is for), or the fixed sentinel 'none' for young_conformation/
-- ability_test - the operator's stage-4 decision was that young-horse classes stay single-rank,
-- exactly as stage 3 built them.
--
-- `class_key` - a single NOT NULL text column identifying "which catalogue entry" a class belongs
-- to (e.g. 'bc:3' for breed_conformation breed 3, 'disc:barrel_racing', 'yc:3:yearling',
-- 'at:speed:yearling'), built by src/db/shows.ts's classKeyFor. This exists because SQLite's unique
-- indexes treat every NULL as distinct from every other NULL - a naive
-- UNIQUE(class_type, breed_id, discipline_code, ability_trait_code, age_band, rank) index would
-- never actually collide, since every one of the four class_types leaves at least one of those
-- columns NULL on every row. class_key folds the whole identity into one always-populated column so
-- the partial unique index below means what it says.
--
-- SQLite cannot ALTER a CHECK constraint, so this is the same rebuild dance migrations 0064 and
-- 0161 already used - show_entries is round-tripped, not reshaped.
CREATE TABLE show_entries_hold AS SELECT * FROM show_entries;

DROP TABLE show_entries;

CREATE TABLE show_classes_new (
  id INTEGER PRIMARY KEY,
  show_id INTEGER NOT NULL REFERENCES shows (id),
  name TEXT NOT NULL,
  class_type TEXT NOT NULL CHECK (class_type IN ('breed_conformation', 'discipline', 'young_conformation', 'ability_test')),
  breed_id INTEGER REFERENCES breeds (id),
  discipline_code TEXT,
  ability_trait_code TEXT,
  age_band TEXT CHECK (age_band IN ('yearling', 'two_year_old')),
  -- The always-populated join/uniqueness key described above.
  class_key TEXT NOT NULL,
  -- 'none' for young_conformation/ability_test (no progression - §7.3/stage 4 decision); one of the
  -- three real ranks for breed_conformation/discipline, which is what this class's field is for.
  rank TEXT NOT NULL DEFAULT 'novice' CHECK (rank IN ('novice', 'open', 'champion', 'none')),
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
    (class_type = 'breed_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NULL AND rank IN ('novice', 'open', 'champion'))
    OR
    (class_type = 'discipline' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND discipline_code IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NULL AND rank IN ('novice', 'open', 'champion'))
    OR
    (class_type = 'young_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL AND ability_trait_code IS NULL AND age_band IS NOT NULL AND rank = 'none')
    OR
    (class_type = 'ability_test' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND breed_id IS NULL AND discipline_code IS NULL AND ability_trait_code IS NOT NULL AND age_band IS NOT NULL AND rank = 'none')
  )
);

-- Backfilled rank: 'novice' for the two rank-tracked types (a reasonable starting point - nothing
-- alive yet has ever earned a promotion), 'none' for the two that were never rank-tracked.
-- class_key is built with the same prefixes src/db/shows.ts's classKeyFor uses.
INSERT INTO show_classes_new (
  id, show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band, class_key, rank,
  min_age_game_days, max_age_game_days, sex_restriction, crosses_eligible, requires_gait, target_field_size,
  max_entries_per_stable, judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status,
  judged_game_day, rng_seed, prize_schedule
)
SELECT
  id, show_id, name, class_type, breed_id, discipline_code, ability_trait_code, age_band,
  CASE class_type
    WHEN 'breed_conformation' THEN 'bc:' || breed_id
    WHEN 'discipline' THEN 'disc:' || discipline_code
    WHEN 'young_conformation' THEN 'yc:' || breed_id || ':' || age_band
    WHEN 'ability_test' THEN 'at:' || ability_trait_code || ':' || age_band
  END,
  CASE class_type WHEN 'breed_conformation' THEN 'novice' WHEN 'discipline' THEN 'novice' ELSE 'none' END,
  min_age_game_days, max_age_game_days, sex_restriction, crosses_eligible, requires_gait, target_field_size,
  max_entries_per_stable, judge_id, ideal_vector, ability_weights, ideal_falloff, noise_sd, status,
  judged_game_day, rng_seed, prize_schedule
FROM show_classes;

DROP TABLE show_classes;

ALTER TABLE show_classes_new RENAME TO show_classes;

CREATE INDEX idx_show_classes_show_id ON show_classes (show_id);
CREATE INDEX idx_show_classes_status ON show_classes (status);
-- The on-demand join-or-create lookup (§7.5a): "does a live class matching this catalogue entry and
-- this horse's own rank already exist" - and the idempotency guarantee for a user-triggered create,
-- replacing the UNIQUE(scheduled_game_day, tier) index on shows that used to do that job for the
-- calendar system alone.
CREATE UNIQUE INDEX idx_show_classes_open_key ON show_classes (class_key, rank) WHERE status = 'scheduled';

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
