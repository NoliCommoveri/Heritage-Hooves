-- What is actually true about a horse - distinct from horse_knowledge, what a player has paid to
-- learn (next migration). Slice 0010 §5.2, trimmed from schema doc §4.5.
--
-- A row is written only when the genotype makes a horse affected - never for carriers, never for
-- clear horses. Carriers are a fact about a genotype, not a condition a horse has, and writing rows
-- for them would triple the table for nothing. What a player sees on screen is always derived from
-- the genotype directly, never read from this table - this table exists for the tick (an indexed
-- set of affected foals to check for a lethal death, rather than a scan parsing every living
-- horse's genotype JSON) and for a later stage's management_state, not for display.
--
-- risk_score, severity and management_state from the schema doc's sketch are not built as columns
-- here (slice 0010 §3.2/§3.4) - nothing in this slice is polygenic or manageable-in-the-sense-of-
-- doable-something-about, so a column nothing writes or reads is a promise nobody has kept.
CREATE TABLE horse_conditions (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  condition_code TEXT NOT NULL REFERENCES conditions (code),
  -- state: onset for manageable and degenerative, terminal for lethal (slice 0010 §5.2). The schema
  -- doc's at_risk/managed/resolved values arrive with the polygenic and care stages.
  state TEXT NOT NULL,
  -- onset_game_day: the horse's born_game_day for everything in this slice - every condition here
  -- is single-gene, present from conception, with no onset model built yet (§3.2).
  onset_game_day INTEGER NOT NULL,
  -- terminal_game_day: nullable, set only on lethal rows, to born_game_day + the config value
  -- lethal_foal_death_game_days AS IT STOOD AT WRITE TIME (CLAUDE.md §5.5 snapshotting) - so
  -- retuning that config value never moves the death date of a foal already born.
  terminal_game_day INTEGER,
  last_evaluated_game_day INTEGER NOT NULL
);

-- The tick's death-stage query: every still-alive horse whose terminal day has arrived.
CREATE INDEX idx_horse_conditions_terminal ON horse_conditions (condition_code, state);
-- A horse's own page and the founding/foaling writers both look up by horse.
CREATE INDEX idx_horse_conditions_horse_id ON horse_conditions (horse_id);
