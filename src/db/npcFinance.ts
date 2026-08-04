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
// Two mechanisms hold an NPC stable up, and only one of them is in this file:
//
// 1. **The income floor** (runNpcBalanceFloor, below). Once every
//    npc_balance_floor_interval_game_days, a stable below its own npc_policy.balance_floor is
//    topped back up to it. A top-up-to, never an add: a stable that is earning gets nothing at all.
//    This is a safety net against a stable going permanently silent, not an operating budget - the
//    ceiling on how much money it can create is one floor per stable per interval, and it only ever
//    pays out to a stable that has already failed to earn.
//
// 2. **The pet home** (src/db/petHome.ts). An NPC listing that ran its full window unsold goes to a
//    pet home at the same price a player gets for choosing the same thing. That is where an NPC's
//    money actually comes from, and unlike the floor it is earned - a stable only gets paid for
//    horses it bred well enough to be worth something. **If /admin/npc shows a stable's balance
//    parked at its floor, it is living on the safety net rather than earning**, and either its
//    breeding or pet_home_payout_fraction wants looking at.
//
// The marker-column pattern here (npc_policy.last_floor_topup_game_day) is the same one
// stables.last_upkeep_game_day and npc_policy.last_bred_game_day already establish (CLAUDE.md §5.4).

import type { Env } from '../types';
import type { Config } from '../lib/config-cache';
import { buildLedgerStatements, type LedgerEntry } from './ledger';
import { listNpcPolicies } from './npcBreeding';
import { getStableById } from './stables';

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
 * /admin/npc's "earned selling" column, which counts sales and pet-home payouts - the floor is
 * help, and it should not be able to disguise itself as earned income.
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
