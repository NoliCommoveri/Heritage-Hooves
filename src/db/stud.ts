// Stud services (slice 0017 §13, Part D): a stallion's owner offers him at stud for a fee; another
// stable books their mare to him without either side giving up a horse. This is the first
// cross-stable breeding in the game - validateStudBooking below re-derives every check
// validateBooking (src/routes/horses.ts) already applies to a same-stable pairing, because that
// function assumes both horses belong to one StableRow and cannot be reused as-is.
//
// **Decided by the operator, 4 Aug 2026, when this part was commissioned** (CLAUDE.md §2's "an
// actual decision was made" - treat these as standing):
//   - No live-foal guarantee. A stud fee pays for the covering, not the outcome - same as a player
//     breeding their own two horses today, where a missed conception is not refunded.
//   - The market's commission applies to a stud fee exactly as it applies to a sale.
//   - NPC stallions stand at stud too (src/db/npcStud.ts), reusing every function in this file - a
//     player booking to an NPC stallion is not a special case anywhere below.
//
// **Race tolerance, a deliberate departure from src/db/listings.ts's sale path.** That file's
// buildSaleStatements uses a CASE-into-NOT-NULL trip-wire so a losing second buyer is never charged
// for a horse they didn't get - a real bug, caught by testing, that a plain WHERE clause could not
// prevent. A stud booking carries the same "money moves, checked-then-written" shape, but its one
// scarce resource (season_cap) is a soft rate limit on the stallion, not an asset that vanishes -
// the existing booking path (src/db/coverings.ts's bookCovering, called from
// src/routes/horses.ts's stableBreedRoute) already accepts exactly this level of race risk for
// "is this mare already booked" and "does this stable have a free stall", with no trip-wire. This
// file matches that posture rather than importing the heavier one: validateStudBooking checks
// immediately before bookStud's batch runs, and the worst a lost race produces is a stallion booked
// one over his season_cap - never a fee charged with nothing created, since the fee only ever posts
// inside the same batch as the covering and the booking row.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import type { Config } from '../lib/config-cache';
import { canTakeOnCost } from '../lib/money';
import { buildBookCoveringStatement } from './coverings';
import { getActivePregnancyForMare } from './pregnancies';
import { getBookedCoveringForMare } from './coverings';
import { countAliveHorses, horseDisplayName, type HorseRow } from './horses';
import type { StableRow } from './stables';
import { buildLedgerStatements } from './ledger';
import { buildEventStatement } from './events';
import { availabilityForHorse } from './care';
import { isInBreedingSeason } from '../engines/breeding/season';

export interface StudListingRow {
  id: number;
  stallion_id: number;
  stable_id: number;
  fee: number;
  season_cap: number;
  active: number;
  created_game_day: number;
  closed_game_day: number | null;
  created_real_ts: number;
}

/** /market/stud's own list, and one listing's detail page - the stallion and offering stable
 * resolved in the same query rather than a lookup per row, the same shape OPEN_LISTING_SELECT
 * (src/db/listings.ts) already follows. */
export interface OpenStudListingRow extends StudListingRow {
  registered_name: string | null;
  barn_name: string | null;
  born_game_day: number;
  breed_id: number | null;
  is_cross: number;
  genotype: string;
  rng_seed: number;
  image_url: string | null;
  stable_name: string;
  /** Null for an NPC stable. */
  stable_account_id: number | null;
}

const ACTIVE_STUD_SELECT = `
  SELECT sl.*, h.registered_name, h.barn_name, h.born_game_day, h.breed_id, h.is_cross, h.genotype,
         h.rng_seed, h.image_url, s.name AS stable_name, s.account_id AS stable_account_id
    FROM stud_listings sl
    JOIN horses h ON h.id = sl.stallion_id
    JOIN stables s ON s.id = sl.stable_id`;

/** Every stallion currently standing at stud, optionally narrowed by breed - the breed filter
 * happens in the query, matching listOpenListings' own reasoning (src/db/listings.ts). */
export async function listActiveStudListings(env: Env, breedId: number | null): Promise<OpenStudListingRow[]> {
  const breedClause = breedId === null ? '' : ' AND h.breed_id = ?';
  const statement = env.DB.prepare(`${ACTIVE_STUD_SELECT} WHERE sl.active = 1 AND h.status = 'alive'${breedClause} ORDER BY sl.id DESC`);
  const bound = breedId === null ? statement : statement.bind(breedId);
  const result = await bound.all<OpenStudListingRow>();
  return result.results ?? [];
}

export async function getStudListing(env: Env, id: number): Promise<OpenStudListingRow | null> {
  return env.DB.prepare(`${ACTIVE_STUD_SELECT} WHERE sl.id = ?`).bind(id).first<OpenStudListingRow>();
}

/** The stallion's own page: whether he is currently standing at stud, and the guard that stops a
 * second active listing for the same stallion. */
export async function getActiveStudListingForHorse(env: Env, horseId: number): Promise<StudListingRow | null> {
  return env.DB.prepare(`SELECT * FROM stud_listings WHERE stallion_id = ? AND active = 1`).bind(horseId).first<StudListingRow>();
}

export type CreateStudListingResult = { ok: true; studListingId: number } | { ok: false; error: 'already_listed' };

/** Free, no turn spent - the same posture §2.5 chose for a sale listing, and for the same reason:
 * an owner should offer a stallion because it costs nothing to try, not hoard the choice against an
 * action budget. The partial unique index is what actually stops a second active listing, the same
 * pattern createListing (src/db/listings.ts) already follows. */
export async function createStudListing(
  env: Env,
  params: { stallionId: number; stableId: number; fee: number; seasonCap: number; gameDay: number }
): Promise<CreateStudListingResult> {
  try {
    const result = await env.DB.prepare(
      `INSERT INTO stud_listings (stallion_id, stable_id, fee, season_cap, active, created_game_day, created_real_ts)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(params.stallionId, params.stableId, params.fee, params.seasonCap, params.gameDay, nowUtcSeconds())
      .run();
    return { ok: true, studListingId: result.meta.last_row_id };
  } catch (err) {
    if (err instanceof Error && /unique constraint failed/i.test(err.message)) return { ok: false, error: 'already_listed' };
    throw err;
  }
}

/** Free, no turn spent, same shape as withdrawListing (src/db/listings.ts). Guarded on stable_id
 * and active in the WHERE clause so a withdraw racing a booking changes zero rows rather than
 * un-listing a stallion mid-transaction. */
export async function withdrawStudListing(env: Env, id: number, stableId: number, gameDay: number): Promise<boolean> {
  const result = await env.DB.prepare(`UPDATE stud_listings SET active = 0, closed_game_day = ? WHERE id = ? AND stable_id = ? AND active = 1`)
    .bind(gameDay, id, stableId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Retiring a listed stallion away takes him off stud in the same batch as his own status change -
 * the same reasoning buildWithdrawListingsForHorseStatement (src/db/listings.ts) already follows
 * for a sale listing, and reused again from that file's own buildSaleStatements: a sold stallion's
 * active stud listing is withdrawn rather than carried to the buyer, since the fee and season_cap
 * were the previous owner's own choice, not something that travels with the horse the way §2.6's
 * pedigree and health knowledge do. */
export function buildWithdrawStudListingsForHorseStatement(env: Env, horseId: number, gameDay: number): D1PreparedStatement[] {
  return [env.DB.prepare(`UPDATE stud_listings SET active = 0, closed_game_day = ? WHERE stallion_id = ? AND active = 1`).bind(gameDay, horseId)];
}

/** The tick's sweep for a stallion who died or was removed while standing at stud - the same lazy
 * "the tick catches what a route missed" shape expireListings (src/db/listings.ts) uses for a dead
 * horse's sale listing. No event is written: a stallion's death or retirement already produces its
 * own event (horse_died / horse_died_old_age), and a second "your stud listing closed" notice for
 * the same horse on the same day teaches nothing new. */
export async function closeDeadStudListings(env: Env, gameDay: number): Promise<void> {
  await env.DB
    .prepare(
      `UPDATE stud_listings SET active = 0, closed_game_day = ?
        WHERE active = 1 AND stallion_id IN (SELECT id FROM horses WHERE status <> 'alive')`
    )
    .bind(gameDay)
    .run();
}

/** How many bookings this stallion has already taken in this world.season_index - what season_cap
 * is actually checked against (stud_bookings is the append-only source of truth, not a running
 * counter on stud_listings - see that migration's own comment). */
export async function bookingsThisSeasonCount(env: Env, studListingId: number, seasonIndex: number): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM stud_bookings WHERE stud_listing_id = ? AND season_index = ?`)
    .bind(studListingId, seasonIndex)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * §13.2's guards, re-derived for two stables rather than one: everything validateBooking
 * (src/routes/horses.ts) already checks for a same-stable pairing, plus the two stud-specific
 * questions (season_cap, and the mare's stable actually having the fee in hand). Returns a plain
 * sentence naming the horse, or undefined when a booking would succeed - the same shape every
 * refusal function in this codebase follows.
 */
export async function validateStudBooking(
  env: Env,
  config: Config,
  worldGameDay: number,
  studListing: StudListingRow,
  seasonIndex: number,
  mare: HorseRow,
  mareStable: StableRow,
  stallion: HorseRow
): Promise<string | undefined> {
  const cfg = config.values;

  // A stallion's own status isn't guaranteed alive the way a picker-sourced horse is (mare comes
  // from listStableHorses, which already filters to status = 'alive' - the stallion comes straight
  // from getStudListing/getHorse, which does not). Between a stallion's death and the tick's next
  // closeDeadStudListings sweep, his listing can still be reachable - checked here the same way
  // buyRefusal (src/routes/market.ts) checks a sale listing's horse first, before anything else.
  if (stallion.status !== 'alive') return `${horseDisplayName(stallion)} is no longer alive, so he can't be booked.`;

  if (mareStable.id === studListing.stable_id) {
    return `${horseDisplayName(mare)} and ${horseDisplayName(stallion)} are both in ${mareStable.name} - use the ordinary breeding page for two horses in the same stable.`;
  }

  if (!canTakeOnCost(mareStable.balance)) {
    return `${mareStable.name} is ${String(Math.abs(mareStable.balance))} in the red. Win a show, or ask a grown-up to add money, before booking a stud fee.`;
  }

  for (const horse of [mare, stallion]) {
    const availability = availabilityForHorse(horse, cfg, worldGameDay);
    if (availability.available) continue;
    const name = horseDisplayName(horse);
    const subject = horse.sex === 'mare' ? 'she' : 'he';
    if (availability.reason === 'at_pasture') {
      return `${name} is out at pasture. ${horse.sex === 'mare' ? 'Her' : 'His'} owner needs to bring ${horse.sex === 'mare' ? 'her' : 'him'} into the barn first - ${subject} will need a little while to settle in before ${subject} can be bred.`;
    }
    return `${name} came in from pasture recently and is still settling in - ${subject} can be bred again in ${String(availability.daysRemaining)} more day${availability.daysRemaining === 1 ? '' : 's'}.`;
  }

  if (stallion.sex !== 'stallion') return `${horseDisplayName(stallion)} is not a stallion.`;
  if (mare.sex !== 'mare') return `${horseDisplayName(mare)} is not a mare.`;

  const minAge = cfg.min_breeding_age_game_days;
  if (worldGameDay - mare.born_game_day < minAge) return `${horseDisplayName(mare)} is not old enough to breed yet.`;
  if (worldGameDay - stallion.born_game_day < minAge) return `${horseDisplayName(stallion)} is not old enough to breed yet.`;

  if (mare.last_foaled_game_day !== null) {
    const recovery = cfg.mare_recovery_game_days;
    if (worldGameDay - mare.last_foaled_game_day < recovery) {
      return `${horseDisplayName(mare)} has just foaled and needs more time to recover before breeding again.`;
    }
  }

  const [activePregnancy, activeCovering] = await Promise.all([getActivePregnancyForMare(env, mare.id), getBookedCoveringForMare(env, mare.id)]);
  if (activePregnancy) return `${horseDisplayName(mare)} is already in foal.`;
  if (activeCovering) return `${horseDisplayName(mare)} is already booked to a covering.`;

  if (!isInBreedingSeason(worldGameDay, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year)) {
    return "It's out of season for breeding right now.";
  }

  const aliveCount = await countAliveHorses(env, mareStable.id);
  if (aliveCount >= mareStable.capacity) return `${mareStable.name} doesn't have room for another horse - the foal will need a stall.`;

  const bookedThisSeason = await bookingsThisSeasonCount(env, studListing.id, seasonIndex);
  if (bookedThisSeason >= studListing.season_cap) {
    return `${horseDisplayName(stallion)} is fully booked for this season - ${String(bookedThisSeason)} of ${String(studListing.season_cap)} already taken.`;
  }

  if (mareStable.balance - studListing.fee < 0) {
    return `${mareStable.name} has ${String(mareStable.balance)} and the stud fee is ${String(studListing.fee)}. Win a show, sell a horse, or ask a grown-up to add money first.`;
  }

  return undefined;
}

/** A local copy of src/db/listings.ts's own commissionFor, rather than an import from it - that
 * file already imports FROM this one (buildWithdrawStudListingsForHorseStatement, in its own sale
 * batch), and this one-line integer calculation is cheaper to duplicate than to introduce a cycle
 * between the market's two data files over. Keep the two in step by hand if the arithmetic ever
 * changes - CLAUDE.md §7's "integer arithmetic, never a float multiply" is the whole of it. */
function commissionFor(price: number, commissionPercent: number): number {
  return Math.floor((price * commissionPercent) / 100);
}

export interface BookStudParams {
  studListing: StudListingRow;
  mare: HorseRow;
  mareStableId: number;
  mareStableName: string;
  mareAccountId: number | null;
  stallion: HorseRow;
  stallionStableId: number;
  stallionStableName: string;
  stallionAccountId: number | null;
  gameDay: number;
  tickSeq: number;
  seasonIndex: number;
  commissionPercent: number;
}

/**
 * §13.1/§13.3: one batch, so the covering, the booking record and every ledger row land together or
 * not at all (D1's env.DB.batch() is one implicit transaction). The covering's own stable_id is the
 * MARE's stable - §13.3's decided rule ("the mare's owner" gets the foal, its prefix, and the
 * covering_conceived/covering_missed event) already falls out of that unchanged, since
 * resolveOneCovering and foalDuePregnancies read dam.owner_stable_id and covering.stable_id exactly
 * as they do for a same-stable booking.
 */
export async function bookStud(env: Env, params: BookStudParams): Promise<void> {
  const commission = commissionFor(params.studListing.fee, params.commissionPercent);
  const sameAccount = params.mareAccountId !== null && params.mareAccountId === params.stallionAccountId;
  const mareName = horseDisplayName(params.mare);
  const stallionName = horseDisplayName(params.stallion);
  const ledgerRef = { referenceType: 'stud_listing', referenceId: params.studListing.id };

  const coveringStatement = buildBookCoveringStatement(env, {
    stableId: params.mareStableId,
    mareId: params.mare.id,
    stallionId: params.stallion.id,
    gameDay: params.gameDay,
    tickSeq: params.tickSeq,
  });

  await env.DB.batch([
    coveringStatement,
    // "(SELECT id FROM coverings ORDER BY id DESC LIMIT 1)" - the same pattern buildFoalInsertStatements'
    // own ancestor rows and buildFoaledEventStatement already use (src/db/events.ts's own comment):
    // safe because a D1 batch is one transaction and nothing else inserts into coverings between
    // that statement and this one landing.
    env.DB
      .prepare(
        `INSERT INTO stud_bookings (stud_listing_id, covering_id, stallion_id, stallion_stable_id, mare_id, mare_stable_id, fee, commission_paid, season_index, booked_game_day, created_real_ts)
         VALUES (?, (SELECT id FROM coverings ORDER BY id DESC LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.studListing.id,
        params.stallion.id,
        params.stallionStableId,
        params.mare.id,
        params.mareStableId,
        params.studListing.fee,
        commission,
        params.seasonIndex,
        params.gameDay,
        nowUtcSeconds()
      ),
    ...buildLedgerStatements(env, [
      {
        stableId: params.mareStableId,
        amount: -params.studListing.fee,
        kind: 'stud_fee_paid',
        ...ledgerRef,
        description: `Stud fee: ${mareName} to ${stallionName} (${params.stallionStableName}).`,
        gameDay: params.gameDay,
        counterpartyStableId: params.stallionStableId,
        sameAccount,
      },
      {
        stableId: params.stallionStableId,
        amount: params.studListing.fee,
        kind: 'stud_fee_received',
        ...ledgerRef,
        description: `Stud fee: ${stallionName} to ${mareName} (${params.mareStableName}).`,
        gameDay: params.gameDay,
        counterpartyStableId: params.mareStableId,
        sameAccount,
      },
      {
        stableId: params.stallionStableId,
        amount: -commission,
        kind: 'commission',
        ...ledgerRef,
        description: 'Stud fee commission.',
        gameDay: params.gameDay,
        counterpartyStableId: null,
        sameAccount,
      },
    ]),
    ...buildEventStatement(env, {
      stableId: params.stallionStableId,
      accountId: params.stallionAccountId,
      gameDay: params.gameDay,
      kind: 'stud_booked',
      subjectHorseId: params.stallion.id,
      payload: { stallion_name: stallionName, mare_name: mareName, mare_stable_name: params.mareStableName, fee: params.studListing.fee },
    }),
  ]);
}
