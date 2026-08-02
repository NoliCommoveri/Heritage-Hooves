import { describe, expect, it } from 'vitest';
import { cancelledReasonFor } from '../../src/db/ageing';

/**
 * This codebase has no D1 mock (test/health/lethal.test.ts's own comment explains why), so the
 * database-touching halves of removal - the actual UPDATE/DELETE statements, the ownership check on
 * the route, and the turn-spend check - are verified by hand against a live wrangler dev per §11,
 * the same as every other tick stage and route in this codebase. What follows is what can be
 * checked in isolation: the pure mapping buildEndHorseParticipationStatements delegates to
 * (cancelledReasonFor), and pure models of the two predicates the shared exit path and the
 * show-entry withdrawal rely on.
 */

describe('cancelledReasonFor', () => {
  it('a mare that dies is dam_died', () => {
    expect(cancelledReasonFor('mare', 'dead')).toBe('dam_died');
  });
  it('a mare that is retired away is dam_removed', () => {
    expect(cancelledReasonFor('mare', 'removed')).toBe('dam_removed');
  });
  it('a stallion that dies is sire_died', () => {
    expect(cancelledReasonFor('stallion', 'dead')).toBe('sire_died');
  });
  it('a stallion that is retired away is sire_removed', () => {
    expect(cancelledReasonFor('stallion', 'removed')).toBe('sire_removed');
  });
});

// ---------------------------------------------------------------------------
// Retiring a pregnant mare cancels the pregnancy, and the tick then produces no foal - the same
// cancellation guard test/ageing/tick.test.ts models for old-age death, since
// buildEndHorseParticipationStatements is the one function both callers share (§6.5) and the
// cancellation UPDATE does not care whether status was set to 'dead' or 'removed'.
// ---------------------------------------------------------------------------

interface FakePregnancy {
  status: 'in_progress' | 'foaled';
  cancelledGameDay: number | null;
  dueGameDay: number;
}

function cancelIfLive(p: FakePregnancy, gameDay: number): FakePregnancy {
  return p.status === 'in_progress' && p.cancelledGameDay === null ? { ...p, cancelledGameDay: gameDay } : p;
}

function foalIfDue(p: FakePregnancy, gameDay: number): FakePregnancy {
  return p.status === 'in_progress' && p.cancelledGameDay === null && p.dueGameDay <= gameDay ? { ...p, status: 'foaled' } : p;
}

describe('retiring a pregnant mare away', () => {
  it('cancels her in-progress pregnancy, and the tick then produces no foal', () => {
    let pregnancy: FakePregnancy = { status: 'in_progress', cancelledGameDay: null, dueGameDay: 200 };
    pregnancy = cancelIfLive(pregnancy, 100); // the retire-away route's own batch
    expect(pregnancy.cancelledGameDay).toBe(100);

    pregnancy = foalIfDue(pregnancy, 200); // the next tick that reaches her due day
    expect(pregnancy.status).toBe('in_progress'); // never foals
  });
});

// ---------------------------------------------------------------------------
// Withdrawing future show entries (§7.4): a judged class is history and stays; only an unjudged
// one is withdrawn. Identified by the class's own status column, not by comparing dates.
// ---------------------------------------------------------------------------

interface FakeShowClass {
  id: number;
  status: 'scheduled' | 'judged';
}

interface FakeEntry {
  classId: number;
}

function withdrawFromUnjudgedClasses(entries: FakeEntry[], classesById: Map<number, FakeShowClass>): FakeEntry[] {
  return entries.filter((e) => classesById.get(e.classId)?.status !== 'scheduled');
}

describe('withdrawing a retired-away or dead horse\'s show entries', () => {
  it('removes the entry in an unjudged (scheduled) class', () => {
    const classes = new Map<number, FakeShowClass>([[1, { id: 1, status: 'scheduled' }]]);
    const remaining = withdrawFromUnjudgedClasses([{ classId: 1 }], classes);
    expect(remaining).toHaveLength(0);
  });

  it('leaves an entry in an already-judged class untouched - deleting it would falsify that show\'s history', () => {
    const classes = new Map<number, FakeShowClass>([[1, { id: 1, status: 'judged' }]]);
    const remaining = withdrawFromUnjudgedClasses([{ classId: 1 }], classes);
    expect(remaining).toHaveLength(1);
  });

  it('handles a horse entered in both an unjudged and an already-judged class: only the unjudged one goes', () => {
    const classes = new Map<number, FakeShowClass>([
      [1, { id: 1, status: 'scheduled' }],
      [2, { id: 2, status: 'judged' }],
    ]);
    const remaining = withdrawFromUnjudgedClasses(
      [{ classId: 1 }, { classId: 2 }],
      classes
    );
    expect(remaining).toEqual([{ classId: 2 }]);
  });
});
