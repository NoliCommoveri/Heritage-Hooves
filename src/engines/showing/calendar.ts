// Which venue a show falls at, and what it's called. Slice 0008 §5.3. Pure, and deliberately NOT
// derived from the show's own rng_seed (see the note below) - keyed only off the game day and the
// show interval, so the same venue recurs at the same point in the calendar every year.
//
// §7.2 of the slice document lists "venue" among the sub-seed labels a show's rng_seed could
// derive. That can't be right together with §5.3's own requirement ("so the same venue comes round
// each year") - shows.rng_seed is a fresh randomSeed() per show (§7.1), so deriving venue from it
// would make the venue different every year at the same calendar position, not the same. Resolved
// in favour of §5.3's more specific, better-reasoned instruction (CLAUDE.md §2): venue selection
// uses the calendar position alone, needs no RNG at all, and is not among this file's exports of a
// seed label. Flagged in the build summary.

const VENUES = [
  'Cedar Hollow',
  'Blue Ridge',
  'Stonebrook',
  'Willow Creek',
  'Maple Crest',
  'Fox Run',
  'Silver Birch',
  'Amber Fields',
  'Copper Hill',
  'Thistledown',
  'Elder Grove',
  'Winterset',
] as const;

const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'] as const;

export interface ShowCalendarEntry {
  venue: string;
  name: string;
}

/**
 * scheduledGameDay must be an exact multiple of intervalGameDays - true of every show this game
 * ever creates (§6.1). Ordinal 1 is the first show the world ever holds, at the first multiple of
 * the interval; month index 0 recurs every VENUES.length shows (a "year" of the show calendar).
 */
export function calendarEntryFor(scheduledGameDay: number, intervalGameDays: number): ShowCalendarEntry {
  const ordinal = Math.round(scheduledGameDay / intervalGameDays);
  const monthIndex = (ordinal - 1) % VENUES.length;
  const year = Math.floor((ordinal - 1) / VENUES.length) + 1;
  const season = SEASONS[Math.floor(monthIndex / 3)];
  const venue = VENUES[monthIndex];
  return { venue, name: `${venue} ${season} Show, Year ${String(year)}` };
}

/**
 * Slice 0025 stage 4 §7.5a: the on-demand equivalent of calendarEntryFor, for a show minted the
 * moment a player asks to enter a class rather than on a fixed calendar. An on-demand show's
 * scheduled_game_day is `gameDay + show_entry_window_game_days`, which is not generally an exact
 * multiple of show_interval_game_days - calendarEntryFor's own documented precondition - so this
 * cannot reuse it directly. Purely cosmetic (a venue and a made-up name, never read by any rule),
 * keyed off a fixed 30-day "month" so it stays deterministic and always defined no matter what the
 * interval is configured to; the cost is that it no longer recurs at the same calendar position
 * every real year the way the interval-driven calendar does, which does not matter for a show that
 * was never on a calendar to begin with.
 */
export function onDemandCalendarEntryFor(scheduledGameDay: number): ShowCalendarEntry {
  const ordinal = Math.floor(scheduledGameDay / 30) + 1;
  const monthIndex = (ordinal - 1) % VENUES.length;
  const year = Math.floor((ordinal - 1) / VENUES.length) + 1;
  const season = SEASONS[Math.floor(monthIndex / 3)];
  const venue = VENUES[monthIndex];
  return { venue, name: `${venue} ${season} Show, Year ${String(year)}` };
}
