-- A player-paused account (distinct from `active`, which is admin-deactivated/soft-deleted).
-- A paused account can still log in but every player action is gated behind a "This account is
-- paused" page except unpausing itself; the tick still ages/kills its horses, foals its
-- pregnancies, runs its listings to expiry and judges its show entries, but stops charging its
-- board and stops rolling new acquired incidents for it. paused_real_ts is audit-trail only (when
-- the pause began, wall clock) - never read to decide anything, per CLAUDE.md 5.3.
ALTER TABLE accounts ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN paused_real_ts INTEGER;
