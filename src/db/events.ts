// The "While you were away" feed (slice 0009 Part B §6). Every write here goes inside the same
// batch as whatever caused it - a foaling, a resolved covering, a judged class - so an event can
// never exist for something that did not happen. Only ever written for a stable with an account_id
// (§6.1); the NPC show barn foals nothing a child reads.

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';

// Slice 0010 §6.4 adds two kinds. events.kind has no CHECK (0048's own comment), so no migration
// is needed for either:
//   condition_signs -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"HERDA"}
//   horse_died       -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"GBED",
//                        "age_game_days":30,"dam_name":"...","sire_name":"...","event_text":"..."}
// event_text is the condition's own conditions.event_text, copied into the payload at the moment
// the event is written rather than looked up fresh when rendered - an append-only event should
// read the same in a year even if the reference text is edited on /admin/config-adjacent tables
// later. src/render/stables.ts's eventSentence renders both.
//
// Slice 0011 §7.6 adds two more, same no-migration-needed reasoning:
//   horse_failing      -> {"v":1,"horse_name":"...","age_years":19,"sex":"mare"}
//   horse_died_old_age -> {"v":1,"horse_name":"...","age_years":24,"sex":"mare","foals":6}
// horse_died stays as it is and keeps meaning "died of a condition" - old age gets its own kind
// rather than a branch on payload, because horse_died's render arm is written in the voice of a
// foal dying and would have to become a conditional to serve both (§7.6).
//
// Slice 0013 §7.4 adds one more, same no-migration-needed reasoning - a stable-level event
// (subject_horse_id is NULL), one per stable per tick, never one per horse:
//   care_due -> {"v":1,"farrier_count":3,"wellness_count":1}
// Slice 0017 §9 adds two more, same no-migration-needed reasoning - both written for the SELLER
// only (the buyer was there, and the expiring seller was not):
//   horse_sold      -> {"v":1,"horse_name":"...","price":4000,"buyer_stable_name":"..."}
//   listing_expired -> {"v":1,"horse_name":"...","price":4000}
// Both payload shapes are also documented in src/db/listings.ts's file header, since
// migrations/0048_events.sql is already applied and must not be edited (CLAUDE.md §8).
// Amendment 0017a §5.7 adds one more, same no-migration-needed reasoning - a stable-level event
// (subject_horse_id is NULL), written to every active player-owned stable when a consignment batch
// lands (src/db/consignment.ts):
//   consignment_batch -> {"v":1,"count":2}
// Slice 0017 Part D (§13) adds one more, same no-migration-needed reasoning - written for the
// STALLION's owner only (src/db/stud.ts's bookStud): the mare's owner was there, pressing the
// button, and gets no event of their own for the same reason a buyer never gets horse_sold:
//   stud_booked -> {"v":1,"stallion_name":"...","mare_name":"...","mare_stable_name":"...","fee":500}
// Slice 0020 §7.4 adds two more, same no-migration-needed reasoning:
//   incident_onset    -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"COLIC",
//                         "window_game_days":4,"treatment_cost":180}
//   incident_resolved -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"COLIC",
//                         "outcome":"resolved"|"manageable"|"degenerative"|"death","treated":true}
// A 'death' outcome writes incident_resolved AND horse_died (the latter reused unchanged from slice
// 0010, condition_code carrying the acquired condition's code) - the same two-event shape a lethal
// single-gene condition never needed, because horse_conditions never carried an 'acute' row before.
export type EventKind =
  | 'foaled'
  | 'covering_conceived'
  | 'covering_missed'
  | 'show_result'
  | 'condition_signs'
  | 'horse_died'
  | 'horse_failing'
  | 'horse_died_old_age'
  | 'care_due'
  | 'horse_sold'
  | 'listing_expired'
  | 'consignment_batch'
  | 'stud_booked'
  | 'incident_onset'
  | 'incident_resolved';

export interface EventRow {
  id: number;
  stable_id: number;
  game_day: number;
  kind: EventKind;
  subject_horse_id: number | null;
  payload: string;
  read_at_real_ts: number | null;
  created_real_ts: number;
}

export interface BuildEventInput {
  stableId: number;
  accountId: number | null;
  gameDay: number;
  kind: EventKind;
  subjectHorseId: number | null;
  /** Plain object, JSON.stringify'd here - each kind's own shape is documented on migrations/0048_events.sql. */
  payload: Record<string, unknown>;
}

/**
 * Builds (but does not run) one event insert - §6.1's "only stables with an account_id get events"
 * guard lives here, once, rather than at every call site: a null accountId means skip, returning
 * an empty array so callers can unconditionally splice this into their own batch.
 */
export function buildEventStatement(env: Env, input: BuildEventInput): D1PreparedStatement[] {
  if (input.accountId === null) return [];
  return [
    env.DB.prepare(
      `INSERT INTO events (stable_id, game_day, kind, subject_horse_id, payload, read_at_real_ts, created_real_ts)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).bind(input.stableId, input.gameDay, input.kind, input.subjectHorseId, JSON.stringify({ v: 1, ...input.payload }), nowUtcSeconds()),
  ];
}

/**
 * Same job as buildEventStatement, for the one case where the subject horse has no JS-known id
 * yet: a foal, inserted by buildFoalInsertStatements immediately before this lands in the same
 * batch. Uses "(SELECT id FROM horses ORDER BY id DESC LIMIT 1)" - the same pattern
 * buildFoalInsertStatements' own ancestor rows use (src/db/horses.ts), safe for the same reason: a
 * D1 batch is one transaction and nothing else inserts into `horses` between that insert and this
 * one landing.
 */
export function buildFoaledEventStatement(
  env: Env,
  input: { stableId: number; accountId: number | null; gameDay: number; payload: Record<string, unknown> }
): D1PreparedStatement[] {
  if (input.accountId === null) return [];
  return [
    env.DB.prepare(
      `INSERT INTO events (stable_id, game_day, kind, subject_horse_id, payload, read_at_real_ts, created_real_ts)
       VALUES (?, ?, 'foaled', (SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, NULL, ?)`
    ).bind(input.stableId, input.gameDay, JSON.stringify({ v: 1, ...input.payload }), nowUtcSeconds()),
  ];
}

/**
 * Same job as buildFoaledEventStatement, for the other point a horse's id is not yet known in JS:
 * a newly-affected foal or founding horse, condition rows inserted immediately before this in the
 * same batch by src/db/health.ts's buildHorseConditionStatements (slice 0010 §6.3). Same safety
 * argument as buildFoaledEventStatement - nothing else inserts into `horses` between that insert
 * and this one landing.
 */
export function buildConditionSignsEventStatement(
  env: Env,
  input: { stableId: number; accountId: number | null; gameDay: number; payload: Record<string, unknown> }
): D1PreparedStatement[] {
  if (input.accountId === null) return [];
  return [
    env.DB.prepare(
      `INSERT INTO events (stable_id, game_day, kind, subject_horse_id, payload, read_at_real_ts, created_real_ts)
       VALUES (?, ?, 'condition_signs', (SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, NULL, ?)`
    ).bind(input.stableId, input.gameDay, JSON.stringify({ v: 1, ...input.payload }), nowUtcSeconds()),
  ];
}

/** The "While you were away" panel (§6.3): every unread event across every stable an account owns,
 * newest first, capped at 30. */
export async function listUnreadEventsForAccount(env: Env, accountId: number, limit: number): Promise<EventRow[]> {
  const result = await env.DB.prepare(
    `SELECT e.* FROM events e JOIN stables s ON s.id = e.stable_id
     WHERE s.account_id = ? AND e.read_at_real_ts IS NULL
     ORDER BY e.id DESC LIMIT ?`
  )
    .bind(accountId, limit)
    .all<EventRow>();
  return result.results ?? [];
}

/** A stable's own home page (§6.3): read and unread together, most recent first. */
export async function listRecentEventsForStable(env: Env, stableId: number, limit: number): Promise<EventRow[]> {
  const result = await env.DB.prepare('SELECT * FROM events WHERE stable_id = ? ORDER BY id DESC LIMIT ?').bind(stableId, limit).all<EventRow>();
  return result.results ?? [];
}

/** Marks every currently-unread event for every stable this account owns as read - the POST behind
 * the "Mark all read" button (§6.3). Never a side effect of a GET. */
export async function markAllEventsReadForAccount(env: Env, accountId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE events SET read_at_real_ts = ?
     WHERE read_at_real_ts IS NULL
       AND stable_id IN (SELECT id FROM stables WHERE account_id = ?)`
  )
    .bind(nowUtcSeconds(), accountId)
    .run();
}

/** The tick's retention stage (§6.4): deletes every event - read or not - older than
 * events_retention_game_days. A notice board, not an archive: a child who hasn't logged in for
 * weeks has lost the moment either way, and every durable record (the horse, its pedigree, its
 * show results, the ledger) survives regardless. */
export async function deleteOldEvents(env: Env, gameDay: number, retentionGameDays: number): Promise<void> {
  await env.DB.prepare('DELETE FROM events WHERE game_day < ?').bind(gameDay - retentionGameDays).run();
}
