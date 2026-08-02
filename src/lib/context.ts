import type { Env } from '../types';
import { getWorld, type WorldRow } from '../db/world';
import { getConfig, type Config } from './config-cache';
import { getAccountById, type AccountRow } from '../db/accounts';
import { readSession, shouldReissue, buildSessionCookie } from './session';

export interface RequestContext {
  env: Env;
  request: Request;
  account: AccountRow | null;
  world: WorldRow;
  config: Config;
  /** Set when the session cookie is due for a refresh; the router appends it to the response. */
  reissuedSessionCookie: string | null;
}

export async function buildContext(request: Request, env: Env): Promise<RequestContext> {
  const [world, config] = await Promise.all([getWorld(env), getConfig(env)]);

  let account: AccountRow | null = null;
  let reissuedSessionCookie: string | null = null;

  const session = await readSession(request, env.SESSION_SECRET);
  if (session) {
    const found = await getAccountById(env, session.accountId);
    if (found && found.active) {
      account = found;
      if (shouldReissue(session)) {
        reissuedSessionCookie = await buildSessionCookie(session.accountId, env.SESSION_SECRET);
      }
    }
  }

  return { env, request, account, world, config, reissuedSessionCookie };
}

export function withReissuedCookie(ctx: RequestContext, response: Response): Response {
  if (ctx.reissuedSessionCookie) {
    response.headers.append('Set-Cookie', ctx.reissuedSessionCookie);
  }
  return response;
}
