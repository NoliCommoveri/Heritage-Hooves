// Managing HYPP and PSSM1 (slice 0014 §5, built as slice 0013 §4.5 specified). Pure, no database
// access (CLAUDE.md §5.1) - the caller resolves ownerEntitled via ownerVisibleStatus (status.ts)
// and management_until_game_day from horse_conditions; this only judges the rule.

export interface ManageableConditionState {
  conditionCode: string;
  /** Whether this stable is entitled to know - the caller resolves this via ownerVisibleStatus. A
   * stable that has never tested, for a condition with no visible signs, is never penalised for
   * failing to manage something the game never told them about (§5.1, CLAUDE.md §12's truth-vs-
   * knowledge line). */
  ownerEntitled: boolean;
  managementUntilGameDay: number | null;
}

export interface ConditionDeltaResult {
  /** Negative or zero - unmanagedPenalty (itself negative) once per unmanaged, owner-entitled,
   * manageable condition. Deltas stack (§5.2): two unmanaged conditions is worse than one, and the
   * care clamp (src/engines/care/modifier.ts) is what keeps the total inside the band. */
  delta: number;
  unmanagedCodes: string[];
}

/**
 * §5: a condition counts as "managed" when a plan is current - gameDay at or before
 * managementUntilGameDay (inclusive at the boundary, matching the farrier/wellness timers'
 * reset-from-today shape: buying a plan sets managementUntilGameDay = today + interval, and that
 * day itself is still covered). A condition the stable is not entitled to know about never
 * contributes, whatever its true management state.
 */
export function conditionDelta(states: ManageableConditionState[], gameDay: number, unmanagedPenalty: number): ConditionDeltaResult {
  let delta = 0;
  const unmanagedCodes: string[] = [];
  for (const state of states) {
    if (!state.ownerEntitled) continue;
    const current = state.managementUntilGameDay !== null && gameDay <= state.managementUntilGameDay;
    if (!current) {
      delta += unmanagedPenalty;
      unmanagedCodes.push(state.conditionCode);
    }
  }
  return { delta, unmanagedCodes };
}
