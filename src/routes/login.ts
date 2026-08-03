import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderLoginPage } from '../render/auth';
import { getAccountByUsername, recordLogin } from '../db/accounts';
import { verifyPassword } from '../lib/password';
import { buildSessionCookie, expireSessionCookie, expireStableCookie } from '../lib/session';

export async function loginRoute(ctx: RequestContext, method: string): Promise<Response> {
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  if (method === 'GET') return htmlResponse(renderLoginPage({ world: ctx.world, gameDaysPerYear }));
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const username = (form.username ?? '').trim();
  const password = form.password ?? '';

  const account = await getAccountByUsername(ctx.env, username);
  const badCredentials = htmlResponse(renderLoginPage({ world: ctx.world, gameDaysPerYear, error: 'Incorrect username or password.' }));
  if (!account || !account.active) return badCredentials;

  const valid = await verifyPassword(password, account.password_hash);
  if (!valid) return badCredentials;

  await recordLogin(ctx.env, account.id);
  const response = redirect('/');
  response.headers.append('Set-Cookie', await buildSessionCookie(account.id, ctx.env.SESSION_SECRET));
  return response;
}

export async function logoutRoute(): Promise<Response> {
  const response = redirect('/login');
  response.headers.append('Set-Cookie', expireSessionCookie());
  response.headers.append('Set-Cookie', expireStableCookie());
  return response;
}
