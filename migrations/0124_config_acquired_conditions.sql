-- Slice 0020 §6.4: the twelve acquired conditions' shared tunables. Treatment costs are set against
-- the same arithmetic slice 0010 §5.4 used for test pricing (board is 60/horse/real-day at standard
-- feed, a show win pays 600) - starting points, to be tuned by observation at /admin/incidents.
-- acute_check_enabled lives in flags, not values, alongside care_notice_enabled/force_next_twins -
-- the existing home for a plain on/off switch in this game (migrations/0072/0089).
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.workload_window_game_days', 90,
      '$.workload_ceiling_entries', 4,
      '$.incident_probability_ceiling_per_game_day', 0.02,
      '$.acute_treatment_cost_colic', 180,
      '$.acute_treatment_cost_choke', 90,
      '$.acute_treatment_cost_ulcers', 150,
      '$.acute_treatment_cost_tying_up', 120,
      '$.acute_treatment_cost_strangles', 160,
      '$.acute_treatment_cost_abscess', 60,
      '$.acute_treatment_cost_skin', 50,
      '$.acute_treatment_cost_eye_injury', 110,
      '$.acute_treatment_cost_laminitis', 220,
      '$.acute_treatment_cost_navicular', 180,
      '$.acute_treatment_cost_osteoarthritis', 180,
      '$.acute_treatment_cost_suspensory', 200,
      '$.acute_incident_care_penalty', 0.02
    ),
    flags = json_set(flags, '$.acute_check_enabled', json('true')),
    updated_real_ts = unixepoch()
WHERE id = 1;
