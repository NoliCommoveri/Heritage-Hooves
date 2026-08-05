/**
 * resetWorld tests that need a real database. Same harness as
 * test/founding/consignment-d1.test.ts - see that file's header for what it is and is not a
 * substitute for.
 *
 * Covers the bug where a full world reset's blanket `DELETE FROM stables` removed the Consignment
 * Yard (migrations/0097, a run-once migration) without recreating it, so runConsignments silently
 * no-opped forever afterwards (it treats a missing dealer as "migration not yet applied").
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../src/lib/sql';
import { RESET_TABLES, resetWorld } from '../src/db/reset';
import { getConsignmentDealerStable, queueInjection, runConsignments } from '../src/db/consignment';
import { getShowBarnStable } from '../src/db/npc';
import type { Env } from '../src/types';
import type { Config } from '../src/lib/config-cache';

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

describeWithSqlite('resetWorld (full world scope) recreates the NPC stables', () => {
  it('recreates the Consignment Yard, and runConsignments mints a batch again afterwards', async () => {
    const db = freshDb();
    const env = makeEnv(db);

    // The dealer exists straight out of migrations.
    expect(await getConsignmentDealerStable(env)).not.toBeNull();

    await resetWorld(env, 'world');

    const dealer = await getConsignmentDealerStable(env);
    expect(dealer).not.toBeNull();
    expect(dealer!.balance).toBe(0);
    // No npc_policy row for the dealer, same as migration 0097 leaves it - it must never breed,
    // show or buy.
    expect(db.prepare('SELECT COUNT(*) AS n FROM npc_policy WHERE stable_id = ?').get(dealer!.id)).toEqual({ n: 0 });

    const config = readConfig(db);
    await runConsignments(env, 0, 1, config);
    const listedCount = (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n;
    expect(listedCount).toBeGreaterThan(0);
  });

  it('recreates the other ten NPC stables alongside it', async () => {
    const db = freshDb();
    const env = makeEnv(db);

    await resetWorld(env, 'world');

    expect(await getShowBarnStable(env)).not.toBeNull();
    const npcStableCount = (db.prepare('SELECT COUNT(*) AS n FROM stables WHERE is_npc = 1').get() as { n: number }).n;
    // Slice 0023: three Quarter Horse personalities (Apples and Oats Ranch, Bronco Valley,
    // Horseshoe Bay) plus three each for Paso Fino and German Warmblood, plus Dressur Stables
    // (migration 0168, German Warmblood's second discipline barn), plus the Consignment Yard.
    expect(npcStableCount).toBe(11);
  });
});

/**
 * The guard that should have caught the `consignment_injections` bug and didn't.
 *
 * test/reset.test.ts checks the delete *order* is right, but only among the tables already in
 * RESET_TABLES - it has no way to notice a table that was left out of the lists altogether, which
 * is the failure that actually reached the operator. This asks the built schema itself rather than
 * a hand-maintained map: every table that really has a foreign key into `horses` must be somewhere
 * a reset deals with it. A future migration adding one and forgetting the reset fails here, with
 * the table named, instead of failing in front of the children.
 */
describeWithSqlite('every foreign key into horses is accounted for by a reset', () => {
  it('names no table that RESET_TABLES and resetWorld both ignore', () => {
    const db = freshDb();

    const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    const referencingHorses = tableNames.filter((name) => {
      const fks = db.prepare(`PRAGMA foreign_key_list(${name})`).all() as { table: string }[];
      return fks.some((fk) => fk.table === 'horses');
    });

    // Sanity check on the check: if this ever comes back empty the assertion below is vacuous.
    expect(referencingHorses.length).toBeGreaterThan(10);

    // Handled by resetWorld directly rather than by the table lists, because the two scopes want
    // different things from it - see the comment at the top of resetWorld().
    const handledOutsideTheTableLists = new Set(['consignment_injections']);

    for (const name of referencingHorses) {
      if (name === 'horses') continue; // self-reference, emptied by its own statement
      if (handledOutsideTheTableLists.has(name)) continue;
      expect(
        RESET_TABLES as readonly string[],
        `${name} has a foreign key into horses but no reset clears it - DELETE FROM horses will throw`
      ).toContain(name);
    }
  });
});

/**
 * The reset used to throw FOREIGN KEY on `DELETE FROM horses` as soon as one queued allele had
 * actually been consumed by a consignment batch, because `consignment_injections.applied_horse_id`
 * (migration 0096) points at `horses` and nothing in resetWorld dealt with it. D1 rolls the whole
 * batch back, the route has no catch, and the operator sees a bare 500 - a button that does nothing
 * and explains nothing.
 *
 * The tests above never caught it because they reset a world with no horses in it. These use the
 * real path - queue an allele, mint a batch, let the tick stamp applied_horse_id - rather than
 * hand-inserting the row, so they keep testing the thing that actually breaks.
 */
describeWithSqlite('resetWorld with a consignment injection already applied to a horse', () => {
  /** Queue an allele, mint the batch that consumes it, and assert it really did get applied. */
  async function seedAppliedInjection(db: DatabaseSync, env: Env): Promise<Config> {
    const config = readConfig(db);
    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: null,
      gameDay: 0,
      config,
    });
    expect(queued.ok).toBe(true);

    await runConsignments(env, 0, 1, config);

    const applied = db
      .prepare("SELECT COUNT(*) AS n FROM consignment_injections WHERE status = 'applied' AND applied_horse_id IS NOT NULL")
      .get() as { n: number };
    expect(applied.n).toBe(1); // the precondition the bug needs - if this ever stops holding, the test below proves nothing
    return config;
  }

  it('horses-only: clears the applied rows, keeps a still-queued instruction', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await seedAppliedInjection(db, env);

    // A second allele queued after that batch is a pending instruction, not a record of a horse
    // that is about to be deleted - the clock keeps running in this scope, so it must survive.
    expect((await queueInjection(env, { locusCode: 'G', allele: 'G', zygosity: 'het', appliesTo: 'one', sexPreference: 'any', note: null, gameDay: 0, config })).ok).toBe(true);

    await resetWorld(env, 'horses');

    expect(db.prepare('SELECT COUNT(*) AS n FROM horses').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM consignment_injections WHERE status = 'applied'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM consignment_injections WHERE status = 'queued'").get()).toEqual({ n: 1 });
  });

  it('full world: empties the table, because game_day going back to 0 invalidates every eligibility day in it', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await seedAppliedInjection(db, env);
    expect((await queueInjection(env, { locusCode: 'G', allele: 'G', zygosity: 'het', appliesTo: 'one', sexPreference: 'any', note: null, gameDay: 0, config })).ok).toBe(true);

    await resetWorld(env, 'world');

    expect(db.prepare('SELECT COUNT(*) AS n FROM horses').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM consignment_injections').get()).toEqual({ n: 0 });
    // Still does everything the reset already promised - the fix must not have cost the world clock.
    expect(db.prepare('SELECT game_day FROM world WHERE id = 1').get()).toEqual({ game_day: 0 });
  });
});
