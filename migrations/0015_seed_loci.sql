-- The five loci this slice implements. Codes, alleles (in canonical order) and sort_order here
-- must exactly match src/engines/genetics/loci.ts's LOCI constant - test/genetics/consistency.test.ts
-- checks it by parsing this file's text.
INSERT INTO loci (code, name, category, inheritance, alleles, teaching_text, enabled, sort_order) VALUES
('E', 'Extension', 'base', 'recessive', '["E","e"]',
 'Controls whether a horse can make black pigment at all. E lets it happen, but a horse with two copies of e cannot make black pigment anywhere, and comes out red (chestnut) no matter what any other gene says.',
 1, 1),
('A', 'Agouti', 'base', 'dominant',
 '["A","a"]',
 'Only matters on a horse that can make black pigment (see Extension). A restricts the black to the points - mane, tail and legs - which reads as bay. Two copies of a let the black spread over the whole body, which reads as black.',
 1, 2),
('CR', 'Cream', 'dilution', 'incomplete_dominant', '["Cr","cr"]',
 'A dilution gene with a dose effect. One copy lightens red to gold (a chestnut becomes palomino) or lightens the body of a bay (buckskin). Two copies lighten much further, toward cream.',
 1, 3),
('G', 'Grey', 'modifier', 'dominant', '["G","g"]',
 'A horse with at least one copy is born its base colour and progressively loses pigment with age, passing through dappling and lightening toward white over several years. The base colour underneath never actually changes.',
 1, 4),
('DMRT3', 'Gait', 'gait', 'recessive', '["C","A"]',
 'The "gait keeper" mutation. Two copies of the A allele let a horse perform smooth four-beat gaits beyond walk, trot and canter. One copy is treated as not gaited for now.',
 1, 5);
