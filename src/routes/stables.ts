import type { RequestContext } from '../lib/context';
import { actionsLeftFor } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderStablesPicker, renderNewStablePage, renderStableHomePage, renderPrefixPage, eventSentence } from '../render/stables';
import { renderMoneyPage } from '../render/money';
import {
  listStablesForAccount,
  countActiveStablesForAccount,
  createStableWithPrefix,
  getStableById,
  renamePrefix,
  setFeedLevel,
  type StableRow,
} from '../db/stables';
import { setLastActiveStable } from '../db/accounts';
import { countAliveHorses } from '../db/horses';
import { validatePrefix, normalizePrefix } from '../lib/prefix';
import { buildStableCookie } from '../lib/session';
import { hasWaitingFoundingOffer } from '../db/founding';
import { getLedgerForStable, withRunningBalance } from '../db/ledger';
import { listUnreadEventsForAccount, listRecentEventsForStable, markAllEventsReadForAccount } from '../db/events';
import { callBarnRoundCare, callBarnRoundManagement, type CareService } from '../db/care';
import { getEnabledConditions } from '../db/health';
import { canTakeOnCost } from '../lib/money';

export async function stablesPickerRoute(ctx: RequestContext): Promise<Response> {
  const account = ctx.account!;
  const [stables, unread] = await Promise.all([
    listStablesForAccount(ctx.env, account.id),
    listUnreadEventsForAccount(ctx.env, account.id, 30),
  ]);
  const max = ctx.config.values.max_stables_per_account;
  return htmlResponse(
    renderStablesPicker({
      world: ctx.world,
      isAdmin: account.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      stables,
      canCreateMore: stables.length < max,
      maxStables: max,
      awayEvents: unread.map(eventSentence),
    })
  );
}

/** The "Mark all read" button on /stables (§6.3) - a POST, never a side effect of the GET above. */
export async function stablesMarkReadRoute(ctx: RequestContext): Promise<Response> {
  await markAllEventsReadForAccount(ctx.env, ctx.account!.id);
  return redirect('/stables');
}

export async function stablesNewRoute(ctx: RequestContext, method: string): Promise<Response> {
  const account = ctx.account!;
  const isAdmin = account.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const max = ctx.config.values.max_stables_per_account;

  const currentCount = await countActiveStablesForAccount(ctx.env, account.id);
  if (currentCount >= max) return redirect('/stables');

  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  if (method === 'GET') {
    return htmlResponse(renderNewStablePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const name = (form.name ?? '').trim();
  const prefixInput = form.prefix ?? '';

  if (name.length < 1 || name.length > 60) {
    return htmlResponse(
      renderNewStablePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, error: 'Stable name is required (up to 60 characters).', name, prefix: prefixInput })
    );
  }

  const validation = validatePrefix(prefixInput);
  if (!validation.ok) {
    return htmlResponse(renderNewStablePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, error: validation.error, name, prefix: prefixInput }));
  }

  const result = await createStableWithPrefix(ctx.env, {
    accountId: account.id,
    name,
    prefix: normalizePrefix(prefixInput),
    gameDay: ctx.world.game_day,
  });

  if (!result.ok) {
    return htmlResponse(
      renderNewStablePage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, error: 'That prefix is already taken. Try another.', name, prefix: prefixInput })
    );
  }

  await setLastActiveStable(ctx.env, account.id, result.stableId);
  const response = redirect(`/stables/${result.stableId}`);
  response.headers.append('Set-Cookie', await buildStableCookie(result.stableId, ctx.env.SESSION_SECRET));
  return response;
}

async function loadOwnedStable(ctx: RequestContext, stableId: number): Promise<StableRow | Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();
  return stable;
}

export async function stableHomeRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  const [hasFoundingOffer, aliveHorseCount, recentEvents] = await Promise.all([
    hasWaitingFoundingOffer(ctx.env, stableId),
    countAliveHorses(ctx.env, stableId),
    listRecentEventsForStable(ctx.env, stableId, 20),
  ]);
  return htmlResponse(
    renderStableHomePage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      stable,
      hasFoundingOffer,
      aliveHorseCount,
      upkeepPerHorsePerGameDay: ctx.config.values.upkeep_per_horse_per_game_day,
      recentEvents: recentEvents.map(eventSentence),
    })
  );
}

/** §7.1: one stable's ledger, newest first, capped at 100 rows - owner-only, no exception for an
 * admin viewing someone else's stable (the same shape src/routes/horses.ts's image picker uses). */
export async function stableMoneyRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  const [hasFoundingOffer, ledgerNewestFirst] = await Promise.all([
    hasWaitingFoundingOffer(ctx.env, stableId),
    getLedgerForStable(ctx.env, stableId, 100),
  ]);
  const withBalances = withRunningBalance([...ledgerNewestFirst].reverse());
  const rows = [...withBalances].reverse();
  return htmlResponse(
    renderMoneyPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      stable,
      hasFoundingOffer,
      rows,
    })
  );
}

export async function stableSelectRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  await setLastActiveStable(ctx.env, ctx.account!.id, stableId);
  const response = redirect(`/stables/${stableId}`);
  response.headers.append('Set-Cookie', await buildStableCookie(stableId, ctx.env.SESSION_SECRET));
  return response;
}

export async function stablePrefixRoute(ctx: RequestContext, method: string, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  const isAdmin = ctx.account!.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);

  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  if (method === 'GET' || stable.prefix_locked) {
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, stable, hasFoundingOffer }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const prefixInput = form.prefix ?? '';
  const validation = validatePrefix(prefixInput);
  if (!validation.ok) {
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, stable, hasFoundingOffer, error: validation.error }));
  }

  const result = await renamePrefix(ctx.env, { stableId, newPrefix: normalizePrefix(prefixInput), gameDay: ctx.world.game_day });
  if (!result.ok) {
    const error = result.error === 'locked' ? 'This prefix is locked and can no longer change.' : 'That prefix is already taken. Try another.';
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, stable, hasFoundingOffer, error }));
  }

  return redirect(`/stables/${stableId}`);
}

/**
 * /stables/:id/care - slice 0013 §6.1/§6.3. The barn round: every horse that needs the chosen
 * service, oldest-due first, serviced until the balance runs out. Free of turns (§2.2). Refused
 * entirely only when the stable is already in debt (§2.7) - a round that is merely more expensive
 * than the balance allows still does as many as it can afford (§6.3), which callBarnRoundCare
 * itself handles.
 */
export async function stableCareRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const form = await parseForm(ctx.request);
  // Slice 0016 §4.4: the hidden `show` field on the care-round forms carries the barn tab you were
  // on back onto the redirect, so a round from a filtered tab doesn't bounce you back to All.
  const showSuffix = form.show ? `?show=${encodeURIComponent(form.show)}` : '';
  const backTo = `/stables/${String(stableId)}/horses${showSuffix}`;
  const joiner = showSuffix ? '&' : '?';

  // Slice 0014 §5.3: the Management round is a third button beside Farrier round/Wellness round,
  // one click renewing every due plan the stable is entitled to know about (§2.2's "one click does
  // the whole barn" promise, extended to Part B).
  if (form.service === 'management') {
    if (!canTakeOnCost(stable.balance)) {
      return redirect(
        `${backTo}${joiner}care_error=${encodeURIComponent(`${stable.name} is ${String(Math.abs(stable.balance))} in the red. Try dropping to poor feed, or ask a grown-up to add money, before a management round.`)}`
      );
    }
    const conditions = await getEnabledConditions(ctx.env);
    const result = await callBarnRoundManagement(ctx.env, {
      stableId,
      gameDay: ctx.world.game_day,
      config: ctx.config.values,
      balance: stable.balance,
      conditions,
    });
    if (result.totalCount === 0) return redirect(`${backTo}${joiner}care_notice=${encodeURIComponent('Nothing due.')}`);
    const notice =
      result.serviced < result.totalCount
        ? `Renewed ${String(result.serviced)} of ${String(result.totalCount)} management plans - not enough money for the rest.`
        : `Renewed ${String(result.serviced)} management plan${result.serviced === 1 ? '' : 's'}.`;
    return redirect(`${backTo}${joiner}care_notice=${encodeURIComponent(notice)}`);
  }

  const service: CareService | null = form.service === 'farrier' ? 'farrier' : form.service === 'wellness' ? 'wellness' : null;
  if (!service) return redirect(backTo);

  if (!canTakeOnCost(stable.balance)) {
    const who = service === 'farrier' ? 'a farrier round' : 'a wellness round';
    return redirect(
      `${backTo}${joiner}care_error=${encodeURIComponent(`${stable.name} is ${String(Math.abs(stable.balance))} in the red. Try dropping to poor feed, or ask a grown-up to add money, before ${who}.`)}`
    );
  }

  const result = await callBarnRoundCare(ctx.env, { stableId, service, gameDay: ctx.world.game_day, config: ctx.config.values, balance: stable.balance });

  if (result.totalCount === 0) return redirect(`${backTo}${joiner}care_notice=${encodeURIComponent('Nothing due.')}`);

  const verb = service === 'farrier' ? 'Shod' : 'Vet visited';
  const notice =
    result.serviced < result.totalCount
      ? `${verb} ${String(result.serviced)} of ${String(result.totalCount)} - not enough money for the rest.`
      : `${verb} ${String(result.serviced)} horse${result.serviced === 1 ? '' : 's'}.`;
  return redirect(`${backTo}${joiner}care_notice=${encodeURIComponent(notice)}`);
}

/** /stables/:id/feed - slice 0013 §2.5/§6.1. Free, costs no turn, takes effect from the next
 * tick's board charge. */
export async function stableFeedRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const form = await parseForm(ctx.request);
  const feedLevel = form.feed_level ?? '';
  // Slice 0016 §4.4: same hidden `show` field, same carry-through, on the feed form.
  const showSuffix = form.show ? `?show=${encodeURIComponent(form.show)}` : '';
  const backTo = `/stables/${String(stableId)}/horses${showSuffix}`;
  const joiner = showSuffix ? '&' : '?';
  if (!(feedLevel in ctx.config.values.feed_levels.levels)) {
    return redirect(`${backTo}${joiner}care_error=${encodeURIComponent('Choose a feed level.')}`);
  }

  await setFeedLevel(ctx.env, stableId, feedLevel);
  return redirect(`${backTo}${joiner}care_notice=${encodeURIComponent('Feed level saved.')}`);
}
