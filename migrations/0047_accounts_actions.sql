-- Turns (slice 0009 Part B, §5.1). Per account, never per stable - a stable-held budget would
-- triple the moment a child founded two more (CLAUDE.md's vocabulary section on why scarcity
-- lives on the account). Both default 0, which reads as "reset at tick 0, none left" - but §5.2's
-- lazy actionsRemaining() treats any account whose actions_reset_tick_seq is behind the current
-- tick_seq as full, so every existing account is at full budget the moment this migration lands.
-- No backfill needed.
ALTER TABLE accounts ADD COLUMN actions_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN actions_reset_tick_seq INTEGER NOT NULL DEFAULT 0;
