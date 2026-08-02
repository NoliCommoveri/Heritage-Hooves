// Founding horses arrive fully named, from an origin stable that does not exist in this game
// (slice 0005 §6.5) - a prefix means "bred by", and stamping a claiming child's own prefix on a
// horse they did not breed would corrupt the one thing the prefix scheme exists to record.
//
// The prefix that actually lands in registered_name is a short letter-combo, the way a real
// breeder's stamp reads in front of a horse's name ("SC Tell Me Nothing"), not the stable's whole
// name spelled out - a real horse doesn't go by "Silver Creek Tell Me Nothing". The full stable
// name is kept alongside its code, for the one sentence on a horse's page that says where a
// founding horse came from (renderHorsePage's bredByLine) - flavor text, never stored on the row.
//
// Two short, obviously-extendable lists, content rather than machinery - a later session or a
// child can add to them. Combined from the candidate's own seed via deriveSeed(seed, 'founding_name').

import { makeRng, deriveSeed } from '../../lib/rng';

const ORIGIN_STABLES = [
  { code: 'SC', full: 'Silver Creek' },
  { code: 'WM', full: 'Windmere' },
  { code: 'BS', full: 'Blue Sage' },
  { code: 'RR', full: 'Rocking R' },
  { code: 'SB', full: 'Stonebridge' },
  { code: 'FH', full: 'Fox Hollow' },
  { code: 'CR', full: 'Cedar Ridge' },
  { code: 'WR', full: 'Wildrose' },
  { code: 'BF', full: 'Broken Fence' },
  { code: 'SD', full: 'Sundance' },
  { code: 'HT', full: 'High Timber' },
  { code: 'CD', full: 'Copper Draw' },
  { code: 'WP', full: 'Whispering Pines' },
  { code: 'LS', full: 'Larkspur' },
  { code: 'IW', full: 'Ironwood' },
  { code: 'PW', full: 'Prairie Wind' },
  { code: 'RG', full: 'Redgate' },
  { code: 'MS', full: 'Moonshadow' },
  { code: 'RO', full: 'Rustling Oak' },
  { code: 'TD', full: 'Thistledown' },
  { code: 'BM', full: 'Bluestem' },
  { code: 'CY', full: 'Coyote Run' },
  { code: 'DV', full: 'Dappled Vale' },
  { code: 'AH', full: 'Amber Hill' },
] as const;

/** Looks up a full stable name from the code stamped in registered_name/breeder_prefix, for the
 * horse page's bred-by sentence only. Undefined for anything not in ORIGIN_STABLES (a hand-built
 * admin founder, or a code this list has since dropped) - the caller falls back to showing just
 * the code in that case. */
export function originStableFullName(code: string): string | undefined {
  return ORIGIN_STABLES.find((s) => s.code === code)?.full;
}

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
    originPrefix: rng.pick([...ORIGIN_STABLES]).code,
    namePart: rng.pick([...NAME_WORDS]),
  };
}
