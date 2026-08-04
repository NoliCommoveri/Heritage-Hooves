-- Amendment 0017a §5.4 follow-up: a queued injection previously became eligible for whichever
-- batch minted next, including one already due/overdue at the moment it was queued - which
-- reads to an operator as "it got swept into the batch that was already about to happen" rather
-- than the fresh batch they meant to seed. eligible_from_game_day lets queueInjection defer a
-- freshly-queued row past an already-due batch to the one after it. NULL for rows queued before
-- this migration (existing 'queued' rows, if any) means "eligible whenever queued" - unchanged.
ALTER TABLE consignment_injections ADD COLUMN eligible_from_game_day INTEGER;
