-- Slice 0014 §2.6/§2.7/§6.4: three heritable soundness traits, appended after agility in TRAITS
-- (src/engines/genetics/polygenic.ts) so they draw last and every earlier trait's RNG sequence is
-- untouched. Display metadata only, same shape as the fertility row - nothing reads these yet
-- (no onset roll, no screening, no condition mapping); they exist purely so a horse born from this
-- deploy onward carries them, because TRAITS is append-only and a genotype is written once at birth.
INSERT INTO quantitative_traits (code, name, category, direction, low_label, high_label, locus_count, teaching_text, enabled, sort_order) VALUES
('foot_robustness', 'Foot robustness', 'hidden', 'higher_better', NULL, NULL, 10,
 'A horse''s underlying soundness of foot. Never shown directly - nothing reads this trait yet.',
 1, 11),
('joint_robustness', 'Joint robustness', 'hidden', 'higher_better', NULL, NULL, 10,
 'A horse''s underlying soundness of joint. Never shown directly - nothing reads this trait yet.',
 1, 12),
('ligament_robustness', 'Ligament robustness', 'hidden', 'higher_better', NULL, NULL, 10,
 'A horse''s underlying soundness of ligament. Never shown directly - nothing reads this trait yet.',
 1, 13);
