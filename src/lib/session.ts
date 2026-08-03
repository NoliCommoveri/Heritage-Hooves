// Signed cookies. CLAUDE.md/overview §13: no sessions table by design - the cookie itself carries
// the signed truth. `hh_session` identifies the logged-in account. `hh_stable` is a convenience
// holding the currently selected stable, and every stable-scoped route must still re-read the
// stable and confirm it belongs to the logged-in account; the cookie is never trusted on its own.

import { parseCookies, serializeCookie } from './cookies';

const SESSION_COOKIE = 'hh_session';
const STABLE_COOKIE = 'hh_stable';
const ADMIN_UNLOCK_COOKIE = 'hh_admin';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REISSUE_AFTER_SECONDS = 60 * 60 * 24; // re-issue once a day old

export interface SessionPayload {
  accountId: number;
  issuedAt: number;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function buildSessionCookie(
  accountId: number,
  secret: string,
  issuedAt: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload = `${accountId}.${issuedAt}`;
  const hmac = await hmacHex(payload, secret);
  return serializeCookie(SESSION_COOKIE, `${payload}.${hmac}`, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
}

export function expireSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', { expireNow: true });
}

export async function readSession(request: Request, secret: string): Promise<SessionPayload | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const value = cookies[SESSION_COOKIE];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [accountIdStr, issuedAtStr, hmac] = parts;
  const payload = `${accountIdStr}.${issuedAtStr}`;
  const expected = await hmacHex(payload, secret);
  if (!constantTimeEqual(hmac, expected)) return null;
  const accountId = Number(accountIdStr);
  const issuedAt = Number(issuedAtStr);
  if (!Number.isInteger(accountId) || !Number.isInteger(issuedAt)) return null;
  return { accountId, issuedAt };
}

/** True if a session this old should be re-issued with a fresh issuedAt, per §6.2. */
export function shouldReissue(session: SessionPayload, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return nowSeconds - session.issuedAt > REISSUE_AFTER_SECONDS;
}

export async function buildStableCookie(stableId: number, secret: string): Promise<string> {
  const hmac = await hmacHex(String(stableId), secret);
  return serializeCookie(STABLE_COOKIE, `${stableId}.${hmac}`, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
}

export function expireStableCookie(): string {
  return serializeCookie(STABLE_COOKIE, '', { expireNow: true });
}

export async function readStableCookie(request: Request, secret: string): Promise<number | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const value = cookies[STABLE_COOKIE];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [stableIdStr, hmac] = parts;
  const expected = await hmacHex(stableIdStr, secret);
  if (!constantTimeEqual(hmac, expected)) return null;
  const stableId = Number(stableIdStr);
  return Number.isInteger(stableId) ? stableId : null;
}

// Slice 0016 §9.5: the admin-door PIN gate's own cookie, same signed shape as hh_session.
//
// The boundary this cookie must never cross (§2.1): unlocking it proves *this admin is present* on
// *this device, right now* - nothing more. It must never become a way for a non-admin session to
// become an admin one. The is_admin check in router.ts always runs first, and this cookie is a
// second gate behind it, never a replacement. A future session reusing "hh_admin present" as a
// general escalation (the mirror image of slice 0005 §7.2's own warning) would be building the
// wrong thing on top of this.
export interface AdminUnlockPayload {
  accountId: number;
  issuedAt: number;
}

export async function buildAdminUnlockCookie(accountId: number, secret: string, issuedAt: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = `${accountId}.${issuedAt}`;
  const hmac = await hmacHex(payload, secret);
  // The cookie's own maxAge is generous cleanup only - the real validity window is
  // admin_pin_grace_seconds, re-checked server-side on every admin request (§9.5), never trusted to
  // expire in the browser.
  return serializeCookie(ADMIN_UNLOCK_COOKIE, `${payload}.${hmac}`, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
}

export function expireAdminUnlockCookie(): string {
  return serializeCookie(ADMIN_UNLOCK_COOKIE, '', { expireNow: true });
}

export async function readAdminUnlockPayload(request: Request, secret: string): Promise<AdminUnlockPayload | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const value = cookies[ADMIN_UNLOCK_COOKIE];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [accountIdStr, issuedAtStr, hmac] = parts;
  const payload = `${accountIdStr}.${issuedAtStr}`;
  const expected = await hmacHex(payload, secret);
  if (!constantTimeEqual(hmac, expected)) return null;
  const accountId = Number(accountIdStr);
  const issuedAt = Number(issuedAtStr);
  if (!Number.isInteger(accountId) || !Number.isInteger(issuedAt)) return null;
  return { accountId, issuedAt };
}
