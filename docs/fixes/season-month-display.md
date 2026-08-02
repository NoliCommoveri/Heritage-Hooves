# Fix: month/season display for game_day

**Problem.** `world.game_day` is a plain integer, which is exactly right for game logic (§5.3 of CLAUDE.md — it's the only clock game logic reads) but a poor experience for a kid who just booked a covering and wants to know "when will the baby come." Right now every due-date and show-date sentence in the app states a raw day count: "due around game day 214," "Game day: 240." Nobody can turn that into "around April" without doing division in their head.

**What this is not.** This is not a new game concept, and it does not touch `isInBreedingSeason`/`dayOfYear` in `src/engines/breeding/season.ts` — that's the real-world seasonal-polyestrus mechanic (mares only conceive in part of the year) and already uses the word "season" for something else. To avoid overloading that word, this doc calls the new thing a **month/year display**, not a season.

**Approach.** `game_days_per_year` is already `360` in config (`migrations/0009_seed_config.sql`), which divides evenly into twelve 30-day months. Add one pure function that maps a `game_day` integer to a calendar-style label, and use it wherever a game day is currently shown to a player. The integer itself stays visible in every case — smaller, secondary, not removed — because it's still what whoever's checking tick/upkeep math actually wants to see.

## 1. New pure function

`src/lib/calendar.ts` (new file, same pattern as `src/lib/time.ts` and `src/engines/breeding/season.ts` — pure, no DB access):

```ts
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface CalendarDate {
  year: number;      // 1-based: game_day 0-359 is Year 1
  month: number;     // 1-12
  monthName: string;
  dayOfMonth: number; // 1-30
}

export function calendarDateFor(gameDay: number, gameDaysPerYear: number): CalendarDate {
  const daysPerMonth = gameDaysPerYear / 12; // 30, given the seeded 360
  const year = Math.floor(gameDay / gameDaysPerYear) + 1;
  const doy = ((gameDay % gameDaysPerYear) + gameDaysPerYear) % gameDaysPerYear;
  const month = Math.floor(doy / daysPerMonth); // 0-11
  const dayOfMonth = (doy % daysPerMonth) + 1;
  return { year, month: month + 1, monthName: MONTH_NAMES[month], dayOfMonth };
}

export function formatCalendarDate(gameDay: number, gameDaysPerYear: number): string {
  const d = calendarDateFor(gameDay, gameDaysPerYear);
  return `${d.monthName}, Year ${d.year}`; // e.g. "April, Year 2" — no day-of-month, see below
}
```

Two deliberate choices worth confirming rather than assuming:

- **Precision is month + year, not month/day/year.** A player needs "the baby comes in April," not "the baby comes on day 14 of April" — the latter reads as fake-precise for a value that already has noise in it (gestation length varies per pregnancy) and gains nothing. `dayOfMonth` is computed and exposed on `CalendarDate` in case a future screen wants it, but `formatCalendarDate` (the thing views actually call) leaves it out.
- **`gameDaysPerYear` is a parameter, not a hardcoded 360.** It's a live-tunable-looking value but this function reads it from `config.values.game_days_per_year` at the call site, same as every other config read in this codebase (§5.5 — nothing here is snapshotted onto an entity, because a due-date's underlying `due_game_day` integer never changes; only its *display* would shift if the config value were ever edited, which is an acceptable, cosmetic-only consequence of changing a live tunable).

If a future session wants season names (Spring/Summer/Fall/Winter) for flavor, that's a small addition to this same file — not in scope here.

## 2. Where it gets used

Every spot below keeps the existing game-day integer, demoted to a secondary/muted position, and puts the calendar label first:

| File | Current | New |
|---|---|---|
| `src/render/layout.ts:56-57` (header, both player and admin) | `Game day **214**` | `**April, Year 1** · game day 214` |
| `src/routes/horses.ts:367` (pregnancy due-date sentence) | "due around game day 214" | "due around April, Year 1 (game day 214)" |
| `src/render/shows.ts:97,116,208` (show date lines) | "Game day: 240" | "April, Year 1 · game day 240" |
| `src/render/admin.ts` (wherever a raw game day is shown administratively) | unchanged | left as-is — admin screens are for the operator, who wants the exact integer more than the label; not touched by this fix unless the operator asks |

`pageShell()` already receives `params.world` (which carries `game_day`) — it will additionally need `config.values.game_days_per_year` threaded in, or simpler: pass the already-formatted string down rather than reaching for config inside the render layer (`src/render/` doesn't currently read config directly; keep it that way and compute the label at the route level, alongside where `game_days_per_year` is already read for breeding-season logic).

## 3. Non-goals / what stays untouched

- No schema change, no migration. `game_day` remains the only thing stored; this is a display-layer function only.
- No change to tick logic, gestation math, upkeep, or the breeding-season window — those all keep reading `game_day` directly, per §5.3.
- Admin-only screens (`/admin/world`, `/admin/migrations`, tick run history) are left showing raw game-day/tick-seq only, since that audience is explicitly the operator, not a child tracking a due date.

## 4. Rough size

Small. One new ~20-line file (`src/lib/calendar.ts`) plus a small test (`test/calendar.test.ts`, pure function, no DB — golden values like `calendarDateFor(0, 360)` → Year 1/January, `calendarDateFor(359, 360)` → Year 1/December, `calendarDateFor(360, 360)` → Year 2/January), and edits to the handful of render/route spots listed above that currently print a bare `game_day`. No new dependencies, no config or migration changes required to ship it, since `game_days_per_year` already exists and is already 360.
