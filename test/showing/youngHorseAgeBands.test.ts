import { describe, expect, it } from 'vitest';
import { youngHorseAgeBands } from '../../src/db/shows';

// Slice 0025 stage 3 §7.3: the two young-horse age bands must be contiguous and mutually
// exclusive, and must hand off cleanly to the adult conformation class's own min age with no gap
// and no day belonging to two bands at once.
describe('youngHorseAgeBands', () => {
  const config = {
    young_horse_yearling_min_age_game_days: 360,
    young_horse_two_year_old_min_age_game_days: 720,
    show_conformation_min_age_game_days: 1080,
  };

  it('yearling runs from its own min up to one day short of two-year-old\'s min', () => {
    const bands = youngHorseAgeBands(config as never);
    expect(bands.yearling).toEqual({ min: 360, max: 719 });
  });

  it('two-year-old runs from its own min up to one day short of the adult class\'s min age', () => {
    const bands = youngHorseAgeBands(config as never);
    expect(bands.twoYearOld).toEqual({ min: 720, max: 1079 });
  });

  it('no day is eligible for two bands at once, and no day between them is eligible for neither', () => {
    const bands = youngHorseAgeBands(config as never);
    expect(bands.yearling.max + 1).toBe(bands.twoYearOld.min);
    expect(bands.twoYearOld.max + 1).toBe(config.show_conformation_min_age_game_days);
  });
});
