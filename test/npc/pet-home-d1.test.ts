/**
 * src/db/npcFinance.ts, against a real database - the same node:sqlite harness
 * test/market/sale-d1.test.ts introduced and test/npc/buying-d1.test.ts already reuses. See
 * sale-d1.test.ts's header for why this repo takes this route instead of a D1 mock.
 *
 * The test that matters most here is the anti-pump one: the income floor's marker must advance even
 * when no money moved, or a stable that spends a single unit below its floor gets restored on the
 * very next tick and the floor becomes unlimited money for the buying routes.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { runNpcBalanceFloor } from '../../src/db/npcFinance';
import { runNpcPetHomeSales, petHomePayout, sellHorseToPetHome } from '../../src/db/petHome';
import { buildDeleteHorseStatements } from '../../src/db/horseRemoval';
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

// Same stable numbering test/npc/buying-d1.test.ts documents: migrations/0085 seeds Fair Meadow 1,
// Cedar Hollow 2, Willow Creek Barrels 3; the consignment dealer is 4 and has no npc_policy row.
const FAIR_MEADOW = 1;
const CEDAR_HOLLOW = 2; // balance_floor 5000 (migrations/0126)
const DEALER = 4;
const MINIMAL_GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';
const GAME_DAY = 5000;
const FLOOR_INTERVAL = 360; // npc_balance_floor_interval_game_days, migrations/0119

function balanceOf(db: DatabaseSync, stableId: number): number {
  return (db.prepare(`SELECT balance FROM stables WHERE id = ${String(stableId)}`).get() as { balance: number }).balance;
}

function ledgerCount(db: DatabaseSync, stableId: number, kind: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE stable_id = ${String(stableId)} AND kind = '${kind}'`).get() as { n: number }).n;
}

function seedHorse(db: DatabaseSync, id: number, stableId: number): void {
  db.exec(
    `INSERT INTO horses (id, sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed)
     VALUES (${String(id)},'mare','Test Horse ${String(id)}','TH',1,0,'{"QH":1}',0,0,${String(stableId)},0,'alive',0,'${MINIMAL_GENOTYPE}',${String(id)})`
  );
}

function seedListing(db: DatabaseSync, horseId: number, stableId: number, opts: { guideValue: number | null; price: number; expiresGameDay: number }): number {
  db.exec(
    `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
     VALUES (${String(horseId)},${String(stableId)},${String(opts.price)},${opts.guideValue === null ? 'NULL' : String(opts.guideValue)},0,${String(opts.expiresGameDay)},'open',0)`
  );
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

describeWithSqlite('runNpcBalanceFloor', () => {
  it('tops a stable sitting below its floor back up to it, as an adjustment', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    // Cedar Hollow is seeded at a balance of 0 with a floor of 5000 and a null marker, so it is due.
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);
    // Never a 'sale' - the floor must not be able to disguise itself as trading income on
    // /admin/npc's earned-selling column.
    expect(ledgerCount(db, CEDAR_HOLLOW, 'sale')).toBe(0);
  });

  it('gives nothing at all to a stable already above its floor, but still stamps the marker', async () => {
    const db = freshDb();
    db.exec(`UPDATE stables SET balance = 9000 WHERE id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(9000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(0);
    const marker = db.prepare(`SELECT last_floor_topup_game_day AS d FROM npc_policy WHERE stable_id = ${String(CEDAR_HOLLOW)}`).get() as { d: number | null };
    expect(marker.d).toBe(GAME_DAY);
  });

  it('does not refill a stable that spends its floor away before the interval is up', async () => {
    // The anti-pump property. Without an always-advancing marker this stable would be restored to
    // 5000 on every single tick, and the buying routes would have unlimited money.
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcBalanceFloor(env, GAME_DAY, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);

    db.exec(`UPDATE stables SET balance = 10 WHERE id = ${String(CEDAR_HOLLOW)}`); // spent it all
    await runNpcBalanceFloor(env, GAME_DAY + 10, config);
    await runNpcBalanceFloor(env, GAME_DAY + FLOOR_INTERVAL - 1, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(10);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);

    // ...and does refill it once the interval has actually elapsed.
    await runNpcBalanceFloor(env, GAME_DAY + FLOOR_INTERVAL, config);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(2);
  });

  it('is idempotent across a re-fired tick on the same game day (CLAUDE.md §5.4)', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcBalanceFloor(env, GAME_DAY, config);
    await runNpcBalanceFloor(env, GAME_DAY, config);

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(5000);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'adjustment')).toBe(1);
  });

  it('skips a stable whose floor is 0 (the off switch)', async () => {
    const db = freshDb();
    db.exec(`UPDATE npc_policy SET balance_floor = 0 WHERE stable_id = ${String(CEDAR_HOLLOW)}`);
    const env = makeEnv(db);
    await runNpcBalanceFloor(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    const marker = db.prepare(`SELECT last_floor_topup_game_day AS d FROM npc_policy WHERE stable_id = ${String(CEDAR_HOLLOW)}`).get() as { d: number | null };
    expect(marker.d).toBe(null);
  });
});

describeWithSqlite('runNpcPetHomeSales', () => {
  it('pays for an expired NPC listing at the pet-home fraction, off guide value', async () => {
    const db = freshDb();
    seedHorse(db, 100, CEDAR_HOLLOW);
    seedListing(db, 100, CEDAR_HOLLOW, { guideValue: 1000, price: 1250, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    // 1000 * pet_home_payout_fraction (0.4) - off what the horse is worth, not what its owner hoped
    // for. Its own ledger kind, never 'sale'.
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(400);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'pet_home_payout')).toBe(1);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'sale')).toBe(0);
  });

  it('marks a horse with a show record as removed rather than deleting it', async () => {
    const db = freshDb();
    seedHorse(db, 110, CEDAR_HOLLOW);
    db.exec(`INSERT INTO horse_show_summary (horse_id, starts, wins, placings, best_placing, last_shown_game_day) VALUES (110,1,0,'{"4":1}',4,100)`);
    const listingId = seedListing(db, 110, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    const horse = db.prepare('SELECT status, end_reason FROM horses WHERE id = 110').get() as { status: string; end_reason: string };
    expect(horse.status).toBe('removed');
    expect(horse.end_reason).toBe('pet_home');

    const listing = db.prepare(`SELECT status, closed_game_day FROM listings WHERE id = ${String(listingId)}`).get() as { status: string; closed_game_day: number };
    expect(listing.status).toBe('expired');
    expect(listing.closed_game_day).toBe(GAME_DAY);
    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(400); // paid either way
  });

  it('deletes a horse that never showed and never conceived, along with the rows describing it', async () => {
    const db = freshDb();
    seedHorse(db, 111, CEDAR_HOLLOW);
    seedHorse(db, 112, CEDAR_HOLLOW); // an ancestor of 111, so 111 has a pedigree row of its own
    db.exec(`INSERT INTO horse_ancestors (descendant_id, ancestor_id, depth, path_count) VALUES (111,112,1,1)`);
    db.exec(`INSERT INTO horse_conditions (horse_id, condition_code, state, onset_game_day, last_evaluated_game_day) VALUES (111,'HYPP','onset',0,0)`);
    db.exec(
      `INSERT INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, cost_paid) VALUES (${String(CEDAR_HOLLOW)},111,'genotype','HYPP','clear',10,140)`
    );
    seedListing(db, 111, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(400); // still paid
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 111').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horse_ancestors WHERE descendant_id = 111').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horse_conditions WHERE horse_id = 111').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horse_knowledge WHERE horse_id = 111').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM listings WHERE horse_id = 111').get()).toEqual({ n: 0 });
    // The receipt survives the horse, and points at the stable rather than the deleted listing.
    const row = db.prepare(`SELECT reference_type, description FROM ledger WHERE stable_id = ${String(CEDAR_HOLLOW)} AND kind = 'pet_home_payout'`).get() as {
      reference_type: string;
      description: string;
    };
    expect(row.reference_type).toBe('stable');
    expect(row.description).toContain('Test Horse 111');
  });

  it('deletes a mare who was covered but never conceived, and clears the covering', async () => {
    // The operator's rule is "never pregnant", not "never covered" - a covering that did not take
    // is not a record of anything, so it goes with the horse.
    const db = freshDb();
    seedHorse(db, 113, CEDAR_HOLLOW); // mare
    seedHorse(db, 114, CEDAR_HOLLOW); // the stallion who covered her
    db.exec(
      `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (${String(CEDAR_HOLLOW)},113,114,100,1,'resolved_failed',1,0)`
    );
    seedListing(db, 113, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 113').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM coverings WHERE mare_id = 113').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 114').get()).toEqual({ n: 1 }); // the stallion stays
  });

  it('keeps a mare who actually conceived, even if the pregnancy is still in progress', async () => {
    const db = freshDb();
    seedHorse(db, 115, CEDAR_HOLLOW);
    seedHorse(db, 116, CEDAR_HOLLOW);
    db.exec(
      `INSERT INTO coverings (id, stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (900,${String(CEDAR_HOLLOW)},115,116,100,1,'resolved_conceived',1,0)`
    );
    db.exec(
      `INSERT INTO pregnancies (covering_id, dam_id, sire_id, conceived_game_day, gestation_days, due_game_day, status, rolled_genotype, rolled_coi, rng_seed, foal_rng_seed, created_real_ts)
       VALUES (900,115,116,100,340,440,'in_progress','${MINIMAL_GENOTYPE}',0,1,2,0)`
    );
    seedListing(db, 115, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    const horse = db.prepare('SELECT status FROM horses WHERE id = 115').get() as { status: string };
    expect(horse.status).toBe('removed'); // kept as a row, not deleted
  });

  it('nulls the foal pointer on the pregnancy that produced a deleted horse, keeping the dam record', async () => {
    const db = freshDb();
    seedHorse(db, 117, CEDAR_HOLLOW); // dam
    seedHorse(db, 118, CEDAR_HOLLOW); // sire
    seedHorse(db, 119, CEDAR_HOLLOW); // the foal, which never showed and never bred
    db.exec(
      `INSERT INTO coverings (id, stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
       VALUES (901,${String(CEDAR_HOLLOW)},117,118,100,1,'resolved_conceived',1,0)`
    );
    db.exec(
      `INSERT INTO pregnancies (id, covering_id, dam_id, sire_id, conceived_game_day, gestation_days, due_game_day, status, rolled_genotype, rolled_coi, rng_seed, foal_rng_seed, foal_id, created_real_ts)
       VALUES (500,901,117,118,100,340,440,'foaled','${MINIMAL_GENOTYPE}',0,1,2,119,0)`
    );
    seedListing(db, 119, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 119').get()).toEqual({ n: 0 });
    const preg = db.prepare('SELECT status, dam_id, sire_id, foal_id FROM pregnancies WHERE id = 500').get() as {
      status: string;
      dam_id: number;
      sire_id: number;
      foal_id: number | null;
    };
    expect(preg.foal_id).toBe(null);
    expect(preg.status).toBe('foaled'); // she still foaled; only the pointer is gone
    expect(preg.dam_id).toBe(117);
    expect(preg.sire_id).toBe(118);
    // The dam and sire themselves are untouched, and both are now unbreedable-by-this-rule anyway.
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id IN (117,118)').get()).toEqual({ n: 2 });
  });

  it('keeps a stallion who ever stood at stud, even with no bookings', async () => {
    const db = freshDb();
    seedHorse(db, 120, CEDAR_HOLLOW);
    db.exec(`UPDATE horses SET sex = 'stallion' WHERE id = 120`);
    db.exec(
      `INSERT INTO stud_listings (stallion_id, stable_id, fee, season_cap, active, created_game_day, created_real_ts)
       VALUES (120,${String(CEDAR_HOLLOW)},500,6,1,100,0)`
    );
    seedListing(db, 120, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    const horse = db.prepare('SELECT status FROM horses WHERE id = 120').get() as { status: string };
    expect(horse.status).toBe('removed');
  });

  it('leaves a listing that has not reached its expiry day alone', async () => {
    const db = freshDb();
    seedHorse(db, 101, CEDAR_HOLLOW);
    seedListing(db, 101, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY + 30 });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    expect((db.prepare('SELECT status FROM horses WHERE id = 101').get() as { status: string }).status).toBe('alive');
  });

  it('never touches the consignment dealer, which has no npc_policy row', async () => {
    const db = freshDb();
    seedHorse(db, 102, DEALER);
    seedListing(db, 102, DEALER, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, DEALER)).toBe(0);
    expect((db.prepare('SELECT status FROM horses WHERE id = 102').get() as { status: string }).status).toBe('alive');
  });

  it('falls back to the asking price when guide_value was never recorded', async () => {
    const db = freshDb();
    seedHorse(db, 103, FAIR_MEADOW);
    seedListing(db, 103, FAIR_MEADOW, { guideValue: null, price: 500, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, FAIR_MEADOW)).toBe(200); // 500 * 0.4, rather than paying 0
  });

  it('never pays less than market_min_value', async () => {
    const db = freshDb();
    seedHorse(db, 104, FAIR_MEADOW);
    seedListing(db, 104, FAIR_MEADOW, { guideValue: 10, price: 10, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, FAIR_MEADOW)).toBe(50); // market_min_value, not round(10 * 0.4) = 4
  });

  it('is idempotent - a re-fired tick finds the listing closed and pays nothing twice', async () => {
    const db = freshDb();
    seedHorse(db, 105, CEDAR_HOLLOW);
    seedListing(db, 105, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    const config = await readConfig(env);

    await runNpcPetHomeSales(env, GAME_DAY, config);
    await runNpcPetHomeSales(env, GAME_DAY, config);

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(400);
    expect(ledgerCount(db, CEDAR_HOLLOW, 'pet_home_payout')).toBe(1);
  });

  it('leaves a listing whose horse is already dead to expireListings', async () => {
    const db = freshDb();
    seedHorse(db, 106, CEDAR_HOLLOW);
    db.exec(`UPDATE horses SET status = 'dead', ended_game_day = ${String(GAME_DAY - 1)} WHERE id = 106`);
    seedListing(db, 106, CEDAR_HOLLOW, { guideValue: 1000, price: 1000, expiresGameDay: GAME_DAY });
    const env = makeEnv(db);
    await runNpcPetHomeSales(env, GAME_DAY, await readConfig(env));

    expect(balanceOf(db, CEDAR_HOLLOW)).toBe(0);
    expect((db.prepare('SELECT status FROM listings WHERE horse_id = 106').get() as { status: string }).status).toBe('open');
  });
});

describeWithSqlite('buildDeleteHorseStatements (the operator broom uses this directly)', () => {
  // /horses/:id/admin-delete runs exactly these statements against a horse that has already ended,
  // for the rows the pet home's rule should have deleted at the time and did not. The route's own
  // guards (admin, ended, deletable) are checked there; what matters here is that running this
  // batch on an already-`removed` row leaves nothing dangling behind it.
  it('clears an already-removed horse without breaking anything that points at it', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    seedHorse(db, 300, CEDAR_HOLLOW);
    seedHorse(db, 301, CEDAR_HOLLOW); // its dam, who stays
    db.exec(`UPDATE horses SET status = 'removed', end_reason = 'pet_home', ended_game_day = 90 WHERE id = 300`);
    db.exec(`INSERT INTO horse_ancestors (descendant_id, ancestor_id, depth, path_count) VALUES (300,301,1,1)`);
    db.exec(
      `INSERT INTO events (stable_id, game_day, kind, subject_horse_id, payload, created_real_ts)
       VALUES (${String(CEDAR_HOLLOW)},40,'foaled',300,'{"v":1,"foal_name":"Test Horse 300"}',0)`
    );

    await env.DB.batch(buildDeleteHorseStatements(env, 300));

    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 300').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horse_ancestors WHERE descendant_id = 300').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 301').get()).toEqual({ n: 1 });
    const event = db.prepare('SELECT subject_horse_id, payload FROM events').get() as { subject_horse_id: number | null; payload: string };
    expect(event.subject_horse_id).toBe(null);
    expect(JSON.parse(event.payload).foal_name).toBe('Test Horse 300');
  });
});

describeWithSqlite('petHomePayout', () => {
  it('is the configured fraction of appraised value, floored at market_min_value', async () => {
    const db = freshDb();
    const config = await readConfig(makeEnv(db));

    // One pricing rule for both ways in - this is the number the confirmation page promises a child
    // and the number an NPC's timed-out listing fetches.
    expect(petHomePayout(1000, config)).toBe(400);
    expect(petHomePayout(2375, config)).toBe(950);
    expect(petHomePayout(10, config)).toBe(50); // market_min_value, never round(10 * 0.4) = 4
  });
});

describeWithSqlite('sellHorseToPetHome (the player entry point)', () => {
  // A player stable, seeded the same way test/npc/buying-d1.test.ts does (see its comment for the
  // stable-id numbering, updated by slice 0023's migrations 0136/0137 and migration 0168).
  const PLAYER = 13;
  function seedPlayerStable(db: DatabaseSync): void {
    db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('p','P','x',0,1,0,0)`);
    db.exec(
      `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
       VALUES (1,'Willow Creek','WC',0,1,0,0,20,0,0,1)`
    );
  }
  async function horseRow(env: Env, id: number) {
    return (await env.DB.prepare('SELECT * FROM horses WHERE id = ?').bind(id).first()) as never;
  }

  it('pays the same fraction a player is promised, and deletes a horse with no history', async () => {
    const db = freshDb();
    seedPlayerStable(db);
    seedHorse(db, 200, PLAYER);
    const env = makeEnv(db);
    const config = await readConfig(env);

    const result = await sellHorseToPetHome(env, {
      horse: await horseRow(env, 200),
      sellerStableId: PLAYER,
      appraisedValue: 1200,
      gameDay: GAME_DAY,
      config,
      withdrawStatements: [],
    });

    expect(result.payout).toBe(480); // 1200 * 0.4
    expect(result.deleted).toBe(true);
    expect(balanceOf(db, PLAYER)).toBe(480);
    expect(ledgerCount(db, PLAYER, 'pet_home_payout')).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 200').get()).toEqual({ n: 0 });
  });

  it('keeps a horse with a show record, marked as having gone to a pet home', async () => {
    const db = freshDb();
    seedPlayerStable(db);
    seedHorse(db, 201, PLAYER);
    db.exec(`INSERT INTO horse_show_summary (horse_id, starts, wins, placings, best_placing, last_shown_game_day) VALUES (201,3,1,'{"1":1}',1,100)`);
    const env = makeEnv(db);

    const result = await sellHorseToPetHome(env, {
      horse: await horseRow(env, 201),
      sellerStableId: PLAYER,
      appraisedValue: 1200,
      gameDay: GAME_DAY,
      config: await readConfig(env),
      withdrawStatements: [],
    });

    expect(result.deleted).toBe(false);
    expect(balanceOf(db, PLAYER)).toBe(480); // paid the same either way
    const horse = db.prepare('SELECT status, end_reason FROM horses WHERE id = 201').get() as { status: string; end_reason: string };
    expect(horse.status).toBe('removed');
    expect(horse.end_reason).toBe('pet_home');
  });

  it('deletes a home-bred foal, keeping its birth notice readable in the feed', async () => {
    // The defect the operator hit: every foal born in a player stable gets a `foaled` event pointing
    // at it (src/db/events.ts), and `events` used to be a keep-clause in deletableHorseSql - so the
    // rule "never showed and never conceived is deleted" never once fired for a home-bred horse.
    const db = freshDb();
    seedPlayerStable(db);
    seedHorse(db, 203, PLAYER);
    db.exec(
      `INSERT INTO events (stable_id, game_day, kind, subject_horse_id, payload, created_real_ts)
       VALUES (${String(PLAYER)},40,'foaled',203,'{"v":1,"foal_name":"Test Horse 203","dam_name":"D","sire_name":"S","sex":"colt"}',0)`
    );
    const env = makeEnv(db);

    const result = await sellHorseToPetHome(env, {
      horse: await horseRow(env, 203),
      sellerStableId: PLAYER,
      appraisedValue: 1550,
      gameDay: GAME_DAY,
      config: await readConfig(env),
      withdrawStatements: [],
    });

    expect(result.deleted).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 203').get()).toEqual({ n: 0 });
    // The operator's decision: keep the words, drop the link. The sentence is rendered from the
    // payload, so the feed still reads normally - only the clickable subject is gone.
    const event = db.prepare(`SELECT kind, subject_horse_id, payload FROM events WHERE stable_id = ${String(PLAYER)}`).get() as {
      kind: string;
      subject_horse_id: number | null;
      payload: string;
    };
    expect(event.kind).toBe('foaled');
    expect(event.subject_horse_id).toBe(null);
    expect(JSON.parse(event.payload).foal_name).toBe('Test Horse 203');
  });

  it('deletes a founding horse, unlinking the import batch that produced it', async () => {
    // The same defect in the other place it was universal: claimFoundingOffer writes
    // import_candidates.horse_id for every founding horse, which used to keep it forever.
    const db = freshDb();
    seedPlayerStable(db);
    seedHorse(db, 204, PLAYER);
    db.exec(
      `INSERT INTO import_offers (id, stable_id, account_id, source, status, quality_band, ability_one_chance,
                                  mare_candidates, mare_claims, stallion_candidates, stallion_claims,
                                  age_min_game_days, age_max_game_days, granted_game_day, rng_seed, created_real_ts)
       VALUES (700,${String(PLAYER)},1,'founding','claimed','mid',0.5,4,2,4,2,1000,2000,0,1,0)`
    );
    db.exec(
      `INSERT INTO import_candidates (id, offer_id, slot_index, sex, age_game_days, genotype, origin_prefix, name_part, rng_seed, chosen, horse_id)
       VALUES (800,700,0,'mare',1500,'${MINIMAL_GENOTYPE}','OP','Bright',7,1,204)`
    );
    const env = makeEnv(db);

    const result = await sellHorseToPetHome(env, {
      horse: await horseRow(env, 204),
      sellerStableId: PLAYER,
      appraisedValue: 1000,
      gameDay: GAME_DAY,
      config: await readConfig(env),
      withdrawStatements: [],
    });

    expect(result.deleted).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = 204').get()).toEqual({ n: 0 });
    // The batch keeps its slot, its genotype and its chosen flag - it just stops naming a horse
    // that no longer exists.
    const candidate = db.prepare('SELECT chosen, horse_id, name_part FROM import_candidates WHERE id = 800').get() as {
      chosen: number;
      horse_id: number | null;
      name_part: string;
    };
    expect(candidate.horse_id).toBe(null);
    expect(candidate.chosen).toBe(1);
    expect(candidate.name_part).toBe('Bright');
  });

  it('still keeps a horse the operator injected an allele into', async () => {
    // consignment_injections stays a keep-clause on purpose: rare rather than universal, and
    // /admin/consignment actually renders applied_horse_id as "Applied (horse #N)".
    const db = freshDb();
    seedPlayerStable(db);
    seedHorse(db, 205, PLAYER);
    db.exec(
      `INSERT INTO consignment_injections (locus_code, allele, zygosity, applies_to, sex_preference, status, queued_game_day, applied_game_day, applied_horse_id, created_real_ts)
       VALUES ('E','E','het','one','any','applied',10,20,205,0)`
    );
    const env = makeEnv(db);

    const result = await sellHorseToPetHome(env, {
      horse: await horseRow(env, 205),
      sellerStableId: PLAYER,
      appraisedValue: 1000,
      gameDay: GAME_DAY,
      config: await readConfig(env),
      withdrawStatements: [],
    });

    expect(result.deleted).toBe(false);
    expect((db.prepare('SELECT status FROM horses WHERE id = 205').get() as { status: string }).status).toBe('removed');
  });

  it('pays a stable that is in debt - this is money coming in, never blocked by the debt rule', async () => {
    const db = freshDb();
    seedPlayerStable(db);
    db.exec(`UPDATE stables SET balance = -300 WHERE id = ${String(PLAYER)}`);
    seedHorse(db, 202, PLAYER);
    const env = makeEnv(db);

    await sellHorseToPetHome(env, {
      horse: await horseRow(env, 202),
      sellerStableId: PLAYER,
      appraisedValue: 1000,
      gameDay: GAME_DAY,
      config: await readConfig(env),
      withdrawStatements: [],
    });

    expect(balanceOf(db, PLAYER)).toBe(100); // -300 + 400, back out of the red
  });
});
