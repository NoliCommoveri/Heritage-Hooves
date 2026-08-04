-- Slice 0020 §6.2: the acute-incident lifecycle. Additive - no CHECK constraint exists on `state`
-- today (confirmed against migrations/0054 and 0077), so the two new values this slice writes
-- ('acute', 'resolved') need no table rebuild, only new rows and new TypeScript-side enum members.
ALTER TABLE horse_conditions ADD COLUMN resolve_game_day INTEGER;
-- Snapshotted at onset: onset_game_day + conditions.trigger.treatmentWindowGameDays AS THAT VALUE
-- STOOD at onset (CLAUDE.md §5.5) - retuning a condition's window later never moves an incident
-- already in progress.
ALTER TABLE horse_conditions ADD COLUMN treated_game_day INTEGER;
-- NULL until the owner pays. Set once, never cleared - a second payment on the same incident is
-- refused (there is nothing left to buy).
ALTER TABLE horse_conditions ADD COLUMN outcome TEXT;
-- NULL while state = 'acute'. Set once, at resolution, to 'resolved' / 'manageable' /
-- 'degenerative' / 'death' - the per-INCIDENT fact eligibility reads, distinct from
-- conditions.severity_class, which stays 'acute' forever as the condition's own general shape.
