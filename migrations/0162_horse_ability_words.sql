-- Slice 0025 stage 3 §7.4: the permanent word an ability-test class leaves behind - "the first time
-- anything in the game has ever shown an ability value to anyone" (ABILITY_TRAITS is otherwise never
-- displayed - src/engines/conformation/model.ts's own comment). One row per (horse, trait), upserted
-- each time that horse is judged in an 'ability_test' class for that trait - the same
-- upsert-a-summary-row shape horse_show_summary already uses (migration 0039), not an append-only
-- history table, since only the most recent word is ever shown.
--
-- The word is read off the horse's own true expressed value at judging time (before noise, care or
-- age modifiers - those describe the judge's day and the horse's upkeep, not its raw ability), using
-- the same Poor/Weak/Acceptable/Good/Outstanding vocabulary conformation_label_* already bands
-- (src/engines/conformation/labels.ts's bandForTraitScore, reused rather than a second vocabulary -
-- CLAUDE.md §13). "The word describes the horse's own result, not its rank" (the slice's own words):
-- banding the true expressed value, never the noisy final_score or the placing, is what keeps that
-- true regardless of who else showed up that day.
CREATE TABLE horse_ability_words (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  trait_code TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('poor', 'weak', 'acceptable', 'good', 'outstanding')),
  entry_id INTEGER NOT NULL REFERENCES show_entries (id),
  game_day INTEGER NOT NULL,
  UNIQUE (horse_id, trait_code)
);

-- The horse page's Ability card: every word this horse has earned, in one query.
CREATE INDEX idx_horse_ability_words_horse_id ON horse_ability_words (horse_id);
