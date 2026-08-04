-- Slice 0022 §A6: how far back the horse page's Incidents card looks. Display-only (rows are never
-- deleted, CLAUDE.md §5.5's "live tunable" - read fresh at render time, not snapshotted onto
-- anything). 720 = two game years at today's game_days_per_year of 360.
UPDATE config
SET version = version + 1,
    "values" = json_set("values", '$.incident_history_game_days', 720),
    updated_real_ts = unixepoch()
WHERE id = 1;
