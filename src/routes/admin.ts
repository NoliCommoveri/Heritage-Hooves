import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderAdminHomePage, renderAccountsPage, renderConfigPage, renderConfigHistoryPage, renderWorldPage } from '../render/admin';
import { listAccounts, createAccount, updatePassword, setActive } from '../db/accounts';
import { hashPassword } from '../lib/password';
import { writeConfig, type ConfigValues } from '../lib/config-cache';
import { listConfigAudit } from '../db/configAudit';
import { setPaused } from '../db/world';
import { listRecentTickRuns } from '../db/tickRuns';
import { runManualTick } from '../tick';

export async function adminHomeRoute(ctx: RequestContext): Promise<Response> {
  return htmlResponse(renderAdminHomePage({ world: ctx.world }));
}

export async function adminAccountsRoute(ctx: RequestContext, method: string): Promise<Response> {
  if (method === 'GET') {
    const accounts = await listAccounts(ctx.env);
    const notice = new URL(ctx.request.url).searchParams.get('saved') ? 'Saved.' : undefined;
    return htmlResponse(renderAccountsPage({ world: ctx.world, accounts, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const minLen = ctx.config.values.min_password_length;

  if (form.action === 'create') {
    const displayName = (form.display_name ?? '').trim();
    const username = (form.username ?? '').trim();
    const startingPassword = form.starting_password ?? '';

    if (!displayName || !username) {
      const accounts = await listAccounts(ctx.env);
      return htmlResponse(renderAccountsPage({ world: ctx.world, accounts, error: 'Name and username are required.' }));
    }
    if (startingPassword.length < minLen) {
      const accounts = await listAccounts(ctx.env);
      return htmlResponse(renderAccountsPage({ world: ctx.world, accounts, error: `Starting password must be at least ${minLen} characters.` }));
    }

    const passwordHash = await hashPassword(startingPassword);
    try {
      await createAccount(ctx.env, { username, displayName, passwordHash, isAdmin: false, mustChangePassword: true });
    } catch {
      const accounts = await listAccounts(ctx.env);
      return htmlResponse(renderAccountsPage({ world: ctx.world, accounts, error: 'That username is already taken.' }));
    }
    return redirect('/admin/accounts?saved=1');
  }

  if (form.action === 'reset_password') {
    const accountId = Number(form.account_id);
    const startingPassword = form.starting_password ?? '';
    if (startingPassword.length < minLen) {
      const accounts = await listAccounts(ctx.env);
      return htmlResponse(renderAccountsPage({ world: ctx.world, accounts, error: `Starting password must be at least ${minLen} characters.` }));
    }
    const passwordHash = await hashPassword(startingPassword);
    await updatePassword(ctx.env, accountId, passwordHash, true);
    return redirect('/admin/accounts?saved=1');
  }

  if (form.action === 'deactivate' || form.action === 'reactivate') {
    const accountId = Number(form.account_id);
    await setActive(ctx.env, accountId, form.action === 'reactivate');
    return redirect('/admin/accounts?saved=1');
  }

  return notFound();
}

const NUMERIC_CONFIG_KEYS = [
  'game_days_per_tick',
  'game_days_per_year',
  'max_stables_per_account',
  'starting_stable_capacity',
  'starting_balance',
  'min_password_length',
] as const;

export async function adminConfigRoute(ctx: RequestContext, method: string): Promise<Response> {
  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('saved') ? 'Changes saved.' : undefined;
    return htmlResponse(renderConfigPage({ world: ctx.world, config: ctx.config, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const values: Partial<ConfigValues> = {};

  const displayTimezone = (form.display_timezone ?? '').trim();
  if (displayTimezone) values.display_timezone = displayTimezone;

  for (const key of NUMERIC_CONFIG_KEYS) {
    const rawValue = form[key];
    if (rawValue === undefined) continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return htmlResponse(renderConfigPage({ world: ctx.world, config: ctx.config, error: `${key.replace(/_/g, ' ')} must be a whole number.` }));
    }
    values[key] = n;
  }

  await writeConfig(ctx.env, ctx.account!.id, { values });
  return redirect('/admin/config?saved=1');
}

export async function adminConfigHistoryRoute(ctx: RequestContext): Promise<Response> {
  const rows = await listConfigAudit(ctx.env);
  return htmlResponse(renderConfigHistoryPage({ world: ctx.world, rows }));
}

export async function adminWorldRoute(ctx: RequestContext, method: string): Promise<Response> {
  if (method === 'GET') {
    const tickRuns = await listRecentTickRuns(ctx.env, 20);
    const params = new URL(ctx.request.url).searchParams;
    let notice: string | undefined;
    if (params.get('paused')) notice = 'The world is now paused.';
    else if (params.get('unpaused')) notice = 'The world is now unpaused.';
    else if (params.get('advanced')) notice = 'Advanced by one tick.';
    else if (params.get('confirm_required')) notice = 'Tick the confirmation box before advancing.';
    return htmlResponse(renderWorldPage({ world: ctx.world, tickRuns, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  if (form.action === 'pause') {
    await setPaused(ctx.env, true);
    return redirect('/admin/world?paused=1');
  }
  if (form.action === 'unpause') {
    await setPaused(ctx.env, false);
    return redirect('/admin/world?unpaused=1');
  }
  if (form.action === 'advance') {
    if (form.confirm !== 'yes') return redirect('/admin/world?confirm_required=1');
    await runManualTick(ctx.env);
    return redirect('/admin/world?advanced=1');
  }

  return notFound();
}
