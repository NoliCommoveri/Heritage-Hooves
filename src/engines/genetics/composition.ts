// Breed composition and the "once a cross, always a cross" rule. Slice 0002 §6.5. Not one of the
// seven files the slice document names in §5, but it's genetics-adjacent, pure, and needs its own
// unit test the way the rest of this directory does, so it lives here rather than inside db/horses.ts.
//
// With only one breed seeded this slice, nothing can actually cross - this code is exercised only
// by its unit test. Written anyway, because applying a rule of this shape retroactively, once
// horses already carry an untracked cross somewhere in their ancestry, is impossible.

export interface BreedCompositionInput {
  /** Breed code -> fraction, e.g. {"QH": 1}. */
  composition: Record<string, number>;
  isCross: boolean;
  breedId: number | null;
}

export interface FoalComposition {
  composition: Record<string, number>;
  isCross: boolean;
  breedId: number | null;
}

export function foalComposition(sire: BreedCompositionInput, dam: BreedCompositionInput): FoalComposition {
  // Once a cross, always a cross (overview §4c): without this, breed allele restrictions dissolve
  // within a few generations of breeding back to a pure line.
  const isCross = sire.isCross || dam.isCross || sire.breedId !== dam.breedId;

  const codes = new Set([...Object.keys(sire.composition), ...Object.keys(dam.composition)]);
  const composition: Record<string, number> = {};
  for (const code of codes) {
    const fraction = ((sire.composition[code] ?? 0) + (dam.composition[code] ?? 0)) / 2;
    if (fraction > 0) composition[code] = fraction;
  }

  const codesInComposition = Object.keys(composition);
  const isCleanSingleBreed = !isCross && codesInComposition.length === 1 && composition[codesInComposition[0]] === 1;
  const breedId = isCleanSingleBreed ? sire.breedId : null;

  return { composition, isCross, breedId };
}
