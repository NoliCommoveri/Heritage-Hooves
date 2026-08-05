// The twelve acquired incidents - colic, laminitis, and the rest. Originally slice 0020 §2.2/§5,
// moved here and renamed by slice 0022 Part A (the twelve were never genetic conditions, and living
// in src/engines/health alongside status.ts/management.ts kept inviting that mistake). Pure, no
// database access (CLAUDE.md §5.1): one onset/resolution pair of functions shared by all twelve,
// distinguished only by the IncidentRiskModel data each incident type's own `incident_types.risk_model`
// row carries - never a branch on incident code (CLAUDE.md §13's "no parallel scoring path" rule).
//
// No RNG inside onsetProbability - it returns a probability, the caller draws (CLAUDE.md §5.2).
// rollOutcome takes an Rng explicitly, the same split every other engine in this codebase keeps.
//
// treatmentWindowGameDays and treatmentCostKey are deliberately NOT part of this shape - they moved
// to real columns on incident_types (treatment_window_game_days/treatment_cost_key) rather than
// staying duplicated in this JSON, since both are genuinely read elsewhere, unlike the columns
// slice 0022 §A1 found dead for these twelve on the old `conditions` table.

import type { Rng } from '../../lib/rng';
// difficulty.ts imports OutcomeTable from here as a *type only*, so this is a one-way runtime
// dependency, not a cycle.
import { scaleBadOutcomes } from './difficulty';

export interface OutcomeTable {
  resolved: number;
  manageable: number;
  degenerative: number;
  death: number;
}

export type IncidentOutcome = 'resolved' | 'manageable' | 'degenerative' | 'death';

export interface IncidentRiskModel {
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
  outcomesUntreated: OutcomeTable;
  outcomesTreated: OutcomeTable;
}

export function parseIncidentRiskModel(json: string): IncidentRiskModel {
  return JSON.parse(json) as IncidentRiskModel;
}

export interface OnsetInputs {
  /** How many game days have passed since this horse was last checked for this incident type - the
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
  /** The owning ACCOUNT's difficulty setting (src/engines/incidents/difficulty.ts), 2026-08-05.
   * Optional and defaulting to 1 so every pre-existing caller and test is unaffected; an NPC stable
   * has no account and always passes 1. Applied inside dailyProbability BEFORE the ceiling clamp,
   * so incident_probability_ceiling_per_game_day still means what it says at every level. */
  difficultyRateMultiplier?: number;
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
function dailyProbability(trigger: IncidentRiskModel, input: OnsetInputs, ceilingPerDay: number): number {
  let multiplier = 1;
  multiplier *= 1 + trigger.careWeight * clamp01(input.carePenaltyFactor);
  multiplier *= 1 + trigger.workloadWeight * clamp01(input.workloadFactor);
  if (trigger.feedWeight > 0) multiplier *= 1 + trigger.feedWeight * clamp01(input.feedRiskFactor);
  multiplier *= input.location === 'pasture' ? trigger.pastureMultiplier : 1;
  if (trigger.robustnessTrait !== null) {
    const potential = input.robustnessPotential ?? 10;
    multiplier *= 1 + trigger.robustnessWeight * (1 - clamp01(potential / 20));
  }
  multiplier *= Math.max(0, input.difficultyRateMultiplier ?? 1);
  const p = trigger.baseRatePerGameDay * multiplier;
  return Math.min(ceilingPerDay, Math.max(0, p));
}

/**
 * The probability of at least one onset across `daysSinceLastCheck` independent daily draws:
 * 1 - (1 - p_day)^days. A missed tick's larger day count carries roughly that many days of
 * accumulated risk rather than either zero (per-invocation only) or a fixed amount - the one place
 * a missed tick should not be treated as "nothing happened" (§7.1).
 */
export function onsetProbability(trigger: IncidentRiskModel, input: OnsetInputs, ceilingPerDay: number): number {
  const days = Math.max(0, input.daysSinceLastCheck);
  if (days === 0) return 0;
  const pDay = dailyProbability(trigger, input, ceilingPerDay);
  return 1 - Math.pow(1 - pDay, days);
}

/** A single draw against the cumulative distribution of the given outcome table - order matters
 * only in that it must be consistent, not in what it means (resolved / manageable / degenerative /
 * death, per §4.3).
 *
 * `badOutcomeMultiplier` is the owning account's difficulty (2026-08-05), defaulting to 1 so every
 * pre-existing caller is unaffected. It reshapes the table before the draw rather than re-rolling or
 * overriding the result afterwards, which is what keeps a horse's outcome reproducible from its own
 * seed (CLAUDE.md §5.2) - the same roll against a kinder table, not a second roll. */
export function rollOutcome(trigger: IncidentRiskModel, treated: boolean, rng: Rng, badOutcomeMultiplier = 1): IncidentOutcome {
  const base = treated ? trigger.outcomesTreated : trigger.outcomesUntreated;
  const table = scaleBadOutcomes(base, badOutcomeMultiplier);
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
