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

/**
 * Slice 0026 §1.4: a gelding's negative show noise is softened, mares and stallions untouched.
 * Pure transform of the value noiseForEntry already drew - no new RNG stream, so a re-fired tick
 * still reproduces the class byte for byte. `relief` is show_gelding_noise_relief, a live config
 * value (not snapshotted onto the class), read fresh by the caller.
 */
export function geldingAdjustedNoise(noise: number, isGelding: boolean, relief: number): number {
  if (!isGelding || noise >= 0) return noise;
  return noise * relief;
}
