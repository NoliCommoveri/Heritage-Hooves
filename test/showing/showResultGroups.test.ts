import { describe, expect, it } from 'vitest';
import { buildShowResultGroups, SHOW_RESULT_GROUP_CAP } from '../../src/render/shows';
import type { HorseResultRow } from '../../src/db/shows';

// The Show record card's grouping, shared by the owner's own horse page, a sale listing, a stud
// listing and /world - so a horse you are thinking of buying reads exactly the way one of your own
// does. Before this was factored out, the three non-owner screens showed a single flat list of five
// placings with the (fictional, uninformative) show name attached and no class type at all.

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
    final_score: 100,
    ...overrides,
  };
}

const GAME_DAYS_PER_YEAR = 360;

describe('buildShowResultGroups', () => {
  it('returns nothing for a horse that has never placed', () => {
    expect(buildShowResultGroups([], GAME_DAYS_PER_YEAR)).toEqual([]);
  });

  it('groups conformation results under "Conformation" and each discipline under its own name', () => {
    const groups = buildShowResultGroups(
      [
        row({ scheduled_game_day: 100, placing: 2 }),
        row({ scheduled_game_day: 90, placing: 5, class_type: 'discipline', discipline_name: 'Endurance' }),
        row({ scheduled_game_day: 80, placing: 3 }),
        row({ scheduled_game_day: 70, placing: 12, class_type: 'discipline', discipline_name: 'Show Jumping' }),
      ],
      GAME_DAYS_PER_YEAR
    );
    expect(groups.map((g) => g.label)).toEqual(['Conformation', 'Endurance', 'Show Jumping']);
    expect(groups[0].items).toEqual(['2nd - red ribbon (April, Year 1)', '3rd - yellow ribbon (March, Year 1)']);
    expect(groups[1].items).toEqual(['5th - pink ribbon (April, Year 1)']);
  });

  it('orders groups by most recent activity, following the order the rows arrive in', () => {
    const groups = buildShowResultGroups(
      [
        row({ scheduled_game_day: 100, placing: 1, class_type: 'discipline', discipline_name: 'Dressage' }),
        row({ scheduled_game_day: 90, placing: 4 }),
      ],
      GAME_DAYS_PER_YEAR
    );
    expect(groups.map((g) => g.label)).toEqual(['Dressage', 'Conformation']);
  });

  it('caps each group separately, so a long career in one discipline cannot crowd out another', () => {
    const rows: HorseResultRow[] = [];
    for (let i = 0; i < SHOW_RESULT_GROUP_CAP + 4; i++) {
      rows.push(row({ scheduled_game_day: 200 - i, placing: 1, class_type: 'discipline', discipline_name: 'Barrel Racing' }));
    }
    rows.push(row({ scheduled_game_day: 10, placing: 6 }));
    const groups = buildShowResultGroups(rows, GAME_DAYS_PER_YEAR);
    expect(groups.map((g) => g.label)).toEqual(['Barrel Racing', 'Conformation']);
    expect(groups[0].items).toHaveLength(SHOW_RESULT_GROUP_CAP);
    expect(groups[1].items).toHaveLength(1);
  });

  it('falls back to "Discipline" when a discipline row somehow has no name joined in', () => {
    const groups = buildShowResultGroups([row({ scheduled_game_day: 30, placing: 7, class_type: 'discipline', discipline_name: null })], GAME_DAYS_PER_YEAR);
    expect(groups.map((g) => g.label)).toEqual(['Discipline']);
  });

  it('never mentions the show name - the class type is what a buyer needs, not a made-up venue', () => {
    const groups = buildShowResultGroups([row({ scheduled_game_day: 100, placing: 2 })], GAME_DAYS_PER_YEAR);
    expect(groups[0].items[0]).not.toContain('Stonebrook');
  });
});
