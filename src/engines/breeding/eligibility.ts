// Whether a mare can be booked to a covering right now, independent of which stallion. Pure - no
// database access. docs/fixes/breeding-eligibility-display.md §2: validateBooking
// (src/routes/horses.ts) and validateStudBooking (src/db/stud.ts) each re-derived this same ladder
// for the mare's own side of a pairing; this is the one place it is decided, so a picker can ask
// the same question those refusal functions do rather than restating it a third time.
//
// Season and capacity are deliberately NOT here - both are barn-wide facts, not per-mare ones, and
// belong in one sentence above a picker rather than being repeated against every mare in it. Both
// refusal ladders still check them, after a mare is chosen.
//
// Order matters: this mirrors the order validateBooking's own checks run in for a mare (location,
// then age, then recovery, then pregnancy, then an existing booking), so a mare who fails more than
// one check is told about the same one a booking attempt would have stopped her on.

import { isOldEnoughToBreed } from './maturity';
import type { WorkAvailability } from '../care/location';

export type MareIneligibility =
  | 'at_pasture'
  | 'settling_in'
  | 'too_young'
  | 'recovering'
  | 'in_foal'
  | 'booked';

export interface MareEligibilityInput {
  bornGameDay: number;
  gameDay: number;
  minBreedingAgeGameDays: number;
  /** src/engines/care/location.ts's workAvailability, already evaluated by the caller - the same
   * discipline src/engines/showing/eligibility.ts's EligibilityHorse follows, so there is exactly
   * one implementation of the settling rule in the codebase. */
  availability: WorkAvailability;
  lastFoaledGameDay: number | null;
  mareRecoveryGameDays: number;
  inFoal: boolean;
  /** True when this mare already has a booked (unresolved) covering - to any stallion. The stallion's
   * name for the message is not this engine's concern; the caller already has the covering row. */
  booked: boolean;
}

export function mareIneligibility(input: MareEligibilityInput): MareIneligibility | undefined {
  if (!input.availability.available) return input.availability.reason;
  if (!isOldEnoughToBreed(input.bornGameDay, input.gameDay, input.minBreedingAgeGameDays)) return 'too_young';
  if (input.lastFoaledGameDay !== null && input.gameDay - input.lastFoaledGameDay < input.mareRecoveryGameDays) return 'recovering';
  if (input.inFoal) return 'in_foal';
  if (input.booked) return 'booked';
  return undefined;
}

/**
 * The stallion-side counterpart, for a picker offering "one of your own stallions" with none
 * chosen yet (docs/fixes/breeding-eligibility-display.md §2's own table names this picker
 * alongside the two mare ones). Only the two reasons that make sense with no mare in the picture -
 * "already booked" and "recovering from foaling" are mare concepts (coverings.mare_id, the
 * recovery timer), never a stallion's.
 */
export type StallionIneligibility = 'at_pasture' | 'settling_in' | 'too_young';

export interface StallionEligibilityInput {
  bornGameDay: number;
  gameDay: number;
  minBreedingAgeGameDays: number;
  availability: WorkAvailability;
}

export function stallionIneligibility(input: StallionEligibilityInput): StallionIneligibility | undefined {
  if (!input.availability.available) return input.availability.reason;
  if (!isOldEnoughToBreed(input.bornGameDay, input.gameDay, input.minBreedingAgeGameDays)) return 'too_young';
  return undefined;
}
