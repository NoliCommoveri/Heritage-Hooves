-- Slice 0026 stage 4 §4.3/§4.6: retunes the show barn's stock target from one flat quality band to
-- a rank-seeded plan (2 novice/mid, 4 open/mid, 4 champion/high per breed in play - 10 total, up
-- from 6), and adds the wider age spread new show-barn mints use so turnover is continuous rather
-- than arriving as a wave (4-14 game years, against founding stock's 4-8). npc_show_barn_quality_band
-- is removed rather than left stale - src/db/npc.ts's mintFoundingHorses now reads the band per rank
-- tier from npc_show_barn_rank_plan instead.
UPDATE config
SET version = version + 1,
    "values" = json_remove(
      json_set(
        "values",
        '$.npc_show_barn_size', 10,
        '$.npc_show_barn_rank_plan', json('[{"rank":"novice","count":2,"band":"mid"},{"rank":"open","count":4,"band":"mid"},{"rank":"champion","count":4,"band":"high"}]'),
        '$.npc_show_barn_age_min_game_days', 1440,
        '$.npc_show_barn_age_max_game_days', 5040
      ),
      '$.npc_show_barn_quality_band'
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
