-- Every seeded breed's founding_allele_pool must list every locus in LOCI (slice 0002 §3.5's rule,
-- restated in src/engines/founding/pool.ts: "a pool missing a locus is an error rather than a
-- default") - so the migration adding HYPP/PSSM1/HERDA/GBED to loci also updates all eight breeds'
-- pools here, in the same change. Slice 0010 §4.3.
--
-- Each statement rewrites a breed's whole pool as a literal, rather than patching in the four new
-- keys with json_set - this table is edited approximately never (src/db/breeds.ts's own comment),
-- and a full literal is what test/genetics/consistency.test.ts can parse the same way it already
-- parses the INSERT statements in 0014_seed_breeds.sql and 0024_seed_breed_pools.sql. The five
-- original loci's frequencies are copied unchanged from those two files.
--
-- Seven of the eight breeds get {"N":1.0} for all four conditions - these are Quarter Horse
-- conditions, HERDA and GBED essentially exclusively so, and confining them to one breed in this
-- first pass keeps the tuning legible. PSSM1 genuinely occurs beyond the Quarter Horse in real
-- populations and can spread to other pools in a later pass; it stays at {"N":1.0} everywhere but
-- QH for now.
--
-- Quarter Horse gets real starting frequencies (allele frequencies, drawn Hardy-Weinberg by the
-- existing generator): HYPP 0.02, PSSM1 0.03, HERDA 0.06, GBED 0.05. Deliberately lower than the
-- real population - slice 0010 §4.3/§14 names these as the first number to revisit if
-- /admin/health shows the panel firing too often or not at all.
UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.03,"g":0.97},"DMRT3":{"C":0.98,"A":0.02},"HYPP":{"N":0.98,"H":0.02},"PSSM1":{"N":0.97,"P1":0.03},"HERDA":{"N":0.94,"Hrd":0.06},"GBED":{"N":0.95,"Gb":0.05}}' WHERE code = 'QH';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.60,"a":0.40},"CR":{"cr":1.0},"G":{"G":0.20,"g":0.80},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'AR';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.65,"a":0.35},"CR":{"cr":1.0},"G":{"G":0.04,"g":0.96},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'TB';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.50,"a":0.50},"CR":{"Cr":0.12,"cr":0.88},"G":{"G":0.08,"g":0.92},"DMRT3":{"A":0.95,"C":0.05},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'PF';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.50,"e":0.50},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.10,"g":0.90},"DMRT3":{"A":0.90,"C":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'IC';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.60,"e":0.40},"A":{"A":0.70,"a":0.30},"CR":{"cr":1.0},"G":{"G":0.08,"g":0.92},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'GW';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.92,"e":0.08},"A":{"a":1.0},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'FR';

UPDATE breeds SET founding_allele_pool = '{"E":{"E":0.55,"e":0.45},"A":{"A":0.40,"a":0.60},"CR":{"cr":1.0},"G":{"G":0.02,"g":0.98},"DMRT3":{"C":0.90,"A":0.10},"HYPP":{"N":1.0},"PSSM1":{"N":1.0},"HERDA":{"N":1.0},"GBED":{"N":1.0}}' WHERE code = 'NOK';
