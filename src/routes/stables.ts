import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderStablesPicker, renderNewStablePage, renderStableHomePage, renderPrefixPage } from '../render/stables';
import { renderMoneyPage } from '../render/money';
import {
  listStablesForAccount,
  countActiveStablesForAccount,
  createStableWithPrefix,
  getStableById,
  renamePrefix,
  type StableRow,
} from '../db/stables';
import { setLastActiveStable } from '../db/accounts';
import { countAliveHorses } from '../db/horses';
import { validatePrefix, normalizePrefix } from '../lib/prefix';
import { buildStableCookie } from '../lib/session';
import { hasWaitingFoundingOffer } from '../db/founding';
import { getLedgerForStable, withRunningBalance } from '../db/ledger';

export async function stablesPickerRoute(ctx: RequestContext): Promise<Response> {
  const account = ctx.account!;
  const stables = await listStablesForAccount(ctx.env, account.id);
  const max = ctx.config.values.max_stables_per_account;
  return htmlResponse(
    renderStablesPicker({
      world: ctx.world,
      isAdmin: account.is_admin === 1,
      stables,
      canCreateMore: stables.length < max,
      maxStables: max,
    })
  );
}

export async function stablesNewRoute(ctx: RequestContext, method: string): Promise<Response> {
  const account = ctx.account!;
  const isAdmin = account.is_admin === 1;
  const max = ctx.config.values.max_stables_per_account;

  const currentCount = await countActiveStablesForAccount(ctx.env, account.id);
  if (currentCount >= max) return redirect('/stables');

  if (method === 'GET') {
    return htmlResponse(renderNewStablePage({ world: ctx.world, isAdmin }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const name = (form.name ?? '').trim();
  const prefixInput = form.prefix ?? '';

  if (name.length < 1 || name.length > 60) {
    return htmlResponse(
      renderNewStablePage({ world: ctx.world, isAdmin, error: 'Stable name is required (up to 60 characters).', name, prefix: prefixInput })
    );
  }

  const validation = validatePrefix(prefixInput);
  if (!validation.ok) {
    return htmlResponse(renderNewStablePage({ world: ctx.world, isAdmin, error: validation.error, name, prefix: prefixInput }));
  }

  const result = await createStableWithPrefix(ctx.env, {
    accountId: account.id,
    name,
    prefix: normalizePrefix(prefixInput),
    gameDay: ctx.world.game_day,
  });

  if (!result.ok) {
    return htmlResponse(
      renderNewStablePage({ world: ctx.world, isAdmin, error: 'That prefix is already taken. Try another.', name, prefix: prefixInput })
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
  const [hasFoundingOffer, aliveHorseCount] = await Promise.all([
    hasWaitingFoundingOffer(ctx.env, stableId),
    countAliveHorses(ctx.env, stableId),
  ]);
  return htmlResponse(
    renderStableHomePage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      stable,
      hasFoundingOffer,
      aliveHorseCount,
      upkeepPerHorsePerGameDay: ctx.config.values.upkeep_per_horse_per_game_day,
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
    renderMoneyPage({ world: ctx.world, isAdmin: ctx.account!.is_admin === 1, stable, hasFoundingOffer, rows })
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
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);

  if (method === 'GET' || stable.prefix_locked) {
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, stable, hasFoundingOffer }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const prefixInput = form.prefix ?? '';
  const validation = validatePrefix(prefixInput);
  if (!validation.ok) {
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, stable, hasFoundingOffer, error: validation.error }));
  }

  const result = await renamePrefix(ctx.env, { stableId, newPrefix: normalizePrefix(prefixInput), gameDay: ctx.world.game_day });
  if (!result.ok) {
    const error = result.error === 'locked' ? 'This prefix is locked and can no longer change.' : 'That prefix is already taken. Try another.';
    return htmlResponse(renderPrefixPage({ world: ctx.world, isAdmin, stable, hasFoundingOffer, error }));
  }

  return redirect(`/stables/${stableId}`);
}
