/**
 * Slice 0017 §11 (Part B): runNpcMarketListings against a real database, the same node:sqlite
 * harness test/market/sale-d1.test.ts introduced - see that file's header for why this repo takes
 * this route instead of a D1 mock. Reuses its makeEnv/freshDb shape rather than a second copy.
 *
 * config-cache.ts caches a Config in module scope for 60 real seconds, keyed by nothing - fine in
 * production (one env), but every `it()` here builds its own in-memory database, so calling
 * getConfig(env) would risk reading a previous test's config. readConfig below does the same read
 * without the cache.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { runNpcMarketListings } from '../../src/db/npcMarket';
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

// migrations/0085 seeds three NPC stables in this order: Fair Meadow (1, volume_breeder),
// Cedar Hollow (2, conformation_specialist, capacity 40), Willow Creek Barrels (3, discipline_barn).
const CEDAR_HOLLOW = 2;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';

/** Inserts `count` alive, mature (born day 0), QH horses owned by Cedar Hollow, none yet listed. */
function seedMatureStock(db: DatabaseSync, count: number, startId: number): void {
  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    rows.push(
      `('mare','CH Foal ${String(id)}','CH',1,0,'{"QH":1}',0,0,${String(CEDAR_HOLLOW)},0,'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
    );
  }
  db.exec(
    `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed) VALUES ${rows.join(',')}`
  );
}

const GAME_DAY = 5000; // well past min_breeding_age_game_days (1080, migrations/0016)

describeWithSqlite('runNpcMarketListings, against a real database (slice 0017 §11)', () => {
  it('lists nothing when a stable has stalls to spare', async () => {
    const db = freshDb();
    seedMatureStock(db, 3, 1000); // capacity 40, buffer 2 - nowhere near full
    const env = makeEnv(db);
    await runNpcMarketListings(env, GAME_DAY, await readConfig(env));

    const count = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ${String(CEDAR_HOLLOW)}`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('lists surplus once free stalls drop below the buffer, capped at the per-tick maximum', async () => {
    const db = freshDb();
    seedMatureStock(db, 39, 1000); // capacity 40, 39 alive -> 1 free stall, buffer 2 -> deficit 1
    const env = makeEnv(db);
    await runNpcMarketListings(env, GAME_DAY, await readConfig(env));

    const listings = db.prepare(`SELECT * FROM listings WHERE seller_stable_id = ${String(CEDAR_HOLLOW)}`).all() as {
      price: number;
      guide_value: number;
      status: string;
    }[];
    // Config default: npc_market_capacity_buffer=2, npc_market_max_listings_per_tick=2, so a
    // deficit of 1 lists exactly one horse, not the full per-tick cap.
    expect(listings.length).toBe(1);
    expect(listings[0].status).toBe('open');
    expect(listings[0].price).toBeGreaterThan(0);
    expect(listings[0].guide_value).toBeGreaterThan(0);
  });

  it('caps listings at npc_market_max_listings_per_tick even when the deficit is larger', async () => {
    const db = freshDb();
    seedMatureStock(db, 40, 1000); // full - 0 free stalls
    const env = makeEnv(db);
    const config = await readConfig(env);
    // A deficit can never exceed the buffer itself under default config (buffer 2 == max per tick
    // 2), so widen the buffer here to actually exercise the separate per-tick cap.
    config.values.npc_market_capacity_buffer = 3; // deficit = 3 - 0 = 3
    config.values.npc_market_max_listings_per_tick = 1; // capped to 1
    await runNpcMarketListings(env, GAME_DAY, config);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ${String(CEDAR_HOLLOW)}`).get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('never lists the same horse twice, and keeps listing fresh candidates on later ticks', async () => {
    const db = freshDb();
    seedMatureStock(db, 39, 1000);
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcMarketListings(env, GAME_DAY, config);
    await runNpcMarketListings(env, GAME_DAY + 1, config);

    const rows = db.prepare(`SELECT horse_id FROM listings WHERE seller_stable_id = ${String(CEDAR_HOLLOW)}`).all() as { horse_id: number }[];
    const horseIds = rows.map((r) => r.horse_id);
    expect(horseIds.length).toBe(2); // one per tick, since the deficit was 1 both times
    expect(new Set(horseIds).size).toBe(horseIds.length); // no horse listed twice
  });

  it('never lists a horse below min_breeding_age_game_days, even when the stable is over its buffer', async () => {
    const db = freshDb();
    // 39 mature horses (as before) plus enough immature ones to also be "at capacity" on their own
    // would exceed the 40-horse table, so instead: 39 immature, 0 mature - nothing eligible at all.
    const rows: string[] = [];
    for (let i = 0; i < 39; i++) {
      rows.push(`('mare','CH Yearling ${String(i)}','CH',1,0,'{"QH":1}',0,0,${String(CEDAR_HOLLOW)},${String(GAME_DAY - 100)},'alive',0,'${MINIMAL_GENOTYPE}',${String(2000 + i)})`);
    }
    db.exec(
      `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed) VALUES ${rows.join(',')}`
    );
    const env = makeEnv(db);
    await runNpcMarketListings(env, GAME_DAY, await readConfig(env));

    const count = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ${String(CEDAR_HOLLOW)}`).get() as { n: number };
    expect(count.n).toBe(0);
  });
});
