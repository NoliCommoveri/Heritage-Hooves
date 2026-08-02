-- Slice 0007 §5.1: how many numbered pictures exist for a breed, e.g. qh-01.webp..qh-03.webp when
-- image_count is 3. Default 0 means every existing breed row is correct with no backfill - a breed
-- with no images yet behaves exactly like the empty state, not a special case.
ALTER TABLE breeds ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
