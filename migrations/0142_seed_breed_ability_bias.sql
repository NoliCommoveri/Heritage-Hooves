-- The eight breeds' ability leanings. Every row sums to zero (see 0141's comment) and no single
-- offset exceeds +/-0.06.
--
-- What an offset is worth: expected potential is 20 x chance and geneticValue is potential x 5, so
-- 0.06 = 1.2 potential = 6 geneticValue points on a 1-99 scale. That is deliberately about
-- two-thirds the size of a founding specialist's own bump (potential 15 vs a mid-band 10, i.e. 25
-- geneticValue points on one trait), because a breed leaning should be a tendency an exceptional
-- individual can still beat - see docs/breed-ability-and-aptitude.md §4 for the worked arithmetic.
--
-- These are first guesses drawn from what each breed is actually for, in the same spirit as
-- docs/breed-ideal-vectors.md §4: tune them by watching results, not by reasoning harder.

-- Quarter Horse: the sprinter and cow horse. Speed and agility together, at the cost of distance
-- and any pretension to a jump - the sharpest specialisation in the set alongside the Thoroughbred.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":0.06,"stamina":-0.06,"jump_scope":-0.06,"trainability":0.0,"agility":0.06}}'
WHERE code = 'QH';

-- Arabian: the endurance breed. Stamina is the only strong leaning; a small trainability gain, and
-- the jump given up entirely.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":-0.02,"stamina":0.06,"jump_scope":-0.06,"trainability":0.02,"agility":0.0}}'
WHERE code = 'AR';

-- Thoroughbred: built to gallop and keep galloping. Speed led, stamina behind it, and the finesse
-- traits (agility, trainability) both given up - the mirror image of the Warmblood below.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":0.06,"stamina":0.04,"jump_scope":0.02,"trainability":-0.06,"agility":-0.06}}'
WHERE code = 'TB';

-- German Warmblood: the modern sport horse. Scope over a fence and trainability, paid for with
-- speed and stamina. This row is the direct answer to the operator's 2026-08-04 report that
-- Warmbloods were outrunning Quarter Horses in barrels.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":-0.06,"stamina":-0.06,"jump_scope":0.06,"trainability":0.05,"agility":0.01}}'
WHERE code = 'GW';

-- Friesian: the baroque carriage and dressage horse. Trainability above all, notably slow. Its real
-- value in this game is its conformation standard (the heaviest single trait weight anywhere,
-- migration 0107), not a discipline.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":-0.06,"stamina":-0.02,"jump_scope":0.0,"trainability":0.06,"agility":0.02}}'
WHERE code = 'FR';

-- Paso Fino: the gaited breed. Agility and trainability - a smooth, precise, footsure horse rather
-- than a fast or bold one.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":0.0,"stamina":-0.04,"jump_scope":-0.06,"trainability":0.04,"agility":0.06}}'
WHERE code = 'PF';

-- Icelandic: gaited, hardy, and small. Stamina and footwork, no speed and no jump.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":-0.06,"stamina":0.06,"jump_scope":-0.06,"trainability":0.02,"agility":0.04}}'
WHERE code = 'IC';

-- Nokota: deliberately the flattest row in the set. An unselected landrace should not have sharp
-- specialisation - the same call docs/breed-disease-panels.md made when it gave the Nokota no
-- disease panel. Tough and even rather than good at one thing.
UPDATE breeds
SET ability_bias = '{"v":1,"traits":{"speed":0.0,"stamina":0.04,"jump_scope":-0.04,"trainability":-0.02,"agility":0.02}}'
WHERE code = 'NOK';
