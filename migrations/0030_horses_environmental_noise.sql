-- Slice 0006 §5.2: the environmental noise roll, written once at birth (CLAUDE.md §5.5 - a later
-- change to conformation_noise_sd must never retroactively move a horse already alive). Nullable is
-- load-bearing: null means "born before this slice", read via the legacy fallback in
-- src/engines/conformation/model.ts, and must stay legal forever rather than being backfilled away.
-- Shape: { "v": 1, "noise": { "neck_length": -2, "shoulder_angle": 4, ... } }, one entry per TRAITS code.
ALTER TABLE horses ADD COLUMN environmental_noise TEXT;
