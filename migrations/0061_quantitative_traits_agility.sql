-- Slice 0012 §4.1/§6.1: a fifth ability trait, appended after fertility in TRAITS
-- (src/engines/genetics/polygenic.ts) so it draws last and every earlier trait's RNG sequence is
-- untouched. Display metadata only - see traits.ts for what the engine computes with.
INSERT INTO quantitative_traits (code, name, category, direction, low_label, high_label, locus_count, teaching_text, enabled, sort_order) VALUES
('agility', 'Agility', 'ability', 'higher_better', NULL, NULL, 10,
 'How quickly and cleanly a horse can turn, stop and change direction. Revealed by doing, not by looking - not shown here.',
 1, 10);
