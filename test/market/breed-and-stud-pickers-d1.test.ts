/**
 * The two mare-picker defects the operator reported on 2026-08-04, against a real database. Same
 * shim as test/market/stud-d1.test.ts (node:sqlite, real migrations, a ~30-line D1 lookalike) - see
 * that file's own header for what it is and isn't. Skips rather than fails where node:sqlite is
 * unavailable.
 *
 *  1. /market/stud/:id showed the mare picker only when the booking was going to work. A player who
 *     owns four mares and whose first one is in foal read "she is already in foal" with no way to
 *     say "not that one, this one" - the refusal was the whole page.
 *  2. The Breed page could only pair two horses in the same barn, so stud services were reachable
 *     only by knowing /market has a stud section. It now has a third picker for every stallion
 *     standing at another ranch, previewing the pairing exactly as it does for a home stallion.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
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

// game_day 2000 is day 200 of game year 5 (360 days a year), inside the breeding season (day
// 30 for 180 days), and every horse below is born on day 0, so all of them clear
// min_breeding_age_game_days (1080).
const GAME_DAY = 2000;
const GENOTYPE = '{"v":1,"mendelian":{},"polygenic":{}}';

interface World {
  env: Env;
  db: DatabaseSync;
  playerStableId: number;
  npcStableId: number;
  mareInFoalId: number;
  freeMareId: number;
  npcStallionId: number;
}

function insertHorse(db: DatabaseSync, sex: string, name: string, stableId: number, seed: number): number {
  db.prepare(
    `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed, last_incident_check_game_day)
     VALUES (?, ?, 'CH', 1, 0, '{"QH":1}', 0, 0, ?, 0, 'alive', 0, ?, ?, 0)`
  ).run(sex, name, stableId, GENOTYPE, seed);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

async function buildWorld(): Promise<World> {
  const db = freshDb();
  const env = makeEnv(db);

  db.exec(`INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('a','A','x',0,1,0,0)`);
  db.exec(`INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active)
           VALUES (1,'Cedar Hollow','CH',0,1,0,50000,20,0,0,1)`);
  const playerStableId = Number(db.prepare(`SELECT id FROM stables WHERE prefix = 'CH'`).get().id);
  db.exec(`INSERT INTO ledger (stable_id, amount, kind, description, game_day, created_real_ts) VALUES (${playerStableId},50000,'opening','Starting balance.',0,0)`);
  db.exec(`UPDATE world SET game_day = ${GAME_DAY}, tick_seq = 100, season_index = 5 WHERE id = 1`);

  // One of the NPC ranches the migrations already seed - a real stable with no account, which is
  // exactly the "another ranch, not mine" case the third picker is for.
  const npcStableId = Number(db.prepare(`SELECT id FROM stables WHERE is_npc = 1 ORDER BY id LIMIT 1`).get().id);

  const mareInFoalId = insertHorse(db, 'mare', 'CH First Mare', playerStableId, 11);
  const freeMareId = insertHorse(db, 'mare', 'CH Second Mare', playerStableId, 12);
  const npcStallionId = insertHorse(db, 'stallion', 'NPC Big Stallion', npcStableId, 13);

  // The first mare is in foal, which is what made the old page a dead end.
  db.prepare(
    `INSERT INTO coverings (stable_id, mare_id, stallion_id, booked_game_day, booked_tick_seq, status, rng_seed, created_real_ts)
     VALUES (?, ?, ?, ?, 1, 'resolved_conceived', 5, 0)`
  ).run(playerStableId, mareInFoalId, npcStallionId, GAME_DAY - 100);
  const coveringId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  db.prepare(
    `INSERT INTO pregnancies (covering_id, dam_id, sire_id, conceived_game_day, gestation_days, due_game_day, status, rolled_genotype, rolled_coi, rng_seed, foal_rng_seed, last_processed_tick_seq, created_real_ts)
     VALUES (?, ?, ?, ?, 340, ?, 'in_progress', ?, 0, 7, 8, 1, 0)`
  ).run(coveringId, mareInFoalId, npcStallionId, GAME_DAY - 100, GAME_DAY + 240, GENOTYPE);

  const { createStudListing } = await import('../../src/db/stud');
  await createStudListing(env, { stallionId: npcStallionId, stableId: npcStableId, fee: 900, seasonCap: 10, gameDay: GAME_DAY - 50 });

  return { env, db, playerStableId, npcStableId, mareInFoalId, freeMareId, npcStallionId };
}

async function contextFor(world: World, url: string, method: string, body?: string) {
  const { getConfig } = await import('../../src/lib/config-cache');
  const { getWorld } = await import('../../src/db/world');
  const { getAccountById } = await import('../../src/db/accounts');
  return {
    env: world.env,
    request: new Request(`https://x${url}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
    account: await getAccountById(world.env, 1),
    world: await getWorld(world.env),
    config: await getConfig(world.env),
    reissuedSessionCookie: null,
  } as any;
}

describeWithSqlite('the stud page keeps its mare picker when a booking is refused', () => {
  it('shows the picker and the refusal together, and books the mare the player picks instead', async () => {
    const world = await buildWorld();
    const { studDetailRoute } = await import('../../src/routes/market');
    const studListingId = Number(world.db.prepare('SELECT id FROM stud_listings').get().id);

    // Default view: the first mare is in foal, so the booking is refused - and the picker is still
    // there, which is the whole of the fix.
    const refused = await studDetailRoute(await contextFor(world, `/market/stud/${studListingId}`, 'GET'), studListingId);
    const refusedHtml = await refused.text();
    expect(refused.status).toBe(200);
    expect(refusedHtml).toContain('is already in foal');
    expect(refusedHtml).toContain('name="mare"');
    expect(refusedHtml).toContain('CH Second Mare');

    // Picking the other mare gets a real book button, on the same page, without a detour.
    const chosen = await studDetailRoute(
      await contextFor(world, `/market/stud/${studListingId}?mare=${world.freeMareId}`, 'GET'),
      studListingId
    );
    const chosenHtml = await chosen.text();
    expect(chosenHtml).not.toContain('is already in foal');
    expect(chosenHtml).toContain('Book CH Second Mare for 900');
  });
});

describeWithSqlite('the Breed page can pair a mare with a stallion standing at another ranch', () => {
  it('offers the outside studs, previews the pairing, and books through the market stud route', async () => {
    const world = await buildWorld();
    const { stableBreedRoute } = await import('../../src/routes/horses');
    const studListingId = Number(world.db.prepare('SELECT id FROM stud_listings').get().id);
    // Slice 0022 §B3 gates a conformation label on a real show start - give both horses one, so the
    // Unknown count below measures the knowledge boundary rather than an empty show record.
    for (const id of [world.freeMareId, world.mareInFoalId, world.npcStallionId]) {
      world.db.prepare(`INSERT INTO horse_show_summary (horse_id, starts, wins, placings, best_placing, last_shown_game_day) VALUES (?, 3, 1, '{"1":1}', 1, ?)`).run(id, GAME_DAY - 10);
    }

    const page = await stableBreedRoute(await contextFor(world, `/stables/${world.playerStableId}/breed`, 'GET'), 'GET', world.playerStableId);
    const pageHtml = await page.text();
    expect(page.status).toBe(200);
    expect(pageHtml).toContain('name="stud_listing_id"');
    expect(pageHtml).toContain('NPC Big Stallion');
    expect(pageHtml).toContain('fee 900');

    // A workable pairing: the free mare, the outside stallion. The book button posts to the
    // market's own stud route, not to a second breeding path grown on this page.
    const preview = await stableBreedRoute(
      await contextFor(
        world,
        `/stables/${world.playerStableId}/breed`,
        'POST',
        `action=check&mare_id=${world.freeMareId}&stallion_id=&stud_listing_id=${studListingId}`
      ),
      'POST',
      world.playerStableId
    );
    const previewHtml = await preview.text();
    expect(previewHtml).toContain('Stud fee:');
    expect(previewHtml).toContain(`/market/stud/${studListingId}/book`);
    expect(previewHtml).toContain('Book for 900');
    // Somebody else's stallion: his conformation is shown nowhere else in the game (not on
    // /world/horses/:id, not on his stud page), so it is not quietly revealed here either. Both
    // horses have shown, so the mare's column carries real words and every 'Unknown' in the table
    // is his - one per conformation trait, and no more.
    const traitCount = (world.db.prepare('SELECT COUNT(*) AS n FROM quantitative_traits WHERE category = ? AND enabled = 1').get('conformation') as { n: number }).n;
    expect(traitCount).toBeGreaterThan(0);
    expect((previewHtml.match(/<td>Unknown<\/td>/g) ?? []).length).toBe(traitCount);

    // The mare who is already in foal gets the refusal in place of the button, on this page.
    const refused = await stableBreedRoute(
      await contextFor(
        world,
        `/stables/${world.playerStableId}/breed`,
        'POST',
        `action=check&mare_id=${world.mareInFoalId}&stallion_id=&stud_listing_id=${studListingId}`
      ),
      'POST',
      world.playerStableId
    );
    const refusedHtml = await refused.text();
    expect(refusedHtml).toContain('is already in foal');
    expect(refusedHtml).not.toContain('Book for 900');
  });

  it('still books an ordinary covering when the outside picker is left alone', async () => {
    const world = await buildWorld();
    const { stableBreedRoute } = await import('../../src/routes/horses');
    const homeStallionId = insertHorse(world.db, 'stallion', 'CH Home Stallion', world.playerStableId, 21);

    const preview = await stableBreedRoute(
      await contextFor(
        world,
        `/stables/${world.playerStableId}/breed`,
        'POST',
        `action=check&mare_id=${world.freeMareId}&stallion_id=${homeStallionId}&stud_listing_id=`
      ),
      'POST',
      world.playerStableId
    );
    const previewHtml = await preview.text();
    expect(previewHtml).toContain('Book covering');
    expect(previewHtml).not.toContain('Stud fee:');

    const booked = await stableBreedRoute(
      await contextFor(
        world,
        `/stables/${world.playerStableId}/breed`,
        'POST',
        `action=book&mare_id=${world.freeMareId}&stallion_id=${homeStallionId}&stud_listing_id=`
      ),
      'POST',
      world.playerStableId
    );
    expect(booked.status).toBe(303);
    expect(booked.headers.get('location')).toBe(`/horses/${world.freeMareId}`);
    const coverings = world.db.prepare(`SELECT COUNT(*) AS n FROM coverings WHERE mare_id = ? AND status = 'booked'`).get(world.freeMareId) as { n: number };
    expect(coverings.n).toBe(1);
  });
});
