-- Slice 0025 stage 4 §7.5: "a three-rank progression: Novice / Open / Champion, tracked
-- independently per class type - Open in barrel racing while still Novice in Quarter Horse
-- conformation." One row per (horse, class_key) - class_key uses the same 'bc:<breed_id>' /
-- 'disc:<discipline_code>' prefixes show_classes.class_key does (src/db/shows.ts's classKeyFor),
-- though this table only ever holds rows for those two rank-tracked types - young_conformation and
-- ability_test never earn a rank (stage 4's own decision, matching stage 3's "ribbons from these
-- classes do not count toward progression").
--
-- Graduation is the operator's own compound rule, implemented literally rather than as a fuzzier
-- points total: at least show_rank_top3_required placings of 3rd or better, including at least
-- show_rank_win_required 1st-place finish, since entering "open" or "champion" status - counted
-- fresh at each rank (top3_since_promotion/wins_since_promotion reset to 0 on every promotion), the
-- same way a real breed association's point system requires a fresh qualifying score at each level
-- rather than banking wins from a lower level forever. There is no path back down - once earned, a
-- rank is never lost.
CREATE TABLE horse_class_ranks (
  id INTEGER PRIMARY KEY,
  horse_id INTEGER NOT NULL REFERENCES horses (id),
  class_type TEXT NOT NULL CHECK (class_type IN ('breed_conformation', 'discipline')),
  breed_id INTEGER REFERENCES breeds (id),
  discipline_code TEXT,
  class_key TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT 'novice' CHECK (rank IN ('novice', 'open', 'champion')),
  top3_since_promotion INTEGER NOT NULL DEFAULT 0,
  wins_since_promotion INTEGER NOT NULL DEFAULT 0,
  updated_game_day INTEGER NOT NULL,
  UNIQUE (horse_id, class_key)
);

CREATE INDEX idx_horse_class_ranks_horse_id ON horse_class_ranks (horse_id);
