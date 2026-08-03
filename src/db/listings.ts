// The market's database layer (slice 0017 Part A). Everything that reads or writes `listings` lives
// here; the appraisal itself is a pure engine (src/engines/market/appraise.ts) and the screens are
// src/routes/market.ts + src/render/market.ts, the same split every other feature in this codebase
// follows.
//
// Two new event kinds are written from this file. events.kind is deliberately free text with no
// CHECK (migrations/0048_events.sql's own comment), so neither needed a migration - their payload
// shapes are documented here rather than in that migration, which is already applied and must not
// be edited (CLAUDE.md §8):
//   horse_sold      -> {"v":1,"horse_name":"...","price":4000,"buyer_stable_name":"..."}
//   listing_expired -> {"v":1,"horse_name":"...","price":4000}
// Both go to the SELLER only. The buyer needs no event - they were there, pressing the button - and
// an expiry is news only to the stable whose horse did not sell.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { buildLedgerStatements } from './ledger';
import { buildEventStatement } from './events';
import { horseDisplayName, type HorseRow } from './horses';
import { getBreedById } from './breeds';
import { getKnowledgeForHorse } from './health';
import { getShowSummary } from './shows';
import { conformationValues, noiseFor } from '../engines/conformation/model';
import { parseGenotype } from '../engines/genetics/genotype';
import { expressPhenotype } from '../engines/genetics/expression';
import { hiddenColourAlleleCount } from '../engines/genetics/inference';
import { displayColourName } from '../render/colour';
import { parseIdealVector } from '../engines/showing/score';
import { appraise, type Appraisal, type AppraiseConfig, type KnownResult } from '../engines/market/appraise';
import type { TraitCode } from '../engines/genetics/polygenic';
import type { ConfigValues } from '../lib/config-cache';

const LOCUS_KNOWLEDGE_PREFIX = 'locus:';

export type ListingStatus = 'open' | 'sold' | 'withdrawn' | 'expired';

export interface ListingRow {
  id: number;
  horse_id: number;
  seller_stable_id: number;
  price: number;
  guide_value: number | null;
  listed_game_day: number;
  /** Snapshotted at listing time from market_listing_game_days (CLAUDE.md §5.5). */
  expires_game_day: number;
  status: ListingStatus;
  buyer_stable_id: number | null;
  sold_game_day: number | null;
  commission_paid: number | null;
  closed_game_day: number | null;
  created_real_ts: number;
}

/** One row of /market's list, or of the barn badge - the horse and the selling stable resolved in
 * the same query rather than a lookup per row (the discipline listClassEntriesForDisplay and
 * listStablesForWorld already follow). */
export interface OpenListingRow extends ListingRow {
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  born_game_day: number;
  breed_id: number | null;
  is_cross: number;
  genotype: string;
  image_url: string | null;
  seller_stable_name: string;
  /** Null for an NPC stable (Parts B and C, not built) or a deleted account. */
  seller_account_id: number | null;
}

export interface SoldListingRow extends ListingRow {
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  seller_stable_name: string;
  buyer_stable_name: string | null;
}

const OPEN_LISTING_SELECT = `
  SELECT l.*, h.registered_name, h.barn_name, h.sex, h.born_game_day, h.breed_id, h.is_cross,
         h.genotype, h.image_url, s.name AS seller_stable_name, s.account_id AS seller_account_id
    FROM listings l
    JOIN horses h ON h.id = l.horse_id
    JOIN stables s ON s.id = l.seller_stable_id`;

/**
 * §6.1: every open listing in the game, optionally narrowed by breed. The breed filter happens in
 * the query, not after the fetch (§6.1's own requirement); the barn-tab filter (All / Mares /
 * Stallions / Foals / Geldings) is applied in the route with src/lib/barnFilter.ts's bucketFor,
 * since that rule is a pure function shared with the barn list and re-expressing it as SQL would be
 * a second copy of it.
 *
 * A listing whose horse has since died is excluded here as well as being swept by the tick (§8) -
 * the sweep runs at most a few times a real day, and a dead horse should not sit on the market in
 * between.
 */
export async function listOpenListings(env: Env, breedId: number | null): Promise<OpenListingRow[]> {
  const breedClause = breedId === null ? '' : ' AND h.breed_id = ?';
  const statement = env.DB.prepare(`${OPEN_LISTING_SELECT} WHERE l.status = 'open' AND h.status = 'alive'${breedClause} ORDER BY l.id DESC`);
  const bound = breedId === null ? statement : statement.bind(breedId);
  const result = await bound.all<OpenListingRow>();
  return result.results ?? [];
}

export async function getListing(env: Env, id: number): Promise<OpenListingRow | null> {
  return env.DB.prepare(`${OPEN_LISTING_SELECT} WHERE l.id = ?`).bind(id).first<OpenListingRow>();
}

/** The open listing for one horse, if it has one - the horse page's own "this is on the market"
 * block, and the guard that stops a second listing being offered. */
export async function getOpenListingForHorse(env: Env, horseId: number): Promise<ListingRow | null> {
  return env.DB.prepare(`SELECT * FROM listings WHERE horse_id = ? AND status = 'open'`).bind(horseId).first<ListingRow>();
}

/** §6.5: the barn list's price badge - every open listing across a stable's own horses, in one
 * query rather than one per row. */
export async function openListingsBySellerStable(env: Env, stableId: number): Promise<Map<number, ListingRow>> {
  const result = await env.DB.prepare(`SELECT * FROM listings WHERE seller_stable_id = ? AND status = 'open'`).bind(stableId).all<ListingRow>();
  const map = new Map<number, ListingRow>();
  for (const row of result.results ?? []) map.set(row.horse_id, row);
  return map;
}

/** §6.4: completed sales, newest first, visible to every logged-in player (§2.9). Commission is not
 * shown here - it is the seller's business and appears in their own ledger. */
export async function listSoldListings(env: Env, limit: number): Promise<SoldListingRow[]> {
  const result = await env.DB.prepare(
    `SELECT l.*, h.registered_name, h.barn_name, h.sex,
            s.name AS seller_stable_name, b.name AS buyer_stable_name
       FROM listings l
       JOIN horses h ON h.id = l.horse_id
       JOIN stables s ON s.id = l.seller_stable_id
       LEFT JOIN stables b ON b.id = l.buyer_stable_id
      WHERE l.status = 'sold'
      ORDER BY l.sold_game_day DESC, l.id DESC
      LIMIT ?`
  )
    .bind(limit)
    .all<SoldListingRow>();
  return result.results ?? [];
}

export interface CreateListingParams {
  horseId: number;
  sellerStableId: number;
  price: number;
  guideValue: number | null;
  gameDay: number;
  /** market_listing_game_days, read live here and snapshotted onto the row (CLAUDE.md §5.5). */
  listingGameDays: number;
}

export type CreateListingResult = { ok: true; listingId: number } | { ok: false; error: 'already_listed' };

/**
 * §6.3: free, spends no turn, no fee. The partial unique index
 * (idx_listings_one_open_per_horse) is what makes "a horse is on the market once at a time" true,
 * rather than a check somebody forgets - a race between two submissions fails the second insert and
 * is translated here, not surfaced as a raw SQLite error.
 */
export async function createListing(env: Env, params: CreateListingParams): Promise<CreateListingResult> {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO listings (horse_id, seller_stable_id, price, guide_value, listed_game_day, expires_game_day, status, created_real_ts)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    )
      .bind(params.horseId, params.sellerStableId, params.price, params.guideValue, params.gameDay, params.gameDay + params.listingGameDays, nowUtcSeconds())
      .run();
    return { ok: true, listingId: result.meta.last_row_id };
  } catch (err) {
    if (err instanceof Error && /unique constraint failed/i.test(err.message)) return { ok: false, error: 'already_listed' };
    throw err;
  }
}

/**
 * §7.4: free, no action, no event. Guarded on seller_stable_id and status in the WHERE clause
 * rather than only in the route, so a withdraw racing a purchase changes zero rows instead of
 * un-selling a sold horse. Returns whether anything actually closed.
 */
export async function withdrawListing(env: Env, listingId: number, sellerStableId: number, gameDay: number): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE listings SET status = 'withdrawn', closed_game_day = ? WHERE id = ? AND seller_stable_id = ? AND status = 'open'`
  )
    .bind(gameDay, listingId, sellerStableId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * §7.4/§2.8: retiring a listed horse away withdraws its listing, in the same batch as the rest of
 * the retire-away path. Built as a statement rather than run here so it lands atomically with the
 * horse's own status change - no `status = 'open'` race can leave a live listing pointing at a
 * retired horse.
 */
export function buildWithdrawListingsForHorseStatement(env: Env, horseId: number, gameDay: number): D1PreparedStatement[] {
  return [env.DB.prepare(`UPDATE listings SET status = 'withdrawn', closed_game_day = ? WHERE horse_id = ? AND status = 'open'`).bind(gameDay, horseId)];
}

/** §2.5: integer arithmetic, never a float multiply - money is always an integer (CLAUDE.md §7).
 * Pure, so test/market/sale.test.ts can exercise it without a database. Floors, so the seller never
 * loses a fraction of a unit more than the rate says. */
export function commissionFor(price: number, commissionPercent: number): number {
  return Math.floor((price * commissionPercent) / 100);
}

export interface SaleParams {
  listing: ListingRow;
  horseName: string;
  buyerStableId: number;
  buyerStableName: string;
  buyerAccountId: number | null;
  sellerStableId: number;
  sellerStableName: string;
  sellerAccountId: number | null;
  gameDay: number;
  commissionPercent: number;
}

export type SaleResult = { ok: true } | { ok: false; error: 'gone' };

/**
 * §7.2, the whole sale, in one env.DB.batch() - D1 batches are one implicit transaction, so either
 * the whole sale happens or none of it does (build log, 2 Aug 2026). The buyer's action spend is
 * deliberately NOT in this batch: spendAction is its own guarded UPDATE and the codebase's
 * established order is check, act, then spend (slice 0009 Part B §5.3) - a race that loses the spend
 * lets a purchase through free rather than charging a child for something that did not happen.
 *
 * Nothing is written for a pregnancy: foalDuePregnancies already reads dam.owner_stable_id at the
 * moment of foaling for both the foal's owner and its breeder_stable_id/breeder_prefix
 * (src/db/pregnancies.ts), so selling a mare in foal gives the buyer the foal, born in their barn
 * under their prefix, with no code at all. **Do not "fix" this** - §2.6 decided it, and Part D
 * settles the same rule for stud services.
 */
export async function sellListing(env: Env, params: SaleParams): Promise<SaleResult> {
  const commission = commissionFor(params.listing.price, params.commissionPercent);
  const sameAccount = params.buyerAccountId !== null && params.buyerAccountId === params.sellerAccountId;

  let results: D1Result[];
  try {
    results = await env.DB.batch(buildSaleStatements(env, { ...params, commission, sameAccount }));
  } catch (err) {
    // §7.3: the trip-wire in statements 0 and 1 fired - somebody else bought this listing, or the
    // horse died or moved, between the route's read and this write. The batch is one transaction,
    // so a constraint failure rolled back every part of it: no money moved, no horse moved, no
    // ledger row written. See buildSaleStatements for why the guard is shaped this way.
    if (err instanceof Error && /not null constraint failed/i.test(err.message)) return { ok: false, error: 'gone' };
    throw err;
  }

  // Belt and braces for the one case the trip-wire cannot catch: a `WHERE id = ?` that matches no
  // row at all changes nothing and raises nothing. The route always reads the listing first, so
  // this should be unreachable - but "should be unreachable" is not the same as "cannot happen",
  // and the cost of being wrong here is a child's money vanishing.
  if ((results[0].meta.changes ?? 0) === 0 || (results[1].meta.changes ?? 0) === 0) return { ok: false, error: 'gone' };
  return { ok: true };
}

interface SaleStatementParams extends SaleParams {
  commission: number;
  sameAccount: boolean;
}

/**
 * The statements §7.2 lists, in that order. Split out from sellListing above so a test can assert
 * what a sale actually writes without a database (test/market/sale.test.ts) - the same shape
 * buildLedgerStatements, buildFoalInsertStatements and buildEndHorseParticipationStatements already
 * use. **Statement 0 must stay the listing update and statement 1 the horse update**: sellListing
 * reads meta.changes off both by index.
 *
 * ## Why statements 0 and 1 assign through a CASE instead of carrying a WHERE guard
 *
 * §7.3 asks for the race guards to be `WHERE` clauses and for `meta.changes` to be checked after
 * the batch. **That is not sufficient on its own, and this was caught by actually running two
 * concurrent buys against a real database rather than by reading the spec.** A `WHERE status =
 * 'open'` that matches nothing is not an error in SQLite - it changes zero rows and the batch
 * happily carries on to the ledger inserts, the balance updates, the knowledge copy and the event.
 * The second buyer would have been charged in full for a horse they did not get, and `meta.changes`
 * would have told us about it only after the money had already moved.
 *
 * So the guard has to *abort the transaction*, not merely match nothing. Assigning
 * `CASE WHEN <still valid> THEN <new value> ELSE NULL END` into a `NOT NULL` column does exactly
 * that: when the listing is no longer open (or the horse is no longer alive and owned by the
 * seller) the write attempts a NULL, SQLite raises a NOT NULL constraint failure, and D1 rolls the
 * whole batch back - the same "a constraint violation aborts the batch" behaviour slice 0010's test
 * purchase already relies on. sellListing catches it and returns a sentence.
 *
 * If you change either statement, keep the trip-wire. Turning it back into a plain `WHERE` clause
 * reintroduces a bug that silently takes a child's money.
 */
export function buildSaleStatements(env: Env, params: SaleStatementParams): D1PreparedStatement[] {
  const { listing, buyerStableId, sellerStableId, gameDay, commission, sameAccount } = params;
  const price = listing.price;
  const ledgerRef = { referenceType: 'listing', referenceId: listing.id };

  return [
    // listings.status is NOT NULL: a listing that is no longer open trips the wire and rolls the
    // whole sale back. See this function's own comment.
    env.DB
      .prepare(
        `UPDATE listings
            SET status = CASE WHEN status = 'open' THEN 'sold' ELSE NULL END,
                buyer_stable_id = ?, sold_game_day = ?, commission_paid = ?, closed_game_day = ?
          WHERE id = ?`
      )
      .bind(buyerStableId, gameDay, commission, gameDay, listing.id),
    // The barn name and notes clear on transfer (§1) - a barn name is what the *current* owner calls
    // the horse, and the registered name (which never changes) is what carries across. `notes` is
    // not a column on `horses` today, so there is nothing to clear beyond the barn name; when a
    // notes column arrives, it clears here.
    //
    // horses.owner_stable_id is NOT NULL, so the same trip-wire covers a horse that died or changed
    // hands between the route's read and this write.
    env.DB
      .prepare(
        `UPDATE horses
            SET owner_stable_id = CASE WHEN status = 'alive' AND owner_stable_id = ? THEN ? ELSE NULL END,
                barn_name = NULL
          WHERE id = ?`
      )
      .bind(sellerStableId, buyerStableId, listing.horse_id),
    ...buildLedgerStatements(env, [
      {
        stableId: buyerStableId,
        amount: -price,
        kind: 'purchase',
        ...ledgerRef,
        description: `Bought ${params.horseName} from ${params.sellerStableName}.`,
        gameDay,
        counterpartyStableId: sellerStableId,
        sameAccount,
      },
      {
        stableId: sellerStableId,
        amount: price,
        kind: 'sale',
        ...ledgerRef,
        description: `Sold ${params.horseName} to ${params.buyerStableName}.`,
        gameDay,
        counterpartyStableId: buyerStableId,
        sameAccount,
      },
      {
        stableId: sellerStableId,
        amount: -commission,
        kind: 'commission',
        ...ledgerRef,
        description: 'Sale commission.',
        gameDay,
        // No counterparty: commission is paid to the market, not to the buyer. It is the sink
        // (§2.5), and the money leaves the game rather than moving between two books.
        counterpartyStableId: null,
        sameAccount,
      },
    ]),
    // §7.2 step 4: copy, never reassign (schema §4.4 - the seller remembers what they knew about a
    // horse they no longer own). OR IGNORE against idx_horse_knowledge_unique handles a buyer who
    // already tested this horse during a previous ownership. cost_paid is 0: the buyer did not pay
    // for these.
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, cost_paid)
         SELECT ?, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, 0
           FROM horse_knowledge WHERE stable_id = ? AND horse_id = ?`
      )
      .bind(buyerStableId, sellerStableId, listing.horse_id),
    // §2.6: an unresolved covering follows the mare, so the conception-or-miss event goes to
    // whoever owns her when it resolves.
    env.DB.prepare(`UPDATE coverings SET stable_id = ? WHERE mare_id = ? AND status = 'booked'`).bind(buyerStableId, listing.horse_id),
    // §2.6: an unjudged entry follows the horse, so the placing and any prize money land with the
    // new owner.
    env.DB.prepare('UPDATE show_entries SET entered_by_stable_id = ? WHERE horse_id = ? AND placing IS NULL').bind(buyerStableId, listing.horse_id),
    ...buildEventStatement(env, {
      stableId: sellerStableId,
      accountId: params.sellerAccountId,
      gameDay,
      kind: 'horse_sold',
      subjectHorseId: listing.horse_id,
      payload: { horse_name: params.horseName, price, buyer_stable_name: params.buyerStableName },
    }),
  ];
}

/**
 * The database side of §4: reads everything the pure appraisal needs and hands it in already
 * computed, so src/engines/market/appraise.ts stays a function of data (CLAUDE.md §5.1).
 *
 * `stableId` is whose *knowledge* the health term is computed from - the seller's, always. Two
 * stables can appraise the same horse differently and that is correct: a tested-clear premium
 * belongs to whoever paid for the tests (§2.3).
 *
 * The falloff comes from the live show_ideal_falloff. §4.3 does not say where it should come from;
 * using the live value rather than snapshotting one means a retune of how harshly a show punishes
 * being off-standard moves what the game thinks a horse is worth, which is the same
 * one-formula-not-two argument §4.1 makes for reusing scoreEntry at all.
 */
export async function appraiseHorseForStable(env: Env, horse: HorseRow, stableId: number, gameDay: number, config: ConfigValues): Promise<Appraisal> {
  const [breed, knowledge, summary] = await Promise.all([
    horse.breed_id ? getBreedById(env, horse.breed_id) : Promise.resolve(undefined),
    getKnowledgeForHorse(env, stableId, horse.id),
    getShowSummary(env, horse.id),
  ]);

  const ageGameDays = gameDay - horse.born_game_day;
  const ageYears = ageGameDays / config.game_days_per_year;
  const genotype = parseGenotype(horse.genotype);
  const values = conformationValues(genotype, noiseFor(horse.rng_seed, horse.environmental_noise), ageYears, horse.coi, config);
  const expressed: Partial<Record<TraitCode, number>> = {};
  for (const v of values) expressed[v.code] = v.expressed;

  const placings = summary ? (JSON.parse(summary.placings) as Record<string, number>) : {};
  const topThree = (placings['1'] ?? 0) + (placings['2'] ?? 0) + (placings['3'] ?? 0);

  // Amendment 0017a §4.7: colour never reads horses.genotype for this term - only the expressed
  // phenotype (public, the same "a stranger at a show can see it" rule health's visible-affected
  // check already uses) and this stable's own locus: knowledge rows.
  const phenotype = expressPhenotype(genotype, ageGameDays, config.game_days_per_year);
  const colourKnowledge = knowledge.filter((k) => k.kind === 'genotype' && k.subject_code.startsWith(LOCUS_KNOWLEDGE_PREFIX));
  const testedLocusCodes = colourKnowledge.map((k) => k.subject_code.slice(LOCUS_KNOWLEDGE_PREFIX.length));
  const creamTested = testedLocusCodes.includes('CR');

  return appraise({
    expressed,
    ideal: breed?.ideal_vector ? parseIdealVector(breed.ideal_vector) : null,
    falloff: config.show_ideal_falloff,
    ageGameDays,
    // §4.2: the announced Failing notice, which the owner has already been told about explicitly -
    // never horses.natural_death_game_day, which is the rolled lifespan and is never rendered in any
    // form. Do not "improve" this by reading the death day.
    isFailing: horse.frailty_notice_game_day !== null,
    knownResults: knowledge.filter((k) => k.kind === 'genotype' && !k.subject_code.startsWith(LOCUS_KNOWLEDGE_PREFIX)).map((k) => k.result as KnownResult),
    wins: summary?.wins ?? 0,
    topThree,
    visibleColour: displayColourName(phenotype.visibleColour, creamTested),
    knownHiddenColourAlleleCount: hiddenColourAlleleCount(phenotype, testedLocusCodes),
    params: config as AppraiseConfig,
  });
}

interface ExpiringListingRow {
  id: number;
  horse_id: number;
  price: number;
  seller_stable_id: number;
  account_id: number | null;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
}

/**
 * §8, the tick's one new stage: closes every open listing that has run past its snapshotted expiry
 * day, and every open listing whose horse is no longer alive (§7.4's third case - a horse that dies
 * while listed leaves a listing pointing at a dead horse; §7.1 step 3 means nobody can buy one in
 * the meantime).
 *
 * **Idempotency comes free from the `status = 'open'` guard**, the same way killDueLethalFoals gets
 * it from `status = 'alive'` - a re-fired tick finds nothing left to change and therefore writes no
 * second event. No processed-marker column is needed (CLAUDE.md §5.4).
 */
export async function expireListings(env: Env, gameDay: number): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT l.id, l.horse_id, l.price, l.seller_stable_id, s.account_id,
            h.registered_name, h.barn_name, h.sex
       FROM listings l
       JOIN horses h ON h.id = l.horse_id
       JOIN stables s ON s.id = l.seller_stable_id
      WHERE l.status = 'open' AND (l.expires_game_day <= ? OR h.status <> 'alive')`
  )
    .bind(gameDay)
    .all<ExpiringListingRow>();

  const rows = due.results ?? [];
  if (rows.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    statements.push(
      env.DB.prepare(`UPDATE listings SET status = 'expired', closed_game_day = ? WHERE id = ? AND status = 'open'`).bind(gameDay, row.id),
      ...buildEventStatement(env, {
        stableId: row.seller_stable_id,
        accountId: row.account_id,
        gameDay,
        kind: 'listing_expired',
        subjectHorseId: row.horse_id,
        payload: { horse_name: horseDisplayName(row), price: row.price },
      })
    );
  }
  await env.DB.batch(statements);
}
