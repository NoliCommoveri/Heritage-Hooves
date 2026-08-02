-- Four single-gene disease loci, appended after DMRT3 (sort_order 6-9) - slice 0010 §4.1. Codes,
-- alleles (in canonical order) and sort_order here must exactly match
-- src/engines/genetics/loci.ts's LOCI constant - test/genetics/consistency.test.ts checks it by
-- parsing this file's text, the same way it already checks 0015_seed_loci.sql.
--
-- Appended, never inserted earlier: inheritance.ts draws one allele per locus in LOCI order from a
-- single RNG stream, so a locus inserted anywhere but the end would shift every draw after it and
-- the same stored seed would stop producing the same horse.
--
-- The wild type is N and is alleles[0] for all four, unlike most of the five loci in
-- 0015_seed_loci.sql. Every horse alive before this migration has no key for these loci in its
-- genotype blob, so getMendelianPair reads two copies of N - clear, for all four - with nothing
-- backfilled. No backfill migration exists here on purpose; see CLAUDE.md's slice 0010 entry.
INSERT INTO loci (code, name, category, inheritance, alleles, teaching_text, enabled, sort_order) VALUES
('HYPP', 'Hyperkalemic periodic paralysis', 'disease', 'dominant', '["N","H"]',
 'A dominant condition. One copy is enough to cause episodes of muscle tremors and weakness. It traces to one enormously successful Quarter Horse sire, and it spread because the same genetics that caused it also produced the muscling that won halter classes.',
 1, 6),
('PSSM1', 'Type 1 polysaccharide storage myopathy', 'disease', 'dominant', '["N","P1"]',
 'A dominant condition affecting how muscle stores sugar, causing tying-up episodes with hard work. One copy is enough to cause it.',
 1, 7),
('HERDA', 'Hereditary equine regional dermal asthenia', 'disease', 'recessive', '["N","Hrd"]',
 'A recessive condition. A horse needs two copies to be affected. The skin does not hold together properly and splits easily under saddle pressure. A horse with only one copy is a healthy carrier.',
 1, 8),
('GBED', 'Glycogen branching enzyme deficiency', 'disease', 'recessive', '["N","Gb"]',
 'A recessive and lethal condition. A horse needs two copies to be affected, one from each parent. A foal with two copies cannot store sugar the way a body needs to, and does not survive. A horse with only one copy is a healthy carrier its whole life.',
 1, 9);
