/**
 * Slice 0026 §1.2/§5 tests 2-3, against a real database - the same node:sqlite harness
 * test/market/stud-d1.test.ts introduced (see that file's header for why). Covers what a pure
 * function test cannot: buildGeldStatements' actual effect on real coverings/pregnancies rows, and
 * unresolvedStudBookingForStallion's query.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { buildGeldStatements } from '../../src/db/ageing';
import { unresolvedStudBookingForStallion } from '../../src/db/stud';
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

// migrations 0085/0097/0136/0137/0168 seed eleven NPC stables (ids 1-11), so the two player stables
// below are 12 and 13 - the same numbering test/market/stud-d1.test.ts uses.
const STALLION_STABLE = 12;
const MARE_STABLE = 13;
const STALLION_ID = 1;
const MARE_ONE_ID = 2; // booked, unresolved
const MARE_TWO_ID = 3; // already conceived
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 1200;

function seed(db: DatabaseSync): void {
  db.exec(
    `INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0), ('b','B','x',0,1,0,0)`
  );
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Stallion Stable','SS',0,1,0,10000,20,0,0,1), (2,'Mare Stable','MS',0,1,0,10000,20,0,0,1)`
  );
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${STALLION_ID},'stallion','SS Sire','SS',1,0,'{"QH":1}',0,0,${STALLION_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',1),
            (${MARE_ONE_ID},'mare','MS Bluebell','MS',1,0,'{"QH":1}',0,0,${MARE_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',2),
            (${MARE_TWO_ID},'mare','MS Daisy','MS',1,0,'{"QH":1}',0,0,${MARE_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',3)`
  );
}

describeWithSqlite('buildGeldStatements, against a real database', () => {
  it('sets sex and gelded_game_day, cancels only the unresolved covering as sire_gelded, and leaves an in-progress pregnancy intact', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);

    // C1: unresolved - this is the one that must be cancelled.
    db.exec(
      `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (${MARE_STABLE},${MARE_ONE_ID},${STALLION_ID},1000,10,'booked',11,0)`
    );
    // C2: already resolved, with a live pregnancy hanging off it.
    db.exec(
      `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, resolved_game_day, resolved_tick_seq, created_real_ts)
       VALUES (${MARE_STABLE},${MARE_TWO_ID},${STALLION_ID},900,9,'resolved_conceived',12,950,9,0)`
    );
    const coveringTwoId = (db.prepare('SELECT id FROM coverings WHERE mare_id = ?').get(MARE_TWO_ID) as { id: number }).id;
    db.exec(
      `INSERT INTO pregnancies (covering_id, dam_id, sire_id, conceived_game_day, gestation_days, due_game_day, status, rolled_genotype, rolled_coi, rng_seed, foal_rng_seed, created_real_ts)
       VALUES (${coveringTwoId},${MARE_TWO_ID},${STALLION_ID},950,340,1290,'in_progress','${MINIMAL_GENOTYPE}',0,21,22,0)`
    );

    await env.DB.batch(buildGeldStatements(env, { horseId: STALLION_ID, gameDay: GAME_DAY }));

    const horse = db.prepare('SELECT sex, gelded_game_day FROM horses WHERE id = ?').get(STALLION_ID) as { sex: string; gelded_game_day: number };
    expect(horse.sex).toBe('gelding');
    expect(horse.gelded_game_day).toBe(GAME_DAY);

    const c1 = db.prepare('SELECT cancelled_game_day, cancelled_reason FROM coverings WHERE mare_id = ?').get(MARE_ONE_ID) as {
      cancelled_game_day: number;
      cancelled_reason: string;
    };
    expect(c1.cancelled_game_day).toBe(GAME_DAY);
    expect(c1.cancelled_reason).toBe('sire_gelded');

    const c2 = db.prepare('SELECT cancelled_game_day FROM coverings WHERE mare_id = ?').get(MARE_TWO_ID) as { cancelled_game_day: number | null };
    expect(c2.cancelled_game_day).toBeNull(); // already resolved before gelding - untouched

    const pregnancy = db.prepare('SELECT status, cancelled_game_day FROM pregnancies WHERE sire_id = ?').get(STALLION_ID) as {
      status: string;
      cancelled_game_day: number | null;
    };
    expect(pregnancy.status).toBe('in_progress');
    expect(pregnancy.cancelled_game_day).toBeNull(); // §1.2: existing pregnancies stand
  });
});

describeWithSqlite('unresolvedStudBookingForStallion, against a real database', () => {
  it('names the mare on an unresolved booking, and reads null once nothing is outstanding', async () => {
    const db = freshDb();
    seed(db);
    const env = makeEnv(db);

    expect(await unresolvedStudBookingForStallion(env, STALLION_ID)).toBeNull();

    db.exec(
      `INSERT INTO stud_listings (stallion_id, stable_id, fee, season_cap, active, created_game_day, created_real_ts)
       VALUES (${STALLION_ID},${STALLION_STABLE},500,5,1,1000,0)`
    );
    const listingId = (db.prepare('SELECT id FROM stud_listings WHERE stallion_id = ?').get(STALLION_ID) as { id: number }).id;

    db.exec(
      `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (${MARE_STABLE},${MARE_ONE_ID},${STALLION_ID},1000,10,'booked',11,0)`
    );
    const coveringId = (db.prepare('SELECT id FROM coverings WHERE mare_id = ?').get(MARE_ONE_ID) as { id: number }).id;
    db.exec(
      `INSERT INTO stud_bookings (stud_listing_id, covering_id, stallion_id, stallion_stable_id, mare_id, mare_stable_id, fee, commission_paid, season_index, booked_game_day, created_real_ts)
       VALUES (${listingId},${coveringId},${STALLION_ID},${STALLION_STABLE},${MARE_ONE_ID},${MARE_STABLE},500,25,3,1000,0)`
    );

    const unresolved = await unresolvedStudBookingForStallion(env, STALLION_ID);
    expect(unresolved).not.toBeNull();
    expect(unresolved!.registered_name).toBe('MS Bluebell');

    // Once the covering resolves, gelding is no longer blocked.
    db.exec(`UPDATE coverings SET status = 'resolved_conceived', resolved_game_day = 1050, resolved_tick_seq = 11 WHERE id = ${String(coveringId)}`);
    expect(await unresolvedStudBookingForStallion(env, STALLION_ID)).toBeNull();
  });
});
