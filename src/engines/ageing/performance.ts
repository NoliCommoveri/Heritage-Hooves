// Age-based show performance decline (slice 0014 §4). Pure, no database access (CLAUDE.md §5.1),
// no randomness, no wall clock - a deterministic function of age in game days and three live
// tunables. Sits beside lifespan.ts, but is otherwise unrelated to it: this reads gameDay -
// bornGameDay and nothing else about a horse. In particular it never reads ageState/the Failing
// marker (slice 0011's lifespan.ts) - §2.2 is explicit that the two must come apart in both
// directions, and keying this off remaining life rather than age in days would collapse them.
//
// Flat at 1.0, then a straight line down to age_modifier_floor, then flat at the floor - the same
// shape discipline slice 0013 §4.1 applied to the care ramp, for the same reason: a future session
// must be able to hold it in their head and an operator must be able to retune it from one screen.

export type AgePhase = 'prime' | 'past_peak' | 'floor';

export interface AgeModifierConfig {
  age_decline_start_game_days: number;
  age_decline_floor_game_days: number;
  age_modifier_floor: number;
  /** For the display-only ageYears field - the same value every other age-in-years display in this
   * codebase converts with (src/db/ageing.ts, src/routes/horses.ts). Not used by the modifier math
   * itself, which works in game days throughout. */
  game_days_per_year: number;
}

export interface AgeModifierResult {
  modifier: number;
  phase: AgePhase;
  /** Whole game years, for the display line - never recomputed by a render function. */
  ageYears: number;
}

/**
 * §4.1's formula, exactly. Below the start day: exactly 1.0 (not 0.9999), so a caller can compare
 * against 1 and the result explanation can print "in its prime" rather than a number. At or past
 * the floor day: exactly age_modifier_floor. A degenerate config (floorDay <= start, an operator can
 * type anything into /admin/config) never divides by zero - it returns the floor for any age at or
 * past the start instead.
 */
export function agePerformanceModifier(ageGameDays: number, config: AgeModifierConfig): AgeModifierResult {
  const ageYears = Math.floor(ageGameDays / config.game_days_per_year);
  const { age_decline_start_game_days: start, age_decline_floor_game_days: floorDay, age_modifier_floor: floor } = config;

  if (ageGameDays < start) {
    return { modifier: 1.0, phase: 'prime', ageYears };
  }
  if (floorDay <= start || ageGameDays >= floorDay) {
    return { modifier: floor, phase: 'floor', ageYears };
  }

  const modifier = 1 - (1 - floor) * ((ageGameDays - start) / (floorDay - start));
  return { modifier, phase: 'past_peak', ageYears };
}
