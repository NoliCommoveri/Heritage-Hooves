-- The externally-scheduled cap overview §10d calls "the single most important thing... to keep
-- adjustable" (schema §9.2). Two ceilings, not one: a conformation trait's quality is its
-- traitScore (closeness to the breed's target) and an ability trait's is its expressed value, and
-- those two sit on different scales in practice - slice 0015 §2.4. No tier column - see §2.8; add
-- one when regional/national shows are real. Applicable row at a given game_day = the one with the
-- largest game_day_from <= game_day.
CREATE TABLE npc_ceiling_schedule (
  id INTEGER PRIMARY KEY,
  game_day_from INTEGER NOT NULL,
  conformation_ceiling REAL NOT NULL,
  ability_ceiling REAL NOT NULL
);
CREATE INDEX idx_npc_ceiling_schedule_game_day_from ON npc_ceiling_schedule (game_day_from);

-- Starter rows (slice 0015 §5.2) - illustrative, expected to be retuned from /admin/npc once a
-- later session builds that page (§12.3): conformation raw scores observe around 70-85 and ability
-- scores around 40-70 (slice 0013 §4.3), so opening at 76/52 lets an NPC stable tell ordinary stock
-- apart without already chasing the top of that band on day one.
INSERT INTO npc_ceiling_schedule (game_day_from, conformation_ceiling, ability_ceiling) VALUES
  (0,    76, 52),
  (1080, 80, 56),
  (2160, 84, 60),
  (3240, 88, 64);
