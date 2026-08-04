-- Slice 0022 §A4 step 4: every acquired-condition row horse_conditions currently carries, copied
-- across to horse_incidents - including open ('acute') ones, which keep their onset day, their
-- window and their treated state, so no horse mid-incident is left with the incident vanished.
INSERT INTO horse_incidents (horse_id, incident_type_code, state, onset_game_day, resolve_game_day, treated_game_day, outcome, management_state, management_until_game_day, last_evaluated_game_day)
SELECT hc.horse_id, hc.condition_code, hc.state, hc.onset_game_day, hc.resolve_game_day, hc.treated_game_day, hc.outcome, hc.management_state, hc.management_until_game_day, hc.last_evaluated_game_day
FROM horse_conditions hc
JOIN conditions c ON c.code = hc.condition_code
WHERE c.category = 'acquired';
