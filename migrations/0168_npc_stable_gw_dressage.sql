-- A second German Warmblood discipline barn, targeting Dressage. Every mechanism it uses
-- (runNpcBreedingDecisions, the ceiling schedule, market listing/buying, NPC stud) already reads
-- any npc_policy row generically (slice 0015), so - same as migration 0137 - this is pure data.
-- Numbers copied verbatim from the breed's existing discipline barn, Springen Stables (jumping),
-- since docs/breed-ability-and-aptitude.md's discipline_aptitudes row rates German Warmblood
-- almost exactly as well suited to dressage (1.04) as to jumping (1.05) - a second discipline barn
-- for the breed's other strong discipline, not a weaker copy of the first.

INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
VALUES (NULL, 'Dressur Stables', 'Dressur Stables', (SELECT game_day FROM world WHERE id = 1), 1, 1, 0, 40, (SELECT game_day FROM world WHERE id = 1), unixepoch(), 1);

INSERT INTO stable_prefix_history (stable_id, prefix, from_game_day, to_game_day, claimed_by_account_id, created_real_ts)
VALUES ((SELECT id FROM stables WHERE prefix = 'Dressur Stables'), 'Dressur Stables', (SELECT game_day FROM world WHERE id = 1), NULL, NULL, unixepoch());

INSERT INTO npc_policy (stable_id, personality_code, target_kind, target_discipline_code, selection_noise_sd, retention_bias, breeding_interval_game_days, max_pairs_per_cycle, market_price_multiplier, market_price_spread, balance_floor)
VALUES (
  (SELECT id FROM stables WHERE prefix = 'Dressur Stables'),
  'discipline_barn', 'ability',
  'dressage',
  4.0, 0.10, 150, 2, 1.10, 0.10, 5000
);
