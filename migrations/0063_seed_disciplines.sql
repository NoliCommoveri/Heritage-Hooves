-- Slice 0012 §5.1/§5.4/§6.3. Only Barrel Racing is seeded this session - the other five
-- disciplines (racing, jumping, endurance, dressage, gaited) are specified in
-- docs/slices/0012-discipline-shows.md §5.1 but deliberately not built yet. Adding one later is a
-- pure-data INSERT into this table, no code change, once it's actually wanted (CLAUDE.md §9's
-- "do not build ahead").
--
-- Weights are from the slice document's table: only ratios matter (the scorer divides by
-- Sum(weight)), and agility (1.5) is the dominant trait - the property that makes Barrel Racing a
-- different question from Flat Racing (both speed-led) once racing is added.
INSERT INTO disciplines (code, name, ability_weights, requires_gait, crosses_eligible, min_age_game_days, default_noise_sd, teaching_text, enabled, sort_order) VALUES
('barrels', 'Barrel Racing',
 '{"v":1,"traits":{"speed":1.4,"stamina":0.2,"jump_scope":0,"trainability":0.8,"agility":1.5}}',
 0, 1, 1080, 3.0,
 'A cloverleaf around three barrels, run against the clock. Rewards a horse that turns tight and comes off a barrel without losing its feet - agility and speed matter most, stamina barely at all.',
 1, 1);
