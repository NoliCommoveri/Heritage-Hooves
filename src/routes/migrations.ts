// Deliberately outside the normal ctx/buildContext flow - see router.ts and render/migrations.ts
// for why. Authorization here can't rely on ctx.account, so it re-derives it directly from the
// session cookie, and treats "the accounts table doesn't exist yet" the same way /setup treats
// "no accounts exist yet": open to whoever gets there first, because nobody could possibly be
// logged in either way. Once a first account exists, this locks down to admins only, same as
// every other /admin route - redirecting a logged-out visitor to /login rather than just
// 403ing them, since "log in first" is the actionable thing to tell them.
import type { Env } from '../types';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderMigrationsPage } from '../render/migrations';
import { listMigrationStatus, applyPendingMigrations } from '../db/migrations';
import { readSession } from '../lib/session';
import { getAccountById, countAccounts } from '../db/accounts';

async function isPreSetup(env: Env): Promise<boolean> {
  try {
    return (await countAccounts(env)) === 0;
  } catch {
    // accounts table doesn't exist yet - definitionally nobody is logged in.
    return true;
  }
}

type AdminCheck = 'admin' | 'logged_out' | 'not_admin';

async function checkAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return 'logged_out';
  const account = await getAccountById(env, session.accountId);
  if (account && account.active === 1 && account.is_admin === 1) return 'admin';
  return 'not_admin';
}

export async function migrationsRoute(request: Request, env: Env, method: string): Promise<Response> {
  const preSetup = await isPreSetup(env);
  if (!preSetup) {
    const check = await checkAdmin(request, env);
    // No session at all reads as "not logged in yet", same as every normal page - send them to
    // log in instead of a bare Forbidden. A session that resolves to a real, non-admin account is
    // still a flat 403, matching every other /admin route.
    if (check === 'logged_out') return redirect('/login');
    if (check === 'not_admin') return new Response('Forbidden', { status: 403 });
  }

  if (method === 'GET') {
    const params = new URL(request.url).searchParams;
    const notice = params.get('confirm_required') ? 'Tick the confirmation box before applying.' : undefined;
    const status = await listMigrationStatus(env);
    return htmlResponse(renderMigrationsPage({ status, preSetup, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(request);
  if (form.confirm !== 'yes') return redirect('/admin/migrations?confirm_required=1');

  const result = await applyPendingMigrations(env);
  const status = await listMigrationStatus(env);
  return htmlResponse(
    renderMigrationsPage({
      status,
      preSetup,
      notice: result.applied.length > 0 ? `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}.` : 'No pending migrations.',
      error: result.failed ? `${result.failed.name} failed: ${result.failed.error}` : undefined,
    })
  );
}
