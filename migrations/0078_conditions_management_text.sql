-- Slice 0014 §5.3/§7: what a management plan actually consists of, in a sentence a child can read.
-- Nullable - only conditions.severity_class = 'manageable' rows get one (next migration fills
-- HYPP and PSSM1). A plain text column rather than slice 0013 §4.5's management_options JSON: a
-- JSON blob promises a structure (options, prices, effects) that nothing in this slice consumes,
-- and CLAUDE.md §7 with slice 0010 §3.2 are both explicit that an unread column is a promise nobody
-- keeps. If a later slice genuinely needs structured options, it can add them then, against a real
-- reader.
ALTER TABLE conditions ADD COLUMN management_text TEXT;
