import type { RequestContext } from '../lib/context';
import { actionsLeftFor } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderPasswordChangePage, renderAccountPausePage } from '../render/auth';
import { updatePassword, setAccountPaused } from '../db/accounts';
import { hashPassword, verifyPassword } from '../lib/password';

export async function accountPasswordRoute(ctx: RequestContext, method: string): Promise<Response> {
  const account = ctx.account!;
  const forced = account.must_change_password === 1;
  const isAdmin = account.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  if (method === 'GET') {
    return htmlResponse(renderPasswordChangePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, forced }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const newPassword = form.new_password ?? '';
  const confirmPassword = form.confirm_password ?? '';

  if (!forced) {
    const currentPassword = form.current_password ?? '';
    const valid = await verifyPassword(currentPassword, account.password_hash);
    if (!valid) {
      return htmlResponse(
        renderPasswordChangePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, forced, error: 'Current password is incorrect.' })
      );
    }
  }

  if (newPassword.length < ctx.config.values.min_password_length) {
    return htmlResponse(
      renderPasswordChangePage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
        gameDaysPerYear,
        forced,
        error: `Password must be at least ${ctx.config.values.min_password_length} characters.`,
      })
    );
  }
  if (newPassword !== confirmPassword) {
    return htmlResponse(renderPasswordChangePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, forced, error: 'Passwords do not match.' }));
  }

  const passwordHash = await hashPassword(newPassword);
  await updatePassword(ctx.env, account.id, passwordHash, false);
  return redirect('/');
}

/**
 * Self-service pause/unpause. Exempted from router.ts's own paused gate, since it's the one page a
 * paused account must always be able to reach - "gate on new page, other than unpausing" is this
 * page. No turn spent and no confirmation beyond the button: it's fully self-reversible any time.
 */
export async function accountPauseRoute(ctx: RequestContext, method: string): Promise<Response> {
  const account = ctx.account!;
  const isAdmin = account.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  if (method === 'GET') {
    return htmlResponse(renderAccountPausePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, paused: account.paused === 1 }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action === 'pause') {
    await setAccountPaused(ctx.env, account.id, true);
    return redirect('/account/pause');
  }
  if (form.action === 'unpause') {
    await setAccountPaused(ctx.env, account.id, false);
    return redirect('/stables');
  }
  return notFound();
}
