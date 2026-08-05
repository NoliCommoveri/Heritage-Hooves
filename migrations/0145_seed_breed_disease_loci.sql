-- Seven single-gene disease loci, appended after PATN1 (sort_order 20-26) - docs/fixes/
-- breed-disease-panels.md, closing the gap docs/breed-disease-panels.md left open: six new loci
-- for Arabian/German Warmblood/Friesian, plus DSLD for Paso Fino (not in that document - added by
-- the fix so Paso Fino has a real panel too, since it has no confirmed single locus in reality and
-- this game models it with one anyway, disclosed as a simplification in the teaching text below).
-- Codes, alleles (in canonical order) and sort_order here must exactly match
-- src/engines/genetics/loci.ts's LOCI constant - test/genetics/consistency.test.ts checks it by
-- parsing this file's text, the same way it already checks 0050 and 0113.
--
-- Appended, never inserted earlier: inheritance.ts draws one allele per locus in LOCI order from a
-- single RNG stream, so a locus inserted anywhere but the end would shift every draw after it and
-- the same stored seed would stop producing the same horse.
--
-- Wild type is N and is alleles[0] for all seven, the same convention 0050's four disease loci use.
-- MCOA (Icelandic) needs no locus row here - it reads the existing Silver locus (Z) a second way,
-- homozygous, seeded in migrations/0113. See migrations/0147 for its conditions row.
INSERT INTO loci (code, name, category, inheritance, alleles, teaching_text, enabled, sort_order) VALUES
('SCID', 'Severe combined immunodeficiency', 'disease', 'recessive', '["N","Sc"]',
 'A recessive condition. It takes two copies, one from each parent, to cause it. A foal with two copies has no working immune system and cannot fight off infection, though it looks perfectly healthy at birth.',
 1, 20),
('CA', 'Cerebellar abiotrophy', 'disease', 'recessive', '["N","Ca"]',
 'A recessive condition. It takes two copies, one from each parent, to cause it. Affects balance and coordination by damaging part of the brain that controls movement.',
 1, 21),
('LFS', 'Lavender foal syndrome', 'disease', 'recessive', '["N","Lv"]',
 'A recessive and lethal condition. It takes two copies, one from each parent, to cause it. A foal with two copies has severe seizures from birth and does not survive, unlike some other lethal conditions where a foal looks well at first.',
 1, 22),
('WFFS', 'Warmblood fragile foal syndrome', 'disease', 'recessive', '["N","Wf"]',
 'A recessive and lethal condition. It takes two copies, one from each parent, to cause it. Skin and connective tissue too fragile to hold together, visible at birth.',
 1, 23),
('DWARF', 'Dwarfism', 'disease', 'recessive', '["N","Dw"]',
 'A recessive condition. It takes two copies, one from each parent, to cause it. Short limbs and an oversized head, visible from birth and permanent, though not life shortening.',
 1, 24),
('HYDRO', 'Hydrocephalus', 'disease', 'recessive', '["N","Hy"]',
 'A recessive condition. It takes two copies, one from each parent, to cause it. Fluid builds up around the brain before birth, causing a visibly enlarged head.',
 1, 25),
('DSLD', 'Degenerative suspensory ligament desmitis', 'disease', 'recessive', '["N","Dsld"]',
 'A recessive condition, modelled here with one gene as a simplification - real DSLD has no single confirmed cause yet. Two copies cause the ligaments supporting the legs to break down over time.',
 1, 26);
