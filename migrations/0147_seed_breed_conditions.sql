-- Eight new conditions rows, closing out the breed disease panels: the six loci this document's
-- design record (docs/breed-disease-panels.md §5) drafted teaching and event text for already,
-- reused verbatim, plus DSLD (Paso Fino) and MCOA (Icelandic), both new here - see
-- docs/fixes/breed-disease-panels.md for why.
--
-- Hydrocephalus departs from the design document on one point, an operator decision recorded in
-- the fix document: seeded here as severity_class 'degenerative', not 'lethal' as that document's
-- own §5.6 specifies - lethal would have put this game's lethal count at six, over overview §3b's
-- own four-or-five ceiling. terminal_game_day is left NULL and state is 'onset', which falls out of
-- buildHorseConditionStatements' existing severity_class branch with no special case.
--
-- MCOA reads the existing Silver locus (Z) a second way: one copy only lightens colour (the coat
-- effect migrations/0113 already models), two copies can also affect the eyes. No new locus row.
--
-- No semicolons and no double hyphens anywhere in these string literals - src/lib/sql.ts's
-- splitSqlStatements splits on every literal ";" and strips every "--" with no awareness of string
-- literals (0053's own header comment, repeated here because this migration lost nothing by
-- repeating it).
INSERT INTO conditions (code, name, category, locus_code, trigger, severity_class, signs_visible, bars_showing, breed_associations, test_cost_key, enabled, teaching_text, event_text, sort_order) VALUES
('SCID', 'Severe combined immunodeficiency', 'single_gene', 'SCID',
 '{"v":1,"locus":"SCID","mutant":"Sc","mode":"recessive"}',
 'lethal', 0, 0, '["AR"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. A foal with SCID has no working immune system and cannot fight off infection. It looks completely healthy at birth because it is still protected by its dam''s antibodies, and there is no cure once that protection wears off. In real Arabians this can take months to become apparent. This game compresses that timeline so the outcome is not lost in a gap between logins.',
 'The foal was born with SCID, severe combined immunodeficiency. A foal with this condition has no working immune system and cannot fight off infection, which is why it seemed well at first and then was not. SCID is recessive. That means a horse needs two copies to be affected, one from each parent, and a horse with only one copy is perfectly healthy its whole life, a carrier. Two carriers bred together have about a one in four chance of an affected foal each time. Neither parent shows anything at all. A genotype test tells you whether a horse is a carrier. It is the only way to know.',
 6),
('CA', 'Cerebellar abiotrophy', 'single_gene', 'CA',
 '{"v":1,"locus":"CA","mutant":"Ca","mode":"recessive"}',
 'degenerative', 1, 1, '["AR"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. Affects balance and coordination by damaging part of the brain that controls movement, causing tremors and an unsteady stance. It is not fatal but a horse with cerebellar abiotrophy cannot be safely ridden or shown.',
 'Recessive, it takes two copies, one from each parent, to cause it. The brain does not develop the way it should, and balance and coordination are affected for life. A horse with cerebellar abiotrophy cannot be entered in a show.',
 7),
('LFS', 'Lavender foal syndrome', 'single_gene', 'LFS',
 '{"v":1,"locus":"LFS","mutant":"Lv","mode":"recessive"}',
 'lethal', 1, 0, '["AR"]', 'genotype_test_cost', 1,
 'Recessive and lethal. It takes two copies, one from each parent, to cause it. A foal with lavender foal syndrome cannot stand and has severe seizures from birth, unlike some other lethal conditions where a foal looks well at first. There is nothing that can be done.',
 'The foal was born with lavender foal syndrome. Unlike some other conditions, this one was visible right away. It cannot stand and its nervous system did not develop the way it should, and there is nothing that can be done about it. Lavender foal syndrome is recessive. That means a horse needs two copies to be affected, one from each parent, and a horse with only one copy is perfectly healthy its whole life, a carrier. Two carriers bred together have about a one in four chance of an affected foal each time. Neither parent shows anything at all. A genotype test tells you whether a horse is a carrier. It is the only way to know.',
 8),
('WFFS', 'Warmblood fragile foal syndrome', 'single_gene', 'WFFS',
 '{"v":1,"locus":"WFFS","mutant":"Wf","mode":"recessive"}',
 'lethal', 1, 0, '["GW"]', 'genotype_test_cost', 1,
 'Recessive and lethal. It takes two copies, one from each parent, to cause it. A foal with WFFS has skin and connective tissue too fragile to hold together, and does not survive. Like HYPP in Quarter Horses, it traces back to a small number of very successful stallions.',
 'The foal was born with WFFS, Warmblood fragile foal syndrome. Its skin and connective tissue could not hold together the way they should, and there was nothing that could be done. WFFS is recessive. That means a horse needs two copies to be affected, one from each parent, and a horse with only one copy is perfectly healthy its whole life, a carrier. Two carriers bred together have about a one in four chance of an affected foal each time. Neither parent shows anything at all. A genotype test tells you whether a horse is a carrier. It is the only way to know.',
 9),
('DWARF', 'Dwarfism', 'single_gene', 'DWARF',
 '{"v":1,"locus":"DWARF","mutant":"Dw","mode":"recessive"}',
 'degenerative', 1, 1, '["FR"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. A foal with dwarfism has short limbs and an oversized head, visible from birth. It does not shorten the horse''s life but the horse cannot be shown and is not the shape the breed standard describes.',
 'Recessive, it takes two copies, one from each parent, to cause it. The limbs and head did not grow in proportion the way they should, and this does not change as the foal grows up. A horse with dwarfism cannot be entered in a show.',
 10),
('HYDRO', 'Hydrocephalus', 'single_gene', 'HYDRO',
 '{"v":1,"locus":"HYDRO","mutant":"Hy","mode":"recessive"}',
 'degenerative', 1, 1, '["FR"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. Fluid builds up around the brain before birth, causing a visibly enlarged head. It does not shorten the horse''s life but the horse cannot be shown. This is one of two named conditions in Friesians, a breed descended from a small closed population where a recessive condition like this one surfaces more often than in an open breed.',
 'Recessive, it takes two copies, one from each parent, to cause it. Fluid built up around the brain before birth, leaving a visibly enlarged head. This does not change as the foal grows up. A horse with hydrocephalus cannot be entered in a show.',
 11),
('DSLD', 'Degenerative suspensory ligament desmitis', 'single_gene', 'DSLD',
 '{"v":1,"locus":"DSLD","mutant":"Dsld","mode":"recessive"}',
 'degenerative', 1, 1, '["PF"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. The ligaments that support the legs break down over time, and a horse with DSLD is eventually no longer sound enough to ride or show. Unlike the other conditions on this list, nobody has yet found the single gene behind DSLD in real horses. Real breeders watch the bloodlines instead of testing. This game gives it one gene so it can be tested and taught, which is a simplification worth knowing.',
 'Recessive, it takes two copies, one from each parent, to cause it. The ligaments that support the legs have started breaking down, and the horse is no longer sound enough to show. Unlike most conditions like this, nobody has found the single gene behind DSLD in real horses. This game models it with one gene anyway, as a simplification.',
 12),
('MCOA', 'Multiple congenital ocular anomalies', 'single_gene', 'Z',
 '{"v":1,"locus":"Z","mutant":"Z","mode":"recessive"}',
 'degenerative', 1, 1, '["IC"]', 'genotype_test_cost', 1,
 'This reads the silver gene a second way. One copy of silver only lightens colour, the mane and tail most of all. Two copies can also cause cysts and other problems in the eye serious enough that the horse cannot be safely shown. A horse with only one copy of silver has normal eyes.',
 'Recessive, it takes two copies, one from each parent, to cause it. This is the silver gene read a second way. Two copies affected the eyes badly enough that the horse cannot be safely shown. A horse with only one copy of silver has normal eyes.',
 13);
