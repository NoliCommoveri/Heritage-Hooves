import { describe, expect, it } from 'vitest';
import { buildShowResultGroups, SHOW_RESULT_GROUP_CAP } from '../../src/render/shows';
import type { HorseResultRow } from '../../src/db/shows';
import type { ShowRank } from '../../src/engines/showing/eligibility';

// The Show record card's grouping, shared by the owner's own horse page, a sale listing, a stud
// listing and /world - so a horse you are thinking of buying reads exactly the way one of your own
// does. Before this was factored out, the three non-owner screens showed a single flat list of five
// placings with the (fictional, uninformative) show name attached and no class type at all.
//
// Slice 0026 §3.2 added a second axis: within a class-type group, placings split into rank
// sub-groups (Novice/Open/Champion, or a single flat 'none' sub-group for young-horse/ability
// results, which are never rank-bracketed).

/** Rows come back from listRecentResultsForHorse newest-first, which the builder relies on. */
function row(overrides: Partial<HorseResultRow> & Pick<HorseResultRow, 'scheduled_game_day' | 'placing'>): HorseResultRow {
  return {
    entry_id: 1,
    show_id: 1,
    show_name: 'Stonebrook Winter Show',
    class_id: 1,
    class_name: 'a class',
    class_type: 'breed_conformation',
    discipline_name: null,
    ability_trait_name: null,
    final_score: 100,
    rank: 'novice',
    class_key: 'bc:1',
    ...overrides,
  };
}

const GAME_DAYS_PER_YEAR = 360;
const NO_CURRENT_RANKS = new Map<string, ShowRank>();

/** Flattens every item across a group's sub-groups, in sub-group order - a convenience for tests
 * that don't care about rank splitting, matching the old flat-items shape. */
function allItems(groups: ReturnType<typeof buildShowResultGroups>) {
  return groups.map((g) => g.subgroups.flatMap((sg) => sg.items));
}

describe('buildShowResultGroups', () => {
  it('returns nothing for a horse that has never placed', () => {
    expect(buildShowResultGroups([], GAME_DAYS_PER_YEAR, NO_CURRENT_RANKS)).toEqual([]);
  });

  it('groups conformation results under "Conformation" and each discipline under its own name', () => {
    const groups = buildShowResultGroups(
      [
        row({ scheduled_game_day: 100, placing: 2 }),
        row({ scheduled_game_day: 90, placing: 5, class_type: 'discipline', discipline_name: 'Endurance', class_key: 'disc:endurance' }),
        row({ scheduled_game_day: 80, placing: 3 }),
        row({ scheduled_game_day: 70, placing: 12, class_type: 'discipline', discipline_name: 'Show Jumping', class_key: 'disc:jumping' }),
      ],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Conformation', 'Endurance', 'Show Jumping']);
    const items = allItems(groups);
    expect(items[0]).toEqual(['2nd - red ribbon (April, Year 1)', '3rd - yellow ribbon (March, Year 1)']);
    expect(items[1]).toEqual(['5th - pink ribbon (April, Year 1)']);
  });

  it('orders groups by most recent activity, following the order the rows arrive in', () => {
    const groups = buildShowResultGroups(
      [
        row({ scheduled_game_day: 100, placing: 1, class_type: 'discipline', discipline_name: 'Dressage', class_key: 'disc:dressage' }),
        row({ scheduled_game_day: 90, placing: 4 }),
      ],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Dressage', 'Conformation']);
  });

  it('caps each sub-group separately, so a long career in one discipline cannot crowd out another', () => {
    const rows: HorseResultRow[] = [];
    for (let i = 0; i < SHOW_RESULT_GROUP_CAP + 4; i++) {
      rows.push(row({ scheduled_game_day: 200 - i, placing: 1, class_type: 'discipline', discipline_name: 'Barrel Racing', class_key: 'disc:barrels' }));
    }
    rows.push(row({ scheduled_game_day: 10, placing: 6 }));
    const groups = buildShowResultGroups(rows, GAME_DAYS_PER_YEAR, NO_CURRENT_RANKS);
    expect(groups.map((g) => g.label)).toEqual(['Barrel Racing', 'Conformation']);
    const items = allItems(groups);
    expect(items[0]).toHaveLength(SHOW_RESULT_GROUP_CAP);
    expect(items[1]).toHaveLength(1);
  });

  it('falls back to "Discipline" when a discipline row somehow has no name joined in', () => {
    const groups = buildShowResultGroups(
      [row({ scheduled_game_day: 30, placing: 7, class_type: 'discipline', discipline_name: null, class_key: 'disc:mystery' })],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Discipline']);
  });

  it('never mentions the show name - the class type is what a buyer needs, not a made-up venue', () => {
    const groups = buildShowResultGroups([row({ scheduled_game_day: 100, placing: 2 })], GAME_DAYS_PER_YEAR, NO_CURRENT_RANKS);
    expect(allItems(groups)[0][0]).not.toContain('Stonebrook');
  });

  // Slice 0025 stage 3: young_conformation and ability_test each get their own label, deliberately
  // distinct from the adult "Conformation" group they resemble. Both are 'none'-ranked - stage 4
  // never tracks a rank for either.
  it('groups young_conformation under "Young Horse Conformation", separate from adult Conformation', () => {
    const groups = buildShowResultGroups(
      [row({ scheduled_game_day: 100, placing: 1 }), row({ scheduled_game_day: 90, placing: 2, class_type: 'young_conformation', rank: 'none', class_key: 'yc:1:yearling' })],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Conformation', 'Young Horse Conformation']);
  });

  it('groups ability_test under its own trait name, with "Test" appended', () => {
    const groups = buildShowResultGroups(
      [row({ scheduled_game_day: 100, placing: 1, class_type: 'ability_test', ability_trait_name: 'Speed', rank: 'none', class_key: 'at:speed:yearling' })],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Speed Test']);
  });

  it('falls back to "Ability Test" when an ability_test row somehow has no trait name joined in', () => {
    const groups = buildShowResultGroups(
      [row({ scheduled_game_day: 100, placing: 1, class_type: 'ability_test', ability_trait_name: null, rank: 'none', class_key: 'at:mystery:yearling' })],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups.map((g) => g.label)).toEqual(['Ability Test']);
  });

  // Slice 0026 §3.2/test 7: a horse with placings at two ranks in one discipline produces two
  // sub-groups, ordered novice-first, capped per sub-group.
  it('splits one discipline into rank sub-groups, ordered Novice before Open, each capped separately', () => {
    const rows: HorseResultRow[] = [];
    for (let i = 0; i < SHOW_RESULT_GROUP_CAP + 2; i++) {
      rows.push(row({ scheduled_game_day: 300 - i, placing: 1, class_type: 'discipline', discipline_name: 'Dressage', class_key: 'disc:dressage', rank: 'open' }));
    }
    for (let i = 0; i < SHOW_RESULT_GROUP_CAP + 2; i++) {
      rows.push(row({ scheduled_game_day: 100 - i, placing: 4, class_type: 'discipline', discipline_name: 'Dressage', class_key: 'disc:dressage', rank: 'novice' }));
    }
    const currentRanks = new Map<string, ShowRank>([['disc:dressage', 'open']]);
    const groups = buildShowResultGroups(rows, GAME_DAYS_PER_YEAR, currentRanks);
    expect(groups).toHaveLength(1);
    const [dressage] = groups;
    expect(dressage.subgroups.map((sg) => sg.rank)).toEqual(['novice', 'open']);
    expect(dressage.subgroups[0].items).toHaveLength(SHOW_RESULT_GROUP_CAP);
    expect(dressage.subgroups[1].items).toHaveLength(SHOW_RESULT_GROUP_CAP);
  });

  it('marks the horse\'s own current rank in that class_key as the open sub-group, everything else not current', () => {
    const groups = buildShowResultGroups(
      [
        row({ scheduled_game_day: 100, placing: 1, class_type: 'discipline', discipline_name: 'Dressage', class_key: 'disc:dressage', rank: 'open' }),
        row({ scheduled_game_day: 90, placing: 4, class_type: 'discipline', discipline_name: 'Dressage', class_key: 'disc:dressage', rank: 'novice' }),
      ],
      GAME_DAYS_PER_YEAR,
      new Map([['disc:dressage', 'open']])
    );
    const [dressage] = groups;
    const novice = dressage.subgroups.find((sg) => sg.rank === 'novice')!;
    const open = dressage.subgroups.find((sg) => sg.rank === 'open')!;
    expect(novice.isCurrent).toBe(false);
    expect(open.isCurrent).toBe(true);
  });

  it('a class_key with no current-rank entry defaults to novice, matching horse_class_ranks\' own no-row-means-novice rule', () => {
    const groups = buildShowResultGroups([row({ scheduled_game_day: 100, placing: 1, class_key: 'bc:1', rank: 'novice' })], GAME_DAYS_PER_YEAR, NO_CURRENT_RANKS);
    expect(groups[0].subgroups[0].isCurrent).toBe(true);
  });

  it('a "none"-ranked sub-group (young-horse/ability) is always marked current - it never collapses behind a rank details block', () => {
    const groups = buildShowResultGroups(
      [row({ scheduled_game_day: 100, placing: 1, class_type: 'young_conformation', rank: 'none', class_key: 'yc:1:yearling' })],
      GAME_DAYS_PER_YEAR,
      NO_CURRENT_RANKS
    );
    expect(groups[0].subgroups[0].isCurrent).toBe(true);
  });
});
