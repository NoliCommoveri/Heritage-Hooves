-- docs/fixes/breed-disease-panels.md's second leftover: migrations/0131 recreated
-- resolve_game_day/treated_game_day/outcome on horse_incidents, and migrations/0133 deleted every
-- acquired-condition row from horse_conditions, so the three columns migrations/0122 added for the
-- acquired-incident lifecycle are now written by nothing and read by nothing on this table -
-- CLAUDE.md's own "a nullable column nothing touches is a promise nobody keeps" rule (slice 0010
-- §3.2). Dropped rather than left dead.
ALTER TABLE horse_conditions DROP COLUMN resolve_game_day;
ALTER TABLE horse_conditions DROP COLUMN treated_game_day;
ALTER TABLE horse_conditions DROP COLUMN outcome;
