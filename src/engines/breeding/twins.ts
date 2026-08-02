// Twins. Slice 0003 §6: two independent rolls from the covering's own seed, kept separate so a
// future session can tune "how often twins conceive" without touching "how often both survive".
// The real-world reduction (most twin conceptions naturally reduce to one by ~day 40) hides inside
// roll 2 - a reduced conception is simply a single foal, indistinguishable from any other. When
// both rolls pass, both foals live and both are healthy: a deliberate departure from reality
// (real live twins usually endanger the mare and both foals), written down so it doesn't read as
// an oversight later.

import type { Rng } from '../../lib/rng';

export interface TwinConfig {
  twin_double_ovulation_rate: number;
  twin_both_continue_rate: number;
}

/**
 * doubleOvulationRng and continueRng must be independently seeded (deriveSeed(covering.rng_seed,
 * "double_ovulation") / "twin_continue") - see slice 0003 §9. continueRng is only ever consumed
 * when double ovulation happens, which keeps the two rolls' draw counts independent of each other.
 */
export function rollTwins(doubleOvulationRng: Rng, continueRng: Rng, config: TwinConfig): boolean {
  const doubleOvulation = doubleOvulationRng.next() < config.twin_double_ovulation_rate;
  if (!doubleOvulation) return false;
  return continueRng.next() < config.twin_both_continue_rate;
}
