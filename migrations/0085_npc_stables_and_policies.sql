-- Slice 0015 §5.3: two new NPC personality stables plus every npc_policy row, including one for
-- the existing Fair Meadow show barn. Same pattern as migrations/0040_npc_show_barn.sql - a
-- stables row and its stable_prefix_history row inserted together so no player can ever claim
-- these prefixes. Both new stables start with zero horses; an admin stocks them by hand (an
-- outcross batch, §3.3/§7.3) once that control exists. created_game_day reads the world's current
-- day rather than a hardcoded 0, since this migration can land well after world start.

-- Cedar Hollow: conformation specialist. Low noise, modest pace, targets the Quarter Horse ideal
-- vector - the only breed with one (§2.1).
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Cedar Hollow', 'Cedar Hollow', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Cedar Hollow'), 'Cedar Hollow', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Cedar Hollow'),
  'conformation_specialist', 'conformation',
  (SELECT id FROM breeds WHERE code = 'QH'),
  3.0, 0.10, 180, 2
);

-- Willow Creek Barrels: discipline barn. Targets Barrel Racing's ability_weights - the one
-- discipline that exists (§2.1). Name and prefix are the same full string, matching Cedar
-- Hollow's shape above (unlike Fair Meadow, whose stable name carries a "Show Barn" suffix its
-- prefix drops).
INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Willow Creek Barrels', 'Willow Creek Barrels', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Willow Creek Barrels'), 'Willow Creek Barrels', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Willow Creek Barrels'),
  'discipline_barn', 'ability',
  'barrels',
  4.0, 0.10, 150, 2
);

-- Fair Meadow: volume breeder. High selection noise (its ranking barely correlates with actual
-- quality - overview §10c's "little selection at all") and a shorter breeding interval than the
-- other two, expressed entirely through this row's numbers rather than a code branch (§2.3). No
-- new stables row - Fair Meadow already exists (migrations/0040_npc_show_barn.sql).
INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_breed_id, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Fair Meadow'),
  'volume_breeder', 'conformation',
  (SELECT id FROM breeds WHERE code = 'QH'),
  12.0, 0.05, 60, 4
);
