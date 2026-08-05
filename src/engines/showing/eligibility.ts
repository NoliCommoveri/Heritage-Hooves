// Whether a given horse may enter a given class. Slice 0008 §5.4/§8.1/§9. Pure - the caller loads
// the horse and class rows and does the counting; this only judges the rules, and returns a reason
// code rather than a sentence, so the wording lives at the edges (render/routes) and can be tuned
// for a seven-year-old without touching this file.

import type { WorkAvailability } from '../care/location';

export type EligibilityReason =
  | 'wrong_breed'
  | 'crossbred_not_eligible'
  | 'too_young'
  | 'too_old'
  | 'wrong_sex'
  | 'requires_gait'
  | 'entry_cap_reached'
  | 'already_entered'
  | 'barred_by_condition'
  // The location flag. Two reasons rather than one because they call for completely different
  // sentences on screen: "she's out at pasture" is a thing the owner chose and can undo today,
  // "she came in four days ago" is a wait with an end date.
  | 'at_pasture'
  | 'settling_in'
  // Slice 0026 §1.3: a freshly gelded horse is unavailable for a wait with an end date, the same
  // shape as settling_in - see isRecoveringFromGelding below.
  | 'recovering_from_gelding'
  // Slice 0020 §5.4. Two reasons, not one, because they call for different sentences and different
  // futures: an open incident clears the moment it resolves, a degenerative outcome never does.
  | 'acute_incident'
  | 'degenerative_incident'
  // Slice 0025 stage 4 §7.5: a breed_conformation/discipline class is now bracketed by rank, and
  // the horse's own current rank in that class type (§7.5a: "the rank is decided by the horse's own
  // rank in that class type") has to match the class's own rank to enter. The normal path (the horse
  // page's on-demand request) can never produce this refusal, since it always targets the horse's
  // own rank when it joins or mints a class - this reason exists for /shows/:id's browse-and-join
  // form, which lists every open class by id and would otherwise let a Novice horse into a Champion
  // field it never earned a place in.
  | 'wrong_rank';

export type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityReason };

/** The three earned ranks, plus the fixed sentinel a young_conformation/ability_test class always
 * carries (stage 4 does not rank-track either type - §7.3's own ribbons-don't-count-toward-adult-
 * progression rule extends to not tracking a rank of their own either). */
export type ShowRank = 'novice' | 'open' | 'champion';
export type ClassRank = ShowRank | 'none';

export interface EligibilityHorse {
  breedId: number | null;
  isCross: boolean;
  ageGameDays: number;
  sex: 'mare' | 'stallion' | 'gelding';
  gaited: boolean;
  alreadyEntered: boolean;
  /** Slice 0010 §7.4: true when the horse currently reads as affected by an enabled condition with
   * bars_showing = 1 (HERDA, in this slice). Computed by the caller from the horse's genotype -
   * this is truth already visible without a test (§2.4), not knowledge, so no boundary is crossed
   * reading it here. */
  barredByCondition: boolean;
  /** Slice 0020 §5.4: true when this horse has an open (state = 'acute') horse_incidents row for
   * any of the twelve acquired conditions, computed by the caller from horse_incidents - this is
   * truth, no test or knowledge boundary involved (§2.7). Slice 0022 Part A moved this table's own
   * truth from horse_conditions to horse_incidents; this comment now names the table that's
   * actually read. */
  hasOpenAcuteIncident: boolean;
  /** Slice 0020 §5.4: true when a past incident's own outcome resolved 'degenerative' - permanent,
   * unlike hasOpenAcuteIncident which clears the moment the incident resolves. Read from the
   * per-incident horse_incidents.outcome column, not conditions.bars_showing (§6.1/§6.2). */
  hasDegenerativeIncident: boolean;
  /** src/engines/care/location.ts's workAvailability, already evaluated by the caller. Passed in
   * resolved rather than as (location, changedDay, settleDays) so there is exactly one
   * implementation of the settling rule in the codebase - breeding, which is not a show and never
   * comes through this file, shares that same function rather than a copy of the arithmetic. */
  availability: WorkAvailability;
  /** Slice 0026 §1.3: true while game_day - horses.gelded_game_day is still under
   * gelding_recovery_game_days - computed by the caller via isRecoveringFromGelding below. Always
   * false for a mare, a stallion, or a gelding never gelded within the window. */
  recoveringFromGelding: boolean;
  /** Slice 0025 stage 4 §7.5: this horse's own current rank in the class's class type (breed or
   * discipline), from horse_class_ranks - 'novice' when it has never been tracked yet (a horse
   * starts at the bottom, not unranked). Ignored entirely when cls.rank is 'none' (a
   * young_conformation/ability_test class, which never rank-gates). */
  rank: ShowRank;
}

export interface EligibilityClass {
  breedId: number | null;
  minAgeGameDays: number;
  maxAgeGameDays: number | null;
  sexRestriction: 'mare' | 'stallion' | 'gelding' | null;
  crossesEligible: boolean;
  requiresGait: boolean;
  maxEntriesPerStable: number;
  /** Slice 0025 stage 4 §7.5. 'none' for young_conformation/ability_test - see ClassRank's comment. */
  rank: ClassRank;
}

/**
 * §5.4/§3/§9: a Paint is eligible for a Quarter Horse class because its breed_id IS the Quarter
 * Horse's (overview §4a) - this falls out of comparing breedId directly, with no branch on breed
 * identity anywhere (CLAUDE.md §11's breeds entry). Order matters only for which single reason a
 * multiply-ineligible horse is told about; each check is independent of the others.
 */
export function checkEligibility(horse: EligibilityHorse, cls: EligibilityClass, stableEntryCountInClass: number): EligibilityResult {
  if (horse.alreadyEntered) return { ok: false, reason: 'already_entered' };
  if (horse.barredByCondition) return { ok: false, reason: 'barred_by_condition' };
  // Slice 0020 §5.4: checked alongside the single-gene bar, before availability - an open emergency
  // or a permanent degenerative outcome are facts about the horse itself, the same footing
  // barred_by_condition already stands on.
  if (horse.hasOpenAcuteIncident) return { ok: false, reason: 'acute_incident' };
  if (horse.hasDegenerativeIncident) return { ok: false, reason: 'degenerative_incident' };
  // Checked high, above every fact about the horse itself: a horse at pasture has not failed a
  // rule, it is simply not in work. Being told "she's out at pasture" is more use than being told
  // she is the wrong breed for a class she was never going to enter this month.
  if (!horse.availability.available) return { ok: false, reason: horse.availability.reason };
  // Slice 0026 §1.3: ordered right after the location checks, before age - the same footing as
  // settling_in, a wait with an end date rather than a fact about the horse's breed or age.
  if (horse.recoveringFromGelding) return { ok: false, reason: 'recovering_from_gelding' };

  if (horse.isCross) {
    if (!cls.crossesEligible) return { ok: false, reason: 'crossbred_not_eligible' };
  } else if (cls.breedId !== null && horse.breedId !== cls.breedId) {
    return { ok: false, reason: 'wrong_breed' };
  }

  if (horse.ageGameDays < cls.minAgeGameDays) return { ok: false, reason: 'too_young' };
  if (cls.maxAgeGameDays !== null && horse.ageGameDays > cls.maxAgeGameDays) return { ok: false, reason: 'too_old' };

  if (cls.sexRestriction !== null && horse.sex !== cls.sexRestriction) return { ok: false, reason: 'wrong_sex' };

  if (cls.requiresGait && !horse.gaited) return { ok: false, reason: 'requires_gait' };

  if (cls.rank !== 'none' && horse.rank !== cls.rank) return { ok: false, reason: 'wrong_rank' };

  if (stableEntryCountInClass >= cls.maxEntriesPerStable) return { ok: false, reason: 'entry_cap_reached' };

  return { ok: true };
}

/** Slice 0026 §1.3: the one place this window is computed, so checkHorseEligibilityForClass,
 * buildCatalogueStatusForHorse and eligibleNpcHorsesForClass (src/db/shows.ts) cannot drift on it. */
export function isRecoveringFromGelding(geldedGameDay: number | null, gameDay: number, recoveryGameDays: number): boolean {
  return geldedGameDay !== null && gameDay - geldedGameDay < recoveryGameDays;
}

const RANK_ORDER: ShowRank[] = ['novice', 'open', 'champion'];

/** Slice 0026 §1.5/§3.1: a horse's own highest rank held across every class_key it has a
 * horse_class_ranks row for - 'novice' (the empty-list default) for a horse with no row. The one
 * place this comparison is made, so appraise() and the barn-list badge (stage 3) cannot drift on
 * which rank counts as "higher". */
export function highestRankHeld(ranks: ShowRank[]): ShowRank {
  let best: ShowRank = 'novice';
  for (const r of ranks) {
    if (RANK_ORDER.indexOf(r) > RANK_ORDER.indexOf(best)) best = r;
  }
  return best;
}
