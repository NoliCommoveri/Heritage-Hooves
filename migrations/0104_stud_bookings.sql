-- Slice 0017 Part D (§13): the historical record of one stud booking - a covering created across
-- two stables, with the fee that changed hands. covering_id links to the coverings row this booking
-- created (via the same bookCovering path any other booking uses), so the conception-or-miss
-- outcome is one join away rather than duplicated here. Nothing here is ever updated after the
-- insert - it is an append-only record of what was agreed, the same shape ledger and horse_knowledge
-- already follow, and it is what season_cap is actually counted against (COUNT(*) WHERE
-- stud_listing_id = ? AND season_index = ?), not a running counter on stud_listings.
CREATE TABLE stud_bookings (
  id INTEGER PRIMARY KEY,
  stud_listing_id INTEGER NOT NULL REFERENCES stud_listings (id),
  covering_id INTEGER NOT NULL REFERENCES coverings (id),
  stallion_id INTEGER NOT NULL REFERENCES horses (id),
  stallion_stable_id INTEGER NOT NULL REFERENCES stables (id),
  mare_id INTEGER NOT NULL REFERENCES horses (id),
  mare_stable_id INTEGER NOT NULL REFERENCES stables (id),
  fee INTEGER NOT NULL,
  -- commission_paid: snapshotted at booking time, same reasoning as listings.commission_paid - a
  -- receipt should say what it said at the time, not what the rate happens to be today.
  commission_paid INTEGER NOT NULL,
  -- season_index: copied from world.season_index at booking time - what the season cap counts
  -- against.
  season_index INTEGER NOT NULL,
  booked_game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL
);

-- The season-cap check itself.
CREATE INDEX idx_stud_bookings_listing_season ON stud_bookings (stud_listing_id, season_index);
-- A mare owner's own stud history, and a stallion owner's own booking history.
CREATE INDEX idx_stud_bookings_mare_stable ON stud_bookings (mare_stable_id, id DESC);
CREATE INDEX idx_stud_bookings_stallion_stable ON stud_bookings (stallion_stable_id, id DESC);
