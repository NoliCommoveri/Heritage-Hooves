import type { Env } from '../types';
import { getWorld, type WorldRow } from '../db/world';
import { getConfig, type Config } from './config-cache';
import { getAccountById, type AccountRow } from '../db/accounts';
import { readSession, shouldReissue, buildSessionCookie } from './session';
import { actionsRemaining, nextTickLocalTime } from './actions';
import { localParts, nowUtcSeconds } from './time';

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

/** Slice 0009 Part B §5.4: how many turns to show in the header on this request. Null when logged
 * out. Centralised here, rather than recomputed at every render call site, since every route
 * already has ctx on hand. */
export function actionsLeftFor(ctx: RequestContext): number | null {
  if (!ctx.account) return null;
  return actionsRemaining(ctx.account, ctx.world.tick_seq, ctx.config.values.actions_per_tick);
}

/** Slice 0009 Part B §5.4's refusal message, when a turn-spending action's budget is already
 * empty: names when more arrive. Reading the wall clock here is display only (CLAUDE.md §5.3 is
 * about deciding things from it, not showing a time), so nowUtcSeconds() is fine. */
export function turnsRefusalMessage(ctx: RequestContext): string {
  const tickTimesLocal = JSON.parse(ctx.world.tick_times_local) as string[];
  const nowMinutes = localParts(nowUtcSeconds(), ctx.config.values.display_timezone).minutesOfDay;
  const next = nextTickLocalTime(tickTimesLocal, nowMinutes);
  return `You've used all your turns for now. More arrive at the next tick - ${next}.`;
}

export function withReissuedCookie(ctx: RequestContext, response: Response): Response {
  if (ctx.reissuedSessionCookie) {
    response.headers.append('Set-Cookie', ctx.reissuedSessionCookie);
  }
  return response;
}
