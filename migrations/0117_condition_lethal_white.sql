-- Slice 0021 Part E (§7.1): lethal white overo syndrome, O/O. No new code at all - conditions
-- already carries single-gene rows keyed on a locus/mutant/mode trigger, and the existing
-- lethal-foal-death path (src/db/pregnancies.ts, src/engines/health/status.ts) already handles a
-- foal born affected by a lethal condition. Modelled line-for-line on 0053's GBED row.
--
-- No semicolons and no double hyphens anywhere in these string literals - src/lib/sql.ts's
-- splitSqlStatements splits on every literal ";" and strips every "--" with no awareness of string
-- literals (0053's own header comment gives the same warning).
INSERT INTO conditions (code, name, category, locus_code, trigger, severity_class, signs_visible, bars_showing, breed_associations, test_cost_key, enabled, teaching_text, event_text, sort_order) VALUES
('LWO', 'Lethal white overo syndrome', 'single_gene', 'O',
 '{"v":1,"locus":"O","mutant":"O","mode":"recessive"}',
 'lethal', 0, 0, '["QH"]', 'genotype_test_cost', 1,
 'Recessive and lethal. It takes two copies, one from each parent, to cause it. A horse with only one copy shows frame overo''s white patterning and is otherwise perfectly healthy. A foal born with two copies is born white, with a gut that never developed properly, and does not survive.',
 'The foal was born with lethal white overo syndrome. Two copies of the frame overo gene left the foal born white, with a gut that never developed the way it needed to, and there is nothing that can be done about it.

This one was preventable. Frame overo is recessive - a horse needs two copies to be affected, one from each parent, and a horse with only one copy is a healthy carrier, usually visibly marked with frame''s patchy white. A genotype test on either parent would have shown it. A carrier bred to a horse that does not carry the gene is completely safe - every foal gets at most one copy. It is only when two carriers are bred together that each foal carries about a one in four chance of being born white.',
 5);
