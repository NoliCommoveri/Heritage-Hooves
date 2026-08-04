-- Slice 0021 Part C (§5.5): frame overo and splashed white each have a penetrance rather than being
-- fully deterministic - a carrier is not always visibly marked, which is why the real genotype test
-- for either one tells a breeder something looking cannot. Locus code -> probability the pattern
-- shows given the allele is present; tobiano, roan, dun, champagne and silver stay fully penetrant
-- and have no entry here. Live tunable, read fresh by every phenotype computation (not snapshotted
-- onto the horse) - setting both to 1.0 disables the mechanism entirely with nothing else to change.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.pattern_penetrance', json('{"O":0.85,"SW1":0.90}')
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
