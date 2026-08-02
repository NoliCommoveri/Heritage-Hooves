import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderPasswordChangePage } from '../render/auth';
import { updatePassword } from '../db/accounts';
import { hashPassword, verifyPassword } from '../lib/password';

export async function accountPasswordRoute(ctx: RequestContext, method: string): Promise<Response> {
  const account = ctx.account!;
  const forced = account.must_change_password === 1;
  const isAdmin = account.is_admin === 1;

  if (method === 'GET') {
    return htmlResponse(renderPasswordChangePage({ world: ctx.world, isAdmin, forced }));
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
        renderPasswordChangePage({ world: ctx.world, isAdmin, forced, error: 'Current password is incorrect.' })
      );
    }
  }

  if (newPassword.length < ctx.config.values.min_password_length) {
    return htmlResponse(
      renderPasswordChangePage({
        world: ctx.world,
        isAdmin,
        forced,
        error: `Password must be at least ${ctx.config.values.min_password_length} characters.`,
      })
    );
  }
  if (newPassword !== confirmPassword) {
    return htmlResponse(renderPasswordChangePage({ world: ctx.world, isAdmin, forced, error: 'Passwords do not match.' }));
  }

  const passwordHash = await hashPassword(newPassword);
  await updatePassword(ctx.env, account.id, passwordHash, false);
  return redirect('/');
}
