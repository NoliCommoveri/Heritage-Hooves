-- Reverses part of migration 0165 (slice 0025 stage 4): the operator wants same-day requests from
-- one household to land in separate parallel classes once a live class fills, not be refused
-- (CLAUDE.md, "entry_cap_reached" walkback, 2026-08-06) - four-plus horses entered at once should
-- get as many same-rank classes as they need, not three refusals.
--
-- idx_show_classes_open_key enforced "at most one scheduled class per (class_key, rank)", which is
-- exactly the constraint standing in the way. Dropped with no unique replacement - requestClassEntry
-- (src/db/shows.ts) now finds the oldest joinable live class with room and mints a new parallel one
-- only when none has room, so several scheduled rows sharing a (class_key, rank) are now expected,
-- not a bug. A plain index on the same columns replaces it for that lookup's own WHERE/ORDER BY.
DROP INDEX idx_show_classes_open_key;

CREATE INDEX idx_show_classes_key_rank_open ON show_classes (class_key, rank, id) WHERE status = 'scheduled';
