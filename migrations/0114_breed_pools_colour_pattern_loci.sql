-- Every seeded breed's founding_allele_pool must list every locus in LOCI (slice 0002 §3.5's rule,
-- restated in src/engines/founding/pool.ts) - so the migration adding the ten colour/pattern loci
-- to LOCI also updates all eight breeds' pools here, in the same push. Mandatory, not optional:
-- parseAllelePool throws for every breed the moment LOCI grows, which means founding stock
-- generation, the consignment dealer, admin horse creation and /admin/breeds all break between
-- 0113 landing and this migration landing - slice 0021 §4.3.
--
-- Each statement rewrites a breed's whole pool as a literal, the same choice 0051 made and for the
-- same reason given there: this table is edited approximately never, and a full literal is what
-- test/genetics/consistency.test.ts can parse directly rather than having to replay a chain of
-- json_set patches. The nine loci from 0051 (E through GBED) are copied unchanged; only the ten new
-- keys are added.
--
-- New-locus frequencies are the operator's own breed-relevance notes: a breed that doesn't carry a
-- given allele in reality is seeded at ~0% for it, not excluded from the schema - the schema
-- requires the key to be present regardless.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.03,"g":0.97},"DMRT3":{"C":0.98,"A":0.02},"HYPP":{"N":0.98,"H":0.02},"PSSM1":{"N":0.97,"P1":0.03},"HERDA":{"N":0.94,"Hrd":0.06},"GBED":{"N":0.95,"Gb":0.05},"D":{"D":0.03,"nd":0.97},"Z":{"z":1.0},"CH":{"Ch":0.01,"ch":0.99},"RN":{"Rn":0.06,"rn":0.94},"TO":{"TO":0.02,"n":0.98},"O":{"O":0.03,"n":0.97},"SW1":{"SW1":0.02,"n":0.98},"SB1":{"SB1":0.05,"n":0.95},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'QH';

-- Arabian: none of the ten new loci - E/A/G already describe the breed completely.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.60,"a":0.40},"CR":{"cr":1.0},"G":{"G":0.20,"g":0.80},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'AR';

-- Thoroughbred: the operator's note said "W only", and W is dropped, so nothing new here. A solid-
-- coloured breed, and this is what that looks like in data - not an oversight.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.65,"a":0.35},"CR":{"cr":1.0},"G":{"G":0.04,"g":0.96},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'TB';

-- German Warmblood: the growing pinto warmblood lines, nothing else.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.70,"a":0.30},"CR":{"cr":1.0},"G":{"G":0.08,"g":0.92},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"TO":0.04,"n":0.96},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'GW';

-- Friesian: fixed black, famously - none of the ten new loci either.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.92,"e":0.08},"A":{"a":1.0},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"nd":1.0},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"rn":1.0},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'FR';

-- Paso Fino: the broad pinto palette 0024's own comment promised and could not deliver until now.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.50,"a":0.50},"CR":{"Cr":0.12,"cr":0.88},"G":{"G":0.08,"g":0.92},"DMRT3":{"A":0.95,"C":0.05},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.05,"nd":0.95},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"Rn":0.05,"rn":0.95},"TO":{"TO":0.10,"n":0.90},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"SB1":0.06,"n":0.94},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'PF';

-- Icelandic: the widest palette in the game, deliberately - dun, silver, tobiano pinto (skjottur)
-- and splash are all ordinary in the breed.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.10,"g":0.90},"DMRT3":{"A":0.90,"C":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.20,"nd":0.80},"Z":{"Z":0.12,"z":0.88},"CH":{"ch":1.0},"RN":{"Rn":0.04,"rn":0.96},"TO":{"TO":0.08,"n":0.92},"O":{"n":1.0},"SW1":{"SW1":0.06,"n":0.94},"SB1":{"n":1.0},"LP":{"lp":1.0},"PATN1":{"n":1.0}}' WHERE code = 'IC';

-- Nokota: blue roan and appaloosa spotting are the breed's identity - the highest Rn and the only
-- meaningful LP in the game.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.40,"a":0.60},"CR":{"cr":1.0},"G":{"G":0.02,"g":0.98},"DMRT3":{"C":0.90,"A":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0},"D":{"D":0.12,"nd":0.88},"Z":{"z":1.0},"CH":{"ch":1.0},"RN":{"Rn":0.25,"rn":0.75},"TO":{"n":1.0},"O":{"n":1.0},"SW1":{"n":1.0},"SB1":{"n":1.0},"LP":{"Lp":0.10,"lp":0.90},"PATN1":{"PATN1":0.08,"n":0.92}}' WHERE code = 'NOK';
