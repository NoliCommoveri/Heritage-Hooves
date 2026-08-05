-- Per-condition signs delays, docs/fixes/breed-disease-panels.md - a blanket delay would be wrong
-- in the other direction, since dwarfism, hydrocephalus, lavender foal syndrome, WFFS and MCOA
-- genuinely are visible at birth. Three bands:
--   100-250 game days: the default - episodes under work and stress (HYPP, PSSM1, HERDA).
--   20-60 game days: cerebellar abiotrophy - real onset is weeks after birth, not months.
--   250-400 game days: DSLD - adult onset by nature.
-- Everything visible at birth (DWARF, HYDRO, LFS, WFFS, MCOA) keeps the 0/0 default
-- migrations/0148 just set and needs no row here. So do GBED, LWO and SCID - all three have
-- signs_visible = 0, so no delay column is ever read for them.
UPDATE conditions SET signs_delay_min_game_days = 100, signs_delay_max_game_days = 250 WHERE code IN ('HYPP', 'PSSM1', 'HERDA');
UPDATE conditions SET signs_delay_min_game_days = 20, signs_delay_max_game_days = 60 WHERE code = 'CA';
UPDATE conditions SET signs_delay_min_game_days = 250, signs_delay_max_game_days = 400 WHERE code = 'DSLD';
