/**
 * docs/breed-ideal-vectors.md §6.2 step 1 - stockShowBarn tops every breed in play with an ideal
 * vector up to its own target, not Quarter Horses alone. Same harness as
 * test/founding/consignment-d1.test.ts - see that file's header for what it is and is not a
 * substitute for.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { stockShowBarn, getShowBarnStable } from '../../src/db/npc';
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

describeWithSqlite('stockShowBarn (docs/breed-ideal-vectors.md §6.2)', () => {
  it('tops up every breed with an ideal vector to targetSize, not just Quarter Horses', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const result = await stockShowBarn(env, { config, gameDay: 1000, worldTickSeq: 1, targetSize: 3, band: 'mid' });

    const vectoredBreeds = db.prepare('SELECT code, id FROM breeds WHERE ideal_vector IS NOT NULL').all() as { code: string; id: number }[];
    expect(vectoredBreeds.length).toBe(8);

    const stable = await getShowBarnStable(env);
    expect(stable).not.toBeNull();

    for (const breed of vectoredBreeds) {
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM horses WHERE owner_stable_id = ? AND breed_id = ? AND status = 'alive'`).get(stable!.id, breed.id) as { n: number }
      ).n;
      expect(count, `${breed.code} not stocked to target`).toBe(3);
    }
    expect(result.minted).toBe(3 * vectoredBreeds.length);
  });

  it('is idempotent: stocking twice at the same target mints nothing the second time', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const first = await stockShowBarn(env, { config, gameDay: 1000, worldTickSeq: 1, targetSize: 2, band: 'mid' });
    expect(first.minted).toBeGreaterThan(0);

    const second = await stockShowBarn(env, { config, gameDay: 1001, worldTickSeq: 2, targetSize: 2, band: 'mid' });
    expect(second.minted).toBe(0);
  });

  it('only tops up the shortfall for a breed already partly stocked', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await stockShowBarn(env, { config, gameDay: 1000, worldTickSeq: 1, targetSize: 2, band: 'mid' });
    const raised = await stockShowBarn(env, { config, gameDay: 1001, worldTickSeq: 2, targetSize: 5, band: 'mid' });

    const vectoredBreeds = db.prepare('SELECT id FROM breeds WHERE ideal_vector IS NOT NULL').all() as { id: number }[];
    // 3 more per breed to go from 2 to 5.
    expect(raised.minted).toBe(3 * vectoredBreeds.length);
  });
});
