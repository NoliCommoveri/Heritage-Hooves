-- The four-condition Quarter Horse panel, minus malignant hyperthermia (slice 0010 §2.1) - it only
-- manifests under general anaesthesia, and there is no surgery in this game.
--
-- event_text is deliberately written without naming any particular horse: it is reference text,
-- edited without a deploy, and the personalised half of a notice (whose foal, which dam) comes
-- from the event payload at the point the event is written, not from this table. The GBED wording
-- below is copied from slice 0010 §5.6, minus its opening heading line - src/render/stables.ts's
-- eventSentence builds that line itself from the event payload (the dam is very often named even
-- when her foal is not) and appends this text below it.
--
-- No semicolons and no double hyphens anywhere in these string literals - src/lib/sql.ts's
-- splitSqlStatements splits on every literal ";" and strips every "--" with no awareness of string
-- literals, so either would corrupt this migration in the browser-based /admin/migrations path
-- (slice 0008 lost an afternoon to exactly this once already).
INSERT INTO conditions (code, name, category, locus_code, trigger, severity_class, signs_visible, bars_showing, breed_associations, test_cost_key, enabled, teaching_text, event_text, sort_order) VALUES
('HYPP', 'Hyperkalemic periodic paralysis', 'single_gene', 'HYPP',
 '{"v":1,"locus":"HYPP","mutant":"H","mode":"dominant"}',
 'manageable', 1, 0, '["QH"]', 'genotype_test_cost', 1,
 'Dominant. One copy is enough to cause it, so there is no such thing as a HYPP carrier - a horse either has it or does not. Causes episodes of muscle tremors and weakness. This build does not link it to muscling or any other trait, unlike the real history behind it - here it is a straight downside with nothing on the other side of the ledger.',
 'A dominant condition. One copy is enough to cause episodes of muscle tremors and weakness after hard work or stress. There are no hidden carriers with HYPP - a horse either has it or does not, and the signs themselves are usually the first anyone learns of it.',
 1),
('PSSM1', 'Type 1 polysaccharide storage myopathy', 'single_gene', 'PSSM1',
 '{"v":1,"locus":"PSSM1","mutant":"P1","mode":"dominant"}',
 'manageable', 1, 0, '["QH"]', 'genotype_test_cost', 1,
 'Dominant. One copy is enough to cause it, so there is no such thing as a PSSM1 carrier. Affects how muscle stores and uses sugar, causing cramping and stiffness (tying-up) with hard work.',
 'A dominant condition affecting how muscle stores and uses sugar, causing tying-up episodes with hard work. One copy is enough to cause it, so there are no hidden carriers with a dominant condition like this one.',
 2),
('HERDA', 'Hereditary equine regional dermal asthenia', 'single_gene', 'HERDA',
 '{"v":1,"locus":"HERDA","mutant":"Hrd","mode":"recessive"}',
 'degenerative', 1, 1, '["QH"]', 'genotype_test_cost', 1,
 'Recessive. It takes two copies, one from each parent, to cause it. A horse with only one copy is a healthy carrier. An affected horse has fragile skin that splits easily under pressure such as a saddle, and cannot be shown.',
 'A recessive condition - it takes two copies, one from each parent, to cause it. The skin does not hold together the way it should, and splits easily under pressure such as a saddle. A horse with HERDA cannot be entered in a show.',
 3),
('GBED', 'Glycogen branching enzyme deficiency', 'single_gene', 'GBED',
 '{"v":1,"locus":"GBED","mutant":"Gb","mode":"recessive"}',
 'lethal', 0, 0, '["QH"]', 'genotype_test_cost', 1,
 'Recessive and lethal. It takes two copies, one from each parent, to cause it. A horse with only one copy is a healthy carrier its whole life, with nothing to see. A foal born with two copies does not survive.',
 'The foal was born with GBED - glycogen branching enzyme deficiency. A foal with this condition cannot store sugar in the way a body needs to, and there is nothing that can be done about it. It is why the foal seemed well at first and then was not.

GBED is recessive. That means a horse needs two copies to be affected, one from each parent, and a horse with only one copy is perfectly healthy its whole life - a carrier. Two carriers bred together have about a one in four chance of an affected foal each time. Neither parent shows anything at all.

A genotype test tells you whether a horse is a carrier. It is the only way to know.',
 4);
