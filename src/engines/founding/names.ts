// Founding horses arrive fully named, from an origin stable that does not exist in this game
// (slice 0005 §6.5) - a prefix means "bred by", and stamping a claiming child's own prefix on a
// horse they did not breed would corrupt the one thing the prefix scheme exists to record.
//
// Two short, obviously-extendable lists, content rather than machinery - a later session or a
// child can add to them. Combined from the candidate's own seed via deriveSeed(seed, 'founding_name').

import { makeRng, deriveSeed } from '../../lib/rng';

const ORIGIN_PREFIXES = [
  'Silver Creek',
  'Windmere',
  'Blue Sage',
  'Rocking R',
  'Stonebridge',
  'Fox Hollow',
  'Cedar Ridge',
  'Wildrose',
  'Broken Fence',
  'Sundance',
  'High Timber',
  'Copper Draw',
  'Whispering Pines',
  'Larkspur',
  'Ironwood',
  'Prairie Wind',
  'Redgate',
  'Moonshadow',
  'Rustling Oak',
  'Thistledown',
  'Bluestem',
  'Coyote Run',
  'Dappled Vale',
  'Amber Hill',
] as const;

const NAME_WORDS = [
  'Comet',
  'Whisper',
  'Ranger',
  'Echo',
  'Blaze',
  'Sable',
  'Juniper',
  'Maverick',
  'Nutmeg',
  'Zephyr',
  'Harlow',
  'Dash',
  'Sundown',
  'Marigold',
  'Rowan',
  'Halo',
  'Ridge',
  'Piper',
  'Talon',
  'Waverly',
  'Clover',
  'Boomer',
  'Fable',
  'Ember',
  'Gale',
  'Hollis',
  'Indigo',
  'Journey',
  'Kestrel',
  'Lumen',
  'Merit',
  'Nomad',
  'Onyx',
  'Pepper',
  'Quill',
  'Reverie',
  'Sable Star',
  'Tempo',
  'Umber',
  'Vesper',
  'Wren',
  'Xanthe',
  'Yonder',
  'Zinnia',
  'Aspen',
  'Birchwood',
  'Cascade',
  'Driftwood',
  'Elmwood',
  'Feather',
  'Granite',
  'Huckleberry',
  'Ivy',
  'Jubilee',
  'Kindling',
  'Lantern',
  'Meridian',
  'North Star',
  'Ochre',
  'Pinnacle',
] as const;

export interface FoundingNameParts {
  originPrefix: string;
  namePart: string;
}

/**
 * attempt 0 (the default) is the name a candidate is generated with and shows on the offer
 * screen. A collision with an existing horses.registered_name at claim time (slice 0005 §6.5) is
 * resolved by walking forward through this same deterministic sequence - attempt 1, 2, ... - never
 * by picking something arbitrary, so the outcome of a retried claim is still reproducible from the
 * candidate's own seed.
 */
export function generateFoundingName(seed: number, attempt = 0): FoundingNameParts {
  const label = attempt === 0 ? 'founding_name' : `founding_name_retry_${String(attempt)}`;
  const rng = makeRng(deriveSeed(seed, label));
  return {
    originPrefix: rng.pick([...ORIGIN_PREFIXES]),
    namePart: rng.pick([...NAME_WORDS]),
  };
}
