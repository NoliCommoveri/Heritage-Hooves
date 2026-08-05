// The breed disease panel filter - docs/fixes/breed-disease-panels.md. Pure, no database access
// (CLAUDE.md §5.1): the caller loads the conditions list, every breed's founding_allele_pool and
// the set of breed codes in a horse's pedigree; this only judges which conditions are worth asking
// about.
//
// A condition belongs on a horse's panel when any named breed's founding_allele_pool carries the
// condition's mutant allele at nonzero frequency - derived from the pools themselves, not from
// conditions.breed_associations (that column stays display-only, exactly as migrations/0052
// documented it - a hand-maintained breed list can drift from the pools that actually decide what a
// horse can carry; the pools cannot drift from themselves).

import type { AllelePool } from '../founding/pool';
import { parseConditionTrigger } from './status';

export interface PanelConditionInput {
  code: string;
  locus_code: string | null;
  trigger: string;
}

/**
 * Filters `conditions` down to the ones worth testing for a horse whose pedigree carries the breed
 * codes in `breedCodes`. A condition with no locus_code (a future non-genetic row - none exist yet)
 * is always kept, since there is nothing to check it against.
 *
 * `pools` must have an entry for every code in `breedCodes`, and every entry must cover every locus
 * a condition's trigger names - both are pool.ts's own existing rule (a pool missing a locus is an
 * error, not a default), so this throws rather than silently dropping a condition off a panel it
 * should be on.
 */
export function panelFor<T extends PanelConditionInput>(conditions: T[], pools: Map<string, AllelePool>, breedCodes: Set<string>): T[] {
  return conditions.filter((condition) => {
    if (condition.locus_code === null) return true;
    const trigger = parseConditionTrigger(condition.trigger);
    for (const breedCode of breedCodes) {
      const pool = pools.get(breedCode);
      if (!pool) throw new Error(`panelFor: no founding_allele_pool for breed ${breedCode}`);
      const freqs = pool[trigger.locus];
      if (!freqs) throw new Error(`panelFor: pool for ${breedCode} missing locus ${trigger.locus}`);
      if ((freqs[trigger.mutant] ?? 0) > 0) return true;
    }
    return false;
  });
}
