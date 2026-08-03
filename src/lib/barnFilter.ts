// Slice 0016 §4.2: the barn list's tab buckets. A pure function so the rule - a horse belongs to
// exactly one bucket, never both Foals and Mares/Stallions - lives in one place and is testable
// without a database. foal_max_age_game_days is a display tunable only; nothing here is read by
// breeding, showing, care or ageing (CLAUDE.md's own barn-filter entry).

export type BarnBucket = 'foals' | 'mares' | 'stallions' | 'geldings';

export function bucketFor(
  horse: { sex: 'mare' | 'stallion' | 'gelding'; born_game_day: number },
  gameDay: number,
  foalMaxAgeGameDays: number
): BarnBucket {
  const ageDays = gameDay - horse.born_game_day;
  if (ageDays < foalMaxAgeGameDays) return 'foals';
  if (horse.sex === 'mare') return 'mares';
  if (horse.sex === 'stallion') return 'stallions';
  return 'geldings';
}
