-- Operator feedback, 2026-08-05: a foal cannot show, so a child has no way to tell a good one from
-- a bad one and no basis for deciding whether to keep feeding it. An evaluation is a paid opinion
-- on a horse's conformation, in the same five words the horse page already uses after a horse has
-- shown (Poor / Weak / Acceptable / Good / Outstanding) - vague on a young foal, sharpening as it
-- grows.
--
-- Deliberately NOT a horse_knowledge row. That table's unique index (stable_id, horse_id,
-- subject_code) exists precisely to stop a permanent result being bought twice, and an evaluation is
-- the opposite: repeatable at full price, because the answer genuinely improves with the horse's
-- age. Its own table keeps that difference visible instead of forcing an exception into the one
-- place the codebase guarantees "a permanent result cannot be bought twice".
--
-- Truth vs knowledge (CLAUDE.md §12) holds here as everywhere: this row records what one stable was
-- told, not what the horse is. Two stables that evaluate the same weanling on the same day get the
-- same words (the jitter is derived from the horse's own rng_seed, never per-purchase), but neither
-- row is the horse's conformation.
CREATE TABLE horse_evaluations (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  evaluated_game_day INTEGER NOT NULL,
  -- The horse's age in game days at the moment of purchase. Stored rather than recomputed so an old
  -- evaluation still explains itself ("bought when he was four months old") after the horse grows.
  age_game_days INTEGER NOT NULL,
  -- JSON, shape: { "v": 1, "traits": { "<trait_code>": { "low": "<label>", "high": "<label>" } } }
  -- where <label> is one of poor/weak/acceptable/good/outstanding. low === high means the evaluator
  -- was certain. Snapshotted (CLAUDE.md §5.5): the words a stable was told never change afterwards,
  -- even though retuning conformation_label_*_min would change what a fresh evaluation says.
  verdicts TEXT NOT NULL,
  -- What was actually charged, for the same reason horse_knowledge.cost_paid exists: a receipt
  -- should say what it said at the time.
  cost_paid INTEGER NOT NULL
);

-- The screens read "the most recent evaluation this stable holds for this horse", which is this
-- index's exact shape. Older rows are kept rather than replaced so a child can see that the
-- yearling verdict was vaguer than the two-year-old one.
CREATE INDEX idx_horse_evaluations_stable_horse ON horse_evaluations (stable_id, horse_id, evaluated_game_day DESC);
