-- Slice 0017 §12 (Part C): NPC standing demand, from schema doc §7.2. An NPC stable posts one active
-- offer at a time describing what it wants and the most it will pay; a player sells a horse that
-- fits straight into it, no browsing period. Players never post offers - the board is NPC demand
-- only, so there is no player-facing "post an offer" route and no player_id-shaped column here.
CREATE TABLE buy_offers (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- criteria: JSON, {"v":1,"breed_id":3|null,"min_age_game_days":int|null,
  --   "max_age_game_days":int|null,"min_quality":number}. A null breed_id means the offer isn't
  --   breed-restricted (an ability-kind NPC policy scores any breed the same way). Geldings are
  --   excluded from every offer in code, not in this JSON - the whole reason NPC buying exists is
  --   outcross breeding stock (overview §10f), and a gelding can never be bred.
  criteria TEXT NOT NULL,
  -- max_price: what the offer actually pays, in whole units - fixed at post time, same reasoning as
  -- listings.price (CLAUDE.md §7, never a float). A seller sells into it at exactly this number.
  max_price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL
);

-- One active offer per NPC stable at a time - refreshNpcBuyOffers (src/db/npcBuying.ts) updates this
-- row in place rather than opening a second one, the same "one open thing per owner" shape
-- idx_listings_one_open_per_horse already establishes.
CREATE UNIQUE INDEX idx_buy_offers_one_active_per_stable ON buy_offers (stable_id) WHERE active = 1;
-- /market's Offers tab.
CREATE INDEX idx_buy_offers_active ON buy_offers (id) WHERE active = 1;
