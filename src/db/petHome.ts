// The pet home: where a horse goes when nobody in the game wants it.
//
// One mechanic, two ways in, and the operator asked for them to stay that way - same price, same
// ledger kind, same rule about whether the row survives:
//
//   - **A player chooses it** (sellHorseToPetHome, reached from the horse page). The outlet for a
//     horse a child has stopped wanting: it pays something rather than nothing, immediately, with
//     no waiting for a buyer who may never come.
//   - **An NPC stable's listing times out** (runNpcPetHomeSales, a tick stage). A listing that ran
//     its whole window with no buyer goes the same way. This is where an NPC stable's income
//     actually comes from now that it only shows when a player does - and it is earned, since a
//     stable only gets paid for horses it bred well enough to be worth something. Every player had
//     the full listing window to buy the horse first, so it never competes with a child. It also
//     stops an NPC's unsold culls returning to a barn that was already near capacity, which is what
//     made it list them in the first place.
//
// **The two ways in are not symmetric, and must not be made so.** A player's horse goes to a pet
// home only when that player says so - there is no tick stage, no timer and no automatic path that
// can ever send a child's horse away, and a player's listing expiring returns the horse to the barn
// exactly as it always has (expireListings, src/db/listings.ts). An NPC stable's horse goes only by
// its listing running the full window unsold - an NPC never "decides" to use a pet home. The tick
// stage below enforces its half structurally, by joining npc_policy and filtering is_npc = 1; the
// player's half is enforced by there being no caller of sellHorseToPetHome except the route a child
// clicks through. Do not add one.
//
// **The price is deliberately bad.** pet_home_payout_fraction is 0.4 of appraised value. A pet home
// has to be worse than selling to a player, or nobody would ever use the market - it is the floor
// under a horse's worth, not a way to cash out. No commission is taken on top: commission is what
// the market charges for finding a buyer, and this is precisely the case where it found none.
//
// Whether the horse's row survives is not this file's rule - it is src/db/horseRemoval.ts's, shared
// with nothing else today but written to be shared. A horse that never showed and never conceived
// is deleted outright; anything with a history behind it is marked `removed` and kept.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { horseDisplayName, type HorseRow } from './horses';
import { deletableHorseSql, buildHorseDepartureStatements, isHorseDeletable } from './horseRemoval';

/** The one pricing rule, used by both entry points and by the confirmation screen that has to tell
 * a child what they will get before they agree to it. Floors at market_min_value so a worthless
 * horse is still worth something to a pet home - nobody should be offered 6. */
export function petHomePayout(appraisedValue: number, config: Config): number {
  return Math.max(config.values.market_min_value, Math.round(appraisedValue * config.values.pet_home_payout_fraction));
}

/** The ledger row both entry points write, so the two can never describe the same event differently.
 * counterpartyStableId stays null - a pet home has no stables row, the same as a prize having no
 * counterparty. */
function petHomeLedgerEntry(params: {
  stableId: number;
  amount: number;
  horseName: string;
  gameDay: number;
  /** A deleted horse's listing row goes with it, and listing ids are rowids SQLite can hand out
   * again - so pointing at one would eventually name somebody else's listing. The stable is the
   * only thing on the receipt guaranteed to still be there. */
  deleted: boolean;
  listingId: number | null;
}): LedgerEntry {
  return {
    stableId: params.stableId,
    amount: params.amount,
    kind: 'pet_home_payout',
    referenceType: params.deleted || params.listingId === null ? 'stable' : 'listing',
    referenceId: params.deleted || params.listingId === null ? params.stableId : params.listingId,
    description: `${params.horseName} went to a pet home.`,
    gameDay: params.gameDay,
  };
}

// ---------------------------------------------------------------------------
// Entry point 1: a player chooses it
// ---------------------------------------------------------------------------

export interface SellToPetHomeResult {
  payout: number;
  deleted: boolean;
}

/**
 * Sends one horse to a pet home on its owner's instruction, and pays for it.
 *
 * The caller (src/routes/horses.ts) has already checked ownership and that the horse is alive; this
 * function owns the money, the departure and the withdrawal of anything the horse was standing in.
 * Those last two are statements in the *same* batch as the payment, so a horse cannot leave without
 * the money arriving or vice versa - the rule buildLedgerStatements' own header sets out.
 *
 * Open listings and stud listings are withdrawn rather than refused, matching what retiring a horse
 * away already does (src/routes/horses.ts's horseRetireRoute) - a child who wants a horse gone
 * should not have to go and un-list it first to be allowed to say so. On the deleted path the
 * listing rows are removed outright instead, which is why the withdrawal statements are ordered
 * ahead of the departure ones.
 */
export async function sellHorseToPetHome(
  env: Env,
  params: {
    horse: HorseRow;
    sellerStableId: number;
    appraisedValue: number;
    gameDay: number;
    config: Config;
    withdrawStatements: D1PreparedStatement[];
  }
): Promise<SellToPetHomeResult> {
  const payout = petHomePayout(params.appraisedValue, params.config);
  const deletable = await isHorseDeletable(env, params.horse.id);

  await env.DB.batch([
    ...params.withdrawStatements,
    ...buildHorseDepartureStatements(env, {
      horseId: params.horse.id,
      sex: params.horse.sex,
      gameDay: params.gameDay,
      endReason: 'pet_home',
      deletable,
    }),
    ...buildLedgerStatements(env, [
      petHomeLedgerEntry({
        stableId: params.sellerStableId,
        amount: payout,
        horseName: horseDisplayName(params.horse),
        gameDay: params.gameDay,
        deleted: deletable,
        listingId: null,
      }),
    ]),
  ]);

  return { payout, deleted: deletable };
}

// ---------------------------------------------------------------------------
// Entry point 2: an NPC stable's listing times out
// ---------------------------------------------------------------------------

interface TimedOutListingRow {
  listing_id: number;
  horse_id: number;
  price: number;
  guide_value: number | null;
  seller_stable_id: number;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  /** 1 when this horse never showed and never conceived - deletableHorseSql is the rule. */
  is_deletable: number;
}

/**
 * Every open listing that has run past its expiry, posted by an NPC stable that has an npc_policy
 * row, whose horse is still alive.
 *
 * All three conditions matter. The npc_policy join is what excludes the Consignment Yard: the dealer
 * mints its stock out of nothing and nothing reads its balance, so paying it for an unsold horse
 * would print money into a stable that has no use for it - and the dealer already has its own
 * cleanup path (releaseExpiredConsignments, src/db/consignment.ts). A horse that is no longer alive
 * has nothing to sell, and expireListings closes that listing on the same tick anyway.
 */
async function listTimedOutNpcListings(env: Env, gameDay: number): Promise<TimedOutListingRow[]> {
  const result = await env.DB.prepare(
    `SELECT l.id AS listing_id, l.horse_id, l.price, l.guide_value, l.seller_stable_id,
            h.registered_name, h.barn_name, h.sex,
            CASE WHEN ${deletableHorseSql} THEN 1 ELSE 0 END AS is_deletable
       FROM listings l
       JOIN horses h ON h.id = l.horse_id
       JOIN stables s ON s.id = l.seller_stable_id
       JOIN npc_policy p ON p.stable_id = s.id
      WHERE l.status = 'open' AND l.expires_game_day <= ? AND h.status = 'alive' AND s.is_npc = 1`
  )
    .bind(gameDay)
    .all<TimedOutListingRow>();
  return result.results ?? [];
}

/**
 * The tick stage. Sends each of those horses to a pet home at the same price a player gets, and
 * pays the stable.
 *
 * Runs immediately before expireListings, which is what makes the split work: this stage takes the
 * NPC listings that timed out with a live horse, expireListings takes everything left (player
 * listings, and NPC listings whose horse died while listed) exactly as it always has. Nothing in
 * src/db/listings.ts changes.
 *
 * Idempotent either way, for two different reasons worth keeping straight: the kept path is guarded
 * by `status = 'open'` on the listing and `status = 'alive'` inside the departure helper, while the
 * deleted path is idempotent because the listing this stage selects on is gone - a re-fired tick's
 * query returns no row for a horse that no longer exists.
 */
export async function runNpcPetHomeSales(env: Env, gameDay: number, config: Config): Promise<void> {
  const rows = await listTimedOutNpcListings(env, gameDay);
  if (rows.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  const ledgerEntries: LedgerEntry[] = [];

  for (const row of rows) {
    // guide_value is nullable on the table, though createListing always sets it for an NPC seller.
    // Falling back to the asking price keeps a null row from clearing at 0 rather than skipping it.
    const payout = petHomePayout(row.guide_value ?? row.price, config);
    const deleted = row.is_deletable === 1;

    // No `UPDATE listings SET status = 'expired'` on the deleted path - the departure statements
    // remove the listing row outright, so setting a status on it first would be writing to a row
    // that does not survive the same batch.
    if (!deleted) {
      statements.push(env.DB.prepare(`UPDATE listings SET status = 'expired', closed_game_day = ? WHERE id = ? AND status = 'open'`).bind(gameDay, row.listing_id));
    }
    statements.push(...buildHorseDepartureStatements(env, { horseId: row.horse_id, sex: row.sex, gameDay, endReason: 'pet_home', deletable: deleted }));
    ledgerEntries.push(
      petHomeLedgerEntry({
        stableId: row.seller_stable_id,
        amount: payout,
        horseName: horseDisplayName(row),
        gameDay,
        deleted,
        listingId: row.listing_id,
      })
    );
  }

  await env.DB.batch([...statements, ...buildLedgerStatements(env, ledgerEntries)]);
}
