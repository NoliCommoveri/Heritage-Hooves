// Taking a horse out of the game for good, and deciding whether its row is worth keeping.
//
// Two callers share this, and they must keep sharing it: an NPC stable's unsold listing clearing to
// a buyer outside the game (src/db/npcFinance.ts) and a player selling a horse to a pet home
// (src/routes/horses.ts). Both are "this horse leaves and somebody pays for it", and the rule for
// what happens to the row is the operator's, not either caller's - so it lives here once rather
// than being written twice and drifting.
//
// **The rule: a horse that never showed and never conceived is deleted outright; everything else is
// marked `removed` and kept.** A row nothing refers to is dead weight on every table it sits in,
// and there is nothing to look back at - no ribbon, no foal, no pedigree hanging off it.

import type { Env } from '../types';
import { buildEndHorseParticipationStatements } from './ageing';

/**
 * "Never showed and never conceived", as a SQL fragment expecting the horses row aliased `h`.
 *
 * **Bred means pregnant, not covered** (the operator's own clarification). A mare who was covered
 * and never caught, or a stallion whose covering never took, has no produce and is deletable - a
 * failed breeding attempt is not a record of anything. That is why `coverings` is absent from the
 * list below and present in buildDeleteHorseStatements instead; `pregnancies` is the real bar.
 *
 * Every clause here is doing two jobs at once, and that is why the list is longer than the phrase
 * suggests. It is the operator's rule, *and* it is the proof that deleting the row cannot break a
 * foreign key: every one of the fifteen tables with a `REFERENCES horses (id)` column is either
 * named below (so the horse is kept) or cleaned up by buildDeleteHorseStatements (so the reference
 * goes with it) - horse_incidents (slice 0022 §A4) is the fifteenth, and it is in the second list.
 * If a future migration adds a sixteenth, it belongs in one list or the other, and the delete will
 * start failing inside a batch if it is in neither.
 *
 * The two stud clauses are deliberately stricter than the operator's rule. A stud booking is a
 * cross-stable transaction with a player's money in it, and deleting a horse that appears in one
 * would delete the covering underneath it, silently emptying the record of what a child actually
 * paid for - so a horse that ever stood at stud or was ever booked to one is kept whole even if the
 * booking never produced a pregnancy. It also happens to be what makes the covering delete safe: a
 * booking always names both its horses, so no covering a stud_booking points at can ever belong to
 * a deletable horse.
 *
 * `events` and the two import/injection tables are defensive rather than expected, but they are not
 * free of consequence for the player-facing caller: a horse that a child has an event about (a
 * birth notice, a show result, a condition sign) is kept, which is the right instinct anyway.
 */
export const deletableHorseSql = `
  NOT EXISTS (SELECT 1 FROM show_entries WHERE horse_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM horse_show_summary WHERE horse_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM horses o WHERE o.sire_id = h.id OR o.dam_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM horse_ancestors WHERE ancestor_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM pregnancies WHERE dam_id = h.id OR sire_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM stud_listings WHERE stallion_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM stud_bookings WHERE stallion_id = h.id OR mare_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM events WHERE subject_horse_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM import_candidates WHERE horse_id = h.id)
  AND NOT EXISTS (SELECT 1 FROM consignment_injections WHERE applied_horse_id = h.id)
`;

/** The same question as a single-horse lookup, for a route that has one horse in hand rather than a
 * set of listings to classify. */
export async function isHorseDeletable(env: Env, horseId: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT CASE WHEN ${deletableHorseSql} THEN 1 ELSE 0 END AS ok FROM horses h WHERE h.id = ?`)
    .bind(horseId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

/**
 * The rows that exist only to describe this one horse, deleted in child-before-parent order so the
 * foreign keys hold at every step.
 *
 * Two things are deliberately not deletes:
 *
 * - **`pregnancies.foal_id` is set to NULL rather than the pregnancy being removed.** The horse may
 *   well have been born of one, and that pregnancy is its *dam's* history, which the operator's
 *   rule is not about. NULL is already an ordinary value in that column (every in-progress
 *   pregnancy has one), and the row keeps its status, its dates and both parents, so the record
 *   that she foaled survives intact.
 * - **Nothing touches `ledger`.** It is append-only (CLAUDE.md §7) and its rows carry the horse's
 *   name in their own description text, so a receipt stays readable after the horse is gone. What
 *   it loses is the reference_id pointer, which nothing renders.
 */
export function buildDeleteHorseStatements(env: Env, horseId: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('UPDATE pregnancies SET foal_id = NULL WHERE foal_id = ?').bind(horseId),
    // Coverings that never became a pregnancy - the only kind a deletable horse can have, since
    // eligibility rules out anything that ever conceived, and pregnancies.covering_id would
    // otherwise be left pointing at nothing. **This is the one place a horse's removal touches
    // another horse's record**: a covering names a mare and a stallion, so the counterpart loses
    // its note of that failed attempt too. That follows from bred meaning pregnant rather than
    // covered - a covering with no pregnancy behind it is the thing the operator judged not worth
    // keeping, and it cannot be kept for one side only.
    env.DB.prepare('DELETE FROM coverings WHERE mare_id = ? OR stallion_id = ?').bind(horseId, horseId),
    env.DB.prepare('DELETE FROM horse_ancestors WHERE descendant_id = ?').bind(horseId),
    env.DB.prepare('DELETE FROM horse_conditions WHERE horse_id = ?').bind(horseId),
    // Slice 0022 §A4: horse_incidents references horses (horse_id) - a fact about one horse, goes
    // with it, same reasoning as horse_conditions right above.
    env.DB.prepare('DELETE FROM horse_incidents WHERE horse_id = ?').bind(horseId),
    env.DB.prepare('DELETE FROM horse_knowledge WHERE horse_id = ?').bind(horseId),
    // Every listing this horse ever had, not just an open one - an earlier withdrawn or expired
    // listing points at it just as hard. None can be a 'sold' row: a sold horse belongs to whoever
    // bought it and is not in the seller's barn to be sent anywhere.
    env.DB.prepare('DELETE FROM listings WHERE horse_id = ?').bind(horseId),
    env.DB.prepare('DELETE FROM horses WHERE id = ?').bind(horseId),
  ];
}

/**
 * The whole departure, either way: delete the row if the operator's rule says it is not worth
 * keeping, otherwise mark it `removed` through slice 0011's own retire-away path (which cancels
 * pregnancies, coverings and unjudged show entries correctly without any caller knowing those
 * tables exist).
 *
 * Callers put these statements in the same batch as whatever pays for the horse, so the money and
 * the departure land together or not at all - the rule buildLedgerStatements' own header sets out.
 */
export function buildHorseDepartureStatements(
  env: Env,
  params: { horseId: number; sex: 'mare' | 'stallion' | 'gelding'; gameDay: number; endReason: string; deletable: boolean }
): D1PreparedStatement[] {
  if (params.deletable) return buildDeleteHorseStatements(env, params.horseId);
  return buildEndHorseParticipationStatements(env, {
    horseId: params.horseId,
    sex: params.sex,
    gameDay: params.gameDay,
    status: 'removed',
    endReason: params.endReason,
  });
}
