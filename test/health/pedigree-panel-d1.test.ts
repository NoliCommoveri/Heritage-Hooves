/**
 * docs/fixes/breed-disease-panels.md, tests 2 and 3 from that document's own list - the ones that
 * need a real horse_ancestors table. Same node:sqlite harness test/market/sale-d1.test.ts
 * introduced (see that file's header for what it is and isn't).
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { pedigreeBreedCodes, conditionsPanelForHorse, getEnabledConditions, getLethalTriggers } from '../../src/db/health';
import { conditionStatus, parseConditionTrigger } from '../../src/engines/health/status';
import { GENOTYPE_VERSION, type Genotype } from '../../src/engines/genetics/genotype';
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

const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
// migrations seed eleven NPC stables (ids 1-11, migration 0168 added a second German Warmblood
// discipline barn), so a player stable is 12.
const STABLE = 12;
// breed ids: QH=1 (0014), AR=2, TB=3, PF=4, IC=5, GW=6, FR=7, NOK=8 (0024, insertion order).
const QH_BREED_ID = 1;
const AR_BREED_ID = 2;

function seedAccountAndStable(db: DatabaseSync): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Test Stable','TS',0,1,0,10000,20,0,0,1)`
  );
}

/** A QH mare (horse 1), an AR stallion (horse 2), and their QH x AR foal (horse 3) with real
 * horse_ancestors rows at depth 1 for both parents - the minimum pedigree pedigreeBreedCodes needs
 * to prove ancestry, not just breed_id, drives the panel. */
function seedPedigree(db: DatabaseSync): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES
       (1,'mare','TS Mare','TS',${QH_BREED_ID},0,'{"QH":1}',0,0,${STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',1),
       (2,'stallion','TS Sire','TS',${AR_BREED_ID},0,'{"AR":1}',0,0,${STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',2),
       (3,'gelding','TS Foal','TS',${QH_BREED_ID},1,'{"QH":0.5,"AR":0.5}',1,0,${STABLE},100,'alive',0,'${MINIMAL_GENOTYPE}',3)`
  );
  db.exec(`INSERT INTO horse_ancestors (descendant_id, ancestor_id, depth, path_count) VALUES (3,1,1,1),(3,2,1,1)`);
}

describeWithSqlite('pedigreeBreedCodes and conditionsPanelForHorse, against a real database', () => {
  it("a QH mare's own panel is just QH", async () => {
    const db = freshDb();
    seedAccountAndStable(db);
    seedPedigree(db);
    const env = makeEnv(db);
    const codes = await pedigreeBreedCodes(env, 1);
    expect(codes).toEqual(new Set(['QH']));
  });

  it('a QH x AR foal carries both breeds in its pedigree, not just its own registry breed_id', async () => {
    const db = freshDb();
    seedAccountAndStable(db);
    seedPedigree(db);
    const env = makeEnv(db);
    const codes = await pedigreeBreedCodes(env, 3);
    expect(codes).toEqual(new Set(['QH', 'AR']));
  });

  it("the QH x AR foal's testing panel includes SCID (an Arabian-only condition) because of its Arabian sire, guarding the whole reason this filters on ancestry rather than breed_id alone", async () => {
    const db = freshDb();
    seedAccountAndStable(db);
    seedPedigree(db);
    const env = makeEnv(db);
    const enabled = await getEnabledConditions(env);
    const panel = await conditionsPanelForHorse(env, 3, enabled);
    expect(panel.map((c) => c.code)).toContain('SCID');
  });

  it("a Quarter Horse's own testing panel does NOT include SCID - it has no Arabian in its pedigree", async () => {
    const db = freshDb();
    seedAccountAndStable(db);
    seedPedigree(db);
    const env = makeEnv(db);
    const enabled = await getEnabledConditions(env);
    const panel = await conditionsPanelForHorse(env, 1, enabled);
    expect(panel.map((c) => c.code)).not.toContain('SCID');
  });

  // docs/fixes/breed-disease-panels.md: "truth is unfiltered" - the assertion that stops a future
  // session "tidying" the panel filter into the engines that compute what a horse actually is. A
  // Friesian genotype hand-built with two GBED mutants (a Quarter-Horse-only condition, off the
  // Friesian's own panel) still reads affected, and getLethalTriggers' clamp still names GBED
  // regardless of any horse's breed - neither function takes a breed or a panel at all.
  it('truth is unfiltered - an affected genotype reads affected and the lethal clamp is breed-agnostic, even for a condition off this breed panel', async () => {
    const db = freshDb();
    seedAccountAndStable(db);
    seedPedigree(db);
    const env = makeEnv(db);

    const friesianGbedGenotype: Genotype = { v: GENOTYPE_VERSION, mendelian: { GBED: ['Gb', 'Gb'] }, polygenic: {} };
    const enabled = await getEnabledConditions(env);
    const gbed = enabled.find((c) => c.code === 'GBED')!;
    expect(conditionStatus(friesianGbedGenotype, parseConditionTrigger(gbed.trigger)).status).toBe('affected');

    const panel = await conditionsPanelForHorse(env, 1, enabled); // horse 1 is a QH, has no Friesian ancestry either
    // panelFor is about testing/disclosure, never truth - it is not consulted here at all. This
    // just documents that getLethalTriggers itself takes no horse or breed argument.
    const lethalTriggers = await getLethalTriggers(env);
    expect(lethalTriggers.some((t) => t.locus === 'GBED' && t.mutant === 'Gb')).toBe(true);
    void panel;
  });
});
