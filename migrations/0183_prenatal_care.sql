-- Slice 0028 §2.7, migration 7 of 8: mare prenatal care. Two columns for one indivisible mechanic -
-- the flag has to exist on BOTH ends of the same covering/pregnancy pair to mean anything (a
-- covering commits it before the foal exists; the pregnancy snapshots it for the record once one
-- exists), so this is one migration rather than CLAUDE.md §8's usual one-table-per-file split.
--
-- coverings.prenatal_care: 0/1, set at booking time (the moment a player or NPC commits and pays
-- prenatal_care_cost - src/db/coverings.ts's bookCovering). Read at conception (resolveOneCovering)
-- to decide which ratchet a freshly-combined foal genotype gets (typeGene.ts's
-- applyBaselineRatchet vs applyCareRatchet - the operator's 2026-08-07 replacement for this
-- section's original "moves the worst trait two rungs" wording).
--
-- pregnancies.prenatal_care: copied over at conception, purely for the record (a foal's own card can
-- say prenatal care was bought) - the genotype effect is already baked into rolled_genotype by the
-- time this row is written, so nothing ever reads this column to decide anything.
ALTER TABLE coverings ADD COLUMN prenatal_care INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pregnancies ADD COLUMN prenatal_care INTEGER NOT NULL DEFAULT 0;

UPDATE config
SET version = version + 1,
    "values" = json_set("values", '$.prenatal_care_cost', 500),
    updated_real_ts = unixepoch()
WHERE id = 1;
