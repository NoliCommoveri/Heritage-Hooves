-- Seven more breeds, insert-only - the Quarter Horse row from 0014_seed_breeds.sql is untouched.
-- Slice 0005 §5. With five loci, several of these breeds cannot yet look like themselves: the
-- Nokota's signature is blue roan, dun and grullo; the Icelandic's identity is silver and dun on
-- top of everything else; the Paso Fino's broad pinto palette needs pattern loci. None of those
-- genes exist yet. These pools are a first pass to be revisited as each locus lands, not a
-- finished statement of breed identity (overview §4a is the target).

-- Arabian: greys heavily (G .20, roughly a third of Arabians come out grey), no dilution at all.
-- Not gaited.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'AR', 'Arabian', 1, 0,
  '{"E":{"E":0.50,"e":0.50},"A":{"A":0.60,"a":0.40},"CR":{"cr":1.0},"G":{"G":0.20,"g":0.80},"DMRT3":{"C":1.0}}',
  0
);

-- Thoroughbred: no dilution, low grey, not gaited.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'TB', 'Thoroughbred', 1, 0,
  '{"E":{"E":0.60,"e":0.40},"A":{"A":0.65,"a":0.35},"CR":{"cr":1.0},"G":{"G":0.04,"g":0.96},"DMRT3":{"C":1.0}}',
  0
);

-- Paso Fino: one of the two gaited breeds, near-fixed for the DMRT3 gait allele. Its real
-- signature - a broad pinto palette - needs pattern loci that do not exist yet.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'PF', 'Paso Fino', 1, 0,
  '{"E":{"E":0.50,"e":0.50},"A":{"A":0.50,"a":0.50},"CR":{"Cr":0.12,"cr":0.88},"G":{"G":0.08,"g":0.92},"DMRT3":{"A":0.95,"C":0.05}}',
  1
);

-- Icelandic: the other gaited breed, near-fixed for the DMRT3 gait allele. Its real identity -
-- silver and dun - needs loci that do not exist yet.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'IC', 'Icelandic', 1, 0,
  '{"E":{"E":0.50,"e":0.50},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.10,"g":0.90},"DMRT3":{"A":0.90,"C":0.10}}',
  1
);

-- German Warmblood: no dilution, low grey, not gaited.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'GW', 'German Warmblood', 1, 0,
  '{"E":{"E":0.60,"e":0.40},"A":{"A":0.70,"a":0.30},"CR":{"cr":1.0},"G":{"G":0.08,"g":0.92},"DMRT3":{"C":1.0}}',
  0
);

-- Friesian: the hard-mode breed (overview §4a). Fixed a/a (bay is impossible - black is the only
-- base), fixed for no dilution and no grey. E carries a real recessive red (e at .08) that occurs
-- in the studbook and is unregistrable - a chestnut Friesian is roughly one foal in 150. The horse
-- page says plainly that a chestnut Friesian could not be registered as one (slice 0005 §11).
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'FR', 'Friesian', 1, 0,
  '{"E":{"E":0.92,"e":0.08},"A":{"a":1.0},"CR":{"cr":1.0},"G":{"g":1.0},"DMRT3":{"C":1.0}}',
  0
);

-- Nokota: carries the DMRT3 gait allele at 10%, so roughly one in a hundred is gaited (A/A only -
-- heterozygotes read as not gaited). Its real signature genes - blue roan, dun, grullo - do not
-- exist yet. Not typically gaited (most Nokotas are not), so gaited_typical stays 0.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'NOK', 'Nokota', 1, 0,
  '{"E":{"E":0.55,"e":0.45},"A":{"A":0.40,"a":0.60},"CR":{"cr":1.0},"G":{"G":0.02,"g":0.98},"DMRT3":{"C":0.90,"A":0.10}}',
  0
);
