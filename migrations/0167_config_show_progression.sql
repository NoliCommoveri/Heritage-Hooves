-- Slice 0025 stage 4 §7.5/§7.5a: two live tunables and one on/off switch.
--
-- show_rank_top3_required / show_rank_win_required: the graduation rule (migration 0166's own
-- comment) - the operator's stated compound rule ("at least four ribbons 1-3 place and at least one
-- must be 1st") as the two counts it takes literally.
--
-- show_auto_create_enabled lives in flags, not values, alongside care_notice_enabled/
-- acute_check_enabled/force_next_twins - the existing home for a plain on/off switch in this game
-- (migrations 0072/0089/0124). Seeded false: the calendar-based show creation createDueShows has
-- always done is switched off as of this migration - classes are now minted on demand, the moment a
-- player asks to enter one (§7.5a). This is "a way back" (the section's own phrase): the operator
-- can flip it from /admin/config with no deploy if an empty /shows page ever reads as a broken game
-- to the children, and createDueShows itself is left in place behind the flag rather than deleted.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.show_rank_top3_required', 4,
      '$.show_rank_win_required', 1
    ),
    flags = json_set(flags, '$.show_auto_create_enabled', json('false')),
    updated_real_ts = unixepoch()
WHERE id = 1;
