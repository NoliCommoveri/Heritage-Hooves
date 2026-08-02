-- A show judge: a fixed multiplier per conformation trait, centred on 1.0 (slice 0008 §4.3/§5.1).
-- A missing trait key in trait_weights reads as 1.0 - the same missing-key discipline the genotype
-- blob uses (CLAUDE.md §11's slice-0002 entry) - so a judge row written before a fifth
-- conformation trait exists keeps working.
CREATE TABLE judges (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- blurb: one plain sentence shown on the show page, e.g. "Likes a horse that moves - weights the
  -- shoulder above everything else." Editable from D1's console without a deploy.
  blurb TEXT NOT NULL,
  -- trait_weights: JSON, { "v": 1, "traits": { "neck_length": 1.1, "shoulder_angle": 1.6, ... } }
  trait_weights TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);
