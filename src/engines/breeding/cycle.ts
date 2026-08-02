// A mare's oestrous cycle, measured in ticks rather than game days. Slice 0003 §2, §3.1-§3.2: a
// real 21-day cycle is finer-grained than a 10-game-day tick, and sampling it at that resolution
// aliases badly (a mare would get one heat, then an eleven-tick drought, then six heats on
// alternating ticks). So the cycle is a count of ticks, not a game-day span - deliberate, and not
// something a future session should "fix" back into game days without re-reading slice 0003 §2.
//
// Pure - no database access. cycle_anchor_tick_seq is the tick_seq at which a given mare's phase
// is zero; everything here is arithmetic against it.

export function cyclePhase(cycleAnchorTickSeq: number, tickSeq: number, cycleTicks: number): number {
  const raw = (tickSeq - cycleAnchorTickSeq) % cycleTicks;
  return raw < 0 ? raw + cycleTicks : raw;
}

export function isInSeason(cycleAnchorTickSeq: number, tickSeq: number, cycleTicks: number, estrusTicks: number): boolean {
  return cyclePhase(cycleAnchorTickSeq, tickSeq, cycleTicks) < estrusTicks;
}

/** Ticks from now until this mare's next in-season tick. 0 if she is in season right now. */
export function ticksUntilNextEstrus(cycleAnchorTickSeq: number, tickSeq: number, cycleTicks: number, estrusTicks: number): number {
  const phase = cyclePhase(cycleAnchorTickSeq, tickSeq, cycleTicks);
  if (phase < estrusTicks) return 0;
  return cycleTicks - phase;
}
