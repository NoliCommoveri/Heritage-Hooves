/** True when this stable may take on a new cost. Debt blocks expansion (booking a covering, and
 * later buying/testing/training/tack), never competing - a stable that goes negative must always
 * be able to show its way back out, since shows are currently the only source of income (slice
 * 0009 §2.4). Called by the breeding route only; do not call it from the show entry path - see the
 * comment at enterHorseInClass in src/db/shows.ts for why. */
export function canTakeOnCost(balance: number): boolean {
  return balance >= 0;
}
