-- Slice 0014 §2.3/§8.3: the age-based performance modifier a show entry was actually scored with,
-- snapshotted at judging time so a result's explanation never changes afterwards even though the
-- horse keeps ageing. Mirrors care_modifier_applied (migration 0071) exactly, as its own column,
-- not folded into it (§2.3). Defaults to 1.0 for rows judged before this slice existed - they *were*
-- scored without a decline.
ALTER TABLE show_entries ADD COLUMN age_modifier_applied REAL NOT NULL DEFAULT 1.0;
