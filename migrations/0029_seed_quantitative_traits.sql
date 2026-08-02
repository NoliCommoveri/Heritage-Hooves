-- The nine traits TRAITS (src/engines/genetics/polygenic.ts) already computes for every horse.
-- Codes, category, direction and locus_count here must exactly match TRAITS and
-- src/engines/conformation/traits.ts's TRAIT_CATEGORY/TRAIT_DIRECTION maps, in the same order -
-- test/genetics/consistency.test.ts checks it by parsing this file's text.
INSERT INTO quantitative_traits (code, name, category, direction, low_label, high_label, locus_count, teaching_text, enabled, sort_order) VALUES
('neck_length', 'Neck length', 'conformation', 'bidirectional', 'short', 'long', 10,
 'How long the neck is relative to the body. Neither end is right or wrong on its own - which one a breed wants arrives with the first show class.',
 1, 1),
('shoulder_angle', 'Shoulder angle', 'conformation', 'bidirectional', 'upright', 'sloping', 10,
 'How much the shoulder blade slopes. An upright shoulder gives a shorter, choppier stride - a sloping one gives a longer one. Neither is right or wrong on its own.',
 1, 2),
('back_length', 'Back length', 'conformation', 'bidirectional', 'short', 'long', 10,
 'How long the back is relative to the body. Neither end is right or wrong on its own.',
 1, 3),
('hock_set', 'Hock set', 'conformation', 'bidirectional', 'straight', 'angled', 10,
 'How much the hock joint angles. Too straight is called post-legged, too angled is called sickle-hocked - both are real faults, and this is the clearest measurement in the set where the middle is usually what a breed wants.',
 1, 4),
('stamina', 'Stamina', 'ability', 'higher_better', NULL, NULL, 10,
 'How long a horse can keep working before tiring. Revealed by doing, not by looking - not shown here.',
 1, 5),
('jump_scope', 'Jump scope', 'ability', 'higher_better', NULL, NULL, 10,
 'How much natural jumping ability a horse has. Revealed by doing, not by looking - not shown here.',
 1, 6),
('speed', 'Speed', 'ability', 'higher_better', NULL, NULL, 10,
 'How fast a horse can go. Revealed by doing, not by looking - not shown here.',
 1, 7),
('trainability', 'Trainability', 'ability', 'higher_better', NULL, NULL, 10,
 'How readily a horse learns and settles to work. Revealed by doing, not by looking - not shown here.',
 1, 8),
('fertility', 'Fertility', 'hidden', 'higher_better', NULL, NULL, 10,
 'A horse''s underlying fertility. Never shown directly - an owner finds out by trying, not by reading a number.',
 1, 9);
