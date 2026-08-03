-- Care timers (slice 0013 §4.1). Game-day columns, per CLAUDE.md §7's *_game_day suffix rule.
-- NULL means "never called" - the modifier's ramp then runs from the horse's care start age
-- (born_game_day + care_start_age_game_days), not from birth, so a foal is never overdue.
ALTER TABLE horses ADD COLUMN last_farrier_game_day INTEGER;
ALTER TABLE horses ADD COLUMN last_vet_game_day INTEGER;
-- The tick's own idempotency marker for the once-per-crossing overdue notice (§7.2): set the game
-- day a horse was last counted as newly overdue, cleared back to NULL the moment either service is
-- called, so the next time it falls overdue, months later, it is noticed again.
ALTER TABLE horses ADD COLUMN care_notice_game_day INTEGER;
