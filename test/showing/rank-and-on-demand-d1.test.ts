/**
 * Slice 0025 stage 4 (docs/slices/0025-difficulty-foals-shows-and-evaluation.md §7.5/§7.5a), against
 * a real database - the same node:sqlite harness test/showing/young-and-ability-classes-d1.test.ts
 * introduced. Covers the two mechanics that file's own stage-3 classes don't touch: the
 * Novice/Open/Champion rank progression judgeOneClass writes to horse_class_ranks, and the
 * on-demand join-or-create requestClassEntry drives from the horse page.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { judgeDueShowClasses, requestClassEntry, classKeyFor } from '../../src/db/shows';
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
  return { version: row.version, values: JSON.parse(row.values), flags: JSON.parse(row.flags) };
}

const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const PLAYER_STABLE = 11; // 10 NPC stables seeded (ids 1-10, see test/npc/buying-d1.test.ts's own comment)
const QH = 1;
const ADULT_AGE = -2000; // born_game_day, well past show_conformation_min_age_game_days (1080)

function seedPlayer(db: DatabaseSync): void {
  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
  db.exec(
    `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
     VALUES (1,'Willow Creek','WC',0,1,0,10000,20,0,0,1)`
  );
}

function seedAdultHorse(db: DatabaseSync, id: number): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'mare','WC Mare ${String(id)}','WC',${String(QH)},0,'{"QH":1}',0,0,${String(PLAYER_STABLE)},${String(ADULT_AGE)},'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

/** Inserts one fresh show + one breed_conformation class at the given rank, and enters the given
 * horse alone - a lone entrant is always placed 1st (assignPlacings), which is what lets a handful
 * of rounds exercise the graduation rule without a whole field. */
function seedSoloRound(db: DatabaseSync, day: number, rank: 'novice' | 'open' | 'champion', horseId: number): { showId: number; classId: number } {
  db.exec(
    `INSERT INTO shows (name, tier, venue, scheduled_game_day, entry_deadline_game_day, status, rng_seed, created_game_day, created_real_ts)
     VALUES ('Round','local','Ring',${String(day)},${String(day)},'entries_open',${String(day)},0,0)`
  );
  const showId = (db.prepare('SELECT id FROM shows ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  db.exec(
    `INSERT INTO show_classes (show_id, name, class_type, breed_id, class_key, rank, ideal_vector, judge_id, crosses_eligible, min_age_game_days, status, noise_sd, ideal_falloff, target_field_size, max_entries_per_stable, prize_schedule, rng_seed)
     VALUES (${String(showId)},'QH Conformation','breed_conformation',${String(QH)},'bc:${String(QH)}','${rank}','{"v":1,"traits":{}}',1,0,0,'scheduled',3,2,8,3,'[100,50]',${String(day)})`
  );
  const classId = (db.prepare('SELECT id FROM show_classes ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
  db.exec(
    `INSERT INTO show_entries (class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day, trait_snapshot) VALUES (${String(classId)},${String(horseId)},${String(PLAYER_STABLE)},0,${String(day)},'{}')`
  );
  return { showId, classId };
}

function rankRow(db: DatabaseSync, horseId: number, classKey: string): { rank: string; top3_since_promotion: number; wins_since_promotion: number } | null {
  return db.prepare('SELECT rank, top3_since_promotion, wins_since_promotion FROM horse_class_ranks WHERE horse_id = ? AND class_key = ?').get(horseId, classKey) ?? null;
}

describeWithSqlite('rank progression, against a real database', () => {
  it('promotes novice -> open after 4 top-3 placings including a win, and resets the counters', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedAdultHorse(db, 100);
    const classKey = classKeyFor('breed_conformation', QH, null, null, null);

    for (let round = 0; round < 4; round++) {
      const { showId } = seedSoloRound(db, round * 10, 'novice', 100);
      await judgeDueShowClasses(env, round * 10, config);
      const show = db.prepare('SELECT status FROM shows WHERE id = ?').get(showId) as { status: string };
      expect(show.status).toBe('judged');
    }

    const row = rankRow(db, 100, classKey);
    expect(row).toEqual({ rank: 'open', top3_since_promotion: 0, wins_since_promotion: 0 });
  });

  it('does not promote past champion, but keeps updating its counters', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedAdultHorse(db, 100);
    const classKey = classKeyFor('breed_conformation', QH, null, null, null);
    db.exec(
      `INSERT INTO horse_class_ranks (horse_id, class_type, breed_id, discipline_code, class_key, rank, top3_since_promotion, wins_since_promotion, updated_game_day)
       VALUES (100,'breed_conformation',${String(QH)},NULL,'${classKey}','champion',0,0,0)`
    );

    seedSoloRound(db, 500, 'champion', 100);
    await judgeDueShowClasses(env, 500, config);

    const row = rankRow(db, 100, classKey);
    expect(row).toEqual({ rank: 'champion', top3_since_promotion: 1, wins_since_promotion: 1 });
  });

  it('a class judged with only 3 top-3 finishes (no promotion yet) keeps the running counters', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedAdultHorse(db, 100);
    const classKey = classKeyFor('breed_conformation', QH, null, null, null);

    for (let round = 0; round < 3; round++) {
      seedSoloRound(db, round * 10, 'novice', 100);
      await judgeDueShowClasses(env, round * 10, config);
    }

    const row = rankRow(db, 100, classKey);
    expect(row).toEqual({ rank: 'novice', top3_since_promotion: 3, wins_since_promotion: 3 });
  });
});

describeWithSqlite('requestClassEntry (slice 0025 stage 4 §7.5a), against a real database', () => {
  const classKey = 'bc:1'; // classKeyFor('breed_conformation', QH, null, null, null)

  it('mints a class on the first request, and later requests for the same catalogue row join it', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedAdultHorse(db, 100);
    seedAdultHorse(db, 101);

    const first = await requestClassEntry(env, { classKey, horseId: 100, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    expect(first).toEqual({ ok: true });

    const classesAfterFirst = db.prepare(`SELECT id FROM show_classes WHERE class_key = '${classKey}' AND status = 'scheduled'`).all() as { id: number }[];
    expect(classesAfterFirst).toHaveLength(1);

    const second = await requestClassEntry(env, { classKey, horseId: 101, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    expect(second).toEqual({ ok: true });

    // Still exactly one live class for this catalogue row - the second request joined the first
    // rather than minting a parallel one (§7.5a's "join before minting").
    const classesAfterSecond = db.prepare(`SELECT id FROM show_classes WHERE class_key = '${classKey}' AND status = 'scheduled'`).all() as { id: number }[];
    expect(classesAfterSecond).toHaveLength(1);
    expect(classesAfterSecond[0].id).toBe(classesAfterFirst[0].id);

    const entries = db.prepare(`SELECT horse_id FROM show_entries WHERE class_id = ${String(classesAfterFirst[0].id)}`).all() as { horse_id: number }[];
    expect(entries.map((e) => e.horse_id).sort()).toEqual([100, 101]);
  });

  it("once a stable's per-class cap is reached, a further request refuses rather than minting a parallel class", async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    for (const id of [100, 101, 102, 103]) seedAdultHorse(db, id);

    // show_max_entries_per_stable is 3 (migration 0041) - the first three requests fill the class.
    for (const id of [100, 101, 102]) {
      const result = await requestClassEntry(env, { classKey, horseId: id, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
      expect(result).toEqual({ ok: true });
    }

    const fourth = await requestClassEntry(env, { classKey, horseId: 103, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    expect(fourth).toEqual({ ok: false, reason: 'entry_cap_reached' });

    // Deliberate departure from a literal reading of the slice document, recorded in the build log:
    // a stable at its own cap is refused rather than getting a second concurrently-open class of the
    // same catalogue row, which would reintroduce exactly the fragmentation "join before minting"
    // exists to avoid.
    const liveClasses = db.prepare(`SELECT id FROM show_classes WHERE class_key = '${classKey}' AND status = 'scheduled'`).all() as { id: number }[];
    expect(liveClasses).toHaveLength(1);
  });

  it('an Open-ranked horse and a Novice-ranked horse land in two different classes for the same catalogue row', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    seedAdultHorse(db, 100); // stays novice (no horse_class_ranks row)
    seedAdultHorse(db, 101);
    db.exec(
      `INSERT INTO horse_class_ranks (horse_id, class_type, breed_id, discipline_code, class_key, rank, top3_since_promotion, wins_since_promotion, updated_game_day)
       VALUES (101,'breed_conformation',${String(QH)},NULL,'${classKey}','open',0,0,0)`
    );

    const novice = await requestClassEntry(env, { classKey, horseId: 100, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    const open = await requestClassEntry(env, { classKey, horseId: 101, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    expect(novice).toEqual({ ok: true });
    expect(open).toEqual({ ok: true });

    const classes = db.prepare(`SELECT id, rank FROM show_classes WHERE class_key = '${classKey}' AND status = 'scheduled'`).all() as { id: number; rank: string }[];
    expect(classes.map((c) => c.rank).sort()).toEqual(['novice', 'open']);
    expect(classes).toHaveLength(2);
  });

  it('refuses a horse too young for the catalogue row (no live class needed to say so)', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);
    seedPlayer(db);
    db.exec(
      `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
       VALUES (200,'mare','WC Foal','WC',${String(QH)},0,'{"QH":1}',0,0,${String(PLAYER_STABLE)},0,'alive',0,'${MINIMAL_GENOTYPE}',200)`
    );

    const result = await requestClassEntry(env, { classKey, horseId: 200, gameDay: 0, gameDaysPerYear: config.values.game_days_per_year, conformationConfig: config.values, config });
    expect(result).toEqual({ ok: false, reason: 'too_young' });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM show_classes WHERE class_key = '${classKey}'`).get()).toEqual({ n: 0 });
  });
});
