-- Every Mendelian locus the genetics engine knows about - colour and gait now, single-gene
-- disease later. Holds only what players read and what an operator might reword (name, category,
-- teaching text) - never the expression rules, which are code (src/engines/genetics/expression.ts).
CREATE TABLE loci (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- category: base / dilution / modifier / gait. (pattern / appaloosa / disease arrive later.)
  category TEXT NOT NULL,
  -- inheritance: dominant / recessive / incomplete_dominant / complex. Documentation only.
  inheritance TEXT NOT NULL,
  -- alleles: JSON array of allele symbols in canonical order, e.g. ["E","e"]. This order is the
  -- one every stored genotype pair must be sorted into - see src/engines/genetics/loci.ts.
  alleles TEXT NOT NULL,
  -- teaching_text: the short genetics note shown to players. Editable without a deploy.
  teaching_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);
