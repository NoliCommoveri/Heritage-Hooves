/**
 * Account pause (migration 0174), against a real database - same node:sqlite harness
 * test/incidents/incidents-d1.test.ts and test/ageing/geld-d1.test.ts use (see either file's own
 * header for what it is and isn't). Covers the two tick-side exemptions a pure-function test
 * cannot: chargeUpkeep charging a paused account's stable nothing while still advancing its
 * last_upkeep_game_day marker, and rollAcuteIncidents rolling no new incident for a paused
 * account's horse while still advancing its last_incident_check_game_day marker - in both cases so
 * neither presents a lump-sum backlog the moment the account unpauses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import type { Env } from '../../src/types';

// src/db/incidents.ts's getIncidentTypes and src/lib/config-cache.ts's getConfig both cache in
// module scope for 60s - reset between tests the same way test/incidents/incidents-d1.test.ts does,
// or a later test's env would silently read an earlier test's cached rows.
beforeEach(() => {
  vi.resetModules();
});
async function freshImports() {
  const accounts = await import('../../src/db/accounts');
  const upkeep = await import('../../src/db/upkeep');
  const incidents = await import('../../src/db/incidents');
  const configCache = await import('../../src/lib/config-cache');
  return { ...accounts, ...upkeep, ...incidents, getConfig: configCache.getConfig };
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

// migrations seed twelve NPC stables (ids 1-12, see test/incidents/incidents-d1.test.ts's own
// comment on the count), so player stables start at 13.
const PAUSED_STABLE = 13;
const ACTIVE_STABLE = 14;
const PAUSED_HORSE = 1;
const ACTIVE_HORSE = 2;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 2000;

function seed(db: DatabaseSync) {
  db.exec(
    `INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, paused, created_real_ts)
     VALUES ('paused','Paused','x',0,1,0,1,0), ('active','Active','x',0,1,0,0,0)`
  );
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active, last_upkeep_game_day)
     VALUES (1,'Paused Stable','PS',0,1,0,10000,20,0,0,1,0), (2,'Active Stable','AS',0,1,0,10000,20,0,0,1,0)`
  );
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed, last_incident_check_game_day)
     VALUES (${PAUSED_HORSE},'mare','PS Rose','PS',1,0,'{"QH":1}',0,0,${PAUSED_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',1,0),
            (${ACTIVE_HORSE},'mare','AS Daisy','AS',1,0,'{"QH":1}',0,0,${ACTIVE_STABLE},0,'alive',0,'${MINIMAL_GENOTYPE}',2,0)`
  );
}

describeWithSqlite('setAccountPaused, against a real database', () => {
  it('sets paused and paused_real_ts on pause, clears both on unpause', async () => {
    const db = freshDb();
    const { setAccountPaused } = await freshImports();
    seed(db);
    const env = makeEnv(db);

    await setAccountPaused(env, 1, true);
    let row = db.prepare('SELECT paused, paused_real_ts FROM accounts WHERE id = 1').get() as { paused: number; paused_real_ts: number | null };
    expect(row.paused).toBe(1);
    expect(row.paused_real_ts).not.toBeNull();

    await setAccountPaused(env, 1, false);
    row = db.prepare('SELECT paused, paused_real_ts FROM accounts WHERE id = 1').get() as { paused: number; paused_real_ts: number | null };
    expect(row.paused).toBe(0);
    expect(row.paused_real_ts).toBeNull();
  });
});

describeWithSqlite('chargeUpkeep - a paused account (migration 0174)', () => {
  it('charges the active stable but not the paused one, and advances both markers', async () => {
    const db = freshDb();
    const { chargeUpkeep, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    await chargeUpkeep(env, GAME_DAY, 500, config);

    const paused = db.prepare('SELECT balance, last_upkeep_game_day FROM stables WHERE id = ?').get(PAUSED_STABLE) as {
      balance: number;
      last_upkeep_game_day: number;
    };
    expect(paused.balance).toBe(10000); // no board charged while paused
    expect(paused.last_upkeep_game_day).toBe(GAME_DAY); // marker still advances - no backlog on unpause

    const active = db.prepare('SELECT balance, last_upkeep_game_day FROM stables WHERE id = ?').get(ACTIVE_STABLE) as {
      balance: number;
      last_upkeep_game_day: number;
    };
    expect(active.balance).toBeLessThan(10000); // board charged as normal
    expect(active.last_upkeep_game_day).toBe(GAME_DAY);

    const pausedLedgerCount = (db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE stable_id = ? AND kind = 'upkeep'`).get(PAUSED_STABLE) as { n: number }).n;
    expect(pausedLedgerCount).toBe(0);
  });

  it('a paused stable that later unpauses is not billed for the days it was paused', async () => {
    const db = freshDb();
    const { chargeUpkeep, getConfig, setAccountPaused } = await freshImports();
    seed(db);
    const env = makeEnv(db);
    const config = await getConfig(env);

    await chargeUpkeep(env, GAME_DAY, 500, config); // paused for this stretch - nothing charged
    await setAccountPaused(env, 1, false);
    await chargeUpkeep(env, GAME_DAY + 10, 510, config); // unpaused - only these 10 days are owed

    const stable = db.prepare('SELECT balance FROM stables WHERE id = ?').get(PAUSED_STABLE) as { balance: number };
    // 1 alive horse * 10 days owed * rate 2/day = 20, not 2010 days' worth.
    expect(10000 - stable.balance).toBe(20);
  });
});

describeWithSqlite('rollAcuteIncidents - a paused account (migration 0174)', () => {
  it('rolls a certain-onset incident for the active horse but nothing for the paused one, and advances both markers', async () => {
    const db = freshDb();
    const { rollAcuteIncidents, getConfig } = await freshImports();
    seed(db);
    const env = makeEnv(db);

    // Ceiling raised to 1.0 and a synthetic 100%-onset incident type, so the roll is deterministic
    // rather than leaning on the real seeded types' own (deliberately small) probabilities.
    db.exec(`UPDATE config SET "values" = json_set("values", '$.incident_probability_ceiling_per_game_day', 1.0) WHERE id = 1`);
    const config = await getConfig(env);
    const riskModel = JSON.stringify({
      v: 1, kind: 'acquired', tissue: 'gut', robustnessTrait: null, robustnessWeight: 0,
      baseRatePerGameDay: 1, careWeight: 0, workloadWeight: 0, feedWeight: 0, pastureMultiplier: 1,
      outcomesUntreated: { resolved: 1, manageable: 0, degenerative: 0, death: 0 },
      outcomesTreated: { resolved: 1, manageable: 0, degenerative: 0, death: 0 },
    });
    db.exec(
      `INSERT INTO incident_types (code, name, risk_model, treatment_window_game_days, treatment_cost_key, enabled, description, event_text, sort_order)
       VALUES ('TESTCERTAIN','Test Certain','${riskModel.replace(/'/g, "''")}',30,'acute_treatment_cost_colic',1,'t','t',999)`
    );

    await rollAcuteIncidents(env, GAME_DAY, 500, config);

    const pausedCount = (db.prepare(`SELECT COUNT(*) AS n FROM horse_incidents WHERE horse_id = ?`).get(PAUSED_HORSE) as { n: number }).n;
    expect(pausedCount).toBe(0);
    const activeCount = (db.prepare(`SELECT COUNT(*) AS n FROM horse_incidents WHERE horse_id = ?`).get(ACTIVE_HORSE) as { n: number }).n;
    expect(activeCount).toBeGreaterThan(0);

    const pausedMarker = (db.prepare('SELECT last_incident_check_game_day FROM horses WHERE id = ?').get(PAUSED_HORSE) as { last_incident_check_game_day: number })
      .last_incident_check_game_day;
    expect(pausedMarker).toBe(GAME_DAY); // marker still advances - no backlog on unpause
    const activeMarker = (db.prepare('SELECT last_incident_check_game_day FROM horses WHERE id = ?').get(ACTIVE_HORSE) as { last_incident_check_game_day: number })
      .last_incident_check_game_day;
    expect(activeMarker).toBe(GAME_DAY);
  });
});
