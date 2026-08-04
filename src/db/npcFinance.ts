// Keeping NPC stables solvent, now that they only ever show when a player does and only ever take
// the slots a player left (the show-field top-up rule in src/db/shows.ts's judgeOneClass).
//
// **Why this file exists.** An NPC stable's outgoings are real - it buys player horses on both
// routes in src/db/npcBuying.ts, and pays for a full disease panel every time it lists (700, in
// src/db/npcMarket.ts). Its income was prize money, sale proceeds and stud fees, and prize money is
// now conditional on the children choosing to show. That is the wrong thing to depend on: a quiet
// fortnight earns an NPC stable nothing, so it stops buying and stops listing, and the market is
// dead exactly when the children come back to it. Slice 0015 §2.5 already exempted NPC stables from
// board for the matching reason on the other side of the ledger - nobody is playing the stable, so
// the charge modelled no decision. This file finishes that thought for income.
//
// Two mechanisms, deliberately separate:
//
// 1. **The income floor** (runNpcBalanceFloor). Once every npc_balance_floor_interval_game_days,
//    a stable below its own npc_policy.balance_floor is topped back up to it. A top-up-to, never an
//    add: a stable that is earning gets nothing at all. This is a safety net against a stable going
//    permanently silent, not an operating budget - the ceiling on how much money it can create is
//    one floor per stable per interval, and it only ever pays out to a stable that has already
//    failed to earn.
//
// 2. **Off-screen clearance** (runNpcListingClearance). An NPC listing that ran its full window
//    unsold is sold to a buyer outside the game at npc_listing_clearance_fraction of guide value,
//    and the horse leaves. This is the income an NPC stable actually lives on, and it is earned:
//    a stable only gets paid for horses it bred well enough to be worth something. Every player had
//    the full listing window to buy the horse first, so this never competes with a child. It also
//    fixes a second thing for free - an NPC's unsold culls used to come back into a barn that was
//    already near capacity, which is what made it list in the first place.
//
// The marker-column pattern in mechanism 1 (npc_policy.last_floor_topup_game_day) is the same one
// stables.last_upkeep_game_day and npc_policy.last_bred_game_day already establish (CLAUDE.md §5.4).
// Mechanism 2 needs no marker: it is guarded by listings.status = 'open', the same way
// expireListings gets its idempotency.

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { listNpcPolicies } from './npcBreeding';
import { getStableById } from './stables';
import { horseDisplayName } from './horses';
import { buildEndHorseParticipationStatements } from './ageing';

// ---------------------------------------------------------------------------
// Mechanism 1: the income floor
// ---------------------------------------------------------------------------

/**
 * Tops every NPC stable that has fallen below its own balance_floor back up to it, at most once per
 * npc_balance_floor_interval_game_days.
 *
 * **The marker advances whether or not any money moved**, and that is the load-bearing detail. If it
 * only advanced on an actual top-up, a healthy stable would stay permanently "due" and be restored
 * the instant it dipped a single unit below its floor - which turns the floor into an unlimited
 * money pump feeding the buying routes. Advancing it every time means a stable gets at most one
 * floor's worth of help per interval no matter how it spends.
 *
 * Idempotent per CLAUDE.md §5.4 in both directions: the shortfall is derived from the stored
 * balance rather than incremented, and a re-fired tick on the same game day finds the marker
 * already stamped and does nothing. A NULL marker means "never topped up" and is treated as due,
 * which is what gives the three stables seeded at a balance of 0 an opening balance on the first
 * tick after migration 0118 lands - no separate backfill migration needed.
 *
 * Posted as an `adjustment` ledger row, not a new ledger kind: it is exactly what the operator's own
 * hand-adjustment at /admin/money is, just on a schedule. That also means it never inflates
 * /admin/npc's "earned selling" column, which reads the 'sale' kind - the floor is help, and it
 * should not be able to disguise itself as trading income.
 */
export async function runNpcBalanceFloor(env: Env, gameDay: number, config: Config): Promise<void> {
  const interval = config.values.npc_balance_floor_interval_game_days;
  const policies = await listNpcPolicies(env);

  const ledgerEntries: LedgerEntry[] = [];
  const markerStatements: D1PreparedStatement[] = [];

  for (const policy of policies) {
    if (policy.balance_floor <= 0) continue;
    const due = policy.last_floor_topup_game_day === null || gameDay - policy.last_floor_topup_game_day >= interval;
    if (!due) continue;

    const stable = await getStableById(env, policy.stable_id);
    if (!stable) continue;

    const shortfall = policy.balance_floor - stable.balance;
    if (shortfall > 0) {
      ledgerEntries.push({
        stableId: stable.id,
        amount: shortfall,
        kind: 'adjustment',
        referenceType: 'stable',
        referenceId: stable.id,
        description: `Income floor: topped up to ${String(policy.balance_floor)}.`,
        gameDay,
      });
    }
    // Outside the `if` on purpose - see the paragraph on the advancing marker above.
    markerStatements.push(env.DB.prepare('UPDATE npc_policy SET last_floor_topup_game_day = ? WHERE stable_id = ?').bind(gameDay, policy.stable_id));
  }

  const statements = [...buildLedgerStatements(env, ledgerEntries), ...markerStatements];
  if (statements.length === 0) return;
  await env.DB.batch(statements);
}

// ---------------------------------------------------------------------------
// Mechanism 2: off-screen clearance
// ---------------------------------------------------------------------------

interface ClearableListingRow {
  listing_id: number;
  horse_id: number;
  price: number;
  guide_value: number | null;
  seller_stable_id: number;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
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
async function listClearableListings(env: Env, gameDay: number): Promise<ClearableListingRow[]> {
  const result = await env.DB.prepare(
    `SELECT l.id AS listing_id, l.horse_id, l.price, l.guide_value, l.seller_stable_id,
            h.registered_name, h.barn_name, h.sex
       FROM listings l
       JOIN horses h ON h.id = l.horse_id
       JOIN stables s ON s.id = l.seller_stable_id
       JOIN npc_policy p ON p.stable_id = s.id
      WHERE l.status = 'open' AND l.expires_game_day <= ? AND h.status = 'alive' AND s.is_npc = 1`
  )
    .bind(gameDay)
    .all<ClearableListingRow>();
  return result.results ?? [];
}

/**
 * §2 of this file's header. Sells each of those horses to a buyer outside the game and removes it.
 *
 * Runs immediately before expireListings in the tick, which is what makes the split work: this
 * stage takes the NPC listings that timed out with a live horse, expireListings takes everything
 * else (player listings, and NPC listings whose horse died while listed) exactly as it always has.
 * Nothing in src/db/listings.ts changes.
 *
 * No commission is taken. Commission is what the market charges for finding a buyer, and the market
 * conspicuously failed to find one - this is a private sale after the fact. The clearance fraction
 * is already doing the work of making an unsold horse worth less than a sold one.
 *
 * The horse leaves via buildEndHorseParticipationStatements with status 'removed' and end_reason
 * 'sold_away' - the same path a player's own retire-away uses, so an in-progress pregnancy, a booked
 * covering and any entry in a class not yet judged are all cancelled correctly without this file
 * knowing anything about those tables. Idempotent by the `status = 'open'` guard on the listing and
 * the `status = 'alive'` guard inside that helper: a re-fired tick sees neither and writes nothing.
 */
export async function runNpcListingClearance(env: Env, gameDay: number, config: Config): Promise<void> {
  const rows = await listClearableListings(env, gameDay);
  if (rows.length === 0) return;

  const fraction = config.values.npc_listing_clearance_fraction;
  const statements: D1PreparedStatement[] = [];
  const ledgerEntries: LedgerEntry[] = [];

  for (const row of rows) {
    // guide_value is nullable on the table, though createListing always sets it for an NPC seller.
    // Falling back to the asking price keeps a null row from clearing at 0 rather than skipping it.
    const basis = row.guide_value ?? row.price;
    const proceeds = Math.max(config.values.market_min_value, Math.round(basis * fraction));

    statements.push(
      env.DB.prepare(`UPDATE listings SET status = 'expired', closed_game_day = ? WHERE id = ? AND status = 'open'`).bind(gameDay, row.listing_id),
      ...buildEndHorseParticipationStatements(env, { horseId: row.horse_id, sex: row.sex, gameDay, status: 'removed', endReason: 'sold_away' })
    );
    ledgerEntries.push({
      stableId: row.seller_stable_id,
      amount: proceeds,
      // The 'sale' kind, not a new one: this is a horse leaving for money, which is what that kind
      // means everywhere else, and counting it keeps /admin/npc's "earned selling" column honest
      // about where a stable's income actually came from. counterpartyStableId stays null - the
      // buyer is off-screen and has no stables row, the same as a prize having no counterparty.
      kind: 'sale',
      referenceType: 'listing',
      referenceId: row.listing_id,
      description: `${horseDisplayName(row)} sold to a buyer outside the area after going unsold.`,
      gameDay,
    });
  }

  await env.DB.batch([...statements, ...buildLedgerStatements(env, ledgerEntries)]);
}
