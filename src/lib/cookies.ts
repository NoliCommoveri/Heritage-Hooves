// Small helpers for reading and writing cookies. Nothing game-specific lives here; see session.ts
// for the signed hh_session / hh_stable cookies built on top of these.

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  /** Set to delete the cookie immediately. */
  expireNow?: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'];
  if (options.expireNow) {
    parts.push('Max-Age=0');
  } else if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  return parts.join('; ');
}
