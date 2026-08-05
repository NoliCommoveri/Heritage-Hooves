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

function breedIdFor(db: DatabaseSync, code: string): number {
  return Number((db.prepare('SELECT id FROM breeds WHERE code = ?').get(code) as { id: number }).id);
}

function insertHorse(db: DatabaseSync, sex: string, name: string, stableId: number, seed: number, breedId?: number): number {
  db.prepare(
    `INSERT INTO horses (sex, registered_name, breeder_prefix, breed_id, is_cross, composition, generation, coi, owner_stable_id, born_game_day, status, created_real_ts, genotype, rng_seed, last_incident_check_game_day)
     VALUES (?, ?, 'CH', ?, 0, '{"QH":1}', 0, 0, ?, 0, 'alive', 0, ?, ?, 0)`
  ).run(sex, name, breedId ?? breedIdFor(db, 'QH'), stableId, GENOTYPE, seed);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** The labels of the third picker's own <select>, in the order the page put them in. */
function outsideStudOptionLabels(html: string): string[] {
  const select = html.match(/<select name="stud_listing_id">([\s\S]*?)<\/select>/);
  if (!select) return [];
  return [...select[1].matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]).filter((label) => !label.startsWith('&mdash;') && !label.startsWith('—'));
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
  it('offers only eligible mares, names the excluded one, and books the mare the player picks', async () => {
    const world = await buildWorld();
    // A second eligible mare, so the picker still has a real choice once the in-foal one is left
    // off it (docs/fixes/breeding-eligibility-display.md §2: the picker itself now only offers
    // mares that could actually be booked, rather than showing all of them and refusing after).
    const thirdMareId = insertHorse(world.db, 'mare', 'CH Third Mare', world.playerStableId, 14);
    const { studDetailRoute } = await import('../../src/routes/market');
    const studListingId = Number(world.db.prepare('SELECT id FROM stud_listings').get().id);

    // Default view: the in-foal mare is not offered at all, and the reason she's missing is named
    // rather than left for a click to discover.
    const page = await studDetailRoute(await contextFor(world, `/market/stud/${studListingId}`, 'GET'), studListingId);
    const pageHtml = await page.text();
    expect(page.status).toBe(200);
    expect(pageHtml).toContain('Not shown: CH First Mare (in foal, Cedar Hollow).');
    expect(pageHtml).not.toContain('CH First Mare</option>');
    expect(pageHtml).toContain('name="mare"');
    expect(pageHtml).toContain('CH Second Mare');
    expect(pageHtml).toContain('CH Third Mare');
    expect(pageHtml).toContain('Book CH Second Mare for 900');

    // Picking the other eligible mare gets a real book button for her instead, on the same page.
    const chosen = await studDetailRoute(
      await contextFor(world, `/market/stud/${studListingId}?mare=${thirdMareId}`, 'GET'),
      studListingId
    );
    const chosenHtml = await chosen.text();
    expect(chosenHtml).toContain('Book CH Third Mare for 900');
  });

  it('replaces the whole book form with a plain sentence when every mare is ineligible', async () => {
    const world = await buildWorld();
    // The only other mare in the stable, made ineligible too - now nothing at all can be booked.
    await world.env.DB.prepare(`UPDATE horses SET last_foaled_game_day = ? WHERE id = ?`).bind(GAME_DAY - 1, world.freeMareId).run();
    const { studDetailRoute } = await import('../../src/routes/market');
    const studListingId = Number(world.db.prepare('SELECT id FROM stud_listings').get().id);

    const page = await studDetailRoute(await contextFor(world, `/market/stud/${studListingId}`, 'GET'), studListingId);
    const pageHtml = await page.text();
    expect(pageHtml).toContain('None of your mares can be bred right now.');
    expect(pageHtml).toContain('CH First Mare (Cedar Hollow) is in foal');
    expect(pageHtml).toContain('CH Second Mare (Cedar Hollow) is recovering from foaling');
    expect(pageHtml).not.toContain('<form method="post" action="/market/stud/');
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
    expect(pageHtml).toContain('Quarter Horse - NPC Big Stallion at Apples and Oats Ranch. Fee 900.');

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
    // 2026-08-05 (slice 0025 §5): this used to assert the opposite - that an outside stallion's
    // conformation column read Unknown all the way down, because his conformation was shown nowhere
    // else in the game. That reasoning expired when stud listings started printing those words for
    // free: leaving it would have made this preview say Unknown next to a page showing the answer.
    // Both horses have shown here, so both columns carry real words and nothing reads Unknown.
    const traitCount = (world.db.prepare('SELECT COUNT(*) AS n FROM quantitative_traits WHERE category = ? AND enabled = 1').get('conformation') as { n: number }).n;
    expect(traitCount).toBeGreaterThan(0);
    expect((previewHtml.match(/<td>Unknown<\/td>/g) ?? []).length).toBe(0);
    // And the third column exists, with a real predicted range in it rather than a placeholder.
    expect(previewHtml).toContain('Likely foal');
    expect(previewHtml).not.toContain('No single standard');

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

  it('sorts the picker by breed, with the mare\'s own breed first', async () => {
    const world = await buildWorld();
    const { stableBreedRoute } = await import('../../src/routes/horses');
    const { createStudListing } = await import('../../src/db/stud');

    // Three more stallions at the same NPC ranch, deliberately listed newest-first-by-id in an
    // order that is neither alphabetical nor breed-grouped, so the page has something to sort.
    const thoroughbred = insertHorse(world.db, 'stallion', 'NPC Thoroughbred', world.npcStableId, 31, breedIdFor(world.db, 'TB'));
    const arabian = insertHorse(world.db, 'stallion', 'NPC Arabian', world.npcStableId, 32, breedIdFor(world.db, 'AR'));
    const secondQuarterHorse = insertHorse(world.db, 'stallion', 'NPC Another Quarter Horse', world.npcStableId, 33);
    for (const id of [thoroughbred, arabian, secondQuarterHorse]) {
      await createStudListing(world.env, { stallionId: id, stableId: world.npcStableId, fee: 500, seasonCap: 10, gameDay: GAME_DAY - 40 });
    }

    // Both mares are Quarter Horses, so both Quarter Horse stallions come first (by name), then
    // Arabian, then Thoroughbred.
    const page = await stableBreedRoute(await contextFor(world, `/stables/${world.playerStableId}/breed`, 'GET'), 'GET', world.playerStableId);
    const labels = outsideStudOptionLabels(await page.text());
    expect(labels).toEqual([
      'Quarter Horse - NPC Another Quarter Horse at Apples and Oats Ranch. Fee 500.',
      'Quarter Horse - NPC Big Stallion at Apples and Oats Ranch. Fee 900.',
      'Arabian - NPC Arabian at Apples and Oats Ranch. Fee 500.',
      'Thoroughbred - NPC Thoroughbred at Apples and Oats Ranch. Fee 500.',
    ]);

    // A mare of another breed re-sorts the same list around her own breed instead - nothing is
    // hidden, a cross-breed pairing is still legal, it is only the order that changes.
    world.db.prepare('UPDATE horses SET breed_id = ? WHERE id = ?').run(breedIdFor(world.db, 'AR'), world.freeMareId);
    const forArabianMare = await stableBreedRoute(
      await contextFor(world, `/stables/${world.playerStableId}/breed`, 'POST', `action=check&mare_id=${world.freeMareId}&stallion_id=&stud_listing_id=`),
      'POST',
      world.playerStableId
    );
    const arabianFirst = outsideStudOptionLabels(await forArabianMare.text());
    expect(arabianFirst[0]).toBe('Arabian - NPC Arabian at Apples and Oats Ranch. Fee 500.');
    expect(arabianFirst).toHaveLength(4);
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

// docs/fixes/breeding-eligibility-display.md §2: the Breed page's own two pickers (mare, and "your
// stallion") only offer horses that could actually be picked right now, the same fix the stud
// page's picker above just got.
describeWithSqlite("the Breed page's own pickers stop offering horses that cannot breed", () => {
  it('leaves out an ineligible mare and an ineligible stallion, naming both', async () => {
    const world = await buildWorld();
    const { stableBreedRoute } = await import('../../src/routes/horses');
    // A colt far short of min_breeding_age_game_days (1080) - too young, alongside a home stallion
    // that clears it fine.
    const coltId = insertHorse(world.db, 'stallion', 'CH Colt', world.playerStableId, 22);
    world.db.prepare('UPDATE horses SET born_game_day = ? WHERE id = ?').run(GAME_DAY - 500, coltId);
    const homeStallionId = insertHorse(world.db, 'stallion', 'CH Home Stallion', world.playerStableId, 23);

    const page = await stableBreedRoute(await contextFor(world, `/stables/${world.playerStableId}/breed`, 'GET'), 'GET', world.playerStableId);
    const pageHtml = await page.text();
    expect(page.status).toBe(200);
    // The in-foal mare from buildWorld is left off the mare picker, named in its own exclusion line.
    expect(pageHtml).not.toContain('CH First Mare - ');
    expect(pageHtml).toContain('Not shown: CH First Mare (in foal).');
    expect(pageHtml).toContain('CH Second Mare - ');
    // The colt is left off the stallion picker, named in its own exclusion line; the eligible home
    // stallion is still offered.
    expect(pageHtml).not.toContain('CH Colt - ');
    expect(pageHtml).toContain('Not shown: CH Colt (too young to breed yet).');
    expect(pageHtml).toContain('CH Home Stallion - ');
  });

  it('replaces the whole form with a plain sentence when no mare is eligible', async () => {
    const world = await buildWorld();
    const { stableBreedRoute } = await import('../../src/routes/horses');
    // The only other mare in the stable, made ineligible too - now nothing at all can be booked,
    // regardless of which stallion.
    world.db.prepare('UPDATE horses SET last_foaled_game_day = ? WHERE id = ?').run(GAME_DAY - 1, world.freeMareId);

    const page = await stableBreedRoute(await contextFor(world, `/stables/${world.playerStableId}/breed`, 'GET'), 'GET', world.playerStableId);
    const pageHtml = await page.text();
    expect(pageHtml).toContain('None of your mares can be bred right now.');
    expect(pageHtml).toContain('CH First Mare is in foal');
    expect(pageHtml).toContain('CH Second Mare is recovering from foaling');
    expect(pageHtml).not.toContain('<form method="post" action="/stables/');
  });
});
