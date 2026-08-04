-- Slice 0020 §6.3/§7.1: idempotency marker for the tick's onset-check stage (CLAUDE.md §5.4), the
-- same pattern last_processed_tick_seq already establishes on stables/pregnancies, scoped per horse
-- here because the check itself is per horse. Named _game_day rather than _tick_seq (unlike that
-- precedent) because the onset-probability math needs a day count, not a tick count - the slice
-- document itself flagged this naming correction (§7.1) and this migration applies it directly
-- rather than shipping the mismatch.
ALTER TABLE horses ADD COLUMN last_incident_check_game_day INTEGER NOT NULL DEFAULT 0;
