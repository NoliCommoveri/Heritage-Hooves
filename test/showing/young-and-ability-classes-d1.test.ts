/**
 * Slice 0025 stage 3 (docs/slices/0025-difficulty-foals-shows-and-evaluation.md §7.3/§7.4), against
 * a real database - the same node:sqlite harness test/market/sale-d1.test.ts introduced. Exercises
 * the whole path a young horse's owner actually uses: a show is created with the new
 * young_conformation/ability_test classes alongside the existing ones, a yearling is entered in one
 * of each, the tick judges them, and the ability test leaves behind the permanent word
 * src/db/abilityTests.ts writes to horse_ability_words.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { createDueShows, judgeDueShowClasses, youngHorseAgeBands } from '../../src/db/shows';
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
  const flags = JSON.parse(row.flags) as Record<string, boolean>;
  // Slice 0025 stage 4 (migration 0167): createDueShows' calendar minting is off by default now that
  // classes mint on demand (§7.5a) - this file exercises createDueShows directly, so it opts back in
  // exactly the way /admin/config would.
  flags.show_auto_create_enabled = true;
  return { version: row.version, values: JSON.parse(row.values), flags };
}

const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const PLAYER_STABLE = 12; // 11 NPC stables seeded (ids 1-11, see test/npc/buying-d1.test.ts's own comment)
const QH = 1;

function seedPlayer(db: DatabaseSync): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Willow Creek','WC',0,1,0,10000,20,0,0,1)`
  );
}

function seedYearling(db: DatabaseSync, id: number, bornGameDay: number): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'mare','WC Yearling ${String(id)}','WC',${String(QH)},0,'{"QH":1}',0,0,${String(PLAYER_STABLE)},${String(bornGameDay)},'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

async function classRow(env: Env, where: string): Promise<{ id: number; min_age_game_days: number; max_age_game_days: number | null; ability_weights: string | null } | null> {
  return env.DB.prepare(`SELECT id, min_age_game_days, max_age_game_days, ability_weights FROM show_classes WHERE ${where} LIMIT 1`).first();
}

describeWithSqlite('young_conformation and ability_test classes, against a real database', () => {
  it('createDueShows mints one young_conformation class per eligible breed per age band, and one ability_test class per ability trait per age band', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    await createDueShows(env, 0, config);

    const counts = db
      .prepare(`SELECT class_type, COUNT(*) AS n FROM show_classes GROUP BY class_type`)
      .all() as { class_type: string; n: number }[];
    const byType = Object.fromEntries(counts.map((r) => [r.class_type, r.n]));

    // 8 breeds all carry an ideal_vector (migration 0107) -> 8 breed_conformation, 8*2 young_conformation.
    expect(byType.breed_conformation).toBe(8);
    expect(byType.young_conformation).toBe(16);
    // 6 enabled disciplines -> 6 discipline classes; 5 ABILITY_TRAITS * 2 bands -> 10 ability_test.
    expect(byType.discipline).toBe(6);
    expect(byType.ability_test).toBe(10);
  });

  it("a young_conformation class's age band matches youngHorseAgeBands, and its ideal_vector is the breed's own", async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    await createDueShows(env, 0, config);

    const bands = youngHorseAgeBands(config.values);
    const yearling = await classRow(env, `class_type = 'young_conformation' AND breed_id = ${String(QH)} AND age_band = 'yearling'`);
    expect(yearling).not.toBeNull();
    expect(yearling!.min_age_game_days).toBe(bands.yearling.min);
    expect(yearling!.max_age_game_days).toBe(bands.yearling.max);

    const twoYearOld = await classRow(env, `class_type = 'young_conformation' AND breed_id = ${String(QH)} AND age_band = 'two_year_old'`);
    expect(twoYearOld!.min_age_game_days).toBe(bands.twoYearOld.min);
    expect(twoYearOld!.max_age_game_days).toBe(bands.twoYearOld.max);
  });

  it("an ability_test class's ability_weights carries only its own trait, and is open to every breed", async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    await createDueShows(env, 0, config);

    const speedYearling = await classRow(env, `class_type = 'ability_test' AND ability_trait_code = 'speed' AND age_band = 'yearling'`);
    expect(speedYearling).not.toBeNull();
    const weights = JSON.parse(speedYearling!.ability_weights!) as { traits: Record<string, number> };
    expect(weights.traits.speed).toBe(1);
    expect(weights.traits.agility ?? 0).toBe(0);

    const breedIdRow = db.prepare(`SELECT breed_id, crosses_eligible FROM show_classes WHERE id = ${String(speedYearling!.id)}`).get() as {
      breed_id: number | null;
      crosses_eligible: number;
    };
    expect(breedIdRow.breed_id).toBeNull();
    expect(breedIdRow.crosses_eligible).toBe(1);
  });

  it('a yearling entered in both a young_conformation class and an ability_test class gets judged in both, and the ability test leaves a permanent word behind', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    seedPlayer(db);
    // Age 400 game days at day 0 - inside the yearling band [360, 719].
    seedYearling(db, 100, -400);

    await createDueShows(env, 0, config);
    const showRow = db.prepare('SELECT id, scheduled_game_day FROM shows LIMIT 1').get() as { id: number; scheduled_game_day: number };
    const youngCls = (await classRow(env, `class_type = 'young_conformation' AND breed_id = ${String(QH)} AND age_band = 'yearling'`))!;
    const abilityCls = (await classRow(env, `class_type = 'ability_test' AND ability_trait_code = 'speed' AND age_band = 'yearling'`))!;

    db.exec(
      `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (${String(youngCls.id)}, 100, ${String(PLAYER_STABLE)}, 0, 0, '{}')`
    );
    db.exec(
      `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (${String(abilityCls.id)}, 100, ${String(PLAYER_STABLE)}, 0, 0, '{}')`
    );

    await judgeDueShowClasses(env, showRow.scheduled_game_day, config);

    const youngEntry = db.prepare(`SELECT placing, final_score FROM show_entries WHERE class_id = ${String(youngCls.id)} AND horse_id = 100`).get() as {
      placing: number | null;
      final_score: number | null;
    };
    expect(youngEntry.placing).not.toBeNull();
    expect(youngEntry.final_score).not.toBeNull();

    const abilityEntry = db.prepare(`SELECT id, placing FROM show_entries WHERE class_id = ${String(abilityCls.id)} AND horse_id = 100`).get() as {
      id: number;
      placing: number | null;
    };
    expect(abilityEntry.placing).not.toBeNull();

    const word = db.prepare(`SELECT trait_code, label, entry_id, game_day FROM horse_ability_words WHERE horse_id = 100`).get() as {
      trait_code: string;
      label: string;
      entry_id: number;
      game_day: number;
    } | null;
    expect(word).not.toBeNull();
    expect(word!.trait_code).toBe('speed');
    expect(['poor', 'weak', 'acceptable', 'good', 'outstanding']).toContain(word!.label);
    expect(word!.entry_id).toBe(abilityEntry.id);
    expect(word!.game_day).toBe(showRow.scheduled_game_day);

    const summary = db.prepare(`SELECT starts FROM horse_show_summary WHERE horse_id = 100`).get() as { starts: number };
    expect(summary.starts).toBe(2);
  });

  it('an adult horse is refused entry into a yearling class as too_old, and a foal as too_young', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedYearling(db, 200, -2000); // 2000 days old - well past the yearling/two-year-old bands
    seedYearling(db, 201, 0); // newborn at game day 0

    await createDueShows(env, 0, config);
    const youngCls = (await classRow(env, `class_type = 'young_conformation' AND breed_id = ${String(QH)} AND age_band = 'yearling'`))!;

    const { enterHorseInClass } = await import('../../src/db/shows');
    const adultResult = await enterHorseInClass(env, {
      classId: youngCls.id,
      horseId: 200,
      gameDay: 0,
      gameDaysPerYear: config.values.game_days_per_year,
      conformationConfig: config.values,
      config,
    });
    expect(adultResult).toEqual({ ok: false, reason: 'too_old' });

    const foalResult = await enterHorseInClass(env, {
      classId: youngCls.id,
      horseId: 201,
      gameDay: 0,
      gameDaysPerYear: config.values.game_days_per_year,
      conformationConfig: config.values,
      config,
    });
    expect(foalResult).toEqual({ ok: false, reason: 'too_young' });
  });
});
