import type { Env } from './types';
import { buildContext, withReissuedCookie, type RequestContext } from './lib/context';
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
  stableCareRoute,
  stableFeedRoute,
} from './routes/stables';
import {
  stableHorsesRoute,
  stablePastHorsesRoute,
  stableBreedRoute,
  horsePageRoute,
  horseNameRoute,
  horseBarnNameRoute,
  horseImageRoute,
  horseEnterShowRoute,
  horseTestRoute,
  horseRetireRoute,
  horsePetHomeRoute,
  horseCareRoute,
  horseTreatRoute,
  horseLocationRoute,
  horseListRoute,
  horseStudRoute,
  horseAdminDeleteRoute,
} from './routes/horses';
import { stableFoundingRoute } from './routes/founding';
import { showsIndexRoute, showRoute, showEntryResultRoute } from './routes/shows';
import { worldIndexRoute, worldStableRoute, worldHorseRoute } from './routes/world';
import {
  marketIndexRoute,
  marketSoldRoute,
  listingPageRoute,
  listingBuyRoute,
  listingWithdrawRoute,
  offerDetailRoute,
  offerSellRoute,
  studIndexRoute,
  studDetailRoute,
  studBookRoute,
  studWithdrawRoute,
} from './routes/market';
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
  adminAgeingRoute,
  adminCareRoute,
  adminIncidentsRoute,
  adminNpcRoute,
  adminConsignmentRoute,
  adminSecurityRoute,
  adminUnlockRoute,
  adminHorseSearchRoute,
} from './routes/admin';
import { readAdminUnlockPayload, expireAdminUnlockCookie } from './lib/session';
import { nowUtcSeconds } from './lib/time';

const STABLE_ROUTE = /^\/stables\/(\d+)(\/select|\/prefix|\/horses|\/breed|\/founding|\/money|\/past|\/care|\/feed)?$/;
// Every sub-path handled below must appear in the alternation here, or the request never reaches
// the handler at all - it falls past this block to the router's closing notFound(), which reaches
// the player as a bare "Not found" page with no explanation. Slice 0020's "Call the vet" button
// (POST /horses/:id/treat) shipped with a handler and no entry here, and did exactly that. The
// regression test in test/router-paths.test.ts now asserts the two lists match.
const HORSE_ROUTE = /^\/horses\/(\d+)(\/name|\/barn-name|\/image|\/enter-show|\/test|\/retire|\/pet-home|\/care|\/treat|\/location|\/list|\/stud|\/admin-delete)?$/;
const LISTING_ROUTE = /^\/market\/(\d+)(\/buy|\/withdraw)?$/;
const OFFER_ROUTE = /^\/market\/offers\/(\d+)(\/sell)?$/;
const STUD_ROUTE = /^\/market\/stud\/(\d+)(\/book|\/withdraw)?$/;
const SHOW_ROUTE = /^\/shows\/(\d+)(\/entries\/(\d+))?$/;
const WORLD_STABLE_ROUTE = /^\/world\/stables\/(\d+)$/;
const WORLD_HORSE_ROUTE = /^\/world\/horses\/(\d+)$/;

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

  const response = await routeForLoggedInAccount(ctx, path, method, request, env);

  // The admin PIN's "re-lock on leaving" behaviour, chosen over the earlier pure time-based grace
  // (still kept as a secondary bound - see the gate check below): the moment an admin account's
  // request lands on any page outside /admin, the unlock cookie is cleared, so navigating back into
  // /admin - even seconds later - always asks again. Moving between admin pages in one visit does
  // not re-prompt, since none of those requests hit this branch.
  if (ctx.account.is_admin === 1 && !path.startsWith('/admin')) {
    response.headers.append('Set-Cookie', expireAdminUnlockCookie());
  }
  return response;
}

async function routeForLoggedInAccount(ctx: RequestContext, path: string, method: string, request: Request, env: Env): Promise<Response> {
  // The caller already checked this; re-asserted here so TypeScript narrows ctx.account for the
  // rest of this function the way it already does in handleRequest.
  if (!ctx.account) return notFound();

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
    if (sub === '/past' && method === 'GET') return withReissuedCookie(ctx, await stablePastHorsesRoute(ctx, stableId));
    if (sub === '/care' && method === 'POST') return withReissuedCookie(ctx, await stableCareRoute(ctx, stableId));
    if (sub === '/feed' && method === 'POST') return withReissuedCookie(ctx, await stableFeedRoute(ctx, stableId));
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
    if (sub === '/retire') return withReissuedCookie(ctx, await horseRetireRoute(ctx, method, horseId));
    if (sub === '/pet-home') return withReissuedCookie(ctx, await horsePetHomeRoute(ctx, method, horseId));
    if (sub === '/care' && method === 'POST') return withReissuedCookie(ctx, await horseCareRoute(ctx, horseId));
    if (sub === '/treat' && method === 'POST') return withReissuedCookie(ctx, await horseTreatRoute(ctx, horseId));
    if (sub === '/location' && method === 'POST') return withReissuedCookie(ctx, await horseLocationRoute(ctx, horseId));
    if (sub === '/list' && method === 'POST') return withReissuedCookie(ctx, await horseListRoute(ctx, horseId));
    if (sub === '/stud' && method === 'POST') return withReissuedCookie(ctx, await horseStudRoute(ctx, horseId));
    // Admin-only, and the route checks that itself rather than relying on being listed here.
    if (sub === '/admin-delete' && method === 'POST') return withReissuedCookie(ctx, await horseAdminDeleteRoute(ctx, horseId));
    return notFound();
  }

  // Slice 0017 §6: /market sits beside /shows and /world - any logged-in account, no ownership
  // required to look. /market/sold is matched before the numeric listing route, since "sold" is not
  // a listing id.
  if (path === '/market' && method === 'GET') return withReissuedCookie(ctx, await marketIndexRoute(ctx));
  if (path === '/market/sold' && method === 'GET') return withReissuedCookie(ctx, await marketSoldRoute(ctx));
  // Slice 0017 §12 (Part C): matched before LISTING_ROUTE - "offers" never matches \d+, so order
  // between the two doesn't actually matter, but this keeps the two market sub-areas visually
  // grouped in the routing table.
  const offerMatch = path.match(OFFER_ROUTE);
  if (offerMatch) {
    const offerId = Number(offerMatch[1]);
    const sub = offerMatch[2];
    if (!sub && method === 'GET') return withReissuedCookie(ctx, await offerDetailRoute(ctx, offerId));
    if (sub === '/sell' && method === 'POST') return withReissuedCookie(ctx, await offerSellRoute(ctx, offerId));
    return notFound();
  }
  // Slice 0017 §13 (Part D): matched before LISTING_ROUTE for the same reason OFFER_ROUTE is -
  // "stud" never matches \d+, so order doesn't actually matter, but this keeps the market's three
  // sub-areas visually grouped in the routing table.
  if (path === '/market/stud' && method === 'GET') return withReissuedCookie(ctx, await studIndexRoute(ctx));
  const studMatch = path.match(STUD_ROUTE);
  if (studMatch) {
    const studListingId = Number(studMatch[1]);
    const sub = studMatch[2];
    if (!sub && method === 'GET') return withReissuedCookie(ctx, await studDetailRoute(ctx, studListingId));
    if (sub === '/book' && method === 'POST') return withReissuedCookie(ctx, await studBookRoute(ctx, studListingId));
    if (sub === '/withdraw' && method === 'POST') return withReissuedCookie(ctx, await studWithdrawRoute(ctx, studListingId));
    return notFound();
  }
  const listingMatch = path.match(LISTING_ROUTE);
  if (listingMatch) {
    const listingId = Number(listingMatch[1]);
    const sub = listingMatch[2];
    if (!sub && method === 'GET') return withReissuedCookie(ctx, await listingPageRoute(ctx, listingId));
    if (sub === '/buy' && method === 'POST') return withReissuedCookie(ctx, await listingBuyRoute(ctx, listingId));
    if (sub === '/withdraw' && method === 'POST') return withReissuedCookie(ctx, await listingWithdrawRoute(ctx, listingId));
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

  // Slice 0016 §6.1: /world sits above /admin and below the login redirect - any logged-in
  // account, no ownership required.
  if (path === '/world' && method === 'GET') return withReissuedCookie(ctx, await worldIndexRoute(ctx));
  const worldStableMatch = path.match(WORLD_STABLE_ROUTE);
  if (worldStableMatch && method === 'GET') return withReissuedCookie(ctx, await worldStableRoute(ctx, Number(worldStableMatch[1])));
  const worldHorseMatch = path.match(WORLD_HORSE_ROUTE);
  if (worldHorseMatch && method === 'GET') return withReissuedCookie(ctx, await worldHorseRoute(ctx, Number(worldHorseMatch[1])));

  if (path.startsWith('/admin')) {
    if (ctx.account.is_admin !== 1) return new Response('Forbidden', { status: 403 });

    // Slice 0016 §9.5: the admin PIN gate. Runs after the is_admin check above and is a second
    // gate behind it, never a replacement (§2.1) - /admin/unlock is the sole exemption, since it is
    // the page that lets a blocked request in.
    if (path !== '/admin/unlock') {
      const pinRequired = ctx.config.flags.admin_pin_required !== false;
      if (pinRequired && ctx.account.pin_hash !== null) {
        const payload = await readAdminUnlockPayload(request, env.SESSION_SECRET);
        // Re-checked against the live config value on every request, not merely trusted to expire
        // in the browser (§9.5) - lowering admin_pin_grace_seconds takes effect immediately.
        const valid =
          payload !== null &&
          payload.accountId === ctx.account.id &&
          nowUtcSeconds() - payload.issuedAt <= ctx.config.values.admin_pin_grace_seconds;
        if (!valid) return redirect(`/admin/unlock?redirect=${encodeURIComponent(path)}`);
      }
    }

    const response = await dispatchAdminRoute(ctx, path, method);
    if (!response) return notFound();
    const withCookie = withReissuedCookie(ctx, response);
    // §9.6: the nag banner - never on /admin/unlock itself, which is reached precisely because
    // there's a reason to be nagged.
    return path === '/admin/unlock' ? withCookie : withAdminPinNag(ctx, withCookie);
  }

  return notFound();
}

/** Every /admin/* page (bar /admin/unlock, handled by the caller). One function so the pin-gate
 * check above it and the nag banner below it apply uniformly with no route forgotten. */
async function dispatchAdminRoute(ctx: RequestContext, path: string, method: string): Promise<Response | null> {
  if (path === '/admin/security') return adminSecurityRoute(ctx, method);
  if (path === '/admin/unlock') return adminUnlockRoute(ctx, method);
  if (path === '/admin') return adminHomeRoute(ctx);
  if (path === '/admin/accounts') return adminAccountsRoute(ctx, method);
  if (path === '/admin/config') return adminConfigRoute(ctx, method);
  if (path === '/admin/config/history' && method === 'GET') return adminConfigHistoryRoute(ctx);
  if (path === '/admin/world') return adminWorldRoute(ctx, method);
  if (path === '/admin/horses' && method === 'GET') return adminHorseSearchRoute(ctx);
  if (path === '/admin/horses/new') return adminHorseNewRoute(ctx, method);
  if (path === '/admin/breeding') return adminBreedingRoute(ctx, method);
  if (path === '/admin/founding') return adminFoundingRoute(ctx, method);
  if (path === '/admin/breeds') return adminBreedsRoute(ctx, method);
  if (path === '/admin/reset') return adminResetRoute(ctx, method);
  if (path === '/admin/shows') return adminShowsRoute(ctx, method);
  if (path === '/admin/money') return adminMoneyRoute(ctx, method);
  if (path === '/admin/health' && method === 'GET') return adminHealthRoute(ctx);
  if (path === '/admin/ageing') return adminAgeingRoute(ctx, method);
  if (path === '/admin/care') return adminCareRoute(ctx, method);
  if (path === '/admin/incidents') return adminIncidentsRoute(ctx, method);
  if (path === '/admin/npc') return adminNpcRoute(ctx, method);
  if (path === '/admin/consignment') return adminConsignmentRoute(ctx, method);
  return null;
}

/**
 * §9.6: "an admin who never sets a PIN" is the first of the two ways to lock the operator out
 * permanently, and the fix is that a missing PIN never blocks - it only nags. Splices a banner into
 * the rendered HTML rather than threading a parameter through every render function in
 * src/render/admin.ts (about fifteen of them) - the one place this needs to be true is here, once.
 * A no-op on a redirect response (no text/html body) and a no-op once a PIN is set.
 */
async function withAdminPinNag(ctx: RequestContext, response: Response): Promise<Response> {
  const pinRequired = ctx.config.flags.admin_pin_required !== false;
  if (!pinRequired || ctx.account!.pin_hash !== null) return response;
  if (!(response.headers.get('Content-Type') ?? '').includes('text/html')) return response;

  const body = await response.text();
  const banner =
    '<div class="banner banner-paused">Anyone holding this phone can reach these pages. <a href="/admin/security">Set an admin PIN</a>.</div>';
  const injected = body.includes('<main>') ? body.replace('<main>', `<main>${banner}`) : body;
  return new Response(injected, { status: response.status, headers: response.headers });
}
