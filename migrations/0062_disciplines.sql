-- Slice 0012 §6.2: reference data for a discipline show class, the counterpart to `breeds` for the
-- breed-conformation classes. A show_classes row snapshots one of these at creation and never
-- re-reads it (CLAUDE.md §5.5) - exactly the relationship breeds.ideal_vector already has with
-- show_classes.ideal_vector.
CREATE TABLE disciplines (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- ability_weights: JSON, { "v": 1, "traits": { "speed": 1.4, "stamina": 0.2, "jump_scope": 0,
  -- "trainability": 0.8, "agility": 1.5 } }. A missing key reads as 0 (§5.1) - the opposite of
  -- judges.trait_weights, where a missing key reads as 1.0 ("no opinion, use the default"). Write
  -- every key explicitly, even at 0, so the row reads as a complete statement.
  ability_weights TEXT NOT NULL,
  requires_gait INTEGER NOT NULL DEFAULT 0,
  crosses_eligible INTEGER NOT NULL DEFAULT 1,
  min_age_game_days INTEGER NOT NULL,
  -- default_noise_sd: this discipline's default, copied onto the class at creation. Per-discipline
  -- rather than one config value because an ability composite's population spread depends on its
  -- own weight vector (§6.5 of the slice document has the arithmetic).
  default_noise_sd REAL NOT NULL,
  teaching_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);
