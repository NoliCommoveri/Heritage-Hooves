-- docs/fixes/breed-disease-panels.md, "Signs take time to show": today signs_visible = 1 means
-- visible the instant the horse exists, which is wrong for almost every condition on this panel - a
-- newborn HERDA foal is flagged on the day it is born, and a horse bought at four is flagged with
-- HYPP before anyone has worked it. Two new columns, defaulted to 0 (immediate, today's behaviour)
-- so every existing row keeps its current meaning until migrations/0149 gives each one a real value.
ALTER TABLE conditions ADD COLUMN signs_delay_min_game_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conditions ADD COLUMN signs_delay_max_game_days INTEGER NOT NULL DEFAULT 0;
