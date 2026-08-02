-- A horse breed. One row per breed; this slice seeds exactly one (Quarter Horse, in 0014).
CREATE TABLE breeds (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- is_recognised_cross: exists so promoting a common cross (e.g. a Quarab) to breed status later
  -- is a data change, not a structural one.
  is_recognised_cross INTEGER NOT NULL DEFAULT 0,
  -- founding_allele_pool: JSON object mapping locus code -> {allele: frequency}, e.g.
  -- {"E":{"E":0.55,"e":0.45}, "A":{"A":0.45,"a":0.55}, ...}. Read by the founding-stock generator
  -- (a later slice), not by anything in this one - see slice 0002 §3.5.
  founding_allele_pool TEXT NOT NULL,
  -- gaited_typical: documentation only. Actual gait comes from the DMRT3 locus, not this flag.
  gaited_typical INTEGER NOT NULL DEFAULT 0
);
