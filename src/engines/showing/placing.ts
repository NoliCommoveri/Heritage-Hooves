// Sorting a class's scored entries into placings, and the ribbon each placing carries. Slice 0008
// §4.7. Pure - no database access.

export interface PlacingCandidate {
  horseId: number;
  finalScore: number;
  rawScore: number;
}

/**
 * §4.7: descending by final score, ties broken by raw score then by horse id ascending - a total
 * order, so re-running the scorer on the same data reproduces byte-identical placings regardless
 * of the order entries were passed in. Placings are 1-based and every entry gets one.
 */
export function assignPlacings<T extends PlacingCandidate>(entries: T[]): (T & { placing: number })[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.finalScore !== b.finalScore) return b.finalScore - a.finalScore;
    if (a.rawScore !== b.rawScore) return b.rawScore - a.rawScore;
    return a.horseId - b.horseId;
  });
  return sorted.map((entry, index) => ({ ...entry, placing: index + 1 }));
}

/** §4.7: the ordinary US show convention. A display constant, not a column and not config. */
export const RIBBON_COLORS: Record<number, string> = {
  1: 'blue',
  2: 'red',
  3: 'yellow',
  4: 'white',
  5: 'pink',
  6: 'green',
};

export function ribbonFor(placing: number): string | undefined {
  return RIBBON_COLORS[placing];
}
