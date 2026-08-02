// The wall clock, kept in its box. CLAUDE.md §6: store instants in UTC, decide and display in
// America/Chicago, never store a local time as a bare string, and never hardcode an offset.
// Everything here goes through Intl.DateTimeFormat, which knows about daylight saving without
// being told.

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** YYYY-MM-DD in the given time zone. */
  dateKey: string;
  /** hour * 60 + minute, in the given time zone. */
  minutesOfDay: number;
}

export function nowUtcSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function localParts(utcSeconds: number, timeZone: string): LocalParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcSeconds * 1000));
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  // Some ICU implementations render local midnight as "24" even with hourCycle h23; normalise it.
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const minute = Number(map.minute);
  const dateKey = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  return { year, month, day, hour, minute, dateKey, minutesOfDay: hour * 60 + minute };
}

export function formatLocal(utcSeconds: number, timeZone: string): string {
  const p = localParts(utcSeconds, timeZone);
  return `${p.dateKey} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "07:00" -> 420 (minutes since local midnight). */
export function parseSlot(slot: string): number {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}
