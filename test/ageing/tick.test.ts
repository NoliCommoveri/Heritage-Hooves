import { describe, expect, it } from 'vitest';

/**
 * Pure models of the tick's SQL predicates (src/db/ageing.ts's killDueOldHorses, noticeFrailty,
 * and the cancellation guards added to src/db/coverings.ts/src/db/pregnancies.ts), the same
 * approach test/health/lethal.test.ts uses for killDueLethalFoals: this codebase has no D1 mock, so
 * these models pin down the logic itself, independent of the database.
 */

interface FakeHorse {
  id: number;
  status: 'alive' | 'dead';
  naturalDeathGameDay: number | null;
  frailtyNoticeGameDay: number | null;
}

function isDueForOldAgeDeath(h: FakeHorse, gameDay: number): boolean {
  return h.status === 'alive' && h.naturalDeathGameDay !== null && h.naturalDeathGameDay <= gameDay;
}

describe('the old-age death predicate, run twice against the same game day', () => {
  it('selects a due horse once - the second run finds it already dead', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: 130, frailtyNoticeGameDay: null };
    expect(isDueForOldAgeDeath(horse, 130)).toBe(true);
    horse.status = 'dead'; // what killDueOldHorses' UPDATE ... WHERE status = 'alive' does
    expect(isDueForOldAgeDeath(horse, 130)).toBe(false);
  });

  it('a missed tick still catches up - the comparison is <=, not ===', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: 130, frailtyNoticeGameDay: null };
    expect(isDueForOldAgeDeath(horse, 150)).toBe(true);
  });

  it('a horse not yet due is left alone', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: 130, frailtyNoticeGameDay: null };
    expect(isDueForOldAgeDeath(horse, 129)).toBe(false);
  });

  it('a horse with no lifespan assigned yet is never selected', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: null, frailtyNoticeGameDay: null };
    expect(isDueForOldAgeDeath(horse, 999999)).toBe(false);
  });
});

function isDueForFrailtyNotice(h: FakeHorse, gameDay: number, frailtyWindowGameDays: number): boolean {
  return h.status === 'alive' && h.frailtyNoticeGameDay === null && h.naturalDeathGameDay !== null && h.naturalDeathGameDay - gameDay <= frailtyWindowGameDays;
}

describe('the frailty-notice predicate', () => {
  it('fires once per horse - running the stage again writes no second event', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: 1000, frailtyNoticeGameDay: null };
    const gameDay = 1000 - 540;
    expect(isDueForFrailtyNotice(horse, gameDay, 540)).toBe(true);
    horse.frailtyNoticeGameDay = gameDay; // what noticeFrailty's UPDATE ... WHERE frailty_notice_game_day IS NULL does
    expect(isDueForFrailtyNotice(horse, gameDay, 540)).toBe(false);
    expect(isDueForFrailtyNotice(horse, gameDay + 10, 540)).toBe(false);
  });

  it('a horse whose window has already passed when this first runs still gets its notice - <=, not ===', () => {
    const horse: FakeHorse = { id: 1, status: 'alive', naturalDeathGameDay: 1000, frailtyNoticeGameDay: null };
    expect(isDueForFrailtyNotice(horse, 990, 540)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ordering: foalDuePregnancies before killDueOldHorses (§7.5). This models both effects that make
// the order matter - foaling only happens to a not-yet-cancelled pregnancy, and killing a dam
// cancels her still-in-progress pregnancy - so the test demonstrates the failure mode the wrong
// order would produce, not just the happy path.
// ---------------------------------------------------------------------------

interface FakePregnancy {
  damId: number;
  status: 'in_progress' | 'foaled';
  dueGameDay: number;
  cancelledGameDay: number | null;
  foalBorn: boolean;
}

function foalDuePregnancies(pregnancies: FakePregnancy[], gameDay: number): FakePregnancy[] {
  return pregnancies.map((p) => (p.status === 'in_progress' && p.cancelledGameDay === null && p.dueGameDay <= gameDay ? { ...p, status: 'foaled', foalBorn: true } : p));
}

function killDueOldHorsesAndCancelPregnancies(horses: FakeHorse[], pregnancies: FakePregnancy[], gameDay: number): { horses: FakeHorse[]; pregnancies: FakePregnancy[] } {
  const newHorses = horses.map((h) => (isDueForOldAgeDeath(h, gameDay) ? { ...h, status: 'dead' as const } : h));
  const diedIds = new Set(newHorses.filter((h, i) => h.status === 'dead' && horses[i].status === 'alive').map((h) => h.id));
  const newPregnancies = pregnancies.map((p) =>
    diedIds.has(p.damId) && p.status === 'in_progress' && p.cancelledGameDay === null ? { ...p, cancelledGameDay: gameDay } : p
  );
  return { horses: newHorses, pregnancies: newPregnancies };
}

describe('tick order: foalDuePregnancies before killDueOldHorses', () => {
  it('a mare due to foal and due to die on the same tick foals first, and the foal is alive afterwards', () => {
    const horses: FakeHorse[] = [{ id: 1, status: 'alive', naturalDeathGameDay: 100, frailtyNoticeGameDay: null }];
    let pregnancies: FakePregnancy[] = [{ damId: 1, status: 'in_progress', dueGameDay: 100, cancelledGameDay: null, foalBorn: false }];

    pregnancies = foalDuePregnancies(pregnancies, 100);
    const afterDeath = killDueOldHorsesAndCancelPregnancies(horses, pregnancies, 100);

    expect(pregnancies[0].foalBorn).toBe(true);
    expect(afterDeath.pregnancies[0].status).toBe('foaled');
    // Already 'foaled' by the time the death stage runs, so the cancellation guard (WHERE
    // status = 'in_progress') never touches it - the foal that already exists is unaffected.
    expect(afterDeath.pregnancies[0].cancelledGameDay).toBeNull();
    expect(afterDeath.horses[0].status).toBe('dead');
  });

  it('the reverse order would have cancelled the pregnancy before it could foal - this is why the order in db/tick.ts matters', () => {
    const horses: FakeHorse[] = [{ id: 1, status: 'alive', naturalDeathGameDay: 100, frailtyNoticeGameDay: null }];
    const pregnancies: FakePregnancy[] = [{ damId: 1, status: 'in_progress', dueGameDay: 100, cancelledGameDay: null, foalBorn: false }];

    const killedFirst = killDueOldHorsesAndCancelPregnancies(horses, pregnancies, 100);
    const afterFoalStage = foalDuePregnancies(killedFirst.pregnancies, 100);

    expect(killedFirst.pregnancies[0].cancelledGameDay).toBe(100);
    expect(afterFoalStage[0].foalBorn).toBe(false);
    expect(afterFoalStage[0].status).toBe('in_progress');
  });

  it("a dead mare's in-progress pregnancy does not foal on a later tick either", () => {
    const horses: FakeHorse[] = [{ id: 1, status: 'alive', naturalDeathGameDay: 100, frailtyNoticeGameDay: null }];
    const pregnancies: FakePregnancy[] = [{ damId: 1, status: 'in_progress', dueGameDay: 150, cancelledGameDay: null, foalBorn: false }];

    // The mare dies at 100, before her pregnancy (due at 150) would otherwise foal.
    const afterDeath = killDueOldHorsesAndCancelPregnancies(horses, pregnancies, 100);
    const atDueDay = foalDuePregnancies(afterDeath.pregnancies, 150);

    expect(afterDeath.pregnancies[0].cancelledGameDay).toBe(100);
    expect(atDueDay[0].foalBorn).toBe(false);
    expect(atDueDay[0].status).toBe('in_progress');
  });
});

// ---------------------------------------------------------------------------
// A cancelled covering does not resolve (src/db/coverings.ts's resolveDueCoverings, "AND
// cancelled_game_day IS NULL" added by migrations/0059_breeding_cancellation.sql).
// ---------------------------------------------------------------------------

interface FakeCovering {
  status: 'booked' | 'resolved_conceived' | 'resolved_failed';
  cancelledGameDay: number | null;
  cycleAnchorTickSeq: number | null;
}

function isDueForResolution(c: FakeCovering, tickSeq: number, cycleTicks: number, estrusTicks: number): boolean {
  if (c.status !== 'booked' || c.cancelledGameDay !== null || c.cycleAnchorTickSeq === null) return false;
  return (tickSeq - c.cycleAnchorTickSeq) % cycleTicks < estrusTicks;
}

describe('a cancelled covering does not resolve', () => {
  it('an uncancelled, in-season covering is due', () => {
    const covering: FakeCovering = { status: 'booked', cancelledGameDay: null, cycleAnchorTickSeq: 10 };
    expect(isDueForResolution(covering, 10, 4, 1)).toBe(true);
  });

  it('the same covering, cancelled, is never due again - even in season', () => {
    const covering: FakeCovering = { status: 'booked', cancelledGameDay: 5, cycleAnchorTickSeq: 10 };
    expect(isDueForResolution(covering, 10, 4, 1)).toBe(false);
  });
});
