import { describe, expect, it } from 'vitest';
import { appraise, type AppraiseConfig, type AppraiseParams } from '../../src/engines/market/appraise';
import type { IdealVector } from '../../src/engines/showing/score';

// Slice 0017 §14 tests 1-3. The engine is pure, so none of this needs a database.

const CONFIG: AppraiseConfig = {
  // agePerformanceModifier's own config (slice 0014's live values).
  age_decline_start_game_days: 4320, // 12 years
  age_decline_floor_game_days: 7200, // 20 years
  age_modifier_floor: 0.7,
  game_days_per_year: 360,
  min_breeding_age_game_days: 1080, // 3 years
  market_base_value: 800,
  market_quality_weight: 4.0,
  market_price_multiplier: 1.0,
  market_foal_value_factor: 0.5,
  market_failing_factor: 0.4,
  market_clear_premium: 0.08,
  market_clear_premium_cap: 1.4,
  market_carrier_factor: 0.8,
  market_affected_factor: 0.4,
  market_win_bonus: 0.15,
  market_place_bonus: 0.05,
  market_record_cap: 2.5,
  market_min_value: 50,
  // Amendment 0017a §4.7.
  market_visible_colour_factors: { palomino: 1.2, cremello: 1.4, buckskin: 1.15 },
  market_carried_allele_premium: 0.1,
  market_carried_allele_cap: 1.5,
  // Slice 0021 §6.4.
  market_pattern_factor: 1.15,
};

const IDEAL: IdealVector = {
  neck_length: { target: 55, weight: 1.2 },
  shoulder_angle: { target: 60, weight: 1.0 },
  back_length: { target: 45, weight: 1.0 },
  hock_set: { target: 52, weight: 0.9 },
};

/** A six-year-old with middling conformation, nothing tested and no show record. */
function baseline(overrides: Partial<AppraiseParams> = {}): AppraiseParams {
  return {
    expressed: { neck_length: 55, shoulder_angle: 60, back_length: 45, hock_set: 52 },
    ideal: IDEAL,
    falloff: 2.0,
    ageGameDays: 6 * 360,
    isFailing: false,
    knownResults: [],
    wins: 0,
    topThree: 0,
    visibleColour: 'bay',
    knownHiddenColourAlleleCount: 0,
    hasPattern: false,
    params: CONFIG,
    ...overrides,
  };
}

describe('appraise: monotonic in the things it should be (§14.1)', () => {
  it('a better conformation score appraises higher', () => {
    const onStandard = appraise(baseline()).value;
    const wellOff = appraise(baseline({ expressed: { neck_length: 30, shoulder_angle: 85, back_length: 20, hock_set: 80 } })).value;
    expect(onStandard).toBeGreaterThan(wellOff);
  });

  it('a known carrier appraises lower than untested, and a tested-clear appraises higher', () => {
    const untested = appraise(baseline()).value;
    const carrier = appraise(baseline({ knownResults: ['carrier'] })).value;
    const clear = appraise(baseline({ knownResults: ['clear'] })).value;
    expect(carrier).toBeLessThan(untested);
    expect(clear).toBeGreaterThan(untested);
  });

  it('a known affected appraises lower than a known carrier', () => {
    const carrier = appraise(baseline({ knownResults: ['carrier'] })).value;
    const affected = appraise(baseline({ knownResults: ['affected'] })).value;
    expect(affected).toBeLessThan(carrier);
  });

  it('the whole tested-clear premium is capped', () => {
    // Ten clear results would be 1.08^10 ≈ 2.16x without the cap; market_clear_premium_cap is 1.4.
    const many = appraise(baseline({ knownResults: Array<'clear'>(10).fill('clear') })).value;
    const untested = appraise(baseline()).value;
    expect(many / untested).toBeLessThanOrEqual(CONFIG.market_clear_premium_cap + 0.01);
  });

  it('three wins appraises higher than none', () => {
    const unshown = appraise(baseline()).value;
    const winner = appraise(baseline({ wins: 3, topThree: 3 })).value;
    expect(winner).toBeGreaterThan(unshown);
  });

  it('a fourteen-year-old appraises lower than a six-year-old', () => {
    const six = appraise(baseline({ ageGameDays: 6 * 360 })).value;
    const fourteen = appraise(baseline({ ageGameDays: 14 * 360 })).value;
    expect(fourteen).toBeLessThan(six);
  });

  it('a foal appraises lower than the same horse at breeding age - a weanling is a promise', () => {
    const foal = appraise(baseline({ ageGameDays: 0 })).value;
    const grown = appraise(baseline({ ageGameDays: 3 * 360 })).value;
    expect(foal).toBeLessThan(grown);
  });

  it('a failing horse appraises lower than the same horse without the notice', () => {
    const sound = appraise(baseline({ ageGameDays: 18 * 360 })).value;
    const failing = appraise(baseline({ ageGameDays: 18 * 360, isFailing: true })).value;
    expect(failing).toBeLessThan(sound);
  });

  it('a patterned horse (§6.4) appraises higher than an otherwise-identical plain one, by exactly market_pattern_factor', () => {
    const plain = appraise(baseline({ hasPattern: false })).value;
    const patterned = appraise(baseline({ hasPattern: true })).value;
    expect(patterned).toBeGreaterThan(plain);
    expect(patterned / plain).toBeCloseTo(CONFIG.market_pattern_factor, 1);
  });
});

describe('appraise: never reads the lifespan (§4.2, §14.2)', () => {
  it('two horses identical in every input appraise identically - there is no lifespan input at all', () => {
    // The strongest form of this test is structural: AppraiseParams has no field a rolled death day
    // could arrive in. `isFailing` is the announced Failing notice and nothing else. If a future
    // session adds a natural_death_game_day (or an "expected remaining life") field to this
    // interface, this test's own type annotation stops compiling - which is the point.
    const keys = Object.keys(baseline()).sort();
    expect(keys).toEqual([
      'ageGameDays',
      'expressed',
      'falloff',
      'hasPattern',
      'ideal',
      'isFailing',
      'knownHiddenColourAlleleCount',
      'knownResults',
      'params',
      'topThree',
      'visibleColour',
      'wins',
    ]);

    // And behaviourally: a horse two years from its rolled death and one twenty years from it
    // appraise identically as long as neither has had the notice, because nothing here can tell
    // them apart.
    const a = appraise(baseline({ ageGameDays: 10 * 360 })).value;
    const b = appraise(baseline({ ageGameDays: 10 * 360 })).value;
    expect(a).toBe(b);
  });
});

describe('appraise: a breed with no ideal vector (§4.4, §14.3)', () => {
  it('returns qualityUnknown and a value well above the floor - not zero', () => {
    const result = appraise(baseline({ ideal: null }));
    expect(result.qualityUnknown).toBe(true);
    expect(result.value).toBeGreaterThan(CONFIG.market_min_value * 4);
  });

  it('treats an empty ideal vector the same way as a missing one', () => {
    expect(appraise(baseline({ ideal: {} })).qualityUnknown).toBe(true);
  });

  it('drops the conformation factor from the reasons rather than showing a zero', () => {
    const result = appraise(baseline({ ideal: null }));
    expect(result.factors.some((f) => f.label === 'Conformation')).toBe(false);
    expect(result.factors.some((f) => f.label === 'Age')).toBe(true);
  });
});

describe('appraise: the value itself', () => {
  it('is a whole number, rounded to the nearest ten', () => {
    const value = appraise(baseline({ wins: 2, topThree: 5, knownResults: ['clear', 'carrier'] })).value;
    expect(Number.isInteger(value)).toBe(true);
    expect(value % 10).toBe(0);
  });

  it('never falls below market_min_value, however bad the horse', () => {
    const awful = appraise(
      baseline({
        expressed: { neck_length: 1, shoulder_angle: 99, back_length: 1, hock_set: 99 },
        ageGameDays: 25 * 360,
        isFailing: true,
        knownResults: ['affected', 'affected', 'affected'],
      })
    ).value;
    expect(awful).toBeGreaterThanOrEqual(CONFIG.market_min_value);
  });

  it('market_price_multiplier moves every value at once', () => {
    const single = appraise(baseline()).value;
    const doubled = appraise(baseline({ params: { ...CONFIG, market_price_multiplier: 2.0 } })).value;
    expect(doubled).toBeGreaterThan(single * 1.9);
  });

  it('gives a reason line for age, health and record even when there is nothing to report', () => {
    const factors = appraise(baseline()).factors.map((f) => f.label);
    expect(factors).toContain('Age');
    expect(factors).toContain('Health tests');
    expect(factors).toContain('Show record');
    expect(factors).toContain('Colour');
  });
});

describe('appraise: colour (amendment 0017a §4.7)', () => {
  it('a rare visible colour appraises higher than a bay of otherwise identical quality', () => {
    const bay = appraise(baseline({ visibleColour: 'bay' })).value;
    const cremello = appraise(baseline({ visibleColour: 'cremello' })).value;
    expect(cremello).toBeGreaterThan(bay);
  });

  it('an untested allele never prices in: two identical horses differ only if one is tested', () => {
    const untested = appraise(baseline({ visibleColour: 'bay', knownHiddenColourAlleleCount: 0 })).value;
    const tested = appraise(baseline({ visibleColour: 'bay', knownHiddenColourAlleleCount: 1 })).value;
    expect(tested).toBeGreaterThan(untested);
  });

  it('the carried-allele premium is capped', () => {
    const cappedAt = appraise(baseline({ knownHiddenColourAlleleCount: 5 })).value;
    const evenMore = appraise(baseline({ knownHiddenColourAlleleCount: 50 })).value;
    expect(evenMore).toBe(cappedAt);
  });

  it('an unpriced colour (no entry in market_visible_colour_factors) is neutral, not worthless', () => {
    const known = appraise(baseline({ visibleColour: 'bay' })).value; // no entry for bay either
    const alsoUnknown = appraise(baseline({ visibleColour: 'some future colour name' })).value;
    expect(alsoUnknown).toBe(known);
  });
});
