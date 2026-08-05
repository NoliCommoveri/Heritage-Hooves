/**
 * Slice 0017 §12 (Part C), against a real database - evaluateOfferForHorse (does a horse fit an
 * offer) and sellIntoOffer (the create-a-listing-then-sell-it-immediately path). Same node:sqlite
 * harness as test/market/sale-d1.test.ts and test/npc/buying-d1.test.ts; see the former's header
 * for why.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { evaluateOfferForHorse, sellIntoOffer, type BuyOfferRow } from '../../src/db/buyOffers';
import type { Config } from '../../src/lib/config-cache';
import type { Env } from '../../src/types';
import type { HorseRow } from '../../src/db/horses';
import type { StableRow } from '../../src/db/stables';

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

// See test/npc/buying-d1.test.ts's own comment for this numbering.
const CEDAR_HOLLOW = 2; // conformation_specialist (now "Bronco Valley"), targets QH (breed id 1)
const PLAYER = 12; // migrations seed eleven NPC stables now (migration 0168 added an 11th), so a player stable is 12.
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 5000; // well past min_breeding_age_game_days (1080, migrations/0016)

function seedPlayer(db: DatabaseSync, balance = 10000): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Willow Creek','WC',0,1,0,${String(balance)},20,0,0,1)`
  );
}

function seedHorse(db: DatabaseSync, id: number, opts: { sex?: 'mare' | 'stallion' | 'gelding'; breedId?: number; bornGameDay?: number } = {}): void {
  const sex = opts.sex ?? 'mare';
  const breedId = opts.breedId ?? 1;
  const born = opts.bornGameDay ?? 0;
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'${sex}','WC Horse ${String(id)}','WC',${String(breedId)},0,'{"QH":1}',0,0,${String(PLAYER)},${String(born)},'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

function insertOffer(db: DatabaseSync, params: { stableId: number; breedId: number | null; minQuality: number; maxPrice: number }): BuyOfferRow {
  const criteria = JSON.stringify({ v: 1, breedId: params.breedId, minAgeGameDays: 1080, maxAgeGameDays: null, minQuality: params.minQuality });
  db.exec(
    `INSERT INTO buy_offers (stable_id, criteria, max_price, active, created_game_day, created_real_ts) VALUES (${String(params.stableId)}, '${criteria}', ${String(params.maxPrice)}, 1, 0, 0)`
  );
  const row = db.prepare('SELECT * FROM buy_offers WHERE stable_id = ? AND active = 1').get(params.stableId) as BuyOfferRow;
  return row;
}

function getHorseRow(db: DatabaseSync, id: number): HorseRow {
  return db.prepare('SELECT * FROM horses WHERE id = ?').get(id) as HorseRow;
}

describeWithSqlite('evaluateOfferForHorse (slice 0017 §12)', () => {
  it('is eligible for a horse that matches breed, age, sex and a lenient quality floor', async () => {
    const db = freshDb();
    seedPlayer(db);
    seedHorse(db, 9000);
    const env = makeEnv(db);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 1000 });

    const result = await evaluateOfferForHorse(env, offer, getHorseRow(db, 9000), GAME_DAY, await readConfig(env));
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.quality).not.toBeNull();
  });

  it('rejects a gelding - the offer is for breeding stock', async () => {
    const db = freshDb();
    seedPlayer(db);
    seedHorse(db, 9000, { sex: 'gelding' });
    const env = makeEnv(db);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 1000 });

    const result = await evaluateOfferForHorse(env, offer, getHorseRow(db, 9000), GAME_DAY, await readConfig(env));
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('gelding'))).toBe(true);
  });

  it('rejects the wrong breed', async () => {
    const db = freshDb();
    seedPlayer(db);
    seedHorse(db, 9000, { breedId: 2 }); // not QH
    const env = makeEnv(db);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 1000 });

    const result = await evaluateOfferForHorse(env, offer, getHorseRow(db, 9000), GAME_DAY, await readConfig(env));
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('breed'))).toBe(true);
  });

  it('rejects a horse too young for the criteria', async () => {
    const db = freshDb();
    seedPlayer(db);
    seedHorse(db, 9000, { bornGameDay: GAME_DAY - 10 }); // 10 game days old, nowhere near breeding age
    const env = makeEnv(db);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 1000 });

    const result = await evaluateOfferForHorse(env, offer, getHorseRow(db, 9000), GAME_DAY, await readConfig(env));
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('young'))).toBe(true);
  });

  it('rejects a horse that does not score highly enough', async () => {
    const db = freshDb();
    seedPlayer(db);
    seedHorse(db, 9000);
    const env = makeEnv(db);
    // scoreEntry's rawScore is 0..100, so a threshold above 100 can never be cleared, regardless of
    // exactly how a minimal genotype happens to score.
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 99999, maxPrice: 1000 });

    const result = await evaluateOfferForHorse(env, offer, getHorseRow(db, 9000), GAME_DAY, await readConfig(env));
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('score'))).toBe(true);
  });
});

describeWithSqlite('sellIntoOffer, the sale batch (slice 0017 §12)', () => {
  it('moves the horse, writes the three ledger rows, and copies knowledge to the buyer', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    seedPlayer(db);
    seedHorse(db, 9000);
    db.exec(`INSERT INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, cost_paid) VALUES (${String(PLAYER)},9000,'genotype','HYPP','clear',900,150)`);
    const env = makeEnv(db);
    const config = await readConfig(env);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 900 });
    const buyerStable = db.prepare('SELECT * FROM stables WHERE id = ?').get(CEDAR_HOLLOW) as StableRow;

    const result = await sellIntoOffer(env, {
      offer,
      horse: getHorseRow(db, 9000),
      horseName: 'WC Horse 9000',
      sellerStableId: PLAYER,
      sellerStableName: 'Willow Creek',
      sellerAccountId: 1,
      buyerStable,
      gameDay: GAME_DAY,
      config: config.values,
    });
    expect(result.ok).toBe(true);

    const horse = db.prepare('SELECT owner_stable_id, barn_name FROM horses WHERE id = 9000').get() as { owner_stable_id: number; barn_name: string | null };
    expect(horse.owner_stable_id).toBe(CEDAR_HOLLOW);
    expect(horse.barn_name).toBeNull();

    const listing = db.prepare('SELECT status, price, buyer_stable_id FROM listings WHERE horse_id = 9000').get() as { status: string; price: number; buyer_stable_id: number };
    expect(listing.status).toBe('sold');
    expect(listing.price).toBe(900); // the offer's own price, not a fresh appraisal
    expect(listing.buyer_stable_id).toBe(CEDAR_HOLLOW);

    const ledgerKinds = (db.prepare(`SELECT stable_id, kind, amount FROM ledger WHERE reference_type = 'listing' ORDER BY id`).all() as {
      stable_id: number;
      kind: string;
      amount: number;
    }[]).map((r) => `${String(r.stable_id)}:${r.kind}:${String(r.amount)}`);
    expect(ledgerKinds).toContain(`${String(CEDAR_HOLLOW)}:purchase:-900`);
    expect(ledgerKinds).toContain(`${String(PLAYER)}:sale:900`);
    expect(ledgerKinds.some((k) => k.startsWith(`${String(PLAYER)}:commission:-`))).toBe(true);

    const knowledge = db.prepare('SELECT stable_id FROM horse_knowledge WHERE horse_id = 9000 ORDER BY stable_id').all() as { stable_id: number }[];
    // Ordered by stable_id ascending (CEDAR_HOLLOW is 2, PLAYER is 5) - both rows exist, which is
    // the thing under test: the seller keeps its own copy, and the buyer gets one too (schema §4.4).
    expect(new Set(knowledge.map((k) => k.stable_id))).toEqual(new Set([PLAYER, CEDAR_HOLLOW]));
    expect(knowledge.length).toBe(2);
  });

  it('refuses a horse that already has an open listing of its own', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 10000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    seedPlayer(db);
    seedHorse(db, 9000);
    db.exec(
      `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
       VALUES (9000,${String(PLAYER)},2000,2000,1000,9000,'open',0)`
    );
    const env = makeEnv(db);
    const config = await readConfig(env);
    const offer = insertOffer(db, { stableId: CEDAR_HOLLOW, breedId: 1, minQuality: 0, maxPrice: 900 });
    const buyerStable = db.prepare('SELECT * FROM stables WHERE id = ?').get(CEDAR_HOLLOW) as StableRow;

    const result = await sellIntoOffer(env, {
      offer,
      horse: getHorseRow(db, 9000),
      horseName: 'WC Horse 9000',
      sellerStableId: PLAYER,
      sellerStableName: 'Willow Creek',
      sellerAccountId: 1,
      buyerStable,
      gameDay: GAME_DAY,
      config: config.values,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('already_listed');

    // Nothing moved - the horse is still the player's, and the pre-existing listing is untouched.
    const horse = db.prepare('SELECT owner_stable_id FROM horses WHERE id = 9000').get() as { owner_stable_id: number };
    expect(horse.owner_stable_id).toBe(PLAYER);
  });
});
