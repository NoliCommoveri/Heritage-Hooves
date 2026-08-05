/**
 * Slice 0017 §14 tests 5, 7, 8, 9 and 10 - the ones that need a real database.
 *
 * Every other test in this repo is a pure function, because `npm test` is plain vitest with no D1
 * binding and adding one (@cloudflare/vitest-pool-workers) means a dependency and a wrangler-config
 * change on a repo where a broken deploy is unfixable for the operator. This file takes the cheaper
 * route: it applies the real migration files to an in-memory SQLite database via **node:sqlite,
 * which is built into Node and is not a dependency**, and puts a ~30-line shim in front of it that
 * looks enough like D1 (prepare/bind/run/all/first/batch, with batch as one transaction) to run the
 * real functions from src/db/listings.ts unmodified.
 *
 * **This is not a substitute for D1 and should not be treated as one.** It shares SQLite's engine,
 * so constraints, indexes, transactions and `changes` behave the same; it does not share D1's
 * client, its error message wording, or its concurrency. What it is genuinely good for is what it
 * was written for: it caught a real bug on its first run (a losing second buyer's guarded UPDATEs
 * matched zero rows, and the batch cheerfully carried on to charge them in full - see
 * buildSaleStatements' comment on the trip-wire that now prevents it).
 *
 * node:sqlite is marked experimental and needs Node 22+, so the whole suite skips rather than fails
 * where it is unavailable. If you are looking at a skipped run and want these back, upgrade Node.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { buildSaleStatements, commissionFor, expireListings, createListing, sellListing, type ListingRow } from '../../src/db/listings';
import type { Env } from '../../src/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DatabaseSync = any;

const DatabaseSyncCtor: (new (p: string) => DatabaseSync) | null = (() => {
  try {
    return (createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string) => DatabaseSync }).DatabaseSync;
  } catch {
    return null;
  }
})();

const describeWithSqlite = DatabaseSyncCtor ? describe : describe.skip;

interface Stmt {
  sql: string;
  args: unknown[];
}

function makeEnv(db: DatabaseSync): Env {
  const run = (s: Stmt) => {
    const r = db.prepare(s.sql).run(...(s.args as never[]));
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  const mk = (sql: string, args: unknown[] = []): Record<string, unknown> => ({
    sql,
    args,
    bind: (...a: unknown[]) => mk(sql, a),
    run: () => run({ sql, args }),
    all: () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    first: () => db.prepare(sql).get(...(args as never[])) ?? null,
  });
  return {
    DB: {
      prepare: (sql: string) => mk(sql),
      batch: (statements: { sql: string; args: unknown[] }[]) => {
        db.exec('BEGIN');
        try {
          const out = statements.map((s) => (/^\s*(select)/i.test(s.sql) ? { results: db.prepare(s.sql).all(...(s.args as never[])), meta: { changes: 0 } } : run(s)));
          db.exec('COMMIT');
          return Promise.resolve(out);
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
  } as unknown as Env;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSyncCtor!(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = path.join(process.cwd(), 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of splitSqlStatements(fs.readFileSync(path.join(dir, f), 'utf8'))) db.exec(stmt);
  }
  return db;
}

// The migrations seed eleven NPC stables (ids 1-9 across three breeds' personalities, slice 0023,
// the amendment 0017a consignment dealer at 10, and migration 0168's second German Warmblood
// discipline barn at 11), so the two player stables below are 12 and 13.
const SELLER = 12;
const BUYER = 13;

function seed(db: DatabaseSync, opts: { sameAccount?: boolean } = {}) {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0), ('b','B','x',0,1,0,0)`);
  const sellerAccount = 1;
  const buyerAccount = opts.sameAccount ? 1 : 2;
  db.exec(`INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (${sellerAccount},'Cedar Hollow','CH',0,1,0,10000,20,0,0,1), (${buyerAccount},'Willow Creek','WC',0,1,0,10000,20,0,0,1)`);
  db.exec(`INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
           VALUES ('mare','CH Copper Penny','CH',1,0,'{"QH":1}',0,0,${SELLER},0,'alive',0,'{"v":1,"mendelian":{},"polygenic":{}}',1),
                  ('stallion','CH Sire','CH',1,0,'{"QH":1}',0,0,${SELLER},0,'alive',0,'{"v":1,"mendelian":{},"polygenic":{}}',2)`);
  db.exec(`INSERT INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, cost_paid) VALUES (${SELLER},1,'genotype','HYPP','carrier',900,150)`);
  db.exec(`INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts) VALUES (${SELLER},1,2,1000,10,'booked',5,0)`);
  db.exec(`INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts) VALUES ('Spring','local','Ring',1200,1190,'entries_open',1,1000,0)`);
  db.exec(`INSERT INTO show_classes (show_id, name, class_type, breed_id, class_key, ideal_vector, judge_id, crosses_eligible, min_age_game_days, status, noise_sd, ideal_falloff, target_field_size, max_entries_per_stable, prize_schedule, rng_seed) VALUES (1,'QH Conformation','breed_conformation',1,'bc:1','{"v":1,"traits":{}}',1,0,1080,'scheduled',3,2,8,2,'[100,50]',7)`);
  db.exec(`INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (1,1,${SELLER},0,1000,'{}')`);
  db.exec(`INSERT INTO ledger (stable_id, amount, kind, description, game_day, created_real_ts) VALUES (${SELLER},10000,'opening','Starting balance.',0,0), (${BUYER},10000,'opening','Starting balance.',0,0)`);
}

const LISTING = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: 1, horse_id: 1, seller_stable_id: SELLER, price: 4000, guide_value: 3800, listed_game_day: 1000,
  expires_game_day: 1090, status: 'open', buyer_stable_id: null, sold_game_day: null,
  commission_paid: null, closed_game_day: null, created_real_ts: 0, ...over,
});

const saleParams = (sameAccount: boolean) => ({
  listing: LISTING(), horseName: 'CH Copper Penny', buyerStableId: BUYER, buyerStableName: 'Willow Creek',
  buyerAccountId: sameAccount ? 1 : 2, sellerStableId: SELLER, sellerStableName: 'Cedar Hollow',
  sellerAccountId: 1, gameDay: 1050, commissionPercent: 5,
});

describeWithSqlite('the sale batch, against a real database (§14.5)', () => {
  it('moves everything and leaves both balances equal to the sum of their own ledger rows', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,3800,1000,1090,'open',0)`);

    const result = await sellListing(env, saleParams(false));
    expect(result.ok).toBe(true);

    const horse = db.prepare('SELECT * FROM horses WHERE id = 1').get() as Record<string, unknown>;
    expect(horse.owner_stable_id).toBe(BUYER);
    expect(horse.barn_name).toBe(null);
    expect(horse.registered_name).toBe('CH Copper Penny');

    // Knowledge copied to the buyer AND still held by the seller.
    const knowledge = db.prepare('SELECT stable_id, cost_paid FROM horse_knowledge WHERE horse_id = 1 ORDER BY stable_id').all() as { stable_id: number; cost_paid: number }[];
    expect(knowledge.map((k) => k.stable_id)).toEqual([SELLER, BUYER]);
    expect(knowledge.find((k) => k.stable_id === SELLER)!.cost_paid).toBe(150);
    expect(knowledge.find((k) => k.stable_id === BUYER)!.cost_paid).toBe(0);

    expect((db.prepare('SELECT stable_id FROM coverings WHERE id = 1').get() as { stable_id: number }).stable_id).toBe(BUYER);
    expect((db.prepare('SELECT entered_by_stable_id FROM show_entries WHERE id = 1').get() as { entered_by_stable_id: number }).entered_by_stable_id).toBe(BUYER);

    const rows = db.prepare(`SELECT stable_id, amount, kind, counterparty_stable_id, same_account FROM ledger WHERE kind IN ('sale','purchase','commission') ORDER BY id`).all() as Record<string, number>[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.same_account)).toEqual([0, 0, 0]);

    for (const stableId of [SELLER, BUYER]) {
      const balance = (db.prepare('SELECT balance FROM stables WHERE id = ?').get(stableId) as { balance: number }).balance;
      const sum = (db.prepare('SELECT SUM(amount) AS s FROM ledger WHERE stable_id = ?').get(stableId) as { s: number }).s;
      expect(balance).toBe(sum);
    }
    expect((db.prepare('SELECT balance FROM stables WHERE id = ?').get(SELLER) as { balance: number }).balance).toBe(10000 + 4000 - 200);
    expect((db.prepare('SELECT balance FROM stables WHERE id = ?').get(BUYER) as { balance: number }).balance).toBe(10000 - 4000);

    const events = db.prepare(`SELECT stable_id, kind FROM events`).all() as { stable_id: number; kind: string }[];
    expect(events).toEqual([{ stable_id: SELLER, kind: 'horse_sold' }]);
  });

  it('sets same_account when two stables under one account trade (§14.6)', async () => {
    const db = freshDb();
    seed(db, { sameAccount: true });
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,3800,1000,1090,'open',0)`);
    await sellListing(env, saleParams(true));
    const flags = (db.prepare(`SELECT same_account FROM ledger WHERE kind IN ('sale','purchase','commission')`).all() as { same_account: number }[]).map((r) => r.same_account);
    expect(flags).toEqual([1, 1, 1]);
  });
});

describeWithSqlite('the second buyer loses gracefully (§14.7)', () => {
  it('changes nothing and writes no second ledger row', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,3800,1000,1090,'open',0)`);
    expect((await sellListing(env, saleParams(false))).ok).toBe(true);
    const second = await sellListing(env, saleParams(false));
    expect(second).toEqual({ ok: false, error: 'gone' });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE kind IN ('sale','purchase','commission')`).get() as { n: number }).n).toBe(3);
    expect((db.prepare('SELECT balance FROM stables WHERE id = ?').get(BUYER) as { balance: number }).balance).toBe(6000);
  });
});

describeWithSqlite('a horse cannot be listed twice (§14.8)', () => {
  it('the partial unique index rejects the second open listing', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const params = { horseId: 1, sellerStableId: SELLER, price: 4000, guideValue: 3800, gameDay: 1000, listingGameDays: 90 };
    expect((await createListing(env, params)).ok).toBe(true);
    expect(await createListing(env, params)).toEqual({ ok: false, error: 'already_listed' });
    // ...but a withdrawn one does not block a fresh listing.
    db.exec(`UPDATE listings SET status = 'withdrawn', closed_game_day = 1010 WHERE id = 1`);
    expect((await createListing(env, params)).ok).toBe(true);
  });
});

describeWithSqlite('expireListings (§14.9, §14.10)', () => {
  it('is idempotent: the second run changes nothing and writes no second event', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,1000,1090,'open',0)`);
    await expireListings(env, 1100);
    const after = db.prepare('SELECT status, closed_game_day FROM listings WHERE id = 1').get() as { status: string; closed_game_day: number };
    expect(after).toEqual({ status: 'expired', closed_game_day: 1100 });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'listing_expired'`).get() as { n: number }).n).toBe(1);
    await expireListings(env, 1110);
    expect((db.prepare('SELECT closed_game_day FROM listings WHERE id = 1').get() as { closed_game_day: number }).closed_game_day).toBe(1100);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'listing_expired'`).get() as { n: number }).n).toBe(1);
  });

  it('leaves a listing that has not run out alone', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,1000,1090,'open',0)`);
    await expireListings(env, 1050);
    expect((db.prepare('SELECT status FROM listings WHERE id = 1').get() as { status: string }).status).toBe('open');
  });

  it("closes a dead horse's listing even though its expiry day is far off (§14.10)", async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},4000,1000,9999,'open',0)`);
    db.exec(`UPDATE horses SET status = 'dead', ended_game_day = 1040 WHERE id = 1`);
    await expireListings(env, 1050);
    expect((db.prepare('SELECT status FROM listings WHERE id = 1').get() as { status: string }).status).toBe('expired');
  });
});

describeWithSqlite('commission against the database', () => {
  it('the seller ends up with exactly price minus floor(price * pct / 100)', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    db.exec(`INSERT INTO listings (horse_id, seller_stable_id, price, listed_game_day, expires_game_day, status, created_real_ts) VALUES (1,${SELLER},999,1000,1090,'open',0)`);
    await sellListing(env, { ...saleParams(false), listing: LISTING({ price: 999 }) });
    expect(commissionFor(999, 5)).toBe(49);
    expect((db.prepare('SELECT balance FROM stables WHERE id = ?').get(SELLER) as { balance: number }).balance).toBe(10000 + 999 - 49);
    expect((db.prepare('SELECT commission_paid FROM listings WHERE id = 1').get() as { commission_paid: number }).commission_paid).toBe(49);
  });
});

describeWithSqlite('buildSaleStatements shape', () => {
  it('still puts the listing update first and the horse update second', () => {
    const db = freshDb();
    const statements = buildSaleStatements(makeEnv(db), { ...saleParams(false), commission: 200, sameAccount: false }) as unknown as { sql: string }[];
    expect(statements[0].sql).toContain('UPDATE listings');
    expect(statements[1].sql).toContain('UPDATE horses');
  });
});
