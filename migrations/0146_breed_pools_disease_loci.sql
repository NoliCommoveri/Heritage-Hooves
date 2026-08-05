-- Every seeded breed's founding_allele_pool must list every locus in LOCI (slice 0002 §3.5's rule)
-- - so the migration adding the seven new disease loci to LOCI also updates all eight breeds' pools
-- here, in the same push. docs/fixes/breed-disease-panels.md.
--
-- Each statement rewrites a breed's whole pool as a literal, the same choice 0051/0114 made and for
-- the same reason: this table is edited approximately never, and a full literal is what
-- test/genetics/consistency.test.ts can parse directly. The nineteen loci from 0114 (E through
-- PATN1) are copied unchanged for every breed except two deliberate widenings, both explained below.
--
-- PSSM1 widened to German Warmblood and Paso Fino (from {"N":1.0} to the same 0.03 frequency the
-- Quarter Horse already carries): PSSM1 genuinely occurs beyond the Quarter Horse in real
-- populations - warmbloods and gaited breeds among them - and confining it to one breed was a
-- slice 0010 simplification, not biology. Widening it is also what gives German Warmblood and Paso
-- Fino a second panel condition apiece with no new locus invented for either.
--
-- Frequencies for the seven new keys are docs/breed-disease-panels.md §7 verbatim for the six loci
-- it specifies, plus one new number for DSLD (Paso Fino only, 0.05 - not in that document, chosen
-- to sit in the same range as the other single-locus degenerative conditions, e.g. CA at 0.05).
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.03,"g":0.97},"DMRT3":{"C":0.98,"A":0.02},"HYPP":{"N":0.98,"H":0.02},"PSSM1":{"N":0.97,"P1":0.03},"HERDA":{"N":0.94,"Hrd":0.06},"GBED":{"N":0.95,"Gb":0.05},"D":{"D":0.03,"nd":0.97},"Z":{"z":1.0},"CH":{"Ch":0.01,"ch":0.99},"RN":{"Rn":0.06,"rn":0.94},"TO":{"TO":0.02,"n":0.98},"O":{"O":0.03,"n":0.97},"SW1":{"SW1":0.02,"n":0.98},"SB1":{"SB1":0.05,"n":0.95},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'QH';

-- Arabian: SCID, CA and LFS all belong here - its real signature panel.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.60,"a":0.40},"CR":{"cr":1.0},"G":{"G":0.20,"g":0.80},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":0.97,"Sc":0.03},"CA":{"N":0.95,"Ca":0.05},"LFS":{"N":0.98,"Lv":0.02},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'AR';

-- Thoroughbred: none of the seven - its real problems are polygenic (docs/breed-disease-panels.md §6.5).
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.65,"a":0.35},"CR":{"cr":1.0},"G":{"G":0.04,"g":0.96},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'TB';

-- German Warmblood: WFFS, its real signature condition, plus the PSSM1 widening described above.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.70,"a":0.30},"CR":{"cr":1.0},"G":{"G":0.08,"g":0.92},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":0.97,"P1":0.03},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"TO":0.04,"n":0.96},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":0.96,"Wf":0.04},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'GW';

-- Friesian: dwarfism and hydrocephalus, both real and named in this breed.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.92,"e":0.08},"A":{"a":1.0},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":0.94,"Dw":0.06},"HYDRO":{"N":0.96,"Hy":0.04},"DSLD":{"N":1.0}}' WHERE code = 'FR';

-- Paso Fino: DSLD, plus the PSSM1 widening described above.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.50,"a":0.50},"CR":{"Cr":0.12,"cr":0.88},"G":{"G":0.08,"g":0.92},"DMRT3":{"A":0.95,"C":0.05},"HYPP":{"N":1.0},"PSSM1":{"N":0.97,"P1":0.03},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.05,"nd":0.95},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"Rn":0.05,"rn":0.95},"TO":{"TO":0.10,"n":0.90},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"SB1":0.06,"n":0.94},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":0.95,"Dsld":0.05}}' WHERE code = 'PF';

-- Icelandic: none of the seven new loci - its own condition (MCOA) reads the existing Silver locus
-- a second way and needs no pool change here (see migrations/0147).
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.10,"g":0.90},"DMRT3":{"A":0.90,"C":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.20,"nd":0.80},"Z":{"Z":0.12,"z":0.88},"CH":{"ch":1.0},"RN":{"Rn":0.04,"rn":0.96},"TO":{"TO":0.08,"n":0.92},"O":{"n":1.0},"SW1":{"SW1":0.06,"n":0.94},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'IC';

-- Nokota: none of the seven, deliberately - the healthy outcross (docs/breed-disease-panels.md §6.6).
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.40,"a":0.60},"CR":{"cr":1.0},"G":{"G":0.02,"g":0.98},"DMRT3":{"C":0.90,"A":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.12,"nd":0.88},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"Rn":0.25,"rn":0.75},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"Lp":0.10,"lp":0.90},"PATN1":{"PATN1":0.08,"n":0.92},"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0},"DSLD":{"N":1.0}}' WHERE code = 'NOK';
