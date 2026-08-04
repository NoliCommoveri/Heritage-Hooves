-- Slice 0017 Part D (stud services, §13): a stallion's owner offers him at stud for a fee, with a
-- cap on bookings per season. This is the market's second table, alongside `listings` - a stud
-- booking never transfers the horse itself, so it cannot reuse `listings` the way an NPC sale
-- listing does (schema doc §7.3).
CREATE TABLE stud_listings (
  id INTEGER PRIMARY KEY,
  stallion_id INTEGER NOT NULL REFERENCES horses (id),
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- fee: what a mare's owner pays per booking, in whole units (CLAUDE.md §7, never a float). Fixed
  -- at listing time - like listings.price, changing it is withdraw-and-relist.
  fee INTEGER NOT NULL,
  -- season_cap: how many bookings this stallion accepts in one world.season_index. Counted live
  -- from stud_bookings rather than kept as a running counter here (CLAUDE.md's "boring
  -- implementation" - a live COUNT can never drift out of sync with the rows it is counting).
  season_cap INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_game_day INTEGER NOT NULL,
  closed_game_day INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- A stallion stands at stud once at a time - the same "one open thing per owner" shape
-- idx_listings_one_open_per_horse already establishes for a sale listing.
CREATE UNIQUE INDEX idx_stud_listings_one_active_per_stallion ON stud_listings (stallion_id) WHERE active = 1;
-- /market/stud's own list, and the tick's dead-stallion sweep.
CREATE INDEX idx_stud_listings_active ON stud_listings (id) WHERE active = 1;
-- A stable's own stud listings.
CREATE INDEX idx_stud_listings_stable ON stud_listings (stable_id, id DESC);
