import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderSetupPage } from '../render/auth';
import { countAccounts, createAccount } from '../db/accounts';
import { hashPassword } from '../lib/password';
import { buildSessionCookie } from '../lib/session';
import { validateNewAccountForm } from '../lib/validation';

export async function setupRoute(ctx: RequestContext, method: string): Promise<Response> {
  const existing = await countAccounts(ctx.env);
  if (existing > 0) return notFound();

  if (method === 'GET') {
    return htmlResponse(renderSetupPage({ world: ctx.world }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const displayName = (form.display_name ?? '').trim();
  const username = (form.username ?? '').trim();
  const password = form.password ?? '';
  const confirmPassword = form.confirm_password ?? '';

  const error = validateNewAccountForm(displayName, username, password, confirmPassword, ctx.config.values.min_password_length);
  if (error) {
    return htmlResponse(renderSetupPage({ world: ctx.world, error }));
  }

  const passwordHash = await hashPassword(password);
  let accountId: number;
  try {
    accountId = await createAccount(ctx.env, { username, displayName, passwordHash, isAdmin: true, mustChangePassword: false });
  } catch {
    return htmlResponse(renderSetupPage({ world: ctx.world, error: 'Something went wrong creating that account. Try a different username.' }));
  }

  const response = redirect('/admin');
  response.headers.append('Set-Cookie', await buildSessionCookie(accountId, ctx.env.SESSION_SECRET));
  return response;
}
