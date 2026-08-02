// The slot-selection logic from slice §8.1, extracted as a pure function so it can be tested
// without a database or a clock. It is the piece most likely to be subtly wrong and the hardest
// to notice in production, because being wrong looks like the game being a bit slow.

import { parseSlot } from '../lib/time';

export interface SlotState {
  /** "HH:MM" strings; need not be pre-sorted. */
  tickTimesLocal: string[];
  lastTickLocalDate: string | null;
  lastTickSlotLocal: string | null;
}

export interface CurrentLocal {
  dateKey: string;
  minutesOfDay: number;
}

export type SlotDecision = { run: false } | { run: true; localDate: string; slot: string };

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dateDiffDays(fromDateKey: string, toDateKey: string): number {
  const [y1, m1, d1] = fromDateKey.split('-').map(Number);
  const [y2, m2, d2] = toDateKey.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

export function decideNextSlot(state: SlotState, current: CurrentLocal): SlotDecision {
  const slots = [...state.tickTimesLocal].sort((a, b) => parseSlot(a) - parseSlot(b));
  if (slots.length === 0) return { run: false };

  let candidateDate: string;
  let candidateIndex: number;

  if (state.lastTickLocalDate === null) {
    candidateDate = current.dateKey;
    candidateIndex = 0;
  } else {
    const lastIndex = state.lastTickSlotLocal === null ? -1 : slots.indexOf(state.lastTickSlotLocal);
    if (lastIndex === -1 || lastIndex === slots.length - 1) {
      candidateDate = addDays(state.lastTickLocalDate, 1);
      candidateIndex = 0;
    } else {
      candidateDate = state.lastTickLocalDate;
      candidateIndex = lastIndex + 1;
    }
  }

  const candidateSlot = slots[candidateIndex];
  const daysBehind = dateDiffDays(candidateDate, current.dateKey);

  // The world was down for a while: drop the backlog and run the most recent elapsed slot today.
  if (daysBehind > 2) {
    const elapsedToday = slots.filter((s) => parseSlot(s) <= current.minutesOfDay);
    if (elapsedToday.length === 0) return { run: false };
    return { run: true, localDate: current.dateKey, slot: elapsedToday[elapsedToday.length - 1] };
  }

  if (candidateDate > current.dateKey) return { run: false };
  if (candidateDate === current.dateKey && parseSlot(candidateSlot) > current.minutesOfDay) return { run: false };

  return { run: true, localDate: candidateDate, slot: candidateSlot };
}
