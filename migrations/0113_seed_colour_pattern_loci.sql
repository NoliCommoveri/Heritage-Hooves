-- Ten colour and pattern loci, appended after GBED (sort_order 10-19) - slice 0021 §4. Codes,
-- alleles (in canonical order) and sort_order here must exactly match
-- src/engines/genetics/loci.ts's LOCI constant - test/genetics/consistency.test.ts checks it by
-- parsing this file's text, the same way it already checks 0015_seed_loci.sql and
-- 0050_seed_disease_loci.sql.
--
-- Appended, never inserted earlier, for the same RNG-order reason 0050's own header gives.
--
-- Eleven loci in the operator's original draft became ten: dominant white ("W") is dropped (slice
-- 0021 §1) - a family of variants standing in as one locus, adding little the other patterns
-- don't, with an embryonic-lethal mode that would read to a child as a bug rather than a lesson.
--
-- Correction to the operator's draft: frame overo's inheritance is 'dominant', not 'recessive' as
-- first written. The *pattern* shows on one copy; only the *lethal* (O/O) is recessive. That
-- distinction is player-facing and matters - see the teaching text below.
--
-- category = 'pattern' is new but anticipated - 0011_loci.sql's own column comment says
-- "(pattern / appaloosa / disease arrive later)".
INSERT INTO loci (code, name, category, inheritance, alleles, teaching_text, enabled, sort_order) VALUES
('D', 'Dun', 'dilution', 'dominant', '["D","nd"]',
 'A dilution gene. One copy is enough to lighten the body while leaving a dorsal stripe down the back and often faint barring on the legs - the "primitive markings" that give the gene away even on a horse otherwise hard to read.',
 1, 10),
('Z', 'Silver', 'dilution', 'dominant', '["Z","z"]',
 'A dilution gene that only touches black pigment - it lightens a black or bay horse''s mane, tail and sometimes body, but does nothing visible on a chestnut, which has no black pigment for it to act on. A chestnut can carry silver invisibly and pass it on with no warning.',
 1, 11),
('CH', 'Champagne', 'dilution', 'dominant', '["Ch","ch"]',
 'A dilution gene that lightens both red and black pigment together, and also lightens the skin - a champagne horse is born with pink, freckling skin and light eyes that darken slightly with age.',
 1, 12),
('RN', 'Roan', 'pattern', 'dominant', '["Rn","rn"]',
 'Intermixes white hairs through the body coat while the head, lower legs, mane and tail stay solid-coloured. Unlike grey, roan does not spread or progress with age - a roan foal looks roan for life.',
 1, 13),
('TO', 'Tobiano', 'pattern', 'dominant', '["TO","n"]',
 'A pinto pattern: white patches with smooth, rounded edges that typically cross the topline, usually paired with four white legs. One copy is enough to show it.',
 1, 14),
('O', 'Frame overo', 'pattern', 'dominant', '["O","n"]',
 'A pinto pattern: irregular, horizontally-spread white patches on the body, usually not crossing the topline, legs often dark. One copy shows the pattern - but two copies (O/O) is a lethal: the foal is born white and cannot survive more than a few days. A carrier bred to a non-carrier is completely safe. Two carriers bred together risk a foal that cannot be saved.',
 1, 15),
('SW1', 'Splashed white', 'pattern', 'dominant', '["SW1","n"]',
 'A pinto pattern with crisp, sharp-edged white as though the horse were dipped in paint from below - white legs, a wide blaze, often blue eyes. One copy is enough to show it, though how much varies widely.',
 1, 16),
('SB1', 'Sabino1', 'pattern', 'incomplete_dominant', '["SB1","n"]',
 'A pinto pattern with a dose effect. One copy gives roaning around the edges of white markings and high white on the legs. Two copies can produce a nearly all-white horse. The three states are visibly distinct, so looking at the horse tells you everything a test would.',
 1, 17),
('LP', 'Leopard complex', 'pattern', 'incomplete_dominant', '["Lp","lp"]',
 'The base gene behind appaloosa spotting - varnish roaning, mottled skin around the eyes and muzzle, striped hooves. One copy gives a lighter, more roaned expression than two. The pattern''s final shape also depends on PATN1.',
 1, 18),
('PATN1', 'Pattern-1', 'modifier', 'dominant', '["PATN1","n"]',
 'Has no visible effect on its own. On a horse that also carries at least one copy of leopard complex (Lp), it turns varnish roaning into a defined white blanket or full leopard spotting.',
 1, 19);
