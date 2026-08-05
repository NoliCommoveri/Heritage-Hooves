-- PSSM1's breed_associations still names only QH (migrations/0053), but migrations/0146 widened its
-- founding_allele_pool to German Warmblood and Paso Fino too - real biology, not a Quarter Horse
-- exclusive (docs/fixes/breed-disease-panels.md). breed_associations is display-only and never
-- enforced (migrations/0052's own comment), but it should still say the truth - a test added
-- alongside this fix (test/genetics/consistency.test.ts) is what caught it disagreeing.
UPDATE conditions SET breed_associations = '["GW","PF","QH"]' WHERE code = 'PSSM1';
