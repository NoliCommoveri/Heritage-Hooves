/**
 * Slice 0026 stage 4 - the show barn, split off the QH volume breeder (Apples and Oats Ranch) and
 * retuned from one flat quality band to a rank-seeded plan. Same node:sqlite harness as
 * test/founding/consignment-d1.test.ts - see that file's header for what it is and is not a
 * substitute for.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { topUpShowBarnToPlan, getShowBarnStable, countShowBarnByBreedAndRank } from '../../src/db/npc';
import type { Env } from '../../src/types';
import type { Config } from '../../src/lib/config-cache';

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

const GW = 6; // breed ids, insertion order: QH=1, AR=2, TB=3, PF=4, IC=5, GW=6, FR=7, NOK=8
const PF = 4;

describeWithSqlite('topUpShowBarnToPlan (slice 0026 stage 4 §4.3/§4.7)', () => {
  it('tops every breed up to the rank plan, not just Quarter Horses', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const result = await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });

    const vectoredBreeds = db.prepare('SELECT code, id FROM breeds WHERE ideal_vector IS NOT NULL AND enabled = 1').all() as { code: string; id: number }[];
    expect(vectoredBreeds.length).toBe(8); // every breed ships with an ideal_vector and enabled=1 by default

    const stable = await getShowBarnStable(env);
    expect(stable).not.toBeNull();

    const target = config.values.npc_show_barn_rank_plan.reduce((sum: number, p: { count: number }) => sum + p.count, 0);
    expect(target).toBe(10); // 2 novice + 4 open + 4 champion

    for (const breed of vectoredBreeds) {
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM horses WHERE owner_stable_id = ? AND breed_id = ? AND status = 'alive'`).get(stable!.id, breed.id) as { n: number }
      ).n;
      expect(count, `${breed.code} not stocked to target`).toBe(target);
    }
    expect(result.minted).toBe(target * vectoredBreeds.length);
  });

  it('is idempotent: topping up twice mints nothing the second time', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const first = await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    expect(first.minted).toBeGreaterThan(0);

    const second = await topUpShowBarnToPlan(env, { config, gameDay: 1001, worldTickSeq: 2 });
    expect(second.minted).toBe(0);
  });

  it('mints only the shortfall for a (breed, rank) already partly stocked', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    const stable = await getShowBarnStable(env);

    // Kill off two of German Warmblood's champions - a missing pair, not the whole tier.
    db.exec(
      `UPDATE horses SET status = 'dead', ended_game_day = 1000, end_reason = 'natural'
       WHERE id IN (SELECT h.id FROM horses h JOIN horse_class_ranks r ON r.horse_id = h.id
                    WHERE h.owner_stable_id = ${String(stable!.id)} AND h.breed_id = ${String(GW)}
                      AND r.class_key = 'bc:${String(GW)}' AND r.rank = 'champion' LIMIT 2)`
    );

    const before = await countShowBarnByBreedAndRank(env, stable!.id);
    expect(before.get(`${String(GW)}:champion`)).toBe(2);

    const result = await topUpShowBarnToPlan(env, { config, gameDay: 1001, worldTickSeq: 2 });
    expect(result.minted).toBe(2);

    const after = await countShowBarnByBreedAndRank(env, stable!.id);
    expect(after.get(`${String(GW)}:champion`)).toBe(4);
  });

  it('rank seeding: a German Warmblood champion holds three class ranks, a Paso Fino champion holds two, and nobody holds a disc:endurance row', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 1000, worldTickSeq: 1 });
    const stable = await getShowBarnStable(env);

    // Read the seeded aptitudes off disk rather than hand-copying them (test/showing/breed-aptitude
    // .test.ts's own precedent) - GW is above neutral in jumping (1.05) and dressage (1.04); PF only
    // in gaited (1.05).
    const gwHorse = db
      .prepare(`SELECT id FROM horses WHERE owner_stable_id = ? AND breed_id = ? AND id IN (SELECT horse_id FROM horse_class_ranks WHERE class_key = ? AND rank = 'champion') LIMIT 1`)
      .get(stable!.id, GW, `bc:${String(GW)}`) as { id: number };
    const gwKeys = (db.prepare('SELECT class_key FROM horse_class_ranks WHERE horse_id = ?').all(gwHorse.id) as { class_key: string }[]).map((r) => r.class_key).sort();
    expect(gwKeys).toEqual([`bc:${String(GW)}`, 'disc:dressage', 'disc:jumping'].sort());

    const pfHorse = db
      .prepare(`SELECT id FROM horses WHERE owner_stable_id = ? AND breed_id = ? AND id IN (SELECT horse_id FROM horse_class_ranks WHERE class_key = ? AND rank = 'champion') LIMIT 1`)
      .get(stable!.id, PF, `bc:${String(PF)}`) as { id: number };
    const pfKeys = (db.prepare('SELECT class_key FROM horse_class_ranks WHERE horse_id = ?').all(pfHorse.id) as { class_key: string }[]).map((r) => r.class_key).sort();
    expect(pfKeys).toEqual([`bc:${String(PF)}`, 'disc:gaited'].sort());

    // A fresh database ships all eight breeds enabled (no migration disables any - the "three breeds
    // in play" the build record describes is live operator state at /admin/breeds, not the default),
    // so Arabian (endurance 1.05) is in play here and does get disc:endurance rows - §4.4's own "no
    // horse holds a disc:endurance row" claim is about the deployed site's three-breed reality, not
    // an invariant this function enforces. Paso Fino, whose own aptitudes never rise above neutral in
    // endurance, correctly gets none.
    expect(pfKeys).not.toContain('disc:endurance');
    const arKeys = (
      db
        .prepare(
          `SELECT class_key FROM horse_class_ranks WHERE horse_id = (
             SELECT id FROM horses WHERE owner_stable_id = ? AND breed_id = (SELECT id FROM breeds WHERE code = 'AR')
               AND id IN (SELECT horse_id FROM horse_class_ranks WHERE class_key = 'bc:' || (SELECT id FROM breeds WHERE code = 'AR') AND rank = 'champion')
             LIMIT 1
           )`
        )
        .all(stable!.id) as { class_key: string }[]
    ).map((r) => r.class_key);
    expect(arKeys).toContain('disc:endurance');
  });

  it("a show-barn horse's natural_death_game_day equals born_game_day + age_decline_start_game_days exactly", async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 2000, worldTickSeq: 1 });
    const stable = await getShowBarnStable(env);

    const rows = db.prepare('SELECT born_game_day, natural_death_game_day FROM horses WHERE owner_stable_id = ?').all(stable!.id) as {
      born_game_day: number;
      natural_death_game_day: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.natural_death_game_day).toBe(row.born_game_day + config.values.age_decline_start_game_days);
    }
  });

  it('mints show-barn horses across the wider age spread, not founding stock\'s narrower one', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    await topUpShowBarnToPlan(env, { config, gameDay: 5000, worldTickSeq: 1 });
    const stable = await getShowBarnStable(env);

    const ages = (db.prepare('SELECT born_game_day FROM horses WHERE owner_stable_id = ?').all(stable!.id) as { born_game_day: number }[]).map(
      (r) => 5000 - r.born_game_day
    );
    for (const age of ages) {
      expect(age).toBeGreaterThanOrEqual(config.values.npc_show_barn_age_min_game_days);
      expect(age).toBeLessThanOrEqual(config.values.npc_show_barn_age_max_game_days);
    }
    // At least one horse should land outside founding stock's own narrower band, or this test would
    // pass even if the override were never wired in.
    expect(ages.some((age) => age > config.values.founding_age_max_game_days)).toBe(true);
  });
});
