-- Slice 0028 §2.1: the five conformation type loci, seeded into the `loci` table the admin
-- create-horse form and the testing page both read - the same table 0015/0050/0113/0145 seed for
-- every other locus. Appended after DSLD (sort_order 27-31), never inserted earlier - the same
-- RNG-order reason every migration above states, even though the `loci` table itself carries no
-- RNG stream (test/genetics/consistency.test.ts checks this file's codes/alleles/order against
-- src/engines/genetics/loci.ts's LOCI constant regardless).
--
-- alleles is the full 25-rung ladder, "2","6","10",...,"98" (src/engines/conformation/typeGene.ts's
-- RUNG_BASE/RUNG_STEP/RUNG_COUNT) - every allele symbol IS its own value on the trait's 1-99 scale.
-- category 'type_gene' is new (every other row's category is base/dilution/modifier/gait/disease) -
-- these five are neither a colour nor a disease locus, and grouping them under an existing category
-- would misdescribe them on the admin form.
INSERT INTO loci (code, name, category, inheritance, alleles, teaching_text, enabled, sort_order) VALUES
('NL', 'Neck length (type)', 'type_gene', 'co-dominant',
 '["2","6","10","14","18","22","26","30","34","38","42","46","50","54","58","62","66","70","74","78","82","86","90","94","98"]',
 'One gene, 25 possible values along the trait''s scale. A horse shows whichever of its two copies sits further from its own breed''s standard - you cannot hide a fault, but you can hide a virtue.',
 1, 27),
('SA', 'Shoulder angle (type)', 'type_gene', 'co-dominant',
 '["2","6","10","14","18","22","26","30","34","38","42","46","50","54","58","62","66","70","74","78","82","86","90","94","98"]',
 'One gene, 25 possible values along the trait''s scale. A horse shows whichever of its two copies sits further from its own breed''s standard - you cannot hide a fault, but you can hide a virtue.',
 1, 28),
('BL', 'Back length (type)', 'type_gene', 'co-dominant',
 '["2","6","10","14","18","22","26","30","34","38","42","46","50","54","58","62","66","70","74","78","82","86","90","94","98"]',
 'One gene, 25 possible values along the trait''s scale. A horse shows whichever of its two copies sits further from its own breed''s standard - you cannot hide a fault, but you can hide a virtue.',
 1, 29),
('HS', 'Hock set (type)', 'type_gene', 'co-dominant',
 '["2","6","10","14","18","22","26","30","34","38","42","46","50","54","58","62","66","70","74","78","82","86","90","94","98"]',
 'One gene, 25 possible values along the trait''s scale. A horse shows whichever of its two copies sits further from its own breed''s standard - you cannot hide a fault, but you can hide a virtue.',
 1, 30),
('HP', 'Head profile (type)', 'type_gene', 'co-dominant',
 '["2","6","10","14","18","22","26","30","34","38","42","46","50","54","58","62","66","70","74","78","82","86","90","94","98"]',
 'One gene, 25 possible values along the trait''s scale. A horse shows whichever of its two copies sits further from its own breed''s standard - you cannot hide a fault, but you can hide a virtue.',
 1, 31);
