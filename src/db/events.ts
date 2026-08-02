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
export type EventKind = 'foaled' | 'covering_conceived' | 'covering_missed' | 'show_result' | 'condition_signs' | 'horse_died';

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
