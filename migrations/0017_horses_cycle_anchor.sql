-- Slice 0003 §3.2: each mare's slot in her oestrous cycle, measured in ticks (not game days - see
-- slice 0003 §2, a real 21-day cycle aliases badly against a 10-game-day tick). Null for
-- stallions and geldings, and null for mares until something sets it (creation, or the backfill in
-- 0021 for mares that already exist).
ALTER TABLE horses ADD COLUMN cycle_anchor_tick_seq INTEGER;
