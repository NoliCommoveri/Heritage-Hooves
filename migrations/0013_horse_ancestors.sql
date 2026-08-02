-- The pedigree table. Written once at birth (buildAncestorRows), never updated. depth is part of
-- the primary key on purpose: the same ancestor can reach a horse by paths of different lengths
-- (a grandsire who is also a great-great-grandsire), and collapsing those loses information the
-- pedigree display wants. path_count is the number of distinct paths of exactly that depth - it
-- does not feed the COI calculation (see src/engines/genetics/pedigree.ts for why).
CREATE TABLE horse_ancestors (
  descendant_id INTEGER NOT NULL REFERENCES horses (id),
  ancestor_id INTEGER NOT NULL REFERENCES horses (id),
  depth INTEGER NOT NULL,
  path_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (descendant_id, ancestor_id, depth)
);
