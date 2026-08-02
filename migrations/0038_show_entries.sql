-- One horse's entry in one class (slice 0008 §5.5). UNIQUE(class_id, horse_id) is both "a horse
-- can't enter twice" and the backstop against the tick's field-filling stage double-inserting an
-- NPC horse if a tick is re-fired.
CREATE TABLE show_entries (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES show_classes (id),
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  entered_by_stable_id INTEGER NOT NULL REFERENCES stables (id),
  is_npc INTEGER NOT NULL DEFAULT 0,
  entered_game_day INTEGER NOT NULL,
  -- conformation_snapshot: written at ENTRY time - what the horse measured then, plus its age and
  -- coi. { "v": 1, "traits": {"neck_length":58,"shoulder_angle":66,"back_length":40,"hock_set":52},
  --        "age_years": 4.2, "coi": 0.0625 }
  conformation_snapshot TEXT NOT NULL,
  raw_score REAL,
  noise_applied REAL,
  final_score REAL,
  -- score_breakdown: written at JUDGING time - the per-trait table a result screen explains itself
  -- with. { "v": 1, "judge_code": "movement",
  --         "traits": [ { "code": "neck_length", "expressed": 58, "target": 55, "weight": 1.1,
  --                       "trait_score": 94 }, ... ],
  --         "weight_sum": 4.53, "raw_score": 92.65, "noise": -1.31, "final_score": 91.34 }
  score_breakdown TEXT,
  placing INTEGER,
  scored_game_day INTEGER,
  UNIQUE (class_id, horse_id)
);

-- The horse page's show-record card reads every entry for one horse.
CREATE INDEX idx_show_entries_horse_id ON show_entries (horse_id);
