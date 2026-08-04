/**
 * Slice 0020 §10 tests 6-9 - the ones that need a real database. Same shim as
 * test/market/sale-d1.test.ts (node:sqlite, real migrations, a ~30-line D1 lookalike) - see that
 * file's own header for what it is and isn't. Skips rather than fails where node:sqlite is
 * unavailable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import type { Env } from '../../src/types';

// src/db/health.ts's getConditions and src/lib/config-cache.ts's getConfig both cache in module
// scope for 60s (their own header comments explain why - no cross-isolate invalidation concern in
// a real Worker, since each isolate has its own module state). In this file every test builds a
// brand new in-memory database, so that cache must be reset between tests or a later test's env
// would silently read an earlier test's cached rows - the same reasoning test/db/disciplines.test.ts
// already documents for its own resetModules() call.
beforeEach(() => {
  vi.resetModules();
});
async function freshImports() {
  const acquired = await import('../../src/db/acquiredConditions');
  const configCache = await import('../../src/lib/config-cache');
  return { ...acquired, getConfig: configCache.getConfig };
}

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

const STABLE = 5; // migrations seed NPC stables 1-4 (incl. the consignment dealer), so a player stable is 5.
const HORSE = 1;
const GAME_DAY = 2000;

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0)`);
  db.exec(`INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (1,'Cedar Hollow','CH',0,1,0,10000,20,0,0,1)`);
  db.exec(`INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed, last_incident_check_game_day)
           VALUES ('mare','CH Copper Penny','CH',1,0,'{"QH":1}',0,0,${STABLE},0,'alive',0,'{"v":1,"mendelian":{},"polygenic":{}}',1,0)`);
  db.exec(`INSERT INTO ledger (stable_id, amount, kind, description, game_day, created_real_ts) VALUES (${STABLE},10000,'opening','Starting balance.',0,0)`);
}

describeWithSqlite('rollAcuteIncidents / resolveAcuteIncidents, against a real database', () => {
  it('force + resolve: an untreated forced incident resolves and the row closes (idempotent on re-run)', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    await forceIncident(env, HORSE, 'COLIC', GAME_DAY);
    const openRow = db.prepare(`SELECT state, resolve_game_day FROM horse_conditions WHERE horse_id = ? AND condition_code = 'COLIC'`).get(HORSE) as {
      state: string;
      resolve_game_day: number;
    };
    expect(openRow.state).toBe('acute');
    expect(openRow.resolve_game_day).toBeGreaterThan(GAME_DAY);

    // forceIncident refuses a second open incident for the same condition (the WHERE NOT EXISTS guard).
    await forceIncident(env, HORSE, 'COLIC', GAME_DAY);
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM horse_conditions WHERE horse_id = ? AND condition_code = 'COLIC'`).get(HORSE) as { n: number }).n;
    expect(count).toBe(1);

    await resolveAcuteIncidents(env, openRow.resolve_game_day, config);
    const resolved = db.prepare(`SELECT state, outcome FROM horse_conditions WHERE horse_id = ? AND condition_code = 'COLIC'`).get(HORSE) as {
      state: string;
      outcome: string;
    };
    expect(resolved.state).toBe('resolved');
    expect(['resolved', 'manageable', 'degenerative', 'death']).toContain(resolved.outcome);

    const events = db.prepare(`SELECT kind FROM events WHERE subject_horse_id = ?`).all(HORSE) as { kind: string }[];
    expect(events.map((e) => e.kind)).toContain('incident_resolved');

    // A re-fired resolve at the same or a later game day changes nothing further - the state = 'acute'
    // guard means the query finds no rows left to resolve.
    const eventCountBefore = events.length;
    await resolveAcuteIncidents(env, openRow.resolve_game_day + 5, config);
    const eventsAfter = db.prepare(`SELECT kind FROM events WHERE subject_horse_id = ?`).all(HORSE) as { kind: string }[];
    expect(eventsAfter.length).toBe(eventCountBefore);
  });

  it('a death outcome runs the full adult-horse exit path: status, pregnancy/covering cancellation and show-entry withdrawal', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    // A synthetic condition whose untreated table is 100% death, so the outcome is deterministic
    // regardless of rng_seed - the real seeded conditions' own tables are probabilistic on purpose
    // and shouldn't be leaned on for a deterministic assertion.
    const trigger = JSON.stringify({
      v: 1, kind: 'acquired', tissue: 'gut', robustnessTrait: null, robustnessWeight: 0,
      baseRatePerGameDay: 0, careWeight: 0, workloadWeight: 0, feedWeight: 0, pastureMultiplier: 1,
      treatmentWindowGameDays: 1, treatmentCostKey: 'acute_treatment_cost_colic',
      outcomesUntreated: { resolved: 0, manageable: 0, degenerative: 0, death: 1 },
      outcomesTreated: { resolved: 1, manageable: 0, degenerative: 0, death: 0 },
    });
    db.exec(
      `INSERT INTO conditions (code, name, category, locus_code, trigger, severity_class, signs_visible, bars_showing, breed_associations, test_cost_key, enabled, teaching_text, event_text, sort_order)
       VALUES ('TESTDEATH','Test Death','acquired',NULL,'${trigger.replace(/'/g, "''")}','acute',1,0,'[]',NULL,1,'t','t',999)`
    );

    // A live covering and a scheduled show entry, both of which should be cancelled/withdrawn when
    // this horse dies - buildEndHorseParticipationStatements' own job, not killDueLethalFoals'.
    db.exec(`INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
             VALUES (1,'Willow Creek','WC',0,1,0,10000,20,0,0,1)`);
    db.exec(
      `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed, last_incident_check_game_day)
       VALUES ('stallion','CH Sire','CH',1,0,'{"QH":1}',0,0,${STABLE},0,'alive',0,'{"v":1,"mendelian":{},"polygenic":{}}',2,0)`
    );
    db.exec(`INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts) VALUES (${STABLE},${HORSE},2,GAME_DAY,10,'booked',5,0)`.replace('GAME_DAY', String(GAME_DAY)));
    db.exec(`INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts) VALUES ('Spring','local','Ring',9999,9990,'entries_open',1,1000,0)`);
    db.exec(`INSERT INTO show_classes (show_id, name, class_type, breed_id, ideal_vector, judge_id, crosses_eligible, min_age_game_days, status, noise_sd, ideal_falloff, target_field_size, max_entries_per_stable, prize_schedule, rng_seed) VALUES (1,'QH Conformation','breed_conformation',1,'{"v":1,"traits":{}}',1,0,0,'scheduled',3,2,8,2,'[100,50]',7)`);
    db.exec(`INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (1,${HORSE},${STABLE},0,1000,'{}')`);

    await forceIncident(env, HORSE, 'TESTDEATH', GAME_DAY);
    const row = db.prepare(`SELECT resolve_game_day FROM horse_conditions WHERE horse_id = ? AND condition_code = 'TESTDEATH'`).get(HORSE) as { resolve_game_day: number };
    await resolveAcuteIncidents(env, row.resolve_game_day, config);

    const horse = db.prepare('SELECT status, end_reason FROM horses WHERE id = ?').get(HORSE) as { status: string; end_reason: string };
    expect(horse.status).toBe('dead');
    expect(horse.end_reason).toBe('TESTDEATH');

    const covering = db.prepare('SELECT status, cancelled_reason FROM coverings WHERE mare_id = ?').get(HORSE) as { status: string; cancelled_reason: string };
    expect(covering.cancelled_reason).toBe('dam_died');

    const entries = db.prepare('SELECT COUNT(*) AS n FROM show_entries WHERE horse_id = ?').get(HORSE) as { n: number };
    expect(entries.n).toBe(0);

    // No duplicate horse_died event - incident_resolved carries the death narrative instead (see
    // resolveOneIncident's own comment on why horse_died's foal-specific wording is not reused here).
    const kinds = (db.prepare('SELECT kind FROM events WHERE subject_horse_id = ?').all(HORSE) as { kind: string }[]).map((e) => e.kind);
    expect(kinds).not.toContain('horse_died');
    expect(kinds).toContain('incident_resolved');
  });

  it('rollAcuteIncidents is idempotent: running twice for the same game day writes nothing the second time', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    await rollAcuteIncidents(env, GAME_DAY, 100, config);
    const marker = (db.prepare('SELECT last_incident_check_game_day FROM horses WHERE id = ?').get(HORSE) as { last_incident_check_game_day: number }).last_incident_check_game_day;
    expect(marker).toBe(GAME_DAY);

    const countBefore = (db.prepare('SELECT COUNT(*) AS n FROM horse_conditions').get() as { n: number }).n;
    await rollAcuteIncidents(env, GAME_DAY, 100, config);
    const countAfter = (db.prepare('SELECT COUNT(*) AS n FROM horse_conditions').get() as { n: number }).n;
    expect(countAfter).toBe(countBefore);
  });
});

describeWithSqlite('treatOneIncident, against a real database', () => {
  it('pays once, refuses a second payment on the same incident, and writes a ledger row', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);

    await forceIncident(env, HORSE, 'COLIC', GAME_DAY);
    const first = await treatOneIncident(env, { horseId: HORSE, horseName: 'Copper Penny', ownerStableId: STABLE, conditionCode: 'COLIC', cost: 180, gameDay: GAME_DAY });
    expect(first).toBe(true);

    const second = await treatOneIncident(env, { horseId: HORSE, horseName: 'Copper Penny', ownerStableId: STABLE, conditionCode: 'COLIC', cost: 180, gameDay: GAME_DAY + 1 });
    expect(second).toBe(false);

    const ledgerRows = db.prepare(`SELECT amount, kind FROM ledger WHERE stable_id = ? AND kind = 'vet'`).all(STABLE) as { amount: number; kind: string }[];
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].amount).toBe(-180);

    const balance = (db.prepare('SELECT balance FROM stables WHERE id = ?').get(STABLE) as { balance: number }).balance;
    expect(balance).toBe(10000 - 180);
  });

  it('refuses to treat a condition with no open incident', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const result = await treatOneIncident(env, { horseId: HORSE, horseName: 'Copper Penny', ownerStableId: STABLE, conditionCode: 'COLIC', cost: 180, gameDay: GAME_DAY });
    expect(result).toBe(false);
  });
});

describeWithSqlite('acquiredBarringFlags, against a real database (§5.4/§10 test 9)', () => {
  it('reads true for an open acute incident and true for a resolved-degenerative one, independently', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);

    let flags = await acquiredBarringFlags(env, HORSE);
    expect(flags).toEqual({ hasOpenAcuteIncident: false, hasDegenerativeIncident: false });

    await forceIncident(env, HORSE, 'LAMINITIS', GAME_DAY);
    flags = await acquiredBarringFlags(env, HORSE);
    expect(flags.hasOpenAcuteIncident).toBe(true);
    expect(flags.hasDegenerativeIncident).toBe(false);

    db.exec(`UPDATE horse_conditions SET state = 'resolved', outcome = 'degenerative' WHERE horse_id = ${HORSE} AND condition_code = 'LAMINITIS'`);
    flags = await acquiredBarringFlags(env, HORSE);
    expect(flags.hasOpenAcuteIncident).toBe(false);
    expect(flags.hasDegenerativeIncident).toBe(true);
  });
});

describeWithSqlite('incidentAdminCensus, against a real database', () => {
  it('counts an open incident and, after resolving, moves it into the right outcome bucket', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, resolveAcuteIncidents, treatOneIncident, acquiredBarringFlags, forceIncident, incidentAdminCensus, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    await forceIncident(env, HORSE, 'COLIC', GAME_DAY);
    let census = await incidentAdminCensus(env);
    let colic = census.find((c) => c.condition.code === 'COLIC')!;
    expect(colic.openCount).toBe(1);

    const row = db.prepare(`SELECT resolve_game_day FROM horse_conditions WHERE horse_id = ? AND condition_code = 'COLIC'`).get(HORSE) as { resolve_game_day: number };
    await resolveAcuteIncidents(env, row.resolve_game_day, config);

    census = await incidentAdminCensus(env);
    colic = census.find((c) => c.condition.code === 'COLIC')!;
    expect(colic.openCount).toBe(0);
    expect(colic.resolved + colic.manageable + colic.degenerative + colic.death).toBe(1);
  });
});
