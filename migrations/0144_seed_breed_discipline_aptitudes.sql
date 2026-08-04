-- The eight breeds' discipline aptitudes, all six disciplines each. Maximum deviation from 1.00 is
-- 0.05, chosen deliberately - see docs/breed-ability-and-aptitude.md §4 for the arithmetic, but the
-- short version is that at +/-0.05 an on-breed horse beats an equally-bred off-breed one by about
-- 3.4 standard deviations of barrel-class noise, while an off-breed horse carrying a founding
-- specialist can still just take the class. Push these past +/-0.06 and breed stops being a strong
-- tendency and becomes a gate.
--
-- Rows are NOT zero-sum, unlike 0142's ability_bias - a breed may genuinely be good at two things,
-- and a horse only ever enters one class at a time so there is no "spend" to balance. What is
-- checked instead (test/showing/breed-aptitude.test.ts) is that every row's MEAN sits close to
-- 1.00, so no breed is quietly advantaged across the board. The spread today is 0.987 to 1.000.

-- Quarter Horse: barrels are the breed's own event, and the direct fix for the operator's report.
-- Fast over a short distance, poor at anything asking it to keep going.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":1.05,"racing":1.02,"jumping":0.97,"endurance":0.95,"dressage":0.98,"gaited":1.00}}'
WHERE code = 'QH';

-- Arabian: endurance is the breed's event and nothing else is. Competent everywhere, excellent in
-- exactly one place.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":0.98,"racing":1.00,"jumping":0.97,"endurance":1.05,"dressage":1.00,"gaited":1.00}}'
WHERE code = 'AR';

-- Thoroughbred: flat racing, with enough athleticism to jump respectably - the one breed with a
-- second discipline above 1.00.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":0.98,"racing":1.05,"jumping":1.02,"endurance":1.00,"dressage":0.97,"gaited":0.98}}'
WHERE code = 'TB';

-- German Warmblood: jumping first, dressage close behind, and 0.95 in barrels - the number the
-- operator's report was actually asking for. A Warmblood in a barrel class is now doing something
-- it was not bred for, and the score says so.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":0.95,"racing":0.97,"jumping":1.05,"endurance":0.97,"dressage":1.04,"gaited":0.98}}'
WHERE code = 'GW';

-- Friesian: dressage, and honestly not much else - the lowest row mean in the set (0.987). That is
-- intended, not an oversight: the Friesian is overview §4a's hard-mode breed and its reward is the
-- conformation ring, where it carries the heaviest single trait weight in the game (migration 0107).
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":0.95,"racing":0.96,"jumping":0.98,"endurance":0.98,"dressage":1.05,"gaited":1.00}}'
WHERE code = 'FR';

-- Paso Fino: gaited pleasure, which is the only class its gait actually opens. Poor over a fence.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":1.00,"racing":0.97,"jumping":0.95,"endurance":1.00,"dressage":1.00,"gaited":1.05}}'
WHERE code = 'PF';

-- Icelandic: gaited first, with real toughness behind it. Small and slow - the two lowest numbers
-- on the row are the two speed events.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":0.98,"racing":0.95,"jumping":0.95,"endurance":1.02,"dressage":0.98,"gaited":1.04}}'
WHERE code = 'IC';

-- Nokota: the flattest row here, matching its flat ability_bias in 0142. Nothing below 0.98 and
-- nothing above 1.02 - a landrace that is mildly good at surviving a long day and unremarkable
-- everywhere else.
UPDATE breeds
SET discipline_aptitudes = '{"v":1,"disciplines":{"barrels":1.00,"racing":0.98,"jumping":0.98,"endurance":1.02,"dressage":0.98,"gaited":1.00}}'
WHERE code = 'NOK';
