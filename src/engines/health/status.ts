// Whether a genotype reads as clear, carrier or affected for one condition. Slice 0010 §4.2. Pure,
// no database access - the same pattern as engines/genetics, engines/breeding, engines/showing and
// engines/conformation (CLAUDE.md §5.1). The caller loads the horse's genotype and the condition's
// trigger row; this only judges the rule.

import type { Genotype } from '../genetics/genotype';
import { getMendelianPair } from '../genetics/genotype';

export type ConditionInheritanceMode = 'dominant' | 'recessive';

/** The shape stored in conditions.trigger - slice 0010 §4.2. Deliberately generic enough that a
 * future colour-linked condition (e.g. Frame Overo) needs no new engine, only a new row. */
export interface ConditionTrigger {
  v: number;
  locus: string;
  mutant: string;
  mode: ConditionInheritanceMode;
}

export function parseConditionTrigger(json: string): ConditionTrigger {
  return JSON.parse(json) as ConditionTrigger;
}

export type ConditionStatusLabel = 'clear' | 'carrier' | 'affected';

export interface ConditionStatusResult {
  status: ConditionStatusLabel;
  copies: 0 | 1 | 2;
}

/**
 * Counts copies of the trigger's mutant allele at the named locus (via getMendelianPair, which
 * already carries slice 0002's missing-locus rule - a genotype predating this locus reads as two
 * copies of wild type, i.e. clear) and maps that count to a status.
 *
 * Recessive: 0 copies clear, 1 carrier, 2 affected.
 * Dominant: 0 copies clear, 1 and 2 both affected. There is no such thing as a carrier of a
 * dominant condition - callers and display code must never use that word for one (slice 0010
 * §4.2's HYPP teaching point).
 */
export function conditionStatus(genotype: Genotype, trigger: ConditionTrigger): ConditionStatusResult {
  const [a, b] = getMendelianPair(genotype, trigger.locus);
  const copies = ((a === trigger.mutant ? 1 : 0) + (b === trigger.mutant ? 1 : 0)) as 0 | 1 | 2;

  if (trigger.mode === 'dominant') {
    return { status: copies === 0 ? 'clear' : 'affected', copies };
  }

  const status: ConditionStatusLabel = copies === 0 ? 'clear' : copies === 1 ? 'carrier' : 'affected';
  return { status, copies };
}

/**
 * The lethal death window's arithmetic (slice 0010 §2.2), pulled out as its own pure function
 * purely so the snapshotting contract is checkable in isolation: this takes the config value as an
 * explicit parameter rather than reading it live, which is what makes CLAUDE.md §5.5's rule true by
 * construction - retuning lethal_foal_death_game_days later can never move a date already computed
 * from an earlier call. The caller (buildHorseConditionStatements) calls this once, at birth, and
 * writes the result onto horse_conditions.terminal_game_day - never recomputed afterwards.
 */
export function lethalTerminalGameDay(bornGameDay: number, lethalFoalDeathGameDays: number): number {
  return bornGameDay + lethalFoalDeathGameDays;
}

export interface OwnerVisibleStatus {
  status: ConditionStatusLabel | null;
  copies: 0 | 1 | 2 | null;
  /** True when status is 'affected' but no test was ever paid for - a signs_visible condition,
   * shown as an observation rather than a result (slice 0010 §2.4). */
  observedOnly: boolean;
}

/**
 * The sharp version of §2.4, as one pure function: what an owner is entitled to see for one
 * condition on one horse, given what this stable has paid to learn (`known`, undefined if
 * nothing). A paid-for result always wins. Failing that, an affected status is visible for free
 * only when the condition's signs are visible (signsVisible) - carrier status is NEVER visible
 * without a test, for any condition, which is the whole point: carriers are the invisible ones.
 * This is the one function most worth testing in isolation, because the boundary it enforces is
 * invisible on screen the moment it is crossed by accident (§14).
 */
export function ownerVisibleStatus(
  genotype: Genotype,
  trigger: ConditionTrigger,
  signsVisible: boolean,
  known: { result: ConditionStatusLabel } | undefined
): OwnerVisibleStatus {
  if (known) {
    const { copies } = conditionStatus(genotype, trigger);
    return { status: known.result, copies, observedOnly: false };
  }
  if (signsVisible) {
    const { status, copies } = conditionStatus(genotype, trigger);
    if (status === 'affected') return { status: 'affected', copies, observedOnly: true };
  }
  return { status: null, copies: null, observedOnly: false };
}
