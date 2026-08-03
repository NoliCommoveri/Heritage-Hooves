import { describe, expect, it } from 'vitest';
import { buildSaleStatements, commissionFor, type ListingRow } from '../../src/db/listings';
import type { Env } from '../../src/types';

// Slice 0017 §14 tests 4-6, at the level this repo's test harness can actually reach.
//
// `npm test` is plain vitest with no D1 binding - every other test in this suite is a pure
// function. Rather than skip §14's sale tests entirely, the sale is built as a statement-*building*
// function (buildSaleStatements, the same shape buildLedgerStatements and
// buildEndHorseParticipationStatements already use) and exercised here against a stub env that
// records the SQL and the bound values. That genuinely covers "does a sale write the right
// statements with the right numbers".
//
// What it deliberately does NOT cover, because a stub can only fake it: §14.7 (the second buyer
// losing gracefully, which rests on meta.changes from a guarded UPDATE), §14.8 (the partial unique
// index rejecting a second open listing) and §14.9/§14.10 (expireListings' idempotency and the dead
// horse's listing). Those are database behaviour, and they are steps 4, 7 and 8 of the slice's own
// §15 hand-verification list.

interface RecordedStatement {
  sql: string;
  values: unknown[];
}

function stubEnv(): { env: Env; statements: RecordedStatement[] } {
  const statements: RecordedStatement[] = [];
  const prepare = (sql: string) => {
    const record: RecordedStatement = { sql, values: [] };
    statements.push(record);
    const stmt = {
      bind: (...values: unknown[]) => {
        record.values = values;
        return stmt;
      },
    };
    return stmt;
  };
  return { env: { DB: { prepare } } as unknown as Env, statements };
}

const LISTING: ListingRow = {
  id: 7,
  horse_id: 42,
  seller_stable_id: 1,
  price: 4000,
  guide_value: 3800,
  listed_game_day: 1000,
  expires_game_day: 1090,
  status: 'open',
  buyer_stable_id: null,
  sold_game_day: null,
  commission_paid: null,
  closed_game_day: null,
  created_real_ts: 0,
};

function saleStatements(overrides: { sameAccount?: boolean; commission?: number } = {}) {
  const { env, statements } = stubEnv();
  buildSaleStatements(env, {
    listing: LISTING,
    horseName: 'Copper Penny',
    buyerStableId: 2,
    buyerStableName: 'Willow Creek Barrels',
    buyerAccountId: 5,
    sellerStableId: 1,
    sellerStableName: 'Cedar Hollow',
    sellerAccountId: overrides.sameAccount ? 5 : 9,
    gameDay: 1050,
    commissionPercent: 5,
    commission: overrides.commission ?? commissionFor(LISTING.price, 5),
    sameAccount: overrides.sameAccount ?? false,
  });
  return statements;
}

const ledgerInserts = (statements: RecordedStatement[]) => statements.filter((s) => s.sql.includes('INSERT INTO ledger'));
const matching = (statements: RecordedStatement[], fragment: string) => statements.filter((s) => s.sql.includes(fragment));

describe('commission is integer arithmetic (§14.4)', () => {
  it('floors rather than rounding - 5% of 999 is 49, not 49.95 and not 50', () => {
    expect(commissionFor(999, 5)).toBe(49);
  });

  it('is always a whole number for any price and rate', () => {
    for (const price of [1, 7, 333, 999, 4001, 123457]) {
      for (const pct of [0, 3, 5, 12, 100]) {
        expect(Number.isInteger(commissionFor(price, pct))).toBe(true);
      }
    }
  });

  it('takes nothing at all at a rate of zero', () => {
    expect(commissionFor(4000, 0)).toBe(0);
  });

  it("the seller's two ledger rows sum to price minus commission", () => {
    const rows = ledgerInserts(saleStatements());
    // ledger insert bindings: (stable_id, amount, kind, ...)
    const sellerRows = rows.filter((r) => r.values[0] === 1);
    const total = sellerRows.reduce((sum, r) => sum + (r.values[1] as number), 0);
    expect(total).toBe(4000 - commissionFor(4000, 5));
  });
});

describe('the sale batch moves everything (§14.5)', () => {
  it('sells the listing and moves the horse, in that order - sellListing reads meta.changes by index', () => {
    const statements = saleStatements();
    expect(statements[0].sql).toContain('UPDATE listings');
    expect(statements[0].sql).toContain("'sold'");
    expect(statements[1].sql).toContain('UPDATE horses');
    expect(statements[1].sql).toContain('owner_stable_id');
  });

  it('clears the barn name on transfer and leaves the registered name alone', () => {
    const horseUpdate = saleStatements()[1];
    expect(horseUpdate.sql).toContain('barn_name = NULL');
    expect(horseUpdate.sql).not.toContain('registered_name');
  });

  /**
   * The guard is an assignment into a NOT NULL column, not a WHERE clause - see
   * buildSaleStatements' own comment. A WHERE clause that matches nothing is not an error, so the
   * batch would carry on and charge a losing second buyer in full; a NULL assignment raises and
   * rolls the whole transaction back. test/market/sale-d1.test.ts proves the behaviour against a
   * real database; this asserts the shape, so a refactor back to a plain WHERE fails here too.
   */
  it('trips a NOT NULL constraint rather than silently matching zero rows (§7.3)', () => {
    const statements = saleStatements();
    expect(statements[0].sql).toContain("CASE WHEN status = 'open' THEN 'sold' ELSE NULL END");
    expect(statements[1].sql).toContain("CASE WHEN status = 'alive' AND owner_stable_id = ? THEN ? ELSE NULL END");
  });

  it('writes three ledger rows: the buyer pays, the seller receives, the seller pays commission', () => {
    const rows = ledgerInserts(saleStatements());
    expect(rows).toHaveLength(3);
    const byKind = new Map(rows.map((r) => [r.values[2] as string, r]));
    expect(byKind.get('purchase')?.values[1]).toBe(-4000);
    expect(byKind.get('sale')?.values[1]).toBe(4000);
    expect(byKind.get('commission')?.values[1]).toBe(-200);
  });

  it('sets counterparty_stable_id on both sides of the trade, and leaves it null on the commission', () => {
    const rows = ledgerInserts(saleStatements());
    const byKind = new Map(rows.map((r) => [r.values[2] as string, r]));
    // ledger insert bindings end: (..., created_real_ts, counterparty_stable_id, same_account)
    const counterparty = (r: RecordedStatement | undefined) => r?.values[r.values.length - 2];
    expect(counterparty(byKind.get('purchase'))).toBe(1); // the seller
    expect(counterparty(byKind.get('sale'))).toBe(2); // the buyer
    expect(counterparty(byKind.get('commission'))).toBe(null); // paid to the market, not a stable
  });

  it('copies the knowledge rows to the buyer rather than reassigning them', () => {
    const copy = matching(saleStatements(), 'horse_knowledge')[0];
    expect(copy.sql).toContain('INSERT OR IGNORE INTO horse_knowledge');
    expect(copy.sql).toContain('FROM horse_knowledge WHERE stable_id = ?');
    expect(copy.sql).not.toContain('UPDATE horse_knowledge');
    // (buyer, seller, horse) - and cost_paid is the literal 0 in the SELECT: the buyer paid nothing.
    expect(copy.values).toEqual([2, 1, 42]);
  });

  it('moves an unresolved covering and an unjudged entry to the buyer', () => {
    const statements = saleStatements();
    const covering = matching(statements, 'UPDATE coverings')[0];
    expect(covering.sql).toContain("status = 'booked'");
    expect(covering.values).toEqual([2, 42]);
    const entry = matching(statements, 'UPDATE show_entries')[0];
    expect(entry.sql).toContain('placing IS NULL');
    expect(entry.values).toEqual([2, 42]);
  });

  it('writes one event, for the seller - the buyer was there', () => {
    const events = matching(saleStatements(), 'INSERT INTO events');
    expect(events).toHaveLength(1);
    expect(events[0].values[0]).toBe(1); // the seller's stable
    expect(JSON.parse(events[0].values[4] as string)).toMatchObject({
      horse_name: 'Copper Penny',
      price: 4000,
      buyer_stable_name: 'Willow Creek Barrels',
    });
  });

  it('writes nothing at all for a pregnancy - the foal follows the mare with no code', () => {
    const statements = saleStatements();
    expect(matching(statements, 'pregnancies')).toHaveLength(0);
  });
});

describe('same_account is the whole of §2.2 defence (§14.6)', () => {
  const sameAccountFlag = (r: RecordedStatement) => r.values[r.values.length - 1];

  it('is 1 on every ledger row when two stables under one account trade', () => {
    const rows = ledgerInserts(saleStatements({ sameAccount: true }));
    expect(rows.map(sameAccountFlag)).toEqual([1, 1, 1]);
  });

  it('is 0 on every ledger row when the two accounts differ', () => {
    const rows = ledgerInserts(saleStatements({ sameAccount: false }));
    expect(rows.map(sameAccountFlag)).toEqual([0, 0, 0]);
  });
});
