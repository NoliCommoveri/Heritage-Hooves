// Whether a horse has reached min_breeding_age_game_days. Pure - no database access. One function
// for both sexes: the age rule itself does not differ between a mare and a stallion, only what a
// screen does once it knows the answer.
//
// docs/fixes/breeding-eligibility-display.md §1: added so mareStatusLine, the barn "in season"
// badge and the "Offer at stud" card can all ask the same question the refusal ladders
// (validateBooking, validateStudBooking) already enforce, instead of inviting a click that was
// always going to be refused.

export function isOldEnoughToBreed(bornGameDay: number, gameDay: number, minAgeGameDays: number): boolean {
  return gameDay - bornGameDay >= minAgeGameDays;
}
