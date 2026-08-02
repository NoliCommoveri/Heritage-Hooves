-- Slice 0011 §5.1: old age gets a lifespan rolled once at birth and snapshotted, not a hazard
-- rolled every tick (CLAUDE.md §5.4/§5.5) - see src/engines/ageing/lifespan.ts.
ALTER TABLE horses ADD COLUMN natural_death_game_day INTEGER;
-- The day old age will take this horse, decided once (deriveSeed(rng_seed, 'lifespan')) and never
-- rerolled. Null means not yet assigned - the tick's backfill stage (assignLifespansAndNoticeFrailty)
-- assigns one to every living horse that lacks it. Never rendered to a player, in any form.
ALTER TABLE horses ADD COLUMN frailty_notice_game_day INTEGER;
-- The day the "failing" event fired for this horse, null until it has - its own idempotency marker
-- (§7.2), not rendered anywhere.

-- Both of the tick's ageing queries (the backfill's "null natural_death_game_day" scan and the death
-- stage's "natural_death_game_day <= today" scan) only ever look at living horses - partial on
-- status = 'alive' keeps the index small and keeps that reason written down next to it.
CREATE INDEX idx_horses_natural_death ON horses (natural_death_game_day) WHERE status = 'alive';
