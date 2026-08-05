/**
 * Slice 0026 stage 4 §4.5/§4.9, against a real database - same node:sqlite harness as
 * test/showing/rank-and-on-demand-d1.test.ts. Covers the two judging-time mechanics
 * test/npc/show-barn-d1.test.ts (minting) does not: that a show-barn horse's rank never updates from
 * judging, and that the NPC top-up draws from a scoped breeding stable before it ever reaches into
 * the show barn.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { judgeDueShowClasses, classKeyFor } from '../../src/db/shows';
import { topUpShowBarnToPlan, getShowBarnStable } from '../../src/db/npc';
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

function readConfig(db: DatabaseSync): Config {
  const row = db.prepare('SELECT version, "values", flags FROM config WHERE id = 1').get() as { version: number; values: string; flags: string };
  return { version: row.version, values: JSON.parse(row.values), flags: JSON.parse(row.flags) };
}

const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const QH = 1;
const BRONCO_VALLEY = 2; // conformation_specialist, migration 0085 - npc_policy targets QH conformation
const ADULT_AGE = -2000; // born_game_day, well past show_conformation_min_age_game_days (1080)
const PLAYER_STABLE = 13; // 12 NPC stables seeded (see test/npc/buying-d1.test.ts's own comment)

function seedPlayer(db: DatabaseSync): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Willow Creek','WC',0,1,0,10000,20,0,0,1)`
  );
}

let nextHorseId = 500;
function seedQhHorse(db: DatabaseSync, stableId: number): number {
  const id = nextHorseId++;
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'mare','Horse ${String(id)}','XX',${String(QH)},0,'{"QH":1}',0,0,${String(stableId)},${String(ADULT_AGE)},'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
  return id;
}

function seedClass(db: DatabaseSync, day: number, targetFieldSize: number, playerHorseId: number): { classId: number; classKey: string } {
  db.exec(
    `INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts)
     VALUES ('Round','local','Ring',${String(day)},${String(day)},'entries_open',${String(day)},0,0)`
  );
  const showId = (db.prepare('SELECT id FROM shows ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  const classKey = classKeyFor('breed_conformation', QH, null, null, null);
  db.exec(
    `INSERT INTO show_classes (show_id, name, class_type, breed_id, class_key, rank, ideal_vector, judge_id, crosses_eligible, min_age_game_days, status, noise_sd, ideal_falloff, target_field_size, max_entries_per_stable, prize_schedule, rng_seed)
     VALUES (${String(showId)},'QH Conformation','breed_conformation',${String(QH)},'${classKey}','novice','{"v":1,"traits":{}}',1,0,0,'scheduled',3,2,${String(targetFieldSize)},99,'[100,50]',${String(day)})`
  );
  const classId = (db.prepare('SELECT id FROM show_classes ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  db.exec(
    `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (${String(classId)},${String(playerHorseId)},${String(PLAYER_STABLE)},0,${String(day)},'{}')`
  );
  return { classId, classKey };
}

describeWithSqlite('rank freeze for show-barn horses (slice 0026 stage 4 §4.5)', () => {
  it("judging a show-barn horse writes no horse_class_ranks update", async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    seedPlayer(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    const barn = await getShowBarnStable(env);

    const playerHorse = seedQhHorse(db, PLAYER_STABLE);
    // Bronco Valley (tier 1) has no stock, so every NPC slot filled must come from the show barn
    // (tier 2) - a clean way to be sure the frozen rows under test really are its own. The class is
    // 'novice', and the plan seeds only 2 novice QH horses, so the field fills to 1 (player) + 2
    // (the only eligible show-barn horses), short of the 8 target - itself an instance of §3.5's "the
    // class judges short" rather than a hole in this test.
    const { classKey } = seedClass(db, 1000, 8, playerHorse);

    const classKeyId = `bc:${String(QH)}`;
    expect(classKey).toBe(classKeyId);
    const before = db
      .prepare('SELECT horse_id, rank, top3_since_promotion, wins_since_promotion FROM horse_class_ranks WHERE class_key = ? AND horse_id IN (SELECT id FROM horses WHERE owner_stable_id = ?)')
      .all(classKeyId, barn!.id) as { horse_id: number; rank: string; top3_since_promotion: number; wins_since_promotion: number }[];
    expect(before.length).toBe(10); // every show-barn QH horse seeded a bc:QH row at mint

    await judgeDueShowClasses(env, 1000, config);

    // The class really was topped up with show-barn horses.
    const entryCount = (db.prepare('SELECT COUNT(*) AS n FROM show_entries WHERE class_id = (SELECT id FROM show_classes WHERE class_key = ?)').get(classKeyId) as { n: number }).n;
    expect(entryCount).toBe(3); // player + the 2 novice-ranked show-barn horses eligible for this class

    const after = db
      .prepare('SELECT horse_id, rank, top3_since_promotion, wins_since_promotion FROM horse_class_ranks WHERE class_key = ? AND horse_id IN (SELECT id FROM horses WHERE owner_stable_id = ?)')
      .all(classKeyId, barn!.id) as { horse_id: number; rank: string; top3_since_promotion: number; wins_since_promotion: number }[];
    expect(after).toEqual(before); // unchanged, win or not
  });
});

describeWithSqlite('two-tier NPC fill (slice 0026 stage 4 §4.9)', () => {
  it('the show barn contributes nothing while a scoped breeding stable can cover the whole shortfall', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    seedPlayer(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    const barn = await getShowBarnStable(env);

    for (let i = 0; i < 5; i++) seedQhHorse(db, BRONCO_VALLEY);
    const playerHorse = seedQhHorse(db, PLAYER_STABLE);
    // target_field_size 3, one player entry -> shortfall 2, well inside Bronco Valley's 5.
    seedClass(db, 1000, 3, playerHorse);

    await judgeDueShowClasses(env, 1000, config);

    const npcOwners = (
      db.prepare('SELECT DISTINCT entered_by_stable_id FROM show_entries WHERE class_id = (SELECT id FROM show_classes WHERE target_field_size = 3) AND is_npc = 1').all() as {
        entered_by_stable_id: number;
      }[]
    ).map((r) => r.entered_by_stable_id);
    expect(npcOwners).toEqual([BRONCO_VALLEY]);
    expect(npcOwners).not.toContain(barn!.id);
  });

  it('the show barn fills whatever tier 1 leaves, and the class judges short if both tiers together fall short', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    seedPlayer(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    const barn = await getShowBarnStable(env);

    seedQhHorse(db, BRONCO_VALLEY); // tier 1 has exactly one horse to give
    const playerHorse = seedQhHorse(db, PLAYER_STABLE);
    // target_field_size 10, one player entry -> shortfall 9. Tier 1 gives 1; tier 2 (the show barn)
    // has exactly 2 novice-ranked QH horses to give (§4.3's plan); both tiers together (1 + 2 = 3)
    // still fall 6 short of the shortfall, so the class judges with fewer than target_field_size.
    seedClass(db, 1000, 10, playerHorse);

    await judgeDueShowClasses(env, 1000, config);

    const npcEntries = db
      .prepare('SELECT entered_by_stable_id FROM show_entries WHERE class_id = (SELECT id FROM show_classes WHERE target_field_size = 10) AND is_npc = 1')
      .all() as { entered_by_stable_id: number }[];
    const bronco = npcEntries.filter((e) => e.entered_by_stable_id === BRONCO_VALLEY).length;
    const fromBarn = npcEntries.filter((e) => e.entered_by_stable_id === barn!.id).length;
    expect(bronco).toBe(1);
    expect(fromBarn).toBe(2);

    const totalEntries = (db.prepare('SELECT COUNT(*) AS n FROM show_entries WHERE class_id = (SELECT id FROM show_classes WHERE target_field_size = 10)').get() as { n: number }).n;
    expect(totalEntries).toBe(1 + 1 + 2); // player + tier 1 + tier 2, short of the 10 target
    expect(totalEntries).toBeLessThan(10);
  });
});
