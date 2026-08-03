// docs/fixes/season-month-display.md: game_day is the only clock game logic reads (CLAUDE.md
// §5.3) - this file turns that integer into a calendar-style label for display only. It never
// feeds a decision; the underlying game_day always stays what's stored and compared.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface CalendarDate {
  year: number; // 1-based: game_day 0-359 is Year 1
  month: number; // 1-12
  monthName: string;
  dayOfMonth: number; // 1-30
}

export function calendarDateFor(gameDay: number, gameDaysPerYear: number): CalendarDate {
  const daysPerMonth = gameDaysPerYear / 12;
  const year = Math.floor(gameDay / gameDaysPerYear) + 1;
  const doy = ((gameDay % gameDaysPerYear) + gameDaysPerYear) % gameDaysPerYear;
  const month = Math.floor(doy / daysPerMonth);
  const dayOfMonth = (doy % daysPerMonth) + 1;
  return { year, month: month + 1, monthName: MONTH_NAMES[month], dayOfMonth };
}

/** "April, Year 2" - month + year only. No day-of-month: a due date already carries its own
 * noise (gestation length varies), so a day figure would read as fake-precise. */
export function formatCalendarDate(gameDay: number, gameDaysPerYear: number): string {
  const d = calendarDateFor(gameDay, gameDaysPerYear);
  return `${d.monthName}, Year ${d.year}`;
}
