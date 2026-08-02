// Mares are seasonally polyestrous (slice 0003 §3.6): breeding is only possible within a window
// each game year, `breeding_season_start_game_day` through `+ breeding_season_length_game_days`.
// Pure - no database access.

export function dayOfYear(gameDay: number, gameDaysPerYear: number): number {
  const d = gameDay % gameDaysPerYear;
  return d < 0 ? d + gameDaysPerYear : d;
}

export function isInBreedingSeason(gameDay: number, startDay: number, lengthDays: number, gameDaysPerYear: number): boolean {
  const doy = dayOfYear(gameDay, gameDaysPerYear);
  return doy >= startDay && doy < startDay + lengthDays;
}

/**
 * The game day the breeding season next opens, so a refusal can always say when to come back
 * (slice 0003 §3.6: "never let a player discover the season by being refused"). Returns null when
 * the season is open right now.
 */
export function nextSeasonStartGameDay(gameDay: number, startDay: number, lengthDays: number, gameDaysPerYear: number): number | null {
  const doy = dayOfYear(gameDay, gameDaysPerYear);
  const yearStart = gameDay - doy;
  if (doy < startDay) return yearStart + startDay;
  if (doy < startDay + lengthDays) return null;
  return yearStart + gameDaysPerYear + startDay;
}
