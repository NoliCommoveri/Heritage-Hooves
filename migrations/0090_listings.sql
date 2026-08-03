-- The market's one table (slice 0017 §5.2), from schema doc §7.1. Every sale in the game is a row
-- here: player-to-player today, NPC-to-player and player-to-NPC when Parts B and C land - an NPC
-- listing is this same row with an is_npc stable in seller_stable_id, not a second table.
CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  seller_stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- price: what the buyer pays, in whole units. Integer, never a float (CLAUDE.md §7). Fixed at
  -- listing time and never changed - editing a price is withdraw-and-relist, so the sold list
  -- (§6.4) is a record of what was actually asked.
  price INTEGER NOT NULL,
  -- guide_value: the appraisal at listing time, snapshotted. Shown to the seller only (§2.7);
  -- stored so a later session can ask how far asking prices ran from the model without having to
  -- re-derive a value from a horse that has since aged, been tested, or won something.
  guide_value INTEGER,
  listed_game_day INTEGER NOT NULL,
  -- expires_game_day: SNAPSHOT (CLAUDE.md §5.5). Retuning market_listing_game_days must never move
  -- the expiry of a listing already posted.
  expires_game_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'withdrawn', 'expired')),
  buyer_stable_id INTEGER REFERENCES stables (id),
  sold_game_day INTEGER,
  -- commission_paid: what the seller actually lost to commission, snapshotted at sale. A receipt
  -- should say what it said at the time, not what the rate happens to be today - the same
  -- reasoning horse_knowledge.cost_paid already follows.
  commission_paid INTEGER,
  -- closed_game_day: set for withdrawn and expired too, so "when did this listing stop being open"
  -- is one column rather than three.
  closed_game_day INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- A horse is on the market once at a time. This is what makes that true, rather than a check
-- somebody forgets - the same pattern idx_horse_knowledge_unique already establishes.
CREATE UNIQUE INDEX idx_listings_one_open_per_horse ON listings (horse_id) WHERE status = 'open';
-- The tick's expiry sweep, and /market's own list.
CREATE INDEX idx_listings_open ON listings (expires_game_day) WHERE status = 'open';
-- A stable's own listings, on the barn and the market's "yours" tab.
CREATE INDEX idx_listings_seller ON listings (seller_stable_id, id DESC);
-- /market/sold, newest first.
CREATE INDEX idx_listings_sold ON listings (sold_game_day DESC) WHERE status = 'sold';
