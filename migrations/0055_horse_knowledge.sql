-- What a player has paid to learn about a horse - distinct from horse_conditions, what is actually
-- true (previous migration). Slice 0010 §5.3, trimmed from schema doc §4.4.
--
-- Per-stable, not per-account (CLAUDE.md §12's account-versus-stable rule) - knowledge belongs to
-- the business that paid for it, and it is what would travel with a horse on sale once a market
-- exists (schema §4.4). A child running two barns who tests a horse in one has not tested it in the
-- other.
--
-- expires_game_day is always NULL for the only kind this slice writes (genotype) - a genotype test
-- is permanent, and that permanence is the point (§3c). The screening kind, and the column actually
-- going stale, arrive with the polygenic predispositions.
--
-- service_call_id from the schema doc's sketch is not built here (slice 0010 §3.3) - there is no
-- vet profession yet, so a test is a direct purchase with instant results. It arrives with that
-- profession.
CREATE TABLE horse_knowledge (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  -- kind: genotype / screening. Only 'genotype' is written by this slice.
  kind TEXT NOT NULL,
  -- subject_code: the condition code today. A locus code, when colour testing arrives.
  subject_code TEXT NOT NULL,
  -- result: clear / carrier / affected, or a screening observation once that kind exists.
  result TEXT NOT NULL,
  tested_game_day INTEGER NOT NULL,
  expires_game_day INTEGER,
  -- cost_paid: what was actually charged - prices are live tunables, and a receipt should say what
  -- it said at the time, not what the price happens to be today.
  cost_paid INTEGER NOT NULL
);

-- A permanent result cannot be bought twice - this is what makes that true, rather than a check
-- somebody forgets. The test page reads existing rows and offers only what is missing.
CREATE UNIQUE INDEX idx_horse_knowledge_unique ON horse_knowledge (stable_id, horse_id, subject_code);
