-- Slice 0022 §A4 step 5: the twelve acquired rows leave horse_conditions/conditions for good, now
-- that horse_incidents/incident_types hold everything they carried. `conditions` is genetics-only
-- from here on, and the six category != 'acquired' guards this move made possible to delete
-- (src/db/incidents.ts's own header names them) are deleted in the same commit as this migration.
DELETE FROM horse_conditions
WHERE condition_code IN (SELECT code FROM conditions WHERE category = 'acquired');

DELETE FROM conditions WHERE category = 'acquired';
