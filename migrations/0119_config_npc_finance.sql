-- Live tunables for the two mechanisms that keep NPC stables solvent now that they only show when a
-- player does (src/db/npcFinance.ts), plus the balance below which an NPC stops buying at all. All
-- three are guesses; nobody has watched this run yet.
--
-- npc_balance_floor_interval_game_days: how often the income floor is applied. Once a game year
-- (360 days, about 12 real days at three ticks a day). Deliberately long - the floor is a safety net
-- against a stable going silent, not an operating budget, and clearance sales are what an NPC
-- actually lives on. Shortening this raises the ceiling on how much money the floor can create.
--
-- pet_home_payout_fraction: what a horse fetches from a pet home, as a fraction of its appraised
-- value. One number for both sides of the same mechanic - a player choosing to send a horse to a
-- pet home, and an NPC stable's listing that ran its full window unsold going the same way. Well
-- below 1.0 on purpose: a pet home is the outlet you take when nobody in the game wants the horse,
-- and it has to be a worse deal than selling to a player or nobody would ever use the market.
--
-- npc_buy_offer_min_balance: below this, an NPC takes its standing buy offer down and stops shopping
-- open listings. Without it a broke stable still advertised an offer at the market_min_value floor
-- (50), and a lowball offer on a good horse reads to a child as a broken game, not a bad deal.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_balance_floor_interval_game_days', 360,
      '$.pet_home_payout_fraction', 0.4,
      '$.npc_buy_offer_min_balance', 500
    )
WHERE id = 1;
