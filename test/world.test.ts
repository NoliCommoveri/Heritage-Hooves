import { describe, expect, it } from 'vitest';
import { buildPublicHorseView, type PublicHorseSource } from '../src/routes/world';

// Slice 0016 §2.2/§6.6: the whole point of this function is that a page assembled from its output
// can never leak a measured number, a test result, or a genotype - fields that don't appear on the
// object it returns simply cannot reach render/world.ts's templates. This test fails loudly if a
// future session widens the return shape (e.g. via a `...horse` spread) without reading §2.2 first.
describe('buildPublicHorseView', () => {
  const horse: PublicHorseSource & { coi: number; genotype: string; care_notice_game_day: number | null } = {
    id: 42,
    registered_name: 'SC Comet',
    barn_name: null,
    sex: 'mare',
    breeder_prefix: 'SC',
    image_url: null,
    status: 'alive',
    location: 'barn',
    is_cross: 0,
    // Fields that must never leak, attached here to prove the builder ignores them.
    coi: 0.125,
    genotype: '{"v":1,"mendelian":{}}',
    care_notice_game_day: 12345,
  };

  const view = buildPublicHorseView({
    horse,
    description: 'a bay mare',
    ageLabel: '5 years',
    breedName: 'Quarter Horse',
    currentStable: { id: 1, name: 'Silver Creek' },
    breederStableName: 'Silver Creek',
    sire: null,
    dam: null,
    showSummary: { starts: 3, wins: 1, best_placing: 1 },
    recentResults: [],
  });

  it('carries no genotype, conformation, coi, or health keys', () => {
    const keys = Object.keys(view);
    for (const forbidden of ['genotype', 'coi', 'conformation', 'care', 'careModifier', 'health', 'careNoticeGameDay', 'care_notice_game_day']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('assembles the public fields correctly', () => {
    expect(view.name).toBe('SC Comet');
    expect(view.bredByLabel).toBe('SC (Silver Creek)');
    expect(view.starts).toBe(3);
    expect(view.wins).toBe(1);
    expect(view.bestPlacing).toBe(1);
    expect(view.statusLabel).toBeNull();
    expect(view.atPasture).toBe(false);
  });
});
