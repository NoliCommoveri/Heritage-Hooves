// Turns (slice 0009 Part B §5). Pure, no database access - the tick never touches `accounts` at
// all; the budget is derived at read time instead, which is what makes it idempotent by
// construction (a tick that fires twice or is missed entirely changes nothing about how many
// turns anyone has), never-banking (a new tick discards whatever was left) and pause-proof
// (world.tick_seq increments on a paused tick too, so a pause stops the world, not a child's
// afternoon - CLAUDE.md §5.3/slice 0001 §137).

import { parseSlot } from './time';

export interface AccountActionState {
  actions_remaining: number;
  actions_reset_tick_seq: number;
}

export function actionsRemaining(account: AccountActionState, tickSeq: number, actionsPerTick: number): number {
  return account.actions_reset_tick_seq === tickSeq ? account.actions_remaining : actionsPerTick;
}

/** The list of what costs a turn lives in one place, so the next slice adds to it rather than
 * hunting for the pattern. Future entries: 'list_horse', 'start_training' - decided in
 * conversation, 2 Aug 2026. genotype_test added by slice 0010 - a panel is one action, not four
 * (see /horses/:id/test's route, which spends this once regardless of how many conditions were
 * bought together). buy_horse added by slice 0017 §2.5 - a purchase is a real decision and should
 * compete with breeding, showing and testing for the day's turns. **Listing a horse stays free and
 * spends nothing**, deliberately (§2.5): a listing that costs nothing is a listing a child will
 * actually use rather than hoard actions against, and the ones nobody buys expire. book_stud added
 * by slice 0017 §13 (Part D) - a distinct kind from book_covering rather than reusing it, so a
 * future session reading the turns log can tell a cross-stable stud booking from an ordinary
 * same-barn one at a glance. Offering a stallion at stud stays free, same reasoning as listing. */
export type ActionKind = 'book_covering' | 'enter_show' | 'claim_founding' | 'genotype_test' | 'buy_horse' | 'sell_to_offer' | 'book_stud' | 'time_warp';

export const ACTION_COSTS: Record<ActionKind, number> = {
  book_covering: 1,
  enter_show: 1,
  claim_founding: 1,
  genotype_test: 1,
  buy_horse: 1,
  // Slice 0017 §12 (Part C): selling into a standing NPC offer skips the browsing period a fixed-
  // price listing has - it is over the moment the button is pressed, the same decisive commitment
  // buy_horse already costs the buyer, mirrored here onto the seller since there is no buyer turn
  // to spend in this direction.
  sell_to_offer: 1,
  book_stud: 1,
  // 2026-08-05: growing one horse up. A turn as well as the money, on the operator's own call - the
  // turn is what stops a whole crop being warped to maturity in one sitting, since there is
  // deliberately no per-horse daily limit.
  time_warp: 1,
};

/** The next tick slot's time of day, for the "more arrive at..." refusal message (§5.4). Purely
 * for display - reading the wall clock to render a time is fine (CLAUDE.md §5.3 is about deciding
 * things from it, not showing them), and this never decides anything. Wraps to the earliest slot
 * when every slot today has already passed. */
export function nextTickLocalTime(tickTimesLocal: string[], nowMinutesOfDay: number): string {
  const slots = [...tickTimesLocal].sort((a, b) => parseSlot(a) - parseSlot(b));
  return slots.find((s) => parseSlot(s) > nowMinutesOfDay) ?? slots[0];
}
