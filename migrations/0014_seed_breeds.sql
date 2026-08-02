-- The one breed this slice implements. founding_allele_pool is seeded now because the genetics
-- work is already in front of whoever writes this file, and the founding-stock generator (the
-- next slice) is the first thing to read it - nothing in this slice does. See slice 0002 §3.5:
-- these are a starting point to be tuned by observation, not a research result.
INSERT INTO breeds (code, name, enabled, is_recognised_cross, founding_allele_pool, gaited_typical)
VALUES (
  'QH',
  'Quarter Horse',
  1,
  0,
  '{"E":{"E":0.55,"e":0.45},"A":{"A":0.45,"a":0.55},"CR":{"Cr":0.10,"cr":0.90},"G":{"G":0.03,"g":0.97},"DMRT3":{"C":0.98,"A":0.02}}',
  0
);
