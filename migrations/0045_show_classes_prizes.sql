-- Prize money at judging (slice 0009 §4.4). Two tables, one file - both columns are half of the
-- same feature and the comment covers both, per CLAUDE.md §8's "one is fine if the comment covers
-- it" allowance.
--
-- prize_schedule: the purse snapshotted onto the class at creation (CLAUDE.md §5.5), the same
-- treatment ideal_vector/noise_sd/ideal_falloff already get - a class judged after the purse is
-- retuned still pays what it advertised when it opened. JSON array, index 0 = first place, e.g.
-- [600, 350, 200, 120, 80, 50]. Placings beyond the end of the array pay nothing.
ALTER TABLE show_classes ADD COLUMN prize_schedule TEXT NOT NULL DEFAULT '[]';

-- prize_paid: what was actually paid to this entry, so a result screen years later can say so
-- without re-deriving it from a schedule that has since changed.
ALTER TABLE show_entries ADD COLUMN prize_paid INTEGER NOT NULL DEFAULT 0;
