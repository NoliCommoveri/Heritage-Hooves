-- Slice 0013 §2.5. Barn-wide, not per horse. The value is a key into config.values.feed_levels;
-- an unrecognised value reads as 'standard' in the engine rather than throwing, so retiring a feed
-- level from config can never break a page.
ALTER TABLE stables ADD COLUMN feed_level TEXT NOT NULL DEFAULT 'standard';
