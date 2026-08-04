/**
 * runNpcStudListings (slice 0017 §13.4's third question - NPC stallions at stud), against a real
 * database. Same node:sqlite harness test/market/sale-d1.test.ts introduced - see that file's
 * header for why. The one thing worth a real database here is the ceiling filter: it is the whole
 * answer to "a player breeding to the best NPC stallion in the game is a route around the ceiling",
 * and a pure-function test of qualityFor alone would not prove the listing itself gets withdrawn.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { runNpcStudListings } from '../../src/db/npcStud';
import { getActiveStudListingForHorse } from '../../src/db/stud';
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
// Cedar Hollow (2, conformation_specialist, targets QH), Willow Creek Barrels (3, discipline_barn).
const CEDAR_HOLLOW = 2;
const STALLION_ID = 1000;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 1200; // past min_breeding_age_game_days (1080)

function seedMatureStallion(db: DatabaseSync): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${STALLION_ID},'stallion','CH Stud','CH',1,0,'{"QH":1}',0,0,${CEDAR_HOLLOW},0,'alive',0,'${MINIMAL_GENOTYPE}',${STALLION_ID})`
  );
}

describeWithSqlite('runNpcStudListings, against a real database', () => {
  it('offers an eligible stallion at a fee derived from npc_stud_fee_fraction', async () => {
    const db = freshDb();
    seedMatureStallion(db);
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcStudListings(env, GAME_DAY, config);

    const listing = await getActiveStudListingForHorse(env, STALLION_ID);
    expect(listing).not.toBeNull();
    expect(listing!.fee).toBeGreaterThan(0);
    expect(listing!.season_cap).toBe(config.values.npc_stud_season_cap);
  });

  it('is naturally idempotent: a second run does not touch the fee already set', async () => {
    const db = freshDb();
    seedMatureStallion(db);
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcStudListings(env, GAME_DAY, config);
    const first = await getActiveStudListingForHorse(env, STALLION_ID);
    await runNpcStudListings(env, GAME_DAY + 10, config);
    const second = await getActiveStudListingForHorse(env, STALLION_ID);
    expect(second!.id).toBe(first!.id);
    expect(second!.fee).toBe(first!.fee);
  });

  it('never lists a stallion whose quality is above the NPC ceiling, and withdraws one that crosses it later', async () => {
    const db = freshDb();
    seedMatureStallion(db);
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcStudListings(env, GAME_DAY, config);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).not.toBeNull();

    // Retune every ceiling row far below anything a real horse could score - the same effect as the
    // ceiling schedule (slice 0015 §2.4) genuinely tightening over time.
    db.exec('UPDATE npc_ceiling_schedule SET conformation_ceiling = -1000, ability_ceiling = -1000');

    await runNpcStudListings(env, GAME_DAY + 10, config);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).toBeNull();
  });

  it('offers nothing for a stallion not yet old enough to breed', async () => {
    const db = freshDb();
    db.exec(
      `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
       VALUES (${STALLION_ID},'stallion','CH Colt','CH',1,0,'{"QH":1}',0,0,${CEDAR_HOLLOW},${GAME_DAY},'alive',0,'${MINIMAL_GENOTYPE}',${STALLION_ID})`
    );
    const env = makeEnv(db);
    const config = await readConfig(env);
    await runNpcStudListings(env, GAME_DAY, config);
    expect(await getActiveStudListingForHorse(env, STALLION_ID)).toBeNull();
  });
});
