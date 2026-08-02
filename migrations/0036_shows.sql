-- One show on the monthly circuit (slice 0008 §5.3/§6.1). UNIQUE(scheduled_game_day, tier) is what
-- makes the tick's show-creation stage idempotent: it re-derives which shows should exist from
-- game_day arithmetic and lets this index reject a show that already exists, rather than a counter
-- or a "last created" column (CLAUDE.md §5.4).
CREATE TABLE shows (
  id INTEGER PRIMARY KEY,
  -- name: assembled once at creation from the venue and the show's position in the calendar, e.g.
  -- "Cedar Hollow Spring Show, Year 2" - never re-derived, so renaming the venue list later does
  -- not rewrite history.
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('local', 'regional', 'national')),
  venue TEXT NOT NULL,
  scheduled_game_day INTEGER NOT NULL,
  -- entry_deadline_game_day: equal to scheduled_game_day in this slice - there is no entry deadline
  -- distinct from the show date yet (§3). Entries close when the tick judges the show.
  entry_deadline_game_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'entries_open' CHECK (status IN ('entries_open', 'judged', 'cancelled')),
  rng_seed INTEGER NOT NULL,
  created_game_day INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL,
  UNIQUE (scheduled_game_day, tier)
);

-- /shows' only two queries: the next not-yet-judged show, and the most recent judged ones.
CREATE INDEX idx_shows_status_scheduled_game_day ON shows (status, scheduled_game_day);
