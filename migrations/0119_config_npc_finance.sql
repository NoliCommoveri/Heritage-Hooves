-- Live tunables for the two mechanisms that keep NPC stables solvent now that they only show when a
-- player does (src/db/npcFinance.ts), plus the balance below which an NPC stops buying at all. All
-- three are guesses; nobody has watched this run yet.
--
-- npc_balance_floor_interval_game_days: how often the income floor is applied. Once a game year
-- (360 days, about 12 real days at three ticks a day). Deliberately long - the floor is a safety net
-- against a stable going silent, not an operating budget, and clearance sales are what an NPC
-- actually lives on. Shortening this raises the ceiling on how much money the floor can create.
--
-- npc_listing_clearance_fraction: what an NPC stable is paid for a horse that ran its full listing
-- window unsold and cleared to a buyer outside the game, as a fraction of the horse's own guide
-- value. Below 1.0 on purpose - a private sale after nobody local wanted the horse must be worse
-- than a sale to a player, or an NPC would rather wait the window out than be bought from.
--
-- npc_buy_offer_min_balance: below this, an NPC takes its standing buy offer down and stops shopping
-- open listings. Without it a broke stable still advertised an offer at the market_min_value floor
-- (50), and a lowball offer on a good horse reads to a child as a broken game, not a bad deal.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_balance_floor_interval_game_days', 360,
      '$.npc_listing_clearance_fraction', 0.6,
      '$.npc_buy_offer_min_balance', 500
    )
WHERE id = 1;
