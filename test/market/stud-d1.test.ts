/**
 * Slice 0017 §13 (Part D), against a real database - the same node:sqlite harness
 * test/market/sale-d1.test.ts introduced (see that file's header for why). Covers what a pure
 * function test cannot: the booking batch's atomicity and its effect on real rows, the season-cap
 * refusal, the partial unique index, the dead-stallion sweep, and a sold stallion losing his stud
 * listing in the same batch as the rest of the sale.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import {
  createStudListing,
  getActiveStudListingForHorse,
  withdrawStudListing,
  bookingsThisSeasonCount,
  validateStudBooking,
  bookStud,
  closeDeadStudListings,
  type StudListingRow,
} from '../../src/db/stud';
import { sellListing, createListing, getListing } from '../../src/db/listings';
import type { HorseRow } from '../../src/db/horses';
import type { StableRow } from '../../src/db/stables';
import type { Config } from '../../src/lib/config-cache';
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

async function readConfig(env: Env): Promise<Config> {
  const row = (await env.DB.prepare('SELECT version, "values", flags FROM config WHERE id = 1').first()) as { version: number; values: string; flags: string };
  return { version: row.version, values: JSON.parse(row.values), flags: JSON.parse(row.flags) };
}

// migrations 0085/0097/0136/0137/0168 seed eleven NPC stables (ids 1-11, slice 0023 grew this from
// 4 to 10 and migration 0168 added an 11th), so the two player stables below are 12 and 13.
const MARE_STABLE = 12;
const STALLION_STABLE = 13;
const MARE_ID = 1;
const STALLION_ID = 2;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
// 1200 mod 360 = 120, inside the default breeding season (starts day 30, 180 days long) - and well
// past min_breeding_age_game_days (1080, migrations/0016).
const GAME_DAY = 1200;
const SEASON_INDEX = 3;

function seed(db: DatabaseSync): void {
  db.exec(
    `INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0), ('b','B','x',0,1,0,0)`
  );
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Mare Stable','MS',0,1,0,10000,20,0,0,1), (2,'Stallion Stable','SS',0,1,0,10000,20,0,0,1)`
  );
  db.exec(
    `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES ('mare','MS Bluebell','MS',1,0,'{"QH":1}',0,0,${MARE_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',1),
            ('stallion','SS Sire','SS',1,0,'{"QH":1}',0,0,${STALLION_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',2)`
  );
  db.exec(
    `INSERT INTO ledger (stable_id, amount, kind, description, game_day, created_real_ts) VALUES (${MARE_STABLE},10000,'opening','Starting balance.',0,0), (${STALLION_STABLE},10000,'opening','Starting balance.',0,0)`
  );
}

function readHorse(db: DatabaseSync, id: number): HorseRow {
  return db.prepare('SELECT * FROM horses WHERE id = ?').get(id) as HorseRow;
}

function readStable(db: DatabaseSync, id: number): StableRow {
  return db.prepare('SELECT * FROM stables WHERE id = ?').get(id) as StableRow;
}

async function seedListing(env: Env, feeOverride?: number, seasonCap = 5): Promise<StudListingRow> {
  const result = await createStudListing(env, { stallionId: STALLION_ID, stableId: STALLION_STABLE, fee: feeOverride ?? 500, seasonCap, gameDay: 1000 });
  if (!result.ok) throw new Error('seedListing: createStudListing failed');
  const row = await getActiveStudListingForHorse(env, STALLION_ID);
  if (!row) throw new Error('seedListing: listing vanished');
  return row;
}

describeWithSqlite('bookStud, against a real database', () => {
  it('creates the covering, the booking row and three ledger rows, all atomically', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env);

    await bookStud(env, {
      studListing: listing,
      mare: readHorse(db, MARE_ID),
      mareStableId: MARE_STABLE,
      mareStableName: 'Mare Stable',
      mareAccountId: 1,
      stallion: readHorse(db, STALLION_ID),
      stallionStableId: STALLION_STABLE,
      stallionStableName: 'Stallion Stable',
      stallionAccountId: 2,
      gameDay: GAME_DAY,
      tickSeq: 100,
      seasonIndex: SEASON_INDEX,
      commissionPercent: 5,
    });

    const covering = db.prepare('SELECT * FROM coverings WHERE mare_id = ?').get(MARE_ID) as Record<string, unknown>;
    expect(covering.stallion_id).toBe(STALLION_ID);
    expect(covering.stable_id).toBe(MARE_STABLE); // §13.3: the covering belongs to the mare's owner

    const booking = db.prepare('SELECT * FROM stud_bookings WHERE stud_listing_id = ?').get(listing.id) as Record<string, unknown>;
    expect(booking.covering_id).toBe(covering.id);
    expect(booking.fee).toBe(500);
    expect(booking.commission_paid).toBe(25);
    expect(booking.season_index).toBe(SEASON_INDEX);

    const rows = db
      .prepare(`SELECT stable_id, amount, kind, counterparty_stable_id FROM ledger WHERE kind IN ('stud_fee_paid','stud_fee_received','commission') ORDER BY id`)
      .all() as Record<string, number>[];
    expect(rows).toEqual([
      { stable_id: MARE_STABLE, amount: -500, kind: 'stud_fee_paid', counterparty_stable_id: STALLION_STABLE },
      { stable_id: STALLION_STABLE, amount: 500, kind: 'stud_fee_received', counterparty_stable_id: MARE_STABLE },
      { stable_id: STALLION_STABLE, amount: -25, kind: 'commission', counterparty_stable_id: null },
    ]);

    for (const stableId of [MARE_STABLE, STALLION_STABLE]) {
      const balance = readStable(db, stableId).balance;
      const sum = (db.prepare('SELECT SUM(amount) AS s FROM ledger WHERE stable_id = ?').get(stableId) as { s: number }).s;
      expect(balance).toBe(sum);
    }
    expect(readStable(db, MARE_STABLE).balance).toBe(10000 - 500);
    expect(readStable(db, STALLION_STABLE).balance).toBe(10000 + 500 - 25);

    const events = db.prepare('SELECT stable_id, kind FROM events').all() as { stable_id: number; kind: string }[];
    expect(events).toEqual([{ stable_id: STALLION_STABLE, kind: 'stud_booked' }]);
  });

  it('counts against the season cap, and validateStudBooking refuses once it is full', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env, 500, 1); // cap of 1

    const bookOnce = () =>
      bookStud(env, {
        studListing: listing,
        mare: readHorse(db, MARE_ID),
        mareStableId: MARE_STABLE,
        mareStableName: 'Mare Stable',
        mareAccountId: 1,
        stallion: readHorse(db, STALLION_ID),
        stallionStableId: STALLION_STABLE,
        stallionStableName: 'Stallion Stable',
        stallionAccountId: 2,
        gameDay: GAME_DAY,
        tickSeq: 100,
        seasonIndex: SEASON_INDEX,
        commissionPercent: 5,
      });

    await bookOnce();
    expect(await bookingsThisSeasonCount(env, listing.id, SEASON_INDEX)).toBe(1);

    // A second booking to the same mare would fail on "already booked" first - clear the covering
    // to isolate the season-cap refusal itself.
    db.exec(`UPDATE coverings SET status = 'resolved_failed' WHERE mare_id = ${MARE_ID}`);

    const config = await readConfig(env);
    const refusal = await validateStudBooking(env, config, GAME_DAY, listing, SEASON_INDEX, readHorse(db, MARE_ID), readStable(db, MARE_STABLE), readHorse(db, STALLION_ID));
    expect(refusal).toMatch(/fully booked/);
  });

  it('validateStudBooking passes for an ordinary cross-stable pairing in season', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env);
    const config = await readConfig(env);
    const refusal = await validateStudBooking(env, config, GAME_DAY, listing, SEASON_INDEX, readHorse(db, MARE_ID), readStable(db, MARE_STABLE), readHorse(db, STALLION_ID));
    expect(refusal).toBeUndefined();
  });

  it('refuses a same-stable pairing, pointing at the ordinary breeding page', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env);
    const config = await readConfig(env);
    // Same-stable stand-in: the mare's own stable is the stallion's own.
    const refusal = await validateStudBooking(env, config, GAME_DAY, listing, SEASON_INDEX, readHorse(db, MARE_ID), readStable(db, STALLION_STABLE), readHorse(db, STALLION_ID));
    expect(refusal).toMatch(/ordinary breeding page/);
  });

  it('refuses to book a stallion who has died since being listed', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env);
    db.exec(`UPDATE horses SET status = 'dead', ended_game_day = ${String(GAME_DAY - 10)} WHERE id = ${STALLION_ID}`);
    const config = await readConfig(env);
    const refusal = await validateStudBooking(env, config, GAME_DAY, listing, SEASON_INDEX, readHorse(db, MARE_ID), readStable(db, MARE_STABLE), readHorse(db, STALLION_ID));
    expect(refusal).toMatch(/no longer alive/);
  });

  it('refuses when the mare stable cannot afford the fee', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const listing = await seedListing(env, 50000); // more than the mare stable's balance
    const config = await readConfig(env);
    const refusal = await validateStudBooking(env, config, GAME_DAY, listing, SEASON_INDEX, readHorse(db, MARE_ID), readStable(db, MARE_STABLE), readHorse(db, STALLION_ID));
    expect(refusal).toMatch(/stud fee is 50000/);
  });
});

describeWithSqlite('stud_listings, against a real database', () => {
  it('a stallion cannot be listed twice, but a withdrawn one does not block a fresh listing', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    const params = { stallionId: STALLION_ID, stableId: STALLION_STABLE, fee: 500, seasonCap: 5, gameDay: 1000 };
    const first = await createStudListing(env, params);
    expect(first.ok).toBe(true);
    expect(await createStudListing(env, params)).toEqual({ ok: false, error: 'already_listed' });
    if (first.ok) await withdrawStudListing(env, first.studListingId, STALLION_STABLE, 1010);
    expect((await createStudListing(env, params)).ok).toBe(true);
  });

  it('closeDeadStudListings sweeps a dead stallion, and is idempotent', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    await seedListing(env);
    db.exec(`UPDATE horses SET status = 'dead', ended_game_day = 1040 WHERE id = ${STALLION_ID}`);
    await closeDeadStudListings(env, 1050);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).toBeNull();
    await closeDeadStudListings(env, 1060); // second run: nothing left to change
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).toBeNull();
  });

  it('leaves a live stallion alone', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    await seedListing(env);
    await closeDeadStudListings(env, 1050);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).not.toBeNull();
  });
});

describeWithSqlite('a sold stallion loses his stud listing (slice 0017 Part D x Part A)', () => {
  it('withdraws the active stud listing in the same batch as the sale', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);
    await seedListing(env);

    const created = await createListing(env, { horseId: STALLION_ID, sellerStableId: STALLION_STABLE, price: 4000, guideValue: 3800, gameDay: 1000, listingGameDays: 90 });
    if (!created.ok) throw new Error('createListing failed');
    const listing = await getListing(env, created.listingId);
    if (!listing) throw new Error('listing vanished');

    const result = await sellListing(env, {
      listing,
      horseName: 'SS Sire',
      buyerStableId: MARE_STABLE,
      buyerStableName: 'Mare Stable',
      buyerAccountId: 1,
      sellerStableId: STALLION_STABLE,
      sellerStableName: 'Stallion Stable',
      sellerAccountId: 2,
      gameDay: 1050,
      commissionPercent: 5,
    });
    expect(result.ok).toBe(true);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).toBeNull();
  });
});
