// Per-account difficulty, 2026-08-05. Operator feedback: sickness and injury were arriving too
// often for the two youngest children, and a difficulty setting was asked for by name. Pure, no
// database access (CLAUDE.md §5.1).
//
// Scope, decided by the operator and deliberately narrow: difficulty touches HOW OFTEN an acute
// incident starts and HOW BAD its outcome is. It does not touch genetics, lethal foals, or death
// from old age. An inherited disease is a fact about a genotype - softening it per account would
// make two children's horses genuinely different animals, and a foal sold between them would change
// its own risk on the way across.
//
// There is no second risk path here (CLAUDE.md §13): both multipliers feed the same
// onsetProbability/rollOutcome the whole game already uses, which is why this file exports numbers
// and a table transform rather than an alternative model.

import type { OutcomeTable } from './risk';

export const DIFFICULTY_LEVELS = ['gentle', 'normal', 'realistic'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  gentle: 'Gentle',
  normal: 'Normal',
  realistic: 'Realistic',
};

export const DIFFICULTY_BLURB: Record<DifficultyLevel, string> = {
  gentle: 'Horses get sick and hurt much less often, and recover far more of the time. For a younger player who is losing horses faster than they can enjoy them.',
  normal: 'The game as it is tuned for everyone by default.',
  realistic: 'Illness and injury arrive a little more often, and go badly a little more often. For a player who wants the risk to bite.',
};

/** The neutral setting: multiply nothing. What an unrecognised level, and every NPC stable, reads
 * as - an NPC has no account, and a typo in the column must never change how the world behaves. */
export const NEUTRAL_DIFFICULTY: DifficultyMultipliers = { incidentRate: 1, badOutcome: 1 };

export interface DifficultyMultipliers {
  /** Multiplies the per-game-day onset probability, applied before the shared ceiling clamp. */
  incidentRate: number;
  /** Multiplies the combined death + degenerative share of an outcome table. */
  badOutcome: number;
}

/** The six flat config keys migration 0154 seeds. Flat decimals rather than a JSON blob so
 * /admin/config's existing form can edit them - see that migration's comment. */
export interface DifficultyConfigValues {
  difficulty_gentle_incident_rate: number;
  difficulty_gentle_bad_outcome: number;
  difficulty_normal_incident_rate: number;
  difficulty_normal_bad_outcome: number;
  difficulty_realistic_incident_rate: number;
  difficulty_realistic_bad_outcome: number;
}

export function isDifficultyLevel(value: string | null | undefined): value is DifficultyLevel {
  return value !== null && value !== undefined && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

/** An unrecognised or missing level reads neutral rather than throwing - migration 0153 puts no
 * CHECK on the column on purpose, and a bad value must never be able to stop a tick. */
export function difficultyMultipliers(level: string | null | undefined, cfg: DifficultyConfigValues): DifficultyMultipliers {
  if (!isDifficultyLevel(level)) return NEUTRAL_DIFFICULTY;
  const rate = cfg[`difficulty_${level}_incident_rate` as keyof DifficultyConfigValues];
  const bad = cfg[`difficulty_${level}_bad_outcome` as keyof DifficultyConfigValues];
  return {
    incidentRate: Number.isFinite(rate) && rate >= 0 ? rate : 1,
    badOutcome: Number.isFinite(bad) && bad >= 0 ? bad : 1,
  };
}

/**
 * Scales the bad half of an outcome table (death + degenerative - the two outcomes that end or
 * permanently mark a career) by `multiplier`, and gives whatever that frees back to resolved and
 * manageable in the proportion they already stood in.
 *
 * Three properties this deliberately holds to, because an outcome table that does not sum to 1 is a
 * silent bug - slice 0020 shipped two of them and only the test caught it:
 *
 *  - the result always sums to 1;
 *  - multiplier 1 returns the table unchanged, to the last decimal;
 *  - a multiplier large enough to push death + degenerative past 1 is clamped at 1 rather than
 *    producing negative shares.
 */
export function scaleBadOutcomes(table: OutcomeTable, multiplier: number): OutcomeTable {
  if (multiplier === 1) return table;

  const bad = table.death + table.degenerative;
  const good = table.resolved + table.manageable;
  const scaledBad = Math.min(1, Math.max(0, bad * multiplier));

  // A table that was all-bad has no good share to grow into; give the freed probability to
  // resolved, the only sensible destination when there is no ratio to preserve.
  const goodTotal = 1 - scaledBad;
  const badRatio = bad > 0 ? scaledBad / bad : 0;
  const goodRatio = good > 0 ? goodTotal / good : 0;

  return {
    death: table.death * badRatio,
    degenerative: table.degenerative * badRatio,
    resolved: good > 0 ? table.resolved * goodRatio : goodTotal,
    manageable: good > 0 ? table.manageable * goodRatio : 0,
  };
}
