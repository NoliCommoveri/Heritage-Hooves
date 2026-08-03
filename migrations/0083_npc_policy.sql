-- One row per NPC stable (slice 0015 §2.1/§2.3). Everything here is a live tunable (CLAUDE.md
-- §5.5) except last_bred_game_day, which is idempotency bookkeeping, not a duration - retuning
-- breeding_interval_game_days mid-cycle changes when the *next* cycle fires, never rewrites one
-- already scheduled. No quality_ceiling column, unlike the schema document's own sketch: §2.4
-- reads the active ceiling fresh from npc_ceiling_schedule every cycle, never caches it.
CREATE TABLE npc_policy (
  stable_id INTEGER PRIMARY KEY REFERENCES stables(id),
  personality_code TEXT NOT NULL,          -- display/reasoning label only, e.g. 'conformation_specialist'
  target_kind TEXT NOT NULL CHECK (target_kind IN ('conformation', 'ability')),
  target_breed_id INTEGER REFERENCES breeds(id),            -- set when target_kind = 'conformation'
  target_discipline_code TEXT REFERENCES disciplines(code),  -- set when target_kind = 'ability'
  selection_noise_sd REAL NOT NULL,
  retention_bias REAL NOT NULL,
  breeding_interval_game_days INTEGER NOT NULL,
  max_pairs_per_cycle INTEGER NOT NULL,
  last_bred_game_day INTEGER,
  CHECK (
    (target_kind = 'conformation' AND target_breed_id IS NOT NULL AND target_discipline_code IS NULL) OR
    (target_kind = 'ability' AND target_discipline_code IS NOT NULL AND target_breed_id IS NULL)
  )
);
