import { describe, expect, it } from 'vitest';
import { parseBreedIdParam } from '../../src/routes/shows';
import { classMatchesShowsFilter } from '../../src/db/shows';

// Regression test: the /shows "All" and "Conformation" tabs were showing "No open classes match
// this filter right now" for every show, even ones with entries, because a missing/empty `breed`
// query param parsed to breed id 0 instead of "no filter" - `Number(null)` and `Number('')` both
// evaluate to 0 in JS, and 0 is never a real breed_id (breed_id starts at 1, and a discipline
// class's breed_id is NULL), so every class silently failed the breed check.
describe('parseBreedIdParam', () => {
  it('reads a missing breed param as no filter (null), not id 0', () => {
    expect(parseBreedIdParam(null)).toBeNull();
  });

  it('reads an empty breed param (the "All breeds" option) as no filter (null), not id 0', () => {
    expect(parseBreedIdParam('')).toBeNull();
  });

  it('reads a real breed id straight through', () => {
    expect(parseBreedIdParam('1')).toBe(1);
  });

  it('reads a non-numeric param as no filter', () => {
    expect(parseBreedIdParam('not-a-number')).toBeNull();
  });
});

describe('classMatchesShowsFilter with a missing breed param', () => {
  it('the "all" tab with no breed filter matches a breed_conformation class', () => {
    const cls = { class_type: 'breed_conformation' as const, discipline_code: null, breed_id: 1 };
    expect(classMatchesShowsFilter(cls, { classType: 'all', breedId: parseBreedIdParam(null) })).toBe(true);
  });

  it('the "all" tab with no breed filter matches a discipline class (breed_id is NULL)', () => {
    const cls = { class_type: 'discipline' as const, discipline_code: 'barrel_racing', breed_id: null };
    expect(classMatchesShowsFilter(cls, { classType: 'all', breedId: parseBreedIdParam(null) })).toBe(true);
  });

  it('the "conformation" tab with no breed filter matches any breed_conformation class', () => {
    const cls = { class_type: 'breed_conformation' as const, discipline_code: null, breed_id: 2 };
    expect(classMatchesShowsFilter(cls, { classType: 'conformation', breedId: parseBreedIdParam(null) })).toBe(true);
  });

  it('a real breed filter still excludes a different breed', () => {
    const cls = { class_type: 'breed_conformation' as const, discipline_code: null, breed_id: 2 };
    expect(classMatchesShowsFilter(cls, { classType: 'all', breedId: parseBreedIdParam('1') })).toBe(false);
  });
});
