-- Slice 0013 §2.1/§8.4: the care modifier a show entry was actually scored with, snapshotted at
-- judging time so a result's explanation never changes afterwards even though the horse's own care
-- state keeps moving. Defaults to 1.0 (normal) for the rows judged before this slice existed.
ALTER TABLE show_entries ADD COLUMN care_modifier_applied REAL NOT NULL DEFAULT 1.0;
