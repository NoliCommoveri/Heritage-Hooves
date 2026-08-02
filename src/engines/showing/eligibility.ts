// Whether a given horse may enter a given class. Slice 0008 §5.4/§8.1/§9. Pure - the caller loads
// the horse and class rows and does the counting; this only judges the rules, and returns a reason
// code rather than a sentence, so the wording lives at the edges (render/routes) and can be tuned
// for a seven-year-old without touching this file.

export type EligibilityReason =
  | 'wrong_breed'
  | 'crossbred_not_eligible'
  | 'too_young'
  | 'too_old'
  | 'wrong_sex'
  | 'requires_gait'
  | 'entry_cap_reached'
  | 'already_entered';

export type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityReason };

export interface EligibilityHorse {
  breedId: number | null;
  isCross: boolean;
  ageGameDays: number;
  sex: 'mare' | 'stallion' | 'gelding';
  gaited: boolean;
  alreadyEntered: boolean;
}

export interface EligibilityClass {
  breedId: number | null;
  minAgeGameDays: number;
  maxAgeGameDays: number | null;
  sexRestriction: 'mare' | 'stallion' | 'gelding' | null;
  crossesEligible: boolean;
  requiresGait: boolean;
  maxEntriesPerStable: number;
}

/**
 * §5.4/§3/§9: a Paint is eligible for a Quarter Horse class because its breed_id IS the Quarter
 * Horse's (overview §4a) - this falls out of comparing breedId directly, with no branch on breed
 * identity anywhere (CLAUDE.md §11's breeds entry). Order matters only for which single reason a
 * multiply-ineligible horse is told about; each check is independent of the others.
 */
export function checkEligibility(horse: EligibilityHorse, cls: EligibilityClass, stableEntryCountInClass: number): EligibilityResult {
  if (horse.alreadyEntered) return { ok: false, reason: 'already_entered' };

  if (horse.isCross) {
    if (!cls.crossesEligible) return { ok: false, reason: 'crossbred_not_eligible' };
  } else if (cls.breedId !== null && horse.breedId !== cls.breedId) {
    return { ok: false, reason: 'wrong_breed' };
  }

  if (horse.ageGameDays < cls.minAgeGameDays) return { ok: false, reason: 'too_young' };
  if (cls.maxAgeGameDays !== null && horse.ageGameDays > cls.maxAgeGameDays) return { ok: false, reason: 'too_old' };

  if (cls.sexRestriction !== null && horse.sex !== cls.sexRestriction) return { ok: false, reason: 'wrong_sex' };

  if (cls.requiresGait && !horse.gaited) return { ok: false, reason: 'requires_gait' };

  if (stableEntryCountInClass >= cls.maxEntriesPerStable) return { ok: false, reason: 'entry_cap_reached' };

  return { ok: true };
}
