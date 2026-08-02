import type { Env } from './types';
import { buildContext, withReissuedCookie } from './lib/context';
import { redirect, notFound } from './lib/http';
import { countAccounts } from './db/accounts';
import { healthRoute } from './routes/health';
import { migrationsRoute } from './routes/migrations';
import { setupRoute } from './routes/setup';
import { loginRoute, logoutRoute } from './routes/login';
import { accountPasswordRoute } from './routes/account';
import {
  stablesPickerRoute,
  stablesMarkReadRoute,
  stablesNewRoute,
  stableHomeRoute,
  stableSelectRoute,
  stablePrefixRoute,
  stableMoneyRoute,
} from './routes/stables';
import {
  stableHorsesRoute,
  stableBreedRoute,
  horsePageRoute,
  horseNameRoute,
  horseBarnNameRoute,
  horseImageRoute,
  horseEnterShowRoute,
  horseTestRoute,
} from './routes/horses';
import { stableFoundingRoute } from './routes/founding';
import { showsIndexRoute, showRoute, showEntryResultRoute } from './routes/shows';
import {
  adminHomeRoute,
  adminAccountsRoute,
  adminConfigRoute,
  adminConfigHistoryRoute,
  adminWorldRoute,
  adminHorseNewRoute,
  adminBreedingRoute,
  adminFoundingRoute,
  adminBreedsRoute,
  adminResetRoute,
  adminShowsRoute,
  adminMoneyRoute,
  adminHealthRoute,
} from './routes/admin';

const STABLE_ROUTE = /^\/stables\/(\d+)(\/select|\/prefix|\/horses|\/breed|\/founding|\/money)?$/;
const HORSE_ROUTE = /^\/horses\/(\d+)(\/name|\/barn-name|\/image|\/enter-show|\/test)?$/;
const SHOW_ROUTE = /^\/shows\/(\d+)(\/entries\/(\d+))?$/;

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // The health check must work even when the database is unreachable, so it bypasses buildContext.
  if (path === '/health' && method === 'GET') return healthRoute(env);

  // Migrations must be reachable before any table exists at all - including world/config, which
  // buildContext needs - so this bypasses it too. It does its own auth check (see routes/migrations.ts).
  if (path === '/admin/migrations') return migrationsRoute(request, env, method);

  const ctx = await buildContext(request, env);

  if (path === '/setup') return withReissuedCookie(ctx, await setupRoute(ctx, method));
  if (path === '/login') return withReissuedCookie(ctx, await loginRoute(ctx, method));
  if (path === '/logout' && method === 'POST') return logoutRoute();

  if (path === '/') {
    const accountsCount = await countAccounts(env);
    if (accountsCount === 0) return redirect('/setup');
    if (!ctx.account) return redirect('/login');
    if (ctx.account.must_change_password) return redirect('/account/password');
    return redirect('/stables');
  }

  // Everything below requires a logged-in account.
  if (!ctx.account) return redirect('/login');

  if (ctx.account.must_change_password && path !== '/account/password') {
    return redirect('/account/password');
  }

  if (path === '/account/password') return withReissuedCookie(ctx, await accountPasswordRoute(ctx, method));

  if (path === '/stables' && method === 'GET') return withReissuedCookie(ctx, await stablesPickerRoute(ctx));
  if (path === '/stables' && method === 'POST') return withReissuedCookie(ctx, await stablesMarkReadRoute(ctx));
  if (path === '/stables/new') return withReissuedCookie(ctx, await stablesNewRoute(ctx, method));

  const stableMatch = path.match(STABLE_ROUTE);
  if (stableMatch) {
    const stableId = Number(stableMatch[1]);
    const sub = stableMatch[2];
    if (!sub && method === 'GET') return withReissuedCookie(ctx, await stableHomeRoute(ctx, stableId));
    if (sub === '/select' && method === 'POST') return withReissuedCookie(ctx, await stableSelectRoute(ctx, stableId));
    if (sub === '/prefix') return withReissuedCookie(ctx, await stablePrefixRoute(ctx, method, stableId));
    if (sub === '/horses' && method === 'GET') return withReissuedCookie(ctx, await stableHorsesRoute(ctx, stableId));
    if (sub === '/breed') return withReissuedCookie(ctx, await stableBreedRoute(ctx, method, stableId));
    if (sub === '/founding') return withReissuedCookie(ctx, await stableFoundingRoute(ctx, method, stableId));
    if (sub === '/money' && method === 'GET') return withReissuedCookie(ctx, await stableMoneyRoute(ctx, stableId));
    return notFound();
  }

  const horseMatch = path.match(HORSE_ROUTE);
  if (horseMatch) {
    const horseId = Number(horseMatch[1]);
    const sub = horseMatch[2];
    if (!sub && method === 'GET') return withReissuedCookie(ctx, await horsePageRoute(ctx, horseId));
    if (sub === '/name' && method === 'POST') return withReissuedCookie(ctx, await horseNameRoute(ctx, horseId));
    if (sub === '/barn-name' && method === 'POST') return withReissuedCookie(ctx, await horseBarnNameRoute(ctx, horseId));
    if (sub === '/image') return withReissuedCookie(ctx, await horseImageRoute(ctx, method, horseId));
    if (sub === '/enter-show' && method === 'POST') return withReissuedCookie(ctx, await horseEnterShowRoute(ctx, horseId));
    if (sub === '/test') return withReissuedCookie(ctx, await horseTestRoute(ctx, method, horseId));
    return notFound();
  }

  if (path === '/shows' && method === 'GET') return withReissuedCookie(ctx, await showsIndexRoute(ctx));

  const showMatch = path.match(SHOW_ROUTE);
  if (showMatch) {
    const showId = Number(showMatch[1]);
    const entryId = showMatch[3] ? Number(showMatch[3]) : null;
    if (entryId !== null && method === 'GET') return withReissuedCookie(ctx, await showEntryResultRoute(ctx, showId, entryId));
    if (entryId === null) return withReissuedCookie(ctx, await showRoute(ctx, method, showId));
    return notFound();
  }

  if (path.startsWith('/admin')) {
    if (ctx.account.is_admin !== 1) return new Response('Forbidden', { status: 403 });
    if (path === '/admin') return withReissuedCookie(ctx, await adminHomeRoute(ctx));
    if (path === '/admin/accounts') return withReissuedCookie(ctx, await adminAccountsRoute(ctx, method));
    if (path === '/admin/config') return withReissuedCookie(ctx, await adminConfigRoute(ctx, method));
    if (path === '/admin/config/history' && method === 'GET') return withReissuedCookie(ctx, await adminConfigHistoryRoute(ctx));
    if (path === '/admin/world') return withReissuedCookie(ctx, await adminWorldRoute(ctx, method));
    if (path === '/admin/horses/new') return withReissuedCookie(ctx, await adminHorseNewRoute(ctx, method));
    if (path === '/admin/breeding') return withReissuedCookie(ctx, await adminBreedingRoute(ctx, method));
    if (path === '/admin/founding') return withReissuedCookie(ctx, await adminFoundingRoute(ctx, method));
    if (path === '/admin/breeds') return withReissuedCookie(ctx, await adminBreedsRoute(ctx, method));
    if (path === '/admin/reset') return withReissuedCookie(ctx, await adminResetRoute(ctx, method));
    if (path === '/admin/shows') return withReissuedCookie(ctx, await adminShowsRoute(ctx, method));
    if (path === '/admin/money') return withReissuedCookie(ctx, await adminMoneyRoute(ctx, method));
    if (path === '/admin/health' && method === 'GET') return withReissuedCookie(ctx, await adminHealthRoute(ctx));
    return notFound();
  }

  return notFound();
}
