-- The "While you were away" feed (slice 0009 Part B, §6). Only stables with an account_id ever get
-- a row - the NPC show barn foals nothing a child reads, so nothing is ever written for it.
--
-- payload: JSON, shape depends on kind, each with its own "v" schema version (the same convention
-- horses.genotype uses). Shapes in use today:
--   foaled              -> {"v":1,"foal_name":"...","dam_name":"...","sire_name":"...","sex":"filly"}
--   covering_conceived  -> {"v":1,"mare_name":"...","stallion_name":"...","due_game_day":1234}
--   covering_missed     -> {"v":1,"mare_name":"...","stallion_name":"..."}
--   show_result         -> {"v":1,"horse_name":"...","show_name":"...","class_name":"...","placing":1,"prize":600}
-- `kind` is deliberately free text with no CHECK - a future kind attaches here with no migration.
--
-- read_at_real_ts, not read_at (the schema document's original sketch): CLAUDE.md §7 requires a
-- wall-clock column to carry the _real_ts suffix so a reader can tell which clock it belongs to.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  game_day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject_horse_id INTEGER REFERENCES horses (id),
  payload TEXT NOT NULL,
  read_at_real_ts INTEGER,
  created_real_ts INTEGER NOT NULL
);

-- The stable-home feed and the "While you were away" panel's per-stable read.
CREATE INDEX idx_events_stable_id ON events (stable_id, id DESC);
-- The unread count/list across every stable an account owns.
CREATE INDEX idx_events_read_at ON events (read_at_real_ts);
