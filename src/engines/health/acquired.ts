// The twelve acquired conditions - colic, laminitis, and the rest. Slice 0020 §2.2/§5. Pure, no
// database access (CLAUDE.md §5.1): one onset/resolution pair of functions shared by all twelve,
// distinguished only by the AcquiredTrigger data each condition's own `conditions.trigger` row
// carries - never a branch on condition code (CLAUDE.md §13's "no parallel scoring path" rule).
//
// No RNG inside onsetProbability - it returns a probability, the caller draws (CLAUDE.md §5.2).
// rollOutcome takes an Rng explicitly, the same split every other engine in this codebase keeps.

import type { Rng } from '../../lib/rng';

export interface OutcomeTable {
  resolved: number;
  manageable: number;
  degenerative: number;
  death: number;
}

export type IncidentOutcome = 'resolved' | 'manageable' | 'degenerative' | 'death';

export interface AcquiredTrigger {
  v: 1;
  kind: 'acquired';
  tissue: string;
  robustnessTrait: string | null;
  robustnessWeight: number;
  baseRatePerGameDay: number;
  careWeight: number;
  workloadWeight: number;
  /** Nonzero only for laminitis (§2.6) - the one condition that reads feed level directly rather
   * than the general care state. */
  feedWeight: number;
  pastureMultiplier: number;
  treatmentWindowGameDays: number;
  treatmentCostKey: string;
  outcomesUntreated: OutcomeTable;
  outcomesTreated: OutcomeTable;
}

export function parseAcquiredTrigger(json: string): AcquiredTrigger {
  return JSON.parse(json) as AcquiredTrigger;
}

export interface OnsetInputs {
  /** How many game days have passed since this horse was last checked for this condition - the
   * caller derives this from horses.last_incident_check_game_day. */
  daysSinceLastCheck: number;
  /** 0 (perfect care) .. 1 (fully neglected) - the caller's own derived measure from the farrier/
   * wellness timers, not recomputed here (§4.2's care_weight input). */
  carePenaltyFactor: number;
  /** 0 (unshown) .. 1 (at or above workload_ceiling_entries) - the caller's own count of recent
   * show_entries, normalised (§2.4). */
  workloadFactor: number;
  /** 0..1, only consulted when trigger.feedWeight > 0 (laminitis). Ignored otherwise. */
  feedRiskFactor: number;
  location: 'barn' | 'pasture';
  /** 0-20, only consulted when trigger.robustnessTrait is set. Null is treated as the neutral
   * midpoint (10) rather than a missing-trait crash - see the no-op test for why this matters. */
  robustnessPotential: number | null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * §4.2's formula: a per-game-day probability, deliberately - a tick may fire more or less often
 * than once a game day (CLAUDE.md §6), and a per-tick rate would silently make the world riskier on
 * a schedule that fires more often. `ceilingPerDay` is the backstop (incident_probability_ceiling_
 * per_game_day) - no combination of inputs can push a single day's probability above it.
 */
function dailyProbability(trigger: AcquiredTrigger, input: OnsetInputs, ceilingPerDay: number): number {
  let multiplier = 1;
  multiplier *= 1 + trigger.careWeight * clamp01(input.carePenaltyFactor);
  multiplier *= 1 + trigger.workloadWeight * clamp01(input.workloadFactor);
  if (trigger.feedWeight > 0) multiplier *= 1 + trigger.feedWeight * clamp01(input.feedRiskFactor);
  multiplier *= input.location === 'pasture' ? trigger.pastureMultiplier : 1;
  if (trigger.robustnessTrait !== null) {
    const potential = input.robustnessPotential ?? 10;
    multiplier *= 1 + trigger.robustnessWeight * (1 - clamp01(potential / 20));
  }
  const p = trigger.baseRatePerGameDay * multiplier;
  return Math.min(ceilingPerDay, Math.max(0, p));
}

/**
 * The probability of at least one onset across `daysSinceLastCheck` independent daily draws:
 * 1 - (1 - p_day)^days. A missed tick's larger day count carries roughly that many days of
 * accumulated risk rather than either zero (per-invocation only) or a fixed amount - the one place
 * a missed tick should not be treated as "nothing happened" (§7.1).
 */
export function onsetProbability(trigger: AcquiredTrigger, input: OnsetInputs, ceilingPerDay: number): number {
  const days = Math.max(0, input.daysSinceLastCheck);
  if (days === 0) return 0;
  const pDay = dailyProbability(trigger, input, ceilingPerDay);
  return 1 - Math.pow(1 - pDay, days);
}

/** A single draw against the cumulative distribution of the given outcome table - order matters
 * only in that it must be consistent, not in what it means (resolved / manageable / degenerative /
 * death, per §4.3). */
export function rollOutcome(trigger: AcquiredTrigger, treated: boolean, rng: Rng): IncidentOutcome {
  const table = treated ? trigger.outcomesTreated : trigger.outcomesUntreated;
  const roll = rng.next();
  let cumulative = 0;
  cumulative += table.resolved;
  if (roll < cumulative) return 'resolved';
  cumulative += table.manageable;
  if (roll < cumulative) return 'manageable';
  cumulative += table.degenerative;
  if (roll < cumulative) return 'degenerative';
  return 'death';
}
