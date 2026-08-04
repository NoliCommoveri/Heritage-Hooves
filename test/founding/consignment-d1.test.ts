/**
 * Amendment 0017a §5.9 - the consignment dealer tests that need a real database (idempotency, the
 * injection queue, the "never remove a sold horse" guard). Same harness as
 * test/market/sale-d1.test.ts - see that file's header for what it is and is not a substitute for.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { splitSqlStatements } from '../../src/lib/sql';
import { runConsignments, queueInjection, listInjectionHistory, getConsignmentDealerStable, forceConsignmentBatchNow } from '../../src/db/consignment';
import { expireListings } from '../../src/db/listings';
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

/** Reads the config row directly rather than through src/lib/config-cache.ts's own getConfig - that
 * module caches in a process-wide variable for 60 real seconds, which would leak one test's fresh
 * in-memory database's config into the next test in this same file. */
function readConfig(db: DatabaseSync): Config {
  const row = db.prepare('SELECT version, "values", flags FROM config WHERE id = 1').get() as { version: number; values: string; flags: string };
  return { version: row.version, values: JSON.parse(row.values), flags: JSON.parse(row.flags) };
}

describeWithSqlite('runConsignments (amendment 0017a §5.9)', () => {
  it('is idempotent: running it twice at the same game_day mints one batch', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await runConsignments(env, 1000, 100, config);
    const dealer = await getConsignmentDealerStable(env);
    expect(dealer).not.toBeNull();
    const firstCount = (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n;
    expect(firstCount).toBeGreaterThan(0);

    await runConsignments(env, 1000, 100, config);
    const secondCount = (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n;
    expect(secondCount).toBe(firstCount);
  });

  it('mints nothing a second time until the cadence has actually elapsed, then mints again', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    const cadence = config.values.consignment_cadence_game_days;

    await runConsignments(env, 1000, 100, config);
    const dealer = await getConsignmentDealerStable(env);
    const afterFirst = (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n;

    await runConsignments(env, 1000 + cadence - 1, 101, config);
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n).toBe(afterFirst);

    await runConsignments(env, 1000 + cadence, 102, config);
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n).toBeGreaterThan(afterFirst);
  });

  it('an injected allele appears in the minted horse, moves the injection to applied, and is pre-tested', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'Cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: 'test',
      gameDay: 900,
      config,
    });
    expect(queued.ok).toBe(true);

    await runConsignments(env, 1000, 100, config);

    const history = await listInjectionHistory(env);
    const applied = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(applied?.status).toBe('applied');
    expect(applied?.applied_horse_id).not.toBeNull();

    const horse = db.prepare('SELECT genotype FROM horses WHERE id = ?').get(applied!.applied_horse_id) as { genotype: string };
    const genotype = JSON.parse(horse.genotype) as { mendelian: Record<string, [string, string]> };
    expect(genotype.mendelian.CR).toContain('Cr');

    const knowledge = db
      .prepare('SELECT result FROM horse_knowledge WHERE horse_id = ? AND subject_code = ?')
      .get(applied!.applied_horse_id, 'locus:CR') as { result: string } | undefined;
    expect(knowledge).toBeDefined();
    expect(knowledge!.result).toContain('Cr');
  });

  it('sweeps an unclaimed listing to removed, and expireListings closes it the same tick', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await runConsignments(env, 1000, 100, config);
    const dealer = await getConsignmentDealerStable(env);
    const listing = db.prepare('SELECT id, horse_id, expires_game_day FROM listings WHERE seller_stable_id = ? LIMIT 1').get(dealer!.id) as {
      id: number;
      horse_id: number;
      expires_game_day: number;
    };

    const pastExpiry = listing.expires_game_day + 1;
    await runConsignments(env, pastExpiry, 200, config); // triggers the sweep stage before minting again
    await expireListings(env, pastExpiry);

    const horse = db.prepare('SELECT status FROM horses WHERE id = ?').get(listing.horse_id) as { status: string };
    const closedListing = db.prepare('SELECT status FROM listings WHERE id = ?').get(listing.id) as { status: string };
    expect(horse.status).toBe('removed');
    expect(closedListing.status).toBe('expired');
  });

  it('never removes a sold dealer horse, however far past its listing expiry', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await runConsignments(env, 1000, 100, config);
    const dealer = await getConsignmentDealerStable(env);
    const listing = db.prepare('SELECT id, horse_id, expires_game_day FROM listings WHERE seller_stable_id = ? LIMIT 1').get(dealer!.id) as {
      id: number;
      horse_id: number;
      expires_game_day: number;
    };

    // Mark it sold, the way a real purchase would - a buyer stable must exist for the FK.
    db.exec(
      `INSERT INTO accounts (username, display_name, password_hash, is_admin, active, must_change_password, created_real_ts) VALUES ('buyer','Buyer','x',0,1,0,0)`
    );
    db.exec(
      `INSERT INTO stables (account_id, name, prefix, prefix_set_game_day, prefix_locked, is_npc, balance, capacity, created_game_day, created_real_ts, active) VALUES (1,'Buyer Stable','BS',0,1,0,10000,20,0,0,1)`
    );
    const buyerStableId = (db.prepare('SELECT id FROM stables WHERE prefix = ?').get('BS') as { id: number }).id;
    db.prepare('UPDATE listings SET status = ?, buyer_stable_id = ?, sold_game_day = ? WHERE id = ?').run('sold', buyerStableId, 1050, listing.id);
    db.prepare('UPDATE horses SET owner_stable_id = ? WHERE id = ?').run(buyerStableId, listing.horse_id);

    const farPastExpiry = listing.expires_game_day + 10_000;
    await runConsignments(env, farPastExpiry, 999, config);
    await expireListings(env, farPastExpiry);

    const horse = db.prepare('SELECT status, owner_stable_id FROM horses WHERE id = ?').get(listing.horse_id) as { status: string; owner_stable_id: number };
    expect(horse.status).toBe('alive');
    expect(horse.owner_stable_id).toBe(buyerStableId);
  });
});

describeWithSqlite('forceConsignmentBatchNow (admin "mint a batch now" button)', () => {
  it('mints immediately even when nowhere near the regular cadence, unlike runConsignments', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    await runConsignments(env, 1000, 100, config);
    const dealer = await getConsignmentDealerStable(env);
    const afterFirst = (db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n;

    // One game day later - runConsignments would decline, cadence not elapsed.
    await runConsignments(env, 1001, 101, config);
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n).toBe(afterFirst);

    const result = await forceConsignmentBatchNow(env, 1001, 101, config);
    expect(result.ok).toBe(true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM listings WHERE seller_stable_id = ?').get(dealer!.id) as { n: number }).n).toBeGreaterThan(afterFirst);
  });

  it('applies a queued injection the same game day it was queued, without waiting for the next scheduled batch', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);

    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'Cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: 'test',
      gameDay: 1000,
      config,
    });
    expect(queued.ok).toBe(true);

    const result = await forceConsignmentBatchNow(env, 1000, 100, config);
    expect(result.ok).toBe(true);

    const history = await listInjectionHistory(env);
    const applied = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(applied?.status).toBe('applied');
    expect(applied?.applied_game_day).toBe(1000);
  });
});

describeWithSqlite('queued injections defer past an already-due batch (amendment 0017a §5.4 follow-up)', () => {
  it('a batch already due when the injection is queued does not consume it - only the batch after does', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    const cadence = config.values.consignment_cadence_game_days;

    await runConsignments(env, 1000, 100, config); // dealer's first-ever batch, last listed = 1000
    const dueDay = 1000 + cadence;
    const queueDay = dueDay + 5; // queued after the next batch is already overdue

    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'Cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: 'test',
      gameDay: queueDay,
      config,
    });
    expect(queued.ok).toBe(true);

    // This mint is the one that was already due before the injection was queued - it must not
    // pick it up, or the operator's "next batch" intent silently gets swept into "current".
    await runConsignments(env, queueDay, 101, config);
    let history = await listInjectionHistory(env);
    let row = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(row?.status).toBe('queued');

    // The batch after that one picks it up.
    await runConsignments(env, queueDay + cadence, 102, config);
    history = await listInjectionHistory(env);
    row = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(row?.status).toBe('applied');
  });

  it('queuing before a batch is due still targets that same, genuinely-next batch', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    const cadence = config.values.consignment_cadence_game_days;

    await runConsignments(env, 1000, 100, config);
    const dueDay = 1000 + cadence;

    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'Cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: 'test',
      gameDay: 1010, // well before dueDay, nothing overdue yet
      config,
    });
    expect(queued.ok).toBe(true);

    await runConsignments(env, dueDay, 101, config);
    const history = await listInjectionHistory(env);
    const row = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(row?.status).toBe('applied');
    expect(row?.applied_game_day).toBe(dueDay);
  });

  it('"mint a batch now" ignores the deferral and applies a just-queued injection immediately', async () => {
    const db = freshDb();
    const env = makeEnv(db);
    const config = readConfig(db);
    const cadence = config.values.consignment_cadence_game_days;

    await runConsignments(env, 1000, 100, config);
    const dueDay = 1000 + cadence;
    const queueDay = dueDay + 5;

    const queued = await queueInjection(env, {
      locusCode: 'CR',
      allele: 'Cr',
      zygosity: 'het',
      appliesTo: 'one',
      sexPreference: 'any',
      note: 'test',
      gameDay: queueDay,
      config,
    });
    expect(queued.ok).toBe(true);

    const result = await forceConsignmentBatchNow(env, queueDay, 101, config);
    expect(result.ok).toBe(true);
    const history = await listInjectionHistory(env);
    const row = history.find((h) => h.locus_code === 'CR' && h.allele === 'Cr');
    expect(row?.status).toBe('applied');
    expect(row?.applied_game_day).toBe(queueDay);
  });
});
