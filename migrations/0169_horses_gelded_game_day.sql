-- Slice 0026 stage 1 (§1.2): the day a stallion was gelded, null for every horse that never was.
-- Drives the recovery window (gelding_recovery_game_days, checked against gameDay - this column)
-- and the show-noise relief's isGelding branch does not need it - that reads horses.sex alone.
ALTER TABLE horses ADD COLUMN gelded_game_day INTEGER;
