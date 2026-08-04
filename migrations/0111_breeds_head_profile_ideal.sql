-- head_profile's per-breed target and weight (slice 0021 §3.3). json_set patches the single key so
-- the four targets seeded in 0035 (QH) and 0107 (the other seven) are preserved exactly as written
-- rather than retyped. The json() wrapper is what makes SQLite store an object rather than a string.

-- Arabian: the dish is the breed's single most recognisable trait, weighted just behind
-- neck_length (1.4), which stays the calling card.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":8,"weight":1.3}'))
  WHERE code = 'AR';

-- Thoroughbred: near-straight and unremarkable. The lightest weight in the file bar the Icelandic;
-- shoulder_angle (1.5) stays the defining trait.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":48,"weight":0.7}'))
  WHERE code = 'TB';

-- German Warmblood: straight and proportionate, expected but not decisive - under 1.0 so
-- shoulder_angle and hock_set remain the row's demanding targets.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":50,"weight":0.8}'))
  WHERE code = 'GW';

-- Friesian: the convex "ramskop" is named in the breed standard, so it carries real weight - but
-- stays below neck_length's 1.5, which is deliberately the hardest single target in the game.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":70,"weight":1.2}'))
  WHERE code = 'FR';

-- Paso Fino: a refined, lightly convex Iberian head matters for elegance, but back_length stays
-- the heaviest trait on the row - the gait is carried on the back, not the head.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":62,"weight":0.9}'))
  WHERE code = 'PF';

-- Icelandic: judged overwhelmingly on gait and movement. The lightest head weight in the set.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":57,"weight":0.6}'))
  WHERE code = 'IC';

-- Nokota: the landrace - close to flat, in keeping with a row that has no single defining feature.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":66,"weight":0.8}'))
  WHERE code = 'NOK';

-- Quarter Horse: the clean, refined "box head" - part of overall balance rather than a standout.
UPDATE breeds SET ideal_vector =
  json_set(ideal_vector, '$.traits.head_profile', json('{"target":35,"weight":0.8}'))
  WHERE code = 'QH';
