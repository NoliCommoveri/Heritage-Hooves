// The judge having an ordinary human day. Slice 0008 §4.5/§7.2. Pure.

import { makeRng, deriveSeed } from '../../lib/rng';

/**
 * Derived per (class, horse) rather than drawn sequentially down the entry list - §7.2 calls this
 * "the important one": the noise a horse gets does not depend on how many other horses entered,
 * what order they entered in, or whether the tick is being re-run after a crash. A re-fired tick
 * reproduces the class byte for byte; sequential draws would not.
 */
export function noiseForEntry(classSeed: number, horseId: number, noiseSd: number): number {
  return makeRng(deriveSeed(classSeed, `noise_${String(horseId)}`)).normal(0, noiseSd);
}
