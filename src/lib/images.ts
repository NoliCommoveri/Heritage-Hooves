// The image library and picker: presentation plumbing over the numbered library described in
// docs/slices/0007-image-slot.md §4, not part of the simulation - it lives in src/lib rather than
// src/engines for that reason (CLAUDE.md §4). Pure, no database access; the caller reads breeds
// and a horse's composition, calls these, and writes the result.

/** The library's file extension, in one place - see slice 0007 §4.1 for why this stays a constant
 * rather than a per-breed column. Change this and rename what's already uploaded if it ever needs
 * to be something other than webp. */
export const LIBRARY_IMAGE_EXT = 'webp';

export const MAX_IMAGE_COUNT = 99;

/** The subset of a breeds row the image functions below need - kept narrow rather than importing
 * BreedRow, so this file stays a plain-data pure module (CLAUDE.md §5.1). */
export interface BreedForImages {
  code: string;
  name: string;
  image_count: number;
}

export interface ImageOption {
  breedCode: string;
  breedName: string;
  index: number;
  path: string;
  /** Names the file, never the horse - see slice 0007 §4.2: describing the horse here would be a
   * lie the moment a child puts a mismatched picture on it, told specifically to a screen reader. */
  alt: string;
}

/** "/horses/qh-03.webp". Zero-padded to two digits; breedCode is lowercased regardless of how it's
 * stored (breeds.code is upper-case, e.g. "QH"). */
export function libraryImagePath(breedCode: string, n: number): string {
  const padded = String(n).padStart(2, '0');
  return `/horses/${breedCode.toLowerCase()}-${padded}.${LIBRARY_IMAGE_EXT}`;
}

/**
 * A horse's image set is the union of the library sets of every breed code in its composition
 * blob, ordered by fraction descending then by breed code (slice 0007 §2.2) - this single rule
 * covers a purebred ({"QH":1}) and a cross with no branch. A composition code with no matching
 * breeds row (or image_count 0) contributes nothing, silently, per §2.3/§8.5 - not a throw.
 */
export function imageOptionsFor(composition: Record<string, number>, breeds: BreedForImages[]): ImageOption[] {
  const breedByCode = new Map(breeds.map((b) => [b.code, b]));
  const codes = Object.keys(composition).filter((code) => breedByCode.has(code));

  codes.sort((a, b) => {
    const fractionDiff = composition[b] - composition[a];
    if (fractionDiff !== 0) return fractionDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const options: ImageOption[] = [];
  for (const code of codes) {
    const breed = breedByCode.get(code);
    if (!breed) continue;
    for (let i = 1; i <= breed.image_count; i++) {
      options.push({
        breedCode: code,
        breedName: breed.name,
        index: i,
        path: libraryImagePath(code, i),
        alt: `${breed.name} picture ${String(i)}`,
      });
    }
  }
  return options;
}

/**
 * The POST handler never trusts the submitted value (slice 0007 §2.6) - it re-derives the allowed
 * set with imageOptionsFor from the horse's own composition and the live image_counts, then checks
 * membership here. Anything not present - a stale count, a foreign breed's path, a path that isn't
 * a library path at all ("../", an https:// URL, "") - is rejected by simply not being in the set.
 */
export function isAllowedImagePath(path: string, options: ImageOption[]): boolean {
  return options.some((o) => o.path === path);
}

/** The radio value that means "no picture" - never a real library path, so it can never collide
 * with one and never needs to appear in the allowed set above. */
export const NO_PICTURE_VALUE = '';

/** Whole numbers 0..99 only (§4.1: zero-padded to two digits). Anything else, including a
 * non-integer or a non-numeric string, is rejected rather than coerced. */
export function parseImageCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n > MAX_IMAGE_COUNT) return null;
  return n;
}
