-- Slice 0006 §5.1: display metadata for the nine quantitative traits every horse already carries
-- and expresses. This table is NOT the iteration order for anything genetic - TRAITS in
-- src/engines/genetics/polygenic.ts is the single source of truth for that, exactly as LOCI is for
-- Mendelian genes. This table only holds what a player reads or an operator might reword.
CREATE TABLE quantitative_traits (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- category: conformation / ability / hidden. Only 'conformation' rows are displayed anywhere yet.
  category TEXT NOT NULL CHECK (category IN ('conformation', 'ability', 'hidden')),
  -- direction: bidirectional (no good end - realization's anchor is 50) or higher_better (anchor 0).
  -- Decided in src/engines/conformation/traits.ts; mirrored here for display only.
  direction TEXT NOT NULL CHECK (direction IN ('bidirectional', 'higher_better')),
  -- low_label/high_label: the two named extremes shown on screen, e.g. "short"/"long". Null for
  -- ability and hidden traits, which never show a bar.
  low_label TEXT,
  high_label TEXT,
  locus_count INTEGER NOT NULL,
  -- teaching_text: the short note shown to players. Editable without a deploy.
  teaching_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);
