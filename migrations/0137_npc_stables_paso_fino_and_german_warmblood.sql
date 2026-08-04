-- Slice 0023: six new NPC personality stables, giving Paso Fino and German Warmblood breeders a
-- real, improving competitor the way Quarter Horse breeders already have (Bronco Valley/Horseshoe
-- Bay/Apples and Oats Ranch, migration 0136's renamed rows). Pure data - runNpcBreedingDecisions,
-- the ceiling schedule, the market listing/buying stages, and the NPC stud mechanism all already
-- read any npc_policy row generically (slice 0015), so this migration alone is the whole slice
-- besides the reset.ts re-seed block (a code change, not data - see that file).
--
-- Each breed gets the same three personalities Quarter Horse has, with each personality's numbers
-- copied verbatim from its Quarter Horse counterpart (docs/slices/0023 §2.4) rather than guessed
-- fresh - conformation specialists and discipline barns from Bronco Valley/Horseshoe Bay, volume
-- breeders from Apples and Oats Ranch. Paso Fino's discipline barn targets Gaited Pleasure - the
-- breed is near-fixed for the DMRT3 gait allele (migrations/0024's own comment) and Gaited Pleasure
-- is the one discipline it enters as a matter of course. German Warmblood's discipline barn targets
-- Show Jumping ('jumping'), matching the operator's own chosen name for it (Springen Stables -
-- "springen" is German for "to jump").

-- Paso Fino conformation specialist.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Carrot Cove', 'Carrot Cove', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Carrot Cove'), 'Carrot Cove', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Carrot Cove'),
  'conformation_specialist', 'conformation',
  (SELECT id FROM breeds WHERE code = 'PF'),
  3.0, 0.10, 180, 2, 1.25, 0.08, 5000
);

-- Paso Fino discipline barn, targeting Gaited Pleasure.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Honeycomb Hills', 'Honeycomb Hills', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Honeycomb Hills'), 'Honeycomb Hills', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Honeycomb Hills'),
  'discipline_barn', 'ability',
  'gaited',
  4.0, 0.10, 150, 2, 1.10, 0.10, 5000
);

-- Paso Fino volume breeder.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Reese Puff Horses', 'Reese Puff Horses', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 200, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Reese Puff Horses'), 'Reese Puff Horses', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Reese Puff Horses'),
  'volume_breeder', 'conformation',
  (SELECT id FROM breeds WHERE code = 'PF'),
  12.0, 0.05, 60, 4, 0.85, 0.15, 3000
);

-- German Warmblood conformation specialist.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Queens Palace', 'Queens Palace', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Queens Palace'), 'Queens Palace', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Queens Palace'),
  'conformation_specialist', 'conformation',
  (SELECT id FROM breeds WHERE code = 'GW'),
  3.0, 0.10, 180, 2, 1.25, 0.08, 5000
);

-- German Warmblood discipline barn, targeting Show Jumping.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Springen Stables', 'Springen Stables', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Springen Stables'), 'Springen Stables', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Springen Stables'),
  'discipline_barn', 'ability',
  'jumping',
  4.0, 0.10, 150, 2, 1.10, 0.10, 5000
);

-- German Warmblood volume breeder.
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Suchon Acres', 'Suchon Acres', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 200, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Suchon Acres'), 'Suchon Acres', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Suchon Acres'),
  'volume_breeder', 'conformation',
  (SELECT id FROM breeds WHERE code = 'GW'),
  12.0, 0.05, 60, 4, 0.85, 0.15, 3000
);
