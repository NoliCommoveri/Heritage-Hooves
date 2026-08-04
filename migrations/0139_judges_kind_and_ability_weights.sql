-- Slice 0024 §2: a judge now has a kind - 'conformation' (the three seeded in 0032/0033, judging
-- breed classes on trait_weights) or 'discipline' (new, judging performance classes on
-- ability_weights). Existing rows default to 'conformation' so nothing already seeded moves pools
-- or changes behaviour.
--
-- No CHECK enforcing the trait_weights/ability_weights pairing. SQLite/D1 cannot ALTER a CHECK
-- constraint, so enforcing one here would mean the full create-copy-drop-rename rebuild migration
-- 0064 had to do for show_classes - and that rebuild is expensive specifically because show_classes
-- has show_entries hanging off it by foreign key, which judges also does (show_classes.judge_id).
-- Two nullable columns do not warrant pulling that chain in; breeds.ideal_vector (0034) sets the
-- same precedent for a nullable reference-data column with no CHECK.
ALTER TABLE judges ADD COLUMN kind TEXT NOT NULL DEFAULT 'conformation';

-- ability_weights: JSON, { "v": 1, "traits": { "speed": 1.3, "stamina": 0.9, ... } } - same shape
-- and missing-key-reads-as-1.0 convention as trait_weights, applied as a second multiplier
-- alongside a discipline's own ability_weights the same way trait_weights is for a conformation
-- class (scoreAbilityEntry's new judgeWeights parameter). Null for a 'conformation' judge.
ALTER TABLE judges ADD COLUMN ability_weights TEXT;
