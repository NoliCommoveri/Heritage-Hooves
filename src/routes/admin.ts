import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import {
  renderAdminHomePage,
  renderAccountsPage,
  renderConfigPage,
  renderConfigHistoryPage,
  renderWorldPage,
  renderBreedingAdminPage,
  renderFoundingAdminPage,
} from '../render/admin';
import { renderAdminHorseNewPage } from '../render/horses';
import { listAccounts, createAccount, updatePassword, setActive } from '../db/accounts';
import { listAllStables, getStableById } from '../db/stables';
import { getBreeds, getLoci } from '../db/breeds';
import { createFoundingHorse } from '../db/horses';
import { mintOffer, listRecentOffers } from '../db/founding';
import { hashPassword } from '../lib/password';
import { writeConfig, type ConfigValues } from '../lib/config-cache';
import { listConfigAudit } from '../db/configAudit';
import { setPaused } from '../db/world';
import { listRecentTickRuns } from '../db/tickRuns';
import { runManualTick } from '../tick';
import { validateHorseNamePart } from '../lib/validation';
import { LOCI } from '../engines/genetics/loci';
import { sortAllelePair, GENOTYPE_VERSION, type AllelePair, type Genotype } from '../engines/genetics/genotype';
import { generateFounderPolygenic } from '../engines/genetics/polygenic';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';

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

export async function adminHorseNewRoute(ctx: RequestContext, method: string): Promise<Response> {
  const [stables, breeds, loci] = await Promise.all([listAllStables(ctx.env), getBreeds(ctx.env), getLoci(ctx.env)]);

  if (method === 'GET') {
    return htmlResponse(renderAdminHorseNewPage({ world: ctx.world, stables, breeds, loci }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const stableId = Number(form.stable_id);
  const sex = form.sex === 'stallion' ? 'stallion' : 'mare';
  const breedId = Number(form.breed_id);
  const namePart = (form.name ?? '').trim();
  const ageYears = Number(form.age_years);

  const stable = stables.find((s) => s.id === stableId);
  const breed = breeds.find((b) => b.id === breedId);
  const nameValidation = validateHorseNamePart(namePart);

  if (!stable || !breed || !nameValidation.ok || !Number.isFinite(ageYears) || ageYears < 0) {
    return htmlResponse(
      renderAdminHorseNewPage({
        world: ctx.world,
        stables,
        breeds,
        loci,
        error: !nameValidation.ok ? nameValidation.error : 'Choose a stable and a breed, and give a valid, non-negative age.',
        form,
      })
    );
  }

  const mendelian: Record<string, AllelePair> = {};
  for (const locus of LOCI) {
    const a1 = form[`locus_${locus.code}_1`] ?? locus.wildType;
    const a2 = form[`locus_${locus.code}_2`] ?? locus.wildType;
    mendelian[locus.code] = sortAllelePair(locus.code, a1, a2);
  }

  const bornGameDay = ctx.world.game_day - Math.round(ageYears * ctx.config.values.game_days_per_year);

  // Slice 0005 §6.6: the polygenic draw moves out here, where the pure-engine/thin-database split
  // (CLAUDE.md §5.1) actually belongs - db/horses.ts no longer does any genetics of its own. A
  // flat 50/50 draw is right for a deliberately-constructed test horse; the band-weighted draw the
  // founding-stock generator uses lives in src/engines/founding/generate.ts instead.
  const seed = randomSeed();
  const polygenicRng = makeRng(deriveSeed(seed, 'founder_polygenic'));
  const genotype: Genotype = { v: GENOTYPE_VERSION, mendelian, polygenic: generateFounderPolygenic(polygenicRng) };

  const result = await createFoundingHorse(ctx.env, {
    stableId,
    sex,
    breedId,
    breedCode: breed.code,
    name: namePart,
    bornGameDay,
    genotype,
    rngSeed: seed,
    worldTickSeq: ctx.world.tick_seq,
    estrousCycleTicks: ctx.config.values.estrous_cycle_ticks,
  });

  if (!result.ok) {
    return htmlResponse(
      renderAdminHorseNewPage({ world: ctx.world, stables, breeds, loci, error: 'That name is already registered to another horse.', form })
    );
  }

  return redirect(`/horses/${String(result.horseId)}`);
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

export async function adminBreedingRoute(ctx: RequestContext, method: string): Promise<Response> {
  if (method === 'GET') {
    const params = new URL(ctx.request.url).searchParams;
    const notice = params.get('forced') ? 'The next covering to conceive will be twins.' : undefined;
    return htmlResponse(renderBreedingAdminPage({ world: ctx.world, config: ctx.config, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action === 'force_twins') {
    if (form.confirm !== 'yes') return redirect('/admin/breeding');
    await writeConfig(ctx.env, ctx.account!.id, { flags: { force_next_twins: true } });
    return redirect('/admin/breeding?forced=1');
  }

  return notFound();
}

/**
 * Mint a founding-stock batch into any stable (slice 0005 §11) - the whole grant path until §7's
 * PIN lands as a follow-up slice. source is 'admin_grant' regardless of which admin does this;
 * granted_by_account_id records who.
 */
export async function adminFoundingRoute(ctx: RequestContext, method: string): Promise<Response> {
  const stables = await listAllStables(ctx.env);

  if (method === 'GET') {
    const params = new URL(ctx.request.url).searchParams;
    const notice = params.get('granted') ? 'Batch granted.' : undefined;
    const offers = await listRecentOffers(ctx.env, 20);
    const stableNameById = new Map(stables.map((s) => [s.id, s.name]));
    const recentOffers = offers.map((o) => ({ ...o, stableName: stableNameById.get(o.stable_id) ?? `Stable #${String(o.stable_id)}` }));
    return htmlResponse(
      renderFoundingAdminPage({
        world: ctx.world,
        stables,
        qualityBands: ctx.config.values.quality_bands,
        defaultBand: ctx.config.values.founding_quality_band,
        recentOffers,
        notice,
      })
    );
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action !== 'mint') return notFound();

  const stableId = Number(form.stable_id);
  const band = form.band ?? '';
  const stable = await getStableById(ctx.env, stableId);

  if (!stable || ctx.config.values.quality_bands[band] === undefined) {
    const offers = await listRecentOffers(ctx.env, 20);
    const stableNameById = new Map(stables.map((s) => [s.id, s.name]));
    const recentOffers = offers.map((o) => ({ ...o, stableName: stableNameById.get(o.stable_id) ?? `Stable #${String(o.stable_id)}` }));
    return htmlResponse(
      renderFoundingAdminPage({
        world: ctx.world,
        stables,
        qualityBands: ctx.config.values.quality_bands,
        defaultBand: ctx.config.values.founding_quality_band,
        recentOffers,
        error: 'Choose a stable and a quality band.',
      })
    );
  }

  await mintOffer(ctx.env, {
    stableId,
    accountId: stable.account_id,
    source: 'admin_grant',
    grantedByAccountId: ctx.account!.id,
    gameDay: ctx.world.game_day,
    config: ctx.config,
    band,
  });

  return redirect('/admin/founding?granted=1');
}
