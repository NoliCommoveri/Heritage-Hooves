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
import { resetWorld } from '../src/db/reset';
import { getConsignmentDealerStable, runConsignments } from '../src/db/consignment';
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

  it('recreates the other nine NPC stables alongside it', async () => {
    const db = freshDb();
    const env = makeEnv(db);

    await resetWorld(env, 'world');

    expect(await getShowBarnStable(env)).not.toBeNull();
    const npcStableCount = (db.prepare('SELECT COUNT(*) AS n FROM stables WHERE is_npc = 1').get() as { n: number }).n;
    // Slice 0023: three Quarter Horse personalities (Apples and Oats Ranch, Bronco Valley,
    // Horseshoe Bay) plus three each for Paso Fino and German Warmblood, plus the Consignment Yard.
    expect(npcStableCount).toBe(10);
  });
});
