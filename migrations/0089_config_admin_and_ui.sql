-- Slice 0016 §10.2: the barn tabs' display-only foal cutoff, how many judged shows /shows lists,
-- and the PIN gate's three tunables. admin_pin_required lives in config.flags, alongside
-- force_next_twins and care_notice_enabled - the existing home for a plain on/off switch in this
-- codebase, and the operator's way to turn the gate off from /admin/config with no deploy.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.foal_max_age_game_days', 360,
      '$.shows_recent_count', 6,
      '$.pin_max_attempts', 5,
      '$.pin_lockout_window_seconds', 900,
      '$.admin_pin_grace_seconds', 1800
    ),
    flags = json_set(flags, '$.admin_pin_required', json('true')),
    updated_real_ts = unixepoch()
WHERE id = 1;
