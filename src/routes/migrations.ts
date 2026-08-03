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
import { readSession, readAdminUnlockPayload } from '../lib/session';
import { getAccountById, countAccounts } from '../db/accounts';

async function isPreSetup(env: Env): Promise<boolean> {
  try {
    return (await countAccounts(env)) === 0;
  } catch {
    // accounts table doesn't exist yet - definitionally nobody is logged in.
    return true;
  }
}

// Slice 0016 §9.6: this page fixes everything, including a botched deploy, so it must never be the
// thing a locked-out operator can't reach. It can't read config.values.admin_pin_grace_seconds
// (config may not exist yet), so this is a hard ceiling rather than the tunable - deliberately
// generous, since there is nothing tuning it down accidentally.
const MIGRATIONS_PIN_GRACE_SECONDS = 1800;

export async function migrationsRoute(request: Request, env: Env, method: string): Promise<Response> {
  const preSetup = await isPreSetup(env);
  if (!preSetup) {
    const session = await readSession(request, env.SESSION_SECRET);
    // No session at all reads as "not logged in yet", same as every normal page - send them to
    // log in instead of a bare Forbidden. A session that resolves to a real, non-admin account is
    // still a flat 403, matching every other /admin route.
    if (!session) return redirect('/login');
    const account = await getAccountById(env, session.accountId);
    if (!account || account.active !== 1 || account.is_admin !== 1) return new Response('Forbidden', { status: 403 });

    // The PIN gate, gated defensively (§9.6): if reading pin_hash fails for any reason - a missing
    // column on a database this migration hasn't landed on yet, a missing table - the request is
    // let through exactly as it was before this slice. A locked-out operator with no working
    // migrations page has no recovery route at all, and that failure mode is worse than a missed
    // PIN check on this one page.
    try {
      if (account.pin_hash) {
        const payload = await readAdminUnlockPayload(request, env.SESSION_SECRET);
        const valid =
          payload !== null && payload.accountId === account.id && Math.floor(Date.now() / 1000) - payload.issuedAt <= MIGRATIONS_PIN_GRACE_SECONDS;
        if (!valid) return redirect(`/admin/unlock?redirect=${encodeURIComponent('/admin/migrations')}`);
      }
    } catch {
      // Deliberate hole - see the comment above.
    }
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
