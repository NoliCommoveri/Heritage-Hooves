/**
 * Slice 0017 §12 (Part C), against a real database - the same node:sqlite harness
 * test/market/sale-d1.test.ts introduced and test/npc/market-d1.test.ts (Part B) already reuses.
 * See sale-d1.test.ts's header for why this repo takes this route instead of a D1 mock.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { refreshNpcBuyOffers, runNpcMarketPurchases } from '../../src/db/npcBuying';
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

// migrations/0085 seeds three NPC stables (Fair Meadow 1, Cedar Hollow 2, Willow Creek Barrels 3);
// amendment 0017a's consignment dealer is 4, with no npc_policy row (never touched by this file).
// Player stables start at 5, same numbering test/market/sale-d1.test.ts already established.
const CEDAR_HOLLOW = 2; // conformation_specialist, targets QH, capacity 40
const PLAYER = 5;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 5000; // well past min_breeding_age_game_days (1080, migrations/0016)

function seedCedarHollowStock(db: DatabaseSync, count: number, startId: number): void {
  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    rows.push(`(${String(id)},'mare','CH Foal ${String(id)}','CH',1,0,'{"QH":1}',0,0,${String(CEDAR_HOLLOW)},0,'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`);
  }
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed) VALUES ${rows.join(',')}`
  );
}

function seedPlayer(db: DatabaseSync, balance = 10000): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Willow Creek','WC',0,1,0,${String(balance)},20,0,0,1)`
  );
}

function seedPlayerHorse(db: DatabaseSync, id: number, opts: { sex?: 'mare' | 'stallion' | 'gelding'; breedId?: number } = {}): void {
  const sex = opts.sex ?? 'mare';
  const breedId = opts.breedId ?? 1;
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'${sex}','WC Player Horse ${String(id)}','WC',${String(breedId)},0,'{"QH":1}',0,0,${String(PLAYER)},0,'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

function seedPlayerListing(db: DatabaseSync, horseId: number, price: number): void {
  db.exec(
    `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
     VALUES (${String(horseId)},${String(PLAYER)},${String(price)},${String(price)},1000,9000,'open',0)`
  );
}

describeWithSqlite('refreshNpcBuyOffers, against a real database (slice 0017 §12)', () => {
  it('posts no offer when a stable has no room to spare', async () => {
    const db = freshDb();
    seedCedarHollowStock(db, 38, 1000); // capacity 40, 38 alive -> 2 free stalls, buffer 3 -> not enough room
    const env = makeEnv(db);
    await refreshNpcBuyOffers(env, GAME_DAY, await readConfig(env));

    const count = db.prepare(`SELECT COUNT(*) AS n FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('posts a standing offer once free stalls clear the buying buffer, priced within the budget fraction', async () => {
    const db = freshDb();
    // 0 horses -> 40 free stalls, well over the buffer of 3.
    db.exec(`UPDATE stables SET balance = 4000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    await refreshNpcBuyOffers(env, GAME_DAY, await readConfig(env));

    const offer = db.prepare(`SELECT * FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as {
      max_price: number;
      criteria: string;
    };
    expect(offer).toBeTruthy();
    expect(offer.max_price).toBe(2000); // floor(4000 * npc_buying_budget_fraction 0.5)
    const criteria = JSON.parse(offer.criteria) as { breedId: number | null; minQuality: number };
    expect(criteria.breedId).toBe(1); // QH, Cedar Hollow's conformation target
    expect(criteria.minQuality).toBe(50); // npc_buy_offer_min_quality default
  });

  // This test used to assert the opposite - that a stable sitting at a balance of 0 still posted an
  // offer, priced at the market_min_value floor of 50. That was the bug: a 50-currency offer against
  // a horse worth a thousand reads to a child as a broken game rather than a bad deal. The
  // npc_buy_offer_min_balance gate in refreshOneOffer is what changed it (src/db/npcFinance.ts's
  // header has the wider reasoning).
  it('posts no offer at all when the stable is below the minimum buying balance', async () => {
    const db = freshDb();
    // Cedar Hollow's seeded balance is 0 (migrations/0085), under npc_buy_offer_min_balance (500).
    const env = makeEnv(db);
    await refreshNpcBuyOffers(env, GAME_DAY, await readConfig(env));

    const count = db.prepare(`SELECT COUNT(*) AS n FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('updates the existing offer in place rather than opening a second one', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    const config = await readConfig(env);

    await refreshNpcBuyOffers(env, GAME_DAY, config);
    const first = db.prepare(`SELECT id, max_price FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as { id: number; max_price: number };
    expect(first.max_price).toBe(5000); // floor(10000 * 0.5)

    db.exec(`UPDATE stables SET balance = 20000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    await refreshNpcBuyOffers(env, GAME_DAY + 30, config);

    const rows = db.prepare(`SELECT id, max_price, active FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)}`).all() as { id: number; max_price: number; active: number }[];
    expect(rows.length).toBe(1); // same row, not a second one
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].max_price).toBe(10000); // floor(20000 * 0.5), updated in place
  });

  it('withdraws the offer once the stable can no longer afford one', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    const config = await readConfig(env);
    await refreshNpcBuyOffers(env, GAME_DAY, config);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as { n: number }).n).toBe(1);

    db.exec(`UPDATE stables SET balance = -500 WHERE id = ${String(CEDAR_HOLLOW)}`); // in debt
    await refreshNpcBuyOffers(env, GAME_DAY + 30, config);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM buy_offers WHERE stable_id = ${String(CEDAR_HOLLOW)} AND active = 1`).get() as { n: number }).n).toBe(0);
  });
});

describeWithSqlite('runNpcMarketPurchases, against a real database (slice 0017 §12)', () => {
  it('buys nothing when a stable has no room to spare', async () => {
    const db = freshDb();
    seedCedarHollowStock(db, 38, 1000); // 2 free stalls, buffer 3
    seedPlayer(db);
    seedPlayerHorse(db, 9000);
    seedPlayerListing(db, 9000, 1000);
    const env = makeEnv(db);
    const config = await readConfig(env);
    config.values.npc_buying_min_quality = 0; // isolate the capacity gate from conformation scoring

    await runNpcMarketPurchases(env, GAME_DAY, config);
    const horse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9000').get() as { owner_stable_id: number };
    expect(horse.owner_stable_id).toBe(PLAYER);
  });

  it("buys a player's listing that fits, and never an NPC-owned one", async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    seedPlayer(db);
    seedPlayerHorse(db, 9000);
    seedPlayerListing(db, 9000, 1000);
    // Cedar Hollow's own stock, listed by Part B - must never be bought by itself or another NPC.
    seedCedarHollowStock(db, 1, 9500);
    db.exec(
      `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
       VALUES (9500,${String(CEDAR_HOLLOW)},1000,1000,1000,9000,'open',0)`
    );
    const env = makeEnv(db);
    const config = await readConfig(env);
    config.values.npc_buying_min_quality = 0;

    await runNpcMarketPurchases(env, GAME_DAY, config);

    const playerHorse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9000').get() as { owner_stable_id: number };
    expect(playerHorse.owner_stable_id).toBe(CEDAR_HOLLOW);
    const npcHorse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9500').get() as { owner_stable_id: number };
    expect(npcHorse.owner_stable_id).toBe(CEDAR_HOLLOW); // untouched - still its own, never self-bought

    const listing = db.prepare('SELECT status, buyer_stable_id FROM listings WHERE horse_id = 9000').get() as { status: string; buyer_stable_id: number };
    expect(listing.status).toBe('sold');
    expect(listing.buyer_stable_id).toBe(CEDAR_HOLLOW);

    // The full sale batch ran (commission, ledger, knowledge copy) - already covered in depth by
    // test/market/sale-d1.test.ts; here it's enough to see the ledger carries a 'purchase' row.
    const purchase = db.prepare(`SELECT amount FROM ledger WHERE stable_id = ${String(CEDAR_HOLLOW)} AND kind = 'purchase'`).get() as { amount: number };
    expect(purchase.amount).toBe(-1000);
  });

  it('never buys a listing priced above the balance fraction', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 1000 WHERE id = ${String(CEDAR_HOLLOW)}`); // budget cap 500
    seedPlayer(db);
    seedPlayerHorse(db, 9000);
    seedPlayerListing(db, 9000, 600); // over the 500 cap, though affordable outright
    const env = makeEnv(db);
    const config = await readConfig(env);
    config.values.npc_buying_min_quality = 0;

    await runNpcMarketPurchases(env, GAME_DAY, config);
    const horse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9000').get() as { owner_stable_id: number };
    expect(horse.owner_stable_id).toBe(PLAYER);
  });

  it('never buys a gelding - the whole point is breeding stock', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    seedPlayer(db);
    seedPlayerHorse(db, 9000, { sex: 'gelding' });
    seedPlayerListing(db, 9000, 1000);
    const env = makeEnv(db);
    const config = await readConfig(env);
    config.values.npc_buying_min_quality = 0;

    await runNpcMarketPurchases(env, GAME_DAY, config);
    const horse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9000').get() as { owner_stable_id: number };
    expect(horse.owner_stable_id).toBe(PLAYER);
  });

  it('caps purchases at npc_buying_max_purchases_per_tick even when more fit', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    seedPlayer(db);
    seedPlayerHorse(db, 9000);
    seedPlayerHorse(db, 9001);
    seedPlayerListing(db, 9000, 500);
    seedPlayerListing(db, 9001, 500);
    const env = makeEnv(db);
    const config = await readConfig(env);
    config.values.npc_buying_min_quality = 0;
    config.values.npc_buying_max_purchases_per_tick = 1;

    await runNpcMarketPurchases(env, GAME_DAY, config);
    const bought = db.prepare(`SELECT COUNT(*) AS n FROM horses WHERE id IN (9000, 9001) AND owner_stable_id = ${String(CEDAR_HOLLOW)}`).get() as { n: number };
    expect(bought.n).toBe(1);
  });
});
