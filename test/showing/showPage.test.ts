import { describe, expect, it } from 'vitest';
import { buildShowPageTabs, buildShowPageClassGroups, groupClassesByKeyAndRank, type ShowPageClassView } from '../../src/render/shows';
import { showPageUrl, showsIndexUrl } from '../../src/lib/showsFilter';
import type { ShowClassRow } from '../../src/db/shows';

// 2026-08-06, operator report: a show's page listed every class in mint order, and since the
// 2026-08-06 walkback (migration 0175) a busy household's show holds two or three copies of the
// same class - so the copies interleaved with everything else and nothing could be found. These are
// the two pure rules that fixed it: which tabs a show needs, and how its classes group.

const DISCIPLINES = [
  { code: 'dressage', name: 'Dressage' },
  { code: 'jumping', name: 'Show Jumping' },
  { code: 'barrels', name: 'Barrel Racing' },
];

function cls(over: Partial<ShowClassRow>): ShowClassRow {
  return {
    id: 1,
    show_id: 1,
    name: 'A class',
    class_type: 'breed_conformation',
    breed_id: 1,
    discipline_code: null,
    ability_trait_code: null,
    age_band: null,
    class_key: 'conf:1',
    rank: 'open',
    min_age_game_days: 1080,
    max_age_game_days: null,
    sex_restriction: null,
    crosses_eligible: 0,
    requires_gait: 0,
    target_field_size: 8,
    max_entries_per_stable: 3,
    judge_id: 1,
    ideal_vector: null,
    ability_weights: null,
    ideal_falloff: 1,
    noise_sd: 2,
    status: 'judged',
    judged_game_day: 100,
    rng_seed: 1,
    prize_schedule: '[]',
    ...over,
  };
}

function view(over: Partial<ShowClassRow>): ShowPageClassView {
  return { cls: cls(over), judge: undefined, breedName: 'Quarter Horse', minAgeYears: 3, entries: [] };
}

describe('buildShowPageTabs', () => {
  it('draws only the class types the show actually holds, All first', () => {
    const tabs = buildShowPageTabs(
      [
        { class_type: 'breed_conformation', discipline_code: null },
        { class_type: 'discipline', discipline_code: 'dressage' },
      ],
      DISCIPLINES,
      'all'
    );
    expect(tabs.map((t) => t.key)).toEqual(['all', 'conformation', 'dressage']);
    expect(tabs.map((t) => t.label)).toEqual(['All', 'Conformation', 'Dressage']);
  });

  it('counts the classes behind each tab, and All counts every one', () => {
    const tabs = buildShowPageTabs(
      [
        { class_type: 'breed_conformation', discipline_code: null },
        { class_type: 'breed_conformation', discipline_code: null },
        { class_type: 'discipline', discipline_code: 'dressage' },
      ],
      DISCIPLINES,
      'all'
    );
    expect(tabs.find((t) => t.key === 'all')?.count).toBe(3);
    expect(tabs.find((t) => t.key === 'conformation')?.count).toBe(2);
    expect(tabs.find((t) => t.key === 'dressage')?.count).toBe(1);
  });

  it('files young_conformation and ability_test under one Young Horse tab, last', () => {
    const tabs = buildShowPageTabs(
      [
        { class_type: 'ability_test', discipline_code: null },
        { class_type: 'young_conformation', discipline_code: null },
        { class_type: 'breed_conformation', discipline_code: null },
      ],
      DISCIPLINES,
      'all'
    );
    expect(tabs.map((t) => t.key)).toEqual(['all', 'conformation', 'young']);
    expect(tabs.find((t) => t.key === 'young')?.count).toBe(2);
  });

  it('orders discipline tabs by name, after conformation and before young horse', () => {
    const tabs = buildShowPageTabs(
      [
        { class_type: 'discipline', discipline_code: 'jumping' },
        { class_type: 'young_conformation', discipline_code: null },
        { class_type: 'discipline', discipline_code: 'barrels' },
        { class_type: 'breed_conformation', discipline_code: null },
      ],
      DISCIPLINES,
      'all'
    );
    expect(tabs.map((t) => t.key)).toEqual(['all', 'conformation', 'barrels', 'jumping', 'young']);
  });

  it('keeps the active tab in the bar even when this show holds nothing of that kind', () => {
    // A link carrying ?class=dressage, opened on a conformation-only show: an active tab reading
    // "Dressage (0)" is true, where a bar with nothing active over an empty page reads as broken.
    const tabs = buildShowPageTabs([{ class_type: 'breed_conformation', discipline_code: null }], DISCIPLINES, 'dressage');
    expect(tabs.map((t) => t.key)).toEqual(['all', 'conformation', 'dressage']);
    expect(tabs.find((t) => t.key === 'dressage')?.count).toBe(0);
  });

  it('needs no tab but All for a show with no classes', () => {
    expect(buildShowPageTabs([], DISCIPLINES, 'all')).toEqual([{ key: 'all', label: 'All', count: 0 }]);
  });
});

describe('buildShowPageClassGroups', () => {
  it('files every copy of one class under a single group, oldest section first', () => {
    const groups = buildShowPageClassGroups([
      view({ id: 7, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'open' }),
      view({ id: 3, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'open' }),
      view({ id: 5, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'open' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sections.map((s) => s.cls.id)).toEqual([3, 5, 7]);
  });

  it('keeps two ranks of the same class apart, Novice before Open before Champion', () => {
    const groups = buildShowPageClassGroups([
      view({ id: 2, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'champion' }),
      view({ id: 1, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'open' }),
      view({ id: 3, name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'novice' }),
    ]);
    expect(groups.map((g) => g.sections[0].cls.rank)).toEqual(['novice', 'open', 'champion']);
    expect(groups.every((g) => g.sections.length === 1)).toBe(true);
  });

  it('orders groups conformation, disciplines, young horse - never mint order', () => {
    const groups = buildShowPageClassGroups([
      view({ id: 1, class_type: 'ability_test', name: 'Yearling Speed Test', class_key: 'abil:speed:yearling', rank: 'none', breed_id: null }),
      view({ id: 2, class_type: 'discipline', name: 'Dressage', class_key: 'disc:dressage', rank: 'open', breed_id: null, discipline_code: 'dressage' }),
      view({ id: 3, class_type: 'breed_conformation', name: 'Conformation- Quarter Horse', class_key: 'conf:1', rank: 'open' }),
      view({ id: 4, class_type: 'discipline', name: 'Barrel Racing', class_key: 'disc:barrels', rank: 'open', breed_id: null, discipline_code: 'barrels' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Conformation- Quarter Horse', 'Barrel Racing', 'Dressage', 'Yearling Speed Test']);
  });
});

// The /shows index lists a show's classes too - one summary line each - so three sections of one
// class were three near-identical lines there as well, which is where a player meets the
// duplication first. Both screens group through this one function, on their own payload types.
describe('groupClassesByKeyAndRank is shared by both screens', () => {
  it('groups a summary-shaped payload by the same rule, in the same order', () => {
    const summary = (id: number, over: Partial<ShowClassRow>, entryCount: number) => ({ cls: cls({ id, ...over }), entryCount });
    const groups = groupClassesByKeyAndRank(
      [
        summary(4, { class_type: 'discipline', name: 'Dressage', class_key: 'disc:dressage', breed_id: null, discipline_code: 'dressage' }, 3),
        summary(2, { name: 'Conformation- Quarter Horse', class_key: 'conf:1' }, 3),
        summary(1, { name: 'Conformation- Quarter Horse', class_key: 'conf:1' }, 2),
      ],
      (s) => s.cls
    );
    expect(groups.map((g) => g.label)).toEqual(['Conformation- Quarter Horse', 'Dressage']);
    expect(groups[0].sections.map((s) => s.cls.id)).toEqual([1, 2]);
    // What the index's "N horses entered so far" line adds up across a split class.
    expect(groups[0].sections.reduce((sum, s) => sum + s.entryCount, 0)).toBe(5);
  });

  it('leaves an unsplit class as a group of one, so the old single-class rendering is unchanged', () => {
    const groups = groupClassesByKeyAndRank([{ cls: cls({ id: 9 }) }], (s) => s.cls);
    expect(groups).toHaveLength(1);
    expect(groups[0].sections).toHaveLength(1);
  });
});

// The write side of the /shows filter. resolveShowsFilter (routes/shows.ts) only reads `breed` on
// the 'all'/'conformation' tabs, so a link must not carry one anywhere else - a stale breed riding
// along invisibly would reappear the moment the player clicked back to Conformation.
describe('showPageUrl / showsIndexUrl', () => {
  it('carries the class filter onto a show page', () => {
    expect(showPageUrl(12, { classType: 'dressage', breedId: null })).toBe('/shows/12?class=dressage');
  });

  it('carries a breed filter on the tabs that read one', () => {
    expect(showPageUrl(12, { classType: 'conformation', breedId: 3 })).toBe('/shows/12?class=conformation&breed=3');
    expect(showsIndexUrl({ classType: 'all', breedId: 3 })).toBe('/shows?class=all&breed=3');
  });

  it('drops a breed filter on a tab that ignores it', () => {
    expect(showPageUrl(12, { classType: 'dressage', breedId: 3 })).toBe('/shows/12?class=dressage');
    expect(showPageUrl(12, { classType: 'young', breedId: 3 })).toBe('/shows/12?class=young');
  });

  it('appends extra parameters, so a POST redirect keeps its own tab and its notice', () => {
    expect(showPageUrl(12, { classType: 'conformation', breedId: null }, { entered: '1' })).toBe('/shows/12?class=conformation&entered=1');
  });
});
