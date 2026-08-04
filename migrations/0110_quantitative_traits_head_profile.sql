-- head_profile, the fifth conformation trait (slice 0021 §3). Appended to TRAITS, never inserted -
-- see src/engines/genetics/polygenic.ts. Scale: 1 = extreme dish, 50 = straight, 100 = Roman nose.
INSERT INTO quantitative_traits (code, name, category, direction, low_label, high_label, locus_count, teaching_text, enabled, sort_order) VALUES
('head_profile', 'Head profile', 'conformation', 'bidirectional', 'dished', 'Roman', 10,
 'The line of the face seen from the side. A dished head curves inward, a Roman nose curves outward, and most horses sit somewhere near straight between them. Which one is right depends entirely on the breed - the dish that wins an Arabian class would be a fault on a Friesian.',
 1, 14);
