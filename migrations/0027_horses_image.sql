-- Slice 0007 §5.2: a horse's chosen picture. image_url is a root-relative path into the library
-- (e.g. /horses/qh-03.webp), never an absolute URL with a hostname, so the site can survive moving
-- domains. Both columns are null exactly together - null means no picture chosen yet, which is the
-- correct reading for every horse alive before this slice as well as an unpicked new foal (no
-- auto-assign - slice 0007 §2.4). image_source only ever gets 'library' written by this slice;
-- 'custom' and 'generated' are legal values reserved for later, unbuilt slices (§2.5, §3).
ALTER TABLE horses ADD COLUMN image_url TEXT;
ALTER TABLE horses ADD COLUMN image_source TEXT
  CHECK (image_source IS NULL OR image_source IN ('library', 'custom', 'generated'));
