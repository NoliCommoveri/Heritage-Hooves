/**
 * src/db/npcFinance.ts, against a real database - the same node:sqlite harness
 * test/market/sale-d1.test.ts introduced and test/npc/buying-d1.test.ts already reuses. See
 * sale-d1.test.ts's header for why this repo takes this route instead of a D1 mock.
 *
 * The test that matters most here is the anti-pump one: the income floor's marker must advance even
 * when no money moved, or a stable that spends a single unit below its floor gets restored on the
 * very next tick and the floor becomes unlimited money for the buying routes.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { runNpcBalanceFloor, runNpcListingClearance } from '../../src/db/npcFinance';
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

// Same stable numbering test/npc/buying-d1.test.ts documents: migrations/0085 seeds Fair Meadow 1,
// Cedar Hollow 2, Willow Creek Barrels 3; the consignment dealer is 4 and has no npc_policy row.
const FAIR_MEADOW = 1;
const CEDAR_HOLLOW = 2; // balance_floor 5000 (migrations/0118)
const DEALER = 4;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 5000;
const FLOOR_INTERVAL = 360; // npc_balance_floor_interval_game_days, migrations/0119

function balanceOf(db: DatabaseSync, stableId: number): number {
  return (db.prepare(`SELECT balance FROM stables WHERE id = ${String(stableId)}`).get() as { balance: number }).balance;
}

function ledgerCount(db: DatabaseSync, stableId: number, kind: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE stable_id = ${String(stableId)} AND kind = '${kind}'`).get() as { n: number }).n;
}

function seedHorse(db: DatabaseSync, id: number, stableId: number): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'mare','Test Horse ${String(id)}','TH',1,0,'{"QH":1}',0,0,${String(stableId)},0,'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

function seedListing(db: DatabaseSync, horseId: number, stableId: number, opts: { guideValue: number | null; price: number; expiresGameDay: number }): number {
  db.exec(
    `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
     VALUES (${String(horseId)},${String(stableId)},${String(opts.price)},${opts.guideValue === null ? 'NULL' : String(opts.guideValue)},0,${String(opts.expiresGameDay)},'open',0)`
  );
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

describeWithSqlite('runNpcBalanceFloor', () => {
  it('tops a stable sitting below its floor back up to it, as an adjustment', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    // Cedar Hollow is seeded at a balance of 0 with a floor of 5000 and a null marker, so it is due.
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);
    // Never a 'sale' - the floor must not be able to disguise itself as trading income on
    // /admin/npc's earned-selling column.
    expect(ledgerCount(db, CEDAR_HOLLOW, 'sale')).toBe(0);
  });

  it('gives nothing at all to a stable already above its floor, but still stamps the marker', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 9000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(9000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(0);
    const marker = db.prepare(`SELECT last_floor_topup_game_day AS d FROM npc_policy WHERE stable_id = ${String(CEDAR_HOLLOW)}`).get() as { d: number | null };
    expect(marker.d).toBe(GAME_DAY);
  });

  it('does not refill a stable that spends its floor away before the interval is up', async () => {
    // The anti-pump property. Without an always-advancing marker this stable would be restored to
    // 5000 on every single tick, and the buying routes would have unlimited money.
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcBalanceFloor(env, GAME_DAY, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);

    db.exec(`UPDATE stables SET balance = 10 WHERE id = ${String(CEDAR_HOLLOW)}`); // spent it all
    await runNpcBalanceFloor(env, GAME_DAY + 10, config);
    await runNpcBalanceFloor(env, GAME_DAY + FLOOR_INTERVAL - 1, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(10);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);

    // ...and does refill it once the interval has actually elapsed.
    await runNpcBalanceFloor(env, GAME_DAY + FLOOR_INTERVAL, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(2);
  });

  it('is idempotent across a re-fired tick on the same game day (CLAUDE.md §5.4)', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcBalanceFloor(env, GAME_DAY, config);
    await runNpcBalanceFloor(env, GAME_DAY, config);

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);
  });

  it('skips a stable whose floor is 0 (the off switch)', async () => {
    const db = freshDb();
    db.exec(`UPDATE npc_policy SET balance_floor = 0 WHERE stable_id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    const marker = db.prepare(`SELECT last_floor_topup_game_day AS d FROM npc_policy WHERE stable_id = ${String(CEDAR_HOLLOW)}`).get() as { d: number | null };
    expect(marker.d).toBe(null);
  });
});

describeWithSqlite('runNpcListingClearance', () => {
  it('sells an expired NPC listing off-screen at the clearance fraction and removes the horse', async () => {
    const db = freshDb();
    seedHorse(db, 100, CEDAR_HOLLOW);
    const listingId = seedListing(db, 100, CEDAR_HOLLOW, { guideValue: 1000, price: 1250, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    // 1000 * npc_listing_clearance_fraction (0.6). Priced off guide value, not the asking price -
    // what a horse is worth, not what its owner hoped for.
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(600);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'sale')).toBe(1);

    const horse = db.prepare('SELECT status, end_reason FROM horses WHERE id = 100').get() as { status: string; end_reason: string };
    expect(horse.status).toBe('removed');
    expect(horse.end_reason).toBe('sold_away');

    const listing = db.prepare(`SELECT status, closed_game_day FROM listings WHERE id = ${String(listingId)}`).get() as { status: string; closed_game_day: number };
    expect(listing.status).toBe('expired');
    expect(listing.closed_game_day).toBe(GAME_DAY);
  });

  it('leaves a listing that has not reached its expiry day alone', async () => {
    const db = freshDb();
    seedHorse(db, 101, CEDAR_HOLLOW);
    seedListing(db, 101, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY + 30 });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    expect((db.prepare('SELECT status FROM horses WHERE id = 101').get() as { status: string }).status).toBe('alive');
  });

  it('never touches the consignment dealer, which has no npc_policy row', async () => {
    const db = freshDb();
    seedHorse(db, 102, DEALER);
    seedListing(db, 102, DEALER, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, DEALER)).toBe(0);
    expect((db.prepare('SELECT status FROM horses WHERE id = 102').get() as { status: string }).status).toBe('alive');
  });

  it('falls back to the asking price when guide_value was never recorded', async () => {
    const db = freshDb();
    seedHorse(db, 103, FAIR_MEADOW);
    seedListing(db, 103, FAIR_MEADOW, { guideValue: null, price: 500, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, FAIR_MEADOW)).toBe(300); // 500 * 0.6, rather than clearing at 0
  });

  it('never pays less than market_min_value', async () => {
    const db = freshDb();
    seedHorse(db, 104, FAIR_MEADOW);
    seedListing(db, 104, FAIR_MEADOW, { guideValue: 10, price: 10, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, FAIR_MEADOW)).toBe(50); // market_min_value, not round(10 * 0.6) = 6
  });

  it('is idempotent - a re-fired tick finds the listing closed and pays nothing twice', async () => {
    const db = freshDb();
    seedHorse(db, 105, CEDAR_HOLLOW);
    seedListing(db, 105, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcListingClearance(env, GAME_DAY, config);
    await runNpcListingClearance(env, GAME_DAY, config);

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(600);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'sale')).toBe(1);
  });

  it('leaves a listing whose horse is already dead to expireListings', async () => {
    const db = freshDb();
    seedHorse(db, 106, CEDAR_HOLLOW);
    db.exec(`UPDATE horses SET status = 'dead', ended_game_day = ${String(GAME_DAY - 1)} WHERE id = 106`);
    seedListing(db, 106, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcListingClearance(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    expect((db.prepare('SELECT status FROM listings WHERE horse_id = 106').get() as { status: string }).status).toBe('open');
  });
});
