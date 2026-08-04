-- Slice 0017 Part D (§13): stud services' own tunables, all live, all guesses (the same posture
-- every other market number in this game was seeded with - build log, 3 Aug 2026). stud_max_fee is
-- a typo guard on the fee field, the same job market_max_price does for a sale's asking price.
-- stud_default_season_cap only pre-fills the "offer at stud" form - nothing enforces it, the owner
-- can type any whole number. npc_stud_fee_fraction is shared by both an NPC's own stud fee and the
-- suggested-fee hint on a player's own offer form, rather than inventing two numbers for the same
-- "what's a typical stud fee, as a fraction of the horse's worth" question. npc_stud_season_cap is
-- how many bookings an NPC-listed stallion accepts per season.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.stud_max_fee', 100000,
      '$.stud_default_season_cap', 10,
      '$.npc_stud_fee_fraction', 0.15,
      '$.npc_stud_season_cap', 6
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
