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
--
-- IF EXISTS/IF NOT EXISTS on both statements: applying this from /admin/migrations on the live site
-- failed with "no such index: idx_show_classes_open_key" - the deployed database does not have this
-- index under this name even though 0165 is recorded as applied there and the columns/behaviour it
-- added are visibly live (rank-gated classes work today). The mismatch's cause wasn't tracked down
-- (world reset only ever does DELETE FROM, per src/db/reset.ts, so it isn't that), but the fix holds
-- either way: this statement's job is "make sure the index is gone", which IF EXISTS does whether or
-- not it was ever really there, rather than blocking every migration after it on an index this file
-- has no way to investigate.
DROP INDEX IF EXISTS idx_show_classes_open_key;

CREATE INDEX IF NOT EXISTS idx_show_classes_key_rank_open ON show_classes (class_key, rank, id) WHERE status = 'scheduled';
