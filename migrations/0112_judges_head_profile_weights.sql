-- Each of the three judges seeded in 0033 gets an explicit opinion of head_profile (slice 0021
-- §3.4), rather than letting scoreEntry's missing-weight default of 1.0 apply silently - a judge
-- whose whole character is a particular set of weights should not have a new trait sneak in at a
-- generic value and shift what every weight sum divides by underneath them.
UPDATE judges SET trait_weights =
  json_set(trait_weights, '$.traits.head_profile', 1.0)
  WHERE code = 'balanced';

UPDATE judges SET trait_weights =
  json_set(trait_weights, '$.traits.head_profile', 0.8)
  WHERE code = 'movement';

UPDATE judges SET trait_weights =
  json_set(trait_weights, '$.traits.head_profile', 1.2)
  WHERE code = 'substance';
