-- Slice 0008 §4.2 / docs/breed-ideal-vectors.md §3: the seven remaining breeds' conformation
-- standards, drafted in that document and seeded here verbatim - migration 0035's Quarter Horse
-- vector is untouched. createShowIfMissing (src/db/shows.ts) creates one class per breed in play
-- whose ideal_vector is non-null with no code change needed, so this alone turns every show from
-- one class into eight. See docs/breed-ideal-vectors.md §4-5 for how these targets were chosen and
-- why none of them sit on the population centre of 50.

-- Arabian: long high-set neck (the breed's calling card), a genuinely short back, hock asked only
-- to be correct.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":75,"weight":1.4},"shoulder_angle":{"target":72,"weight":1.1},"back_length":{"target":28,"weight":1.2},"hock_set":{"target":48,"weight":0.8}}}'
WHERE code = 'AR';

-- Thoroughbred: built to gallop - the laid-back shoulder is the most extreme target and heaviest
-- weight in the whole set, everything else asked to be moderate.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":65,"weight":1.0},"shoulder_angle":{"target":80,"weight":1.5},"back_length":{"target":50,"weight":0.9},"hock_set":{"target":55,"weight":1.0}}}'
WHERE code = 'TB';

-- German Warmblood: the modern sport horse - three of four traits carry weight above 1.0, the most
-- demanding standard in the set even though no single target is extreme.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":72,"weight":1.2},"shoulder_angle":{"target":78,"weight":1.3},"back_length":{"target":52,"weight":0.9},"hock_set":{"target":62,"weight":1.2}}}'
WHERE code = 'GW';

-- Friesian: the hard-mode breed (overview §4a). A very long, high, arched neck carries the
-- heaviest weight anywhere in the set - the hardest single trait target in the game, on purpose.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":82,"weight":1.5},"shoulder_angle":{"target":68,"weight":1.0},"back_length":{"target":40,"weight":1.0},"hock_set":{"target":62,"weight":1.1}}}'
WHERE code = 'FR';

-- Paso Fino: an elegant, high-carried neck over a genuinely short back - the short back carries the
-- heaviest weight on the row, since it is what the collected, four-beat gait is carried on.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":68,"weight":1.2},"shoulder_angle":{"target":60,"weight":1.0},"back_length":{"target":30,"weight":1.3},"hock_set":{"target":45,"weight":1.1}}}'
WHERE code = 'PF';

-- Icelandic: the compact counter-example to every sport breed above - the only breed in the set
-- wanting an upright shoulder, and that trait carries the heaviest weight on the row on purpose.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":40,"weight":0.9},"shoulder_angle":{"target":35,"weight":1.2},"back_length":{"target":42,"weight":1.0},"hock_set":{"target":36,"weight":1.1}}}'
WHERE code = 'IC';

-- Nokota: the landrace, describing an unselected working horse rather than a refined one - the
-- longest back in the set, weights close to flat since a landrace has no single defining feature.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":40,"weight":1.0},"shoulder_angle":{"target":45,"weight":0.9},"back_length":{"target":58,"weight":1.1},"hock_set":{"target":36,"weight":1.0}}}'
WHERE code = 'NOK';
