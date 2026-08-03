-- Slice 0017 §11 (Part B): an NPC stable's asking price is the same appraise() every player's
-- guide value comes from, times a per-personality multiplier, with a modest seeded spread so two
-- listings from the same stable don't ask an identical number. Both live on npc_policy alongside
-- the personality's other traits (selection_noise_sd, retention_bias) rather than in global config,
-- because they are a property of the personality, not a game-wide tunable.
ALTER TABLE npc_policy ADD COLUMN market_price_multiplier REAL NOT NULL DEFAULT 1.0;
-- Fraction either side of the multiplied appraisal, e.g. 0.1 = +/-10%.
ALTER TABLE npc_policy ADD COLUMN market_price_spread REAL NOT NULL DEFAULT 0.1;

-- Differentiate the three existing personalities (migrations/0085): a conformation specialist
-- prices its culls higher than a volume breeder prices its surplus.
UPDATE npc_policy SET market_price_multiplier = 1.25, market_price_spread = 0.08 WHERE personality_code = 'conformation_specialist';
UPDATE npc_policy SET market_price_multiplier = 1.10, market_price_spread = 0.10 WHERE personality_code = 'discipline_barn';
UPDATE npc_policy SET market_price_multiplier = 0.85, market_price_spread = 0.15 WHERE personality_code = 'volume_breeder';
