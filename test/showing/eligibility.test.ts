import { describe, expect, it } from 'vitest';
import { checkEligibility, type EligibilityClass, type EligibilityHorse } from '../../src/engines/showing/eligibility';

const QH_CLASS: EligibilityClass = {
  breedId: 1, // Quarter Horse
  minAgeGameDays: 1080,
  maxAgeGameDays: null,
  sexRestriction: null,
  crossesEligible: false,
  requiresGait: false,
  maxEntriesPerStable: 3,
};

const ELIGIBLE_HORSE: EligibilityHorse = {
  breedId: 1,
  isCross: false,
  ageGameDays: 1500,
  sex: 'mare',
  gaited: false,
  alreadyEntered: false,
  barredByCondition: false,
  // The location flag: the baseline horse is in the barn and settled.
  availability: { available: true },
};

describe('checkEligibility', () => {
  // The location flag. Checked above every fact about the horse itself, so a horse that is both out
  // at pasture and the wrong breed is told the thing it can actually do something about.
  it('refuses a horse that is out at pasture', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, availability: { available: false, reason: 'at_pasture' } }, QH_CLASS, 0)).toEqual({
      ok: false,
      reason: 'at_pasture',
    });
  });

  it('refuses a horse still settling in after coming home', () => {
    expect(
      checkEligibility({ ...ELIGIBLE_HORSE, availability: { available: false, reason: 'settling_in', daysRemaining: 12 } }, QH_CLASS, 0)
    ).toEqual({ ok: false, reason: 'settling_in' });
  });

  it('reports being at pasture ahead of any other failed rule', () => {
    const out: EligibilityHorse = { ...ELIGIBLE_HORSE, breedId: 2, ageGameDays: 10, availability: { available: false, reason: 'at_pasture' } };
    expect(checkEligibility(out, QH_CLASS, 0)).toEqual({ ok: false, reason: 'at_pasture' });
  });

  it('accepts a horse that meets every rule', () => {
    expect(checkEligibility(ELIGIBLE_HORSE, QH_CLASS, 0)).toEqual({ ok: true });
  });

  it('refuses the wrong breed', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, breedId: 2 }, QH_CLASS, 0)).toEqual({ ok: false, reason: 'wrong_breed' });
  });

  it('a Paint is eligible - its breed_id IS the Quarter Horse\'s (overview §4a), so nothing here needs to know it is a Paint specifically', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, breedId: 1 }, QH_CLASS, 0)).toEqual({ ok: true });
  });

  it('refuses a horse too young for the class', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, ageGameDays: 1000 }, QH_CLASS, 0)).toEqual({ ok: false, reason: 'too_young' });
  });

  it('refuses a horse too old, when a class sets a maximum', () => {
    const cls = { ...QH_CLASS, maxAgeGameDays: 2000 };
    expect(checkEligibility({ ...ELIGIBLE_HORSE, ageGameDays: 2500 }, cls, 0)).toEqual({ ok: false, reason: 'too_old' });
    expect(checkEligibility({ ...ELIGIBLE_HORSE, ageGameDays: 1999 }, cls, 0)).toEqual({ ok: true });
  });

  it('refuses the wrong sex, when a class restricts it', () => {
    const cls: EligibilityClass = { ...QH_CLASS, sexRestriction: 'stallion' };
    expect(checkEligibility(ELIGIBLE_HORSE, cls, 0)).toEqual({ ok: false, reason: 'wrong_sex' });
  });

  it('refuses a crossbred entering a purebred class', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, isCross: true }, QH_CLASS, 0)).toEqual({ ok: false, reason: 'crossbred_not_eligible' });
  });

  it('admits a crossbred once the class allows crosses', () => {
    const cls = { ...QH_CLASS, crossesEligible: true };
    expect(checkEligibility({ ...ELIGIBLE_HORSE, isCross: true }, cls, 0)).toEqual({ ok: true });
  });

  it('refuses a non-gaited horse when the class requires gait', () => {
    const cls = { ...QH_CLASS, requiresGait: true };
    expect(checkEligibility(ELIGIBLE_HORSE, cls, 0)).toEqual({ ok: false, reason: 'requires_gait' });
  });

  it('admits a gaited horse when the class requires gait', () => {
    const cls = { ...QH_CLASS, requiresGait: true };
    expect(checkEligibility({ ...ELIGIBLE_HORSE, gaited: true }, cls, 0)).toEqual({ ok: true });
  });

  it('the per-stable entry cap counts only that stable\'s entries in that class', () => {
    expect(checkEligibility(ELIGIBLE_HORSE, QH_CLASS, 3)).toEqual({ ok: false, reason: 'entry_cap_reached' });
    expect(checkEligibility(ELIGIBLE_HORSE, QH_CLASS, 2)).toEqual({ ok: true });
  });

  it('refuses a horse already entered in this class', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, alreadyEntered: true }, QH_CLASS, 0)).toEqual({ ok: false, reason: 'already_entered' });
  });

  it('refuses a horse barred by a condition (slice 0010 §7.4, e.g. HERDA)', () => {
    expect(checkEligibility({ ...ELIGIBLE_HORSE, barredByCondition: true }, QH_CLASS, 0)).toEqual({ ok: false, reason: 'barred_by_condition' });
  });
});
