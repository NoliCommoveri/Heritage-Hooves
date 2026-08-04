-- Slice 0022 §A2/§A4 step 3: horse_incidents, the per-episode replacement for the acquired rows
-- horse_conditions used to carry. Same lifecycle columns migrations/0122/0077 added to
-- horse_conditions for this purpose, moved onto their own table with their own foreign key.
CREATE TABLE horse_incidents (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  incident_type_code TEXT NOT NULL REFERENCES incident_types (code),
  -- state: 'acute' while open, 'resolved' once the outcome roll has fired.
  state TEXT NOT NULL,
  onset_game_day INTEGER NOT NULL,
  -- resolve_game_day: onset_game_day + this incident type's own treatment_window_game_days AS IT
  -- STOOD at onset (CLAUDE.md §5.5) - retuning a window later never moves an incident already in
  -- progress.
  resolve_game_day INTEGER,
  -- treated_game_day: NULL until the owner pays. Set once, never cleared.
  treated_game_day INTEGER,
  -- outcome: NULL while state = 'acute'. Set once, at resolution, to 'resolved' / 'manageable' /
  -- 'degenerative' / 'death'.
  outcome TEXT,
  -- management_state/management_until_game_day: only meaningful for an outcome = 'manageable' row,
  -- same shape migrations/0077 gave the genetic manageable conditions.
  management_state TEXT NOT NULL DEFAULT 'unmanaged',
  management_until_game_day INTEGER,
  last_evaluated_game_day INTEGER NOT NULL
);

-- The tick's onset-check and resolution stages both scan open rows by horse.
CREATE INDEX idx_horse_incidents_horse_id ON horse_incidents (horse_id);
-- The resolution stage's due-today scan.
CREATE INDEX idx_horse_incidents_state_resolve ON horse_incidents (state, resolve_game_day);
-- /admin/incidents' per-type open counts and outcome distribution.
CREATE INDEX idx_horse_incidents_type_state ON horse_incidents (incident_type_code, state);
