-- Slice 0012 §5.1/§5.4/§6.5: the five disciplines deliberately left unseeded when migration 0063
-- shipped Barrel Racing alone (CLAUDE.md §9's "do not build ahead"). A pure-data INSERT, no code
-- change - createShowIfMissing already creates one class per enabled discipline, capped at
-- show_discipline_classes_per_show (6, migration 0066), which now exactly covers all six.
--
-- Weights are from the slice document's table: only ratios matter (the scorer divides by
-- Sum(weight)). Ages are §5.4's; noise_sd values are §6.5's per-discipline population-spread
-- estimates, tuned to put noise in the same proportion to signal a conformation class has at
-- show_noise_sd = 5.
INSERT INTO disciplines (code, name, ability_weights, requires_gait, crosses_eligible, min_age_game_days, default_noise_sd, teaching_text, enabled, sort_order) VALUES
('racing', 'Flat Racing',
 '{"v":1,"traits":{"speed":1.6,"stamina":1.3,"jump_scope":0,"trainability":0.3,"agility":0.2}}',
 0, 1, 720, 6.8,
 'A straight gallop against the clock, the oldest test there is. Rewards raw speed and the stamina to hold it, with little value for finesse.',
 1, 2),
('jumping', 'Show Jumping',
 '{"v":1,"traits":{"speed":0.3,"stamina":0.5,"jump_scope":1.6,"trainability":1.0,"agility":1.0}}',
 0, 1, 1440, 5.5,
 'A course of fences against a time allowed. Rewards a horse with real scope over a jump, the trainability to read a line, and the agility to recover from an awkward stride.',
 1, 3),
('endurance', 'Endurance',
 '{"v":1,"traits":{"speed":0.4,"stamina":1.8,"jump_scope":0,"trainability":0.5,"agility":0.2}}',
 0, 1, 1800, 7.3,
 'A long-distance ride measured on time and soundness. Rewards stamina above everything else - a fast horse that cannot last the distance is no use here.',
 1, 4),
('dressage', 'Dressage',
 '{"v":1,"traits":{"speed":0.1,"stamina":0.8,"jump_scope":0.2,"trainability":1.6,"agility":0.9}}',
 0, 1, 1440, 6.2,
 'A pattern of precise, controlled movements. Rewards a horse that is supple, obedient and easy to train more than one that is fast or bold.',
 1, 5),
('gaited', 'Gaited Pleasure',
 '{"v":1,"traits":{"speed":0.6,"stamina":0.5,"jump_scope":0,"trainability":1.2,"agility":1.0}}',
 1, 1, 1080, 5.8,
 'A smooth, four-beat gait shown at a relaxed pace, open only to a horse that actually carries the gait. Rewards trainability and agility over raw speed.',
 1, 6);
