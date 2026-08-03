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
  renderBreedsAdminPage,
  renderResetPage,
  renderShowsAdminPage,
  renderMoneyAdminPage,
  renderHealthAdminPage,
  renderAgeingAdminPage,
  renderCareAdminPage,
  renderNpcAdminPage,
  renderAdminSecurityPage,
  renderAdminUnlockPage,
  renderAdminHorseSearchPage,
} from '../render/admin';
import { renderAdminHorseNewPage } from '../render/horses';
import {
  listAccounts,
  createAccount,
  updatePassword,
  setActive,
  countStablesByAccount,
  listStableNamesForAccount,
  hasGrantedFoundingBatch,
  countAdmins,
  updateAccountProfile,
  setAdminFlag,
  deleteAccountRow,
} from '../db/accounts';
import { countResetRows, resetWorld, type ResetScope } from '../db/reset';
import { expireStableCookie, buildAdminUnlockCookie } from '../lib/session';
import { setPinHash, recordPinAttempt, listRecentPinAttempts, listRecentPinAttemptsForDisplay } from '../db/pin';
import { decidePinAttempt } from '../lib/pin';
import { nowUtcSeconds } from '../lib/time';
import { listAllStables, getStableById } from '../db/stables';
import { getBreeds, getLoci, updateBreedImageCounts } from '../db/breeds';
import { createFoundingHorse, countAliveHorses, listStableHorses, horseDisplayName, searchHorses } from '../db/horses';
import { ageState } from '../engines/ageing/lifespan';
import { mintOffer, listRecentOffers } from '../db/founding';
import { getShowBarnStable, stockShowBarn, stockNpcStable } from '../db/npc';
import { listShowsForAdmin, judgeDueShowClasses } from '../db/shows';
import { listNpcStablesForAdmin, listNpcCeilingSchedule, upsertNpcCeilingScheduleRow, foundNpcStable } from '../db/npcBreeding';
import { getDisciplines } from '../db/disciplines';
import { buildLedgerStatements, listStableBalancesForAdmin, listRecentAdjustments } from '../db/ledger';
import { hashPassword, verifyPassword } from '../lib/password';
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
import { parseImageCount } from '../lib/images';
import { getEnabledConditions, conditionCensus } from '../db/health';
import { listLivingHorsesForAdmin, listRecentDeaths, bringHorseDeathForward, ageModifierDistribution } from '../db/ageing';
import { getCareAdminData, makeAllHorsesOverdue } from '../db/care';

export async function adminHomeRoute(ctx: RequestContext): Promise<Response> {
  return htmlResponse(renderAdminHomePage({ world: ctx.world }));
}

/**
 * /admin/horses (a follow-up to slice 0016): find any horse by name and jump straight to its full
 * page. `/horses/:id` already shows an admin everything an owner sees - conformation, care,
 * genotype - and now (per the same follow-up) true health status computed from the genotype
 * directly rather than filtered through what any one stable has paid to learn. This page is just
 * the missing way in: without it, an admin had to go stable by stable to find a horse.
 */
export async function adminHorseSearchRoute(ctx: RequestContext): Promise<Response> {
  const query = new URL(ctx.request.url).searchParams.get('q')?.trim() ?? '';
  const results = query.length > 0 ? await searchHorses(ctx.env, query, 50) : [];
  return htmlResponse(renderAdminHorseSearchPage({ world: ctx.world, query, results }));
}

export async function adminAccountsRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const [accounts, stableCounts, adminCount] = await Promise.all([listAccounts(ctx.env), countStablesByAccount(ctx.env), countAdmins(ctx.env)]);
    return htmlResponse(
      renderAccountsPage({ world: ctx.world, accounts, stableCounts, currentAccountId: ctx.account!.id, adminCount, error, notice })
    );
  }

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('saved') ? 'Saved.' : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const minLen = ctx.config.values.min_password_length;

  if (form.action === 'create') {
    const displayName = (form.display_name ?? '').trim();
    const username = (form.username ?? '').trim();
    const startingPassword = form.starting_password ?? '';

    if (!displayName || !username) return page('Name and username are required.');
    if (startingPassword.length < minLen) return page(`Starting password must be at least ${minLen} characters.`);

    const passwordHash = await hashPassword(startingPassword);
    try {
      await createAccount(ctx.env, { username, displayName, passwordHash, isAdmin: false, mustChangePassword: true });
    } catch {
      return page('That username is already taken.');
    }
    return redirect('/admin/accounts?saved=1');
  }

  if (form.action === 'reset_password') {
    const accountId = Number(form.account_id);
    const startingPassword = form.starting_password ?? '';
    if (startingPassword.length < minLen) return page(`Starting password must be at least ${minLen} characters.`);
    const passwordHash = await hashPassword(startingPassword);
    await updatePassword(ctx.env, accountId, passwordHash, true);
    return redirect('/admin/accounts?saved=1');
  }

  if (form.action === 'deactivate' || form.action === 'reactivate') {
    const accountId = Number(form.account_id);
    await setActive(ctx.env, accountId, form.action === 'reactivate');
    return redirect('/admin/accounts?saved=1');
  }

  // §8.2: rename and username change together. Changing a username never logs anyone out - the
  // session cookie carries the account id, not the name.
  if (form.action === 'edit') {
    const accountId = Number(form.account_id);
    const displayName = (form.display_name ?? '').trim();
    const username = (form.username ?? '').trim();
    if (!displayName || !username) return page('Name and username are required.');

    const result = await updateAccountProfile(ctx.env, accountId, displayName, username);
    if (!result.ok) return page('That username is already taken.');
    return redirect('/admin/accounts?saved=1');
  }

  // §8.3: two guards, both re-checked here rather than trusted from the form - the single most
  // likely way to lock the operator out.
  if (form.action === 'set_admin') {
    const accountId = Number(form.account_id);
    const makeAdmin = form.is_admin === '1';

    if (!makeAdmin) {
      if (accountId === ctx.account!.id) return page("You can't remove your own admin flag.");
      const adminCount = await countAdmins(ctx.env);
      const target = (await listAccounts(ctx.env)).find((a) => a.id === accountId);
      if (target?.is_admin === 1 && adminCount <= 1) return page("You can't remove the last admin.");
    }

    await setAdminFlag(ctx.env, accountId, makeAdmin);
    return redirect('/admin/accounts?saved=1');
  }

  // §8.4: refuse, never cascade - an account that owns anything keeps it, always. Guarded by the
  // same tick-box-plus-typed-word pattern /admin/reset uses, the typed word being the account's own
  // username here rather than a fixed word.
  if (form.action === 'delete') {
    const accountId = Number(form.account_id);
    const target = (await listAccounts(ctx.env)).find((a) => a.id === accountId);
    if (!target) return notFound();

    if (form.confirm !== 'yes') return page('Tick the box to confirm before deleting an account.');
    if ((form.confirm_word ?? '').trim() !== target.username) return page(`Type ${target.username} to confirm.`);

    if (accountId === ctx.account!.id) return page("You can't delete your own account.");

    const adminCount = await countAdmins(ctx.env);
    if (target.is_admin === 1 && adminCount <= 1) return page("You can't delete the last admin.");

    const stableNames = await listStableNamesForAccount(ctx.env, accountId);
    if (stableNames.length > 0) {
      return page(`${stableNames.join(' and ')} still belong to this account. Deactivate the account instead, or move the stables first.`);
    }
    if (await hasGrantedFoundingBatch(ctx.env, accountId)) {
      return page(`${target.display_name} has granted a founding-stock batch on record. Deactivate the account instead.`);
    }

    try {
      await deleteAccountRow(ctx.env, accountId);
    } catch (err) {
      // A foreign key elsewhere (pin_attempts, config_audit) that the checks above don't name -
      // only possible for an account that has actually used an admin page, which the "created with
      // a typo and never used" case this button is for never will. Refuse rather than crash.
      if (err instanceof Error && /foreign key/i.test(err.message)) {
        return page(`${target.display_name} has other records attached and can't be deleted - deactivate the account instead.`);
      }
      throw err;
    }
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
  'conformation_noise_sd',
  'conformation_maturity_years',
  'show_interval_game_days',
  'show_entry_window_game_days',
  'show_target_field_size',
  'show_max_entries_per_stable',
  'show_conformation_min_age_game_days',
  'npc_show_barn_size',
  'upkeep_per_horse_per_game_day',
  'actions_per_tick',
  'events_retention_game_days',
  'genotype_test_cost',
  'genotype_panel_cost',
  'lethal_foal_death_game_days',
  'lifespan_mean_game_days',
  'lifespan_sd_game_days',
  'lifespan_min_game_days',
  'lifespan_max_game_days',
  'frailty_window_game_days',
  'veteran_age_game_days',
  'barn_shows_ended_game_days',
  'care_start_age_game_days',
  'farrier_interval_game_days',
  'farrier_overdue_game_days',
  'farrier_cost',
  'vet_wellness_interval_game_days',
  'vet_wellness_overdue_game_days',
  'vet_wellness_cost',
  'foal_max_age_game_days',
  'shows_recent_count',
  'pin_max_attempts',
  'pin_lockout_window_seconds',
  'admin_pin_grace_seconds',
  'market_commission_percent',
  'market_listing_game_days',
  'market_max_price',
  'market_base_value',
  'market_min_value',
] as const;

// These are genuine fractions (0.55, 1.0, 2.0, 5) rather than whole numbers - CLAUDE.md §5.5/slice
// 0006 §5.3 - so they get their own validation rather than NUMERIC_CONFIG_KEYS's Number.isInteger
// check. show_noise_sd and show_ideal_falloff aren't strictly fractional today, but they're tuned
// in fine increments (slice 0008 §5.8), so they belong here rather than the whole-number list.
const DECIMAL_CONFIG_KEYS = [
  'conformation_realization_at_birth',
  'inbreeding_depression_factor',
  'show_noise_sd',
  'show_ideal_falloff',
  'farrier_bonus',
  'farrier_penalty',
  'vet_wellness_bonus',
  'vet_wellness_penalty',
  'care_modifier_min',
  'care_modifier_max',
  'market_price_multiplier',
  'market_quality_weight',
  'market_foal_value_factor',
  'market_failing_factor',
  'market_clear_premium',
  'market_clear_premium_cap',
  'market_carrier_factor',
  'market_affected_factor',
  'market_win_bonus',
  'market_place_bonus',
  'market_record_cap',
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

  for (const key of DECIMAL_CONFIG_KEYS) {
    const rawValue = form[key];
    if (rawValue === undefined) continue;
    const n = Number(rawValue);
    if (!Number.isFinite(n)) {
      return htmlResponse(renderConfigPage({ world: ctx.world, config: ctx.config, error: `${key.replace(/_/g, ' ')} must be a number.` }));
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

  const conditions = await getEnabledConditions(ctx.env);
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
    conformationNoiseSd: ctx.config.values.conformation_noise_sd,
    conditions,
    lethalFoalDeathGameDays: ctx.config.values.lethal_foal_death_game_days,
    accountId: stable.account_id,
    lifespanConfig: ctx.config.values,
    careStartAgeGameDays: ctx.config.values.care_start_age_game_days,
    currentGameDay: ctx.world.game_day,
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

/** Slice 0007 §6.4: grows the image library by count, not by upload - the Worker has no write path
 * to static assets (§4.5). Rejects a non-whole-number or out-of-range count with a sentence naming
 * the breed, the same shape as /admin/config's numeric validation. */
export async function adminBreedsRoute(ctx: RequestContext, method: string): Promise<Response> {
  const breeds = await getBreeds(ctx.env);

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('saved') ? 'Changes saved.' : undefined;
    return htmlResponse(renderBreedsAdminPage({ world: ctx.world, breeds, notice }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const counts: { breedId: number; imageCount: number }[] = [];
  for (const breed of breeds) {
    const rawValue = form[`count_${String(breed.id)}`];
    if (rawValue === undefined) continue;
    const parsed = parseImageCount(rawValue.trim());
    if (parsed === null) {
      return htmlResponse(
        renderBreedsAdminPage({ world: ctx.world, breeds, error: `${breed.name}'s count must be a whole number from 0 to 99.` })
      );
    }
    counts.push({ breedId: breed.id, imageCount: parsed });
  }

  await updateBreedImageCounts(ctx.env, counts);
  return redirect('/admin/breeds?saved=1');
}

/**
 * Clear the world so it can be played from the start again. Guarded by the `required` checkbox
 * pattern the world-clock page uses plus a typed confirmation word, both re-checked here rather
 * than trusted from the form. Accounts, config and the reference tables are never touched - see
 * src/db/reset.ts for the full list and why.
 */
export async function adminResetRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const [counts, accounts] = await Promise.all([countResetRows(ctx.env), listAccounts(ctx.env)]);
    return htmlResponse(renderResetPage({ world: ctx.world, counts, accountCount: accounts.length, error, notice }));
  }

  if (method === 'GET') {
    const done = new URL(ctx.request.url).searchParams.get('cleared');
    let notice: string | undefined;
    if (done === 'horses') notice = 'Every horse, pedigree, covering, pregnancy and founding batch is gone. Stables are untouched and the calendar is still running.';
    else if (done === 'world') notice = 'The world is empty and the calendar is back at day 0. Everyone starts by making a new stable.';
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action !== 'reset') return notFound();

  const scope: ResetScope | null = form.scope === 'world' ? 'world' : form.scope === 'horses' ? 'horses' : null;
  if (!scope) return page('Choose how much to clear.');
  if (form.confirm !== 'yes') return page('Tick the box to confirm before clearing.');
  if ((form.confirm_word ?? '').trim().toLowerCase() !== 'reset') return page('Type the word reset in the box to confirm.');

  await resetWorld(ctx.env, scope);

  // A full reset deletes the stable this browser last had selected, so drop that cookie too.
  const response = redirect(`/admin/reset?cleared=${scope}`);
  if (scope === 'world') response.headers.append('Set-Cookie', expireStableCookie());
  return response;
}

/**
 * Slice 0008 §8.2: stock the NPC show barn, judge the next show now (for testing), and a read-only
 * list of recent shows. No show-creation form here - shows come from the tick (§6), not an admin
 * button.
 */
export async function adminShowsRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const barn = await getShowBarnStable(ctx.env);
    const barnCount = barn ? await countAliveHorses(ctx.env, barn.id) : 0;
    const recentShows = await listShowsForAdmin(ctx.env, 20);
    // Slice 0011 §2.3/§8.2: the show barn ages and dies on the same code path as everyone else's
    // horses (CLAUDE.md §13), so it will thin out on its own over months of play - this has to be
    // visible or it is a mystery. listStableHorses already sorts oldest-first, so its top five are
    // the barn's oldest without a second query.
    const barnHorses = barn ? await listStableHorses(ctx.env, barn.id) : [];
    const oldestBarnHorses = barnHorses.slice(0, 5).map((h) => ({
      name: horseDisplayName(h),
      ageState: ageState({ bornGameDay: h.born_game_day, naturalDeathGameDay: h.natural_death_game_day, status: h.status }, ctx.world.game_day, ctx.config.values),
    }));
    return htmlResponse(
      renderShowsAdminPage({
        world: ctx.world,
        barnCount,
        barnTarget: ctx.config.values.npc_show_barn_size,
        oldestBarnHorses,
        qualityBands: ctx.config.values.quality_bands,
        defaultBand: ctx.config.values.npc_show_barn_quality_band,
        recentShows,
        error,
        notice,
      })
    );
  }

  if (method === 'GET') {
    const params = new URL(ctx.request.url).searchParams;
    const notice = params.get('stocked') ? 'Show barn stocked.' : params.get('judged') ? 'Judged every show that was due.' : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  if (form.action === 'stock_barn') {
    if (form.confirm !== 'yes') return page('Tick the box to confirm before stocking the barn.');
    const band = form.band ?? '';
    if (ctx.config.values.quality_bands[band] === undefined) return page('Choose a quality band.');

    await stockShowBarn(ctx.env, {
      config: ctx.config,
      gameDay: ctx.world.game_day,
      worldTickSeq: ctx.world.tick_seq,
      targetSize: ctx.config.values.npc_show_barn_size,
      band,
    });
    return redirect('/admin/shows?stocked=1');
  }

  if (form.action === 'judge_now') {
    await judgeDueShowClasses(ctx.env, ctx.world.game_day, ctx.config);
    return redirect('/admin/shows?judged=1');
  }

  return notFound();
}

/**
 * §7.3: adding or removing money by hand, the relief valve for §2.4's debt rule. Guarded by the
 * `required` checkbox pattern the world-clock page uses, re-checked here rather than trusted from
 * the form. One kind = 'adjustment' ledger row per submission, written through
 * buildLedgerStatements (src/db/ledger.ts) like every other movement in the game - referenceType
 * 'account'/referenceId the admin account that did it, so a later reader can trace who.
 */
export async function adminMoneyRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const [stables, recentAdjustments] = await Promise.all([listStableBalancesForAdmin(ctx.env), listRecentAdjustments(ctx.env, 20)]);
    return htmlResponse(renderMoneyAdminPage({ world: ctx.world, stables, recentAdjustments, error, notice }));
  }

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('applied') ? 'Adjustment applied.' : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action !== 'adjust') return notFound();

  if (form.confirm !== 'yes') return page('Tick the box to confirm before applying this adjustment.');

  const stableId = Number(form.stable_id);
  const amount = Number(form.amount);
  const reason = (form.reason ?? '').trim();

  if (!Number.isFinite(stableId)) return page('Choose a stable.');
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) return page('Amount must be a non-zero whole number.');
  if (!reason) return page('A reason is required.');

  const stable = await getStableById(ctx.env, stableId);
  if (!stable) return page('Choose a stable.');

  await ctx.env.DB.batch(
    buildLedgerStatements(ctx.env, [
      {
        stableId,
        amount,
        kind: 'adjustment',
        referenceType: 'account',
        referenceId: ctx.account!.id,
        description: reason,
        gameDay: ctx.world.game_day,
      },
    ])
  );

  return redirect('/admin/money?applied=1');
}

/** /admin/health (slice 0010 §8) - read-only, no editing form. */
export async function adminHealthRoute(ctx: RequestContext): Promise<Response> {
  const census = await conditionCensus(ctx.env, ctx.world.game_day);
  return htmlResponse(renderHealthAdminPage({ world: ctx.world, census }));
}

// Slice 0011 §8.4: roughly one game year - long enough to see a rate, short enough to stay a
// window rather than a full history (horse_show_summary/the ledger are where full history lives).
const RECENT_DEATHS_WINDOW_GAME_DAYS = 360;

/** /admin/ageing (slice 0011 §8.4). GET is read-only except for one control - see the comment on
 * bringHorseDeathForward in src/db/ageing.ts for why this shape does not cross overview §6b's
 * warning about advancing an individual horse. */
export async function adminAgeingRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const [livingHorses, recentDeaths] = await Promise.all([
      listLivingHorsesForAdmin(ctx.env, ctx.world.game_day, ctx.config),
      listRecentDeaths(ctx.env, ctx.world.game_day, RECENT_DEATHS_WINDOW_GAME_DAYS),
    ]);
    return htmlResponse(
      renderAgeingAdminPage({
        world: ctx.world,
        livingHorses,
        recentDeaths,
        recentDeathsWindowGameDays: RECENT_DEATHS_WINDOW_GAME_DAYS,
        ageModifierDistribution: ageModifierDistribution(livingHorses),
        error,
        notice,
      })
    );
  }

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('forced') ? "That horse's end has been brought forward to today." : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action !== 'force_death') return notFound();
  if (form.confirm !== 'yes') return page("Tick the box to confirm before bringing a horse's end forward.");

  const horseId = Number(form.horse_id);
  if (!Number.isInteger(horseId)) return page('Choose a horse.');

  await bringHorseDeathForward(ctx.env, horseId, ctx.world.game_day);
  return redirect('/admin/ageing?forced=1');
}

/** /admin/care (slice 0013 §8.5) - read-only except for the "make every horse overdue" testing
 * control. */
export async function adminCareRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const data = await getCareAdminData(ctx.env, ctx.world.game_day, ctx.config);
    return htmlResponse(renderCareAdminPage({ world: ctx.world, data, noticeEnabled: ctx.config.flags.care_notice_enabled !== false, error, notice }));
  }

  if (method === 'GET') {
    const params = new URL(ctx.request.url).searchParams;
    const notice = params.get('forced')
      ? 'Every eligible horse is now fully overdue on both timers.'
      : params.get('toggled')
        ? 'Overdue notices setting saved.'
        : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  if (form.action === 'toggle_notice') {
    await writeConfig(ctx.env, ctx.account!.id, { flags: { care_notice_enabled: ctx.config.flags.care_notice_enabled === false } });
    return redirect('/admin/care?toggled=1');
  }

  if (form.action !== 'make_overdue') return notFound();
  if (form.confirm !== 'yes') return page('Tick the box to confirm before making every horse overdue.');

  await makeAllHorsesOverdue(ctx.env, ctx.world.game_day, ctx.config.values);
  return redirect('/admin/care?forced=1');
}

/**
 * /admin/npc (slice 0015 §7.3): every NPC stable's roster, personality and breeding cycle, the
 * ceiling schedule, and three controls - editing the schedule, founding a new personality stable,
 * and adding an outcross batch to any NPC stable by hand (§3.3's only way genetic material enters a
 * closed NPC population). Read-only otherwise, per CLAUDE.md §13.
 */
export async function adminNpcRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string, notice?: string): Promise<Response> {
    const [stables, ceilingSchedule, breeds, disciplines] = await Promise.all([
      listNpcStablesForAdmin(ctx.env),
      listNpcCeilingSchedule(ctx.env),
      getBreeds(ctx.env),
      getDisciplines(ctx.env),
    ]);
    return htmlResponse(
      renderNpcAdminPage({
        world: ctx.world,
        stables,
        ceilingSchedule,
        breeds,
        disciplines,
        qualityBands: ctx.config.values.quality_bands,
        defaultBand: ctx.config.values.founding_quality_band,
        error,
        notice,
      })
    );
  }

  if (method === 'GET') {
    const params = new URL(ctx.request.url).searchParams;
    const notice = params.get('ceiling_saved')
      ? 'Ceiling schedule saved.'
      : params.get('founded')
        ? 'New NPC stable founded.'
        : params.get('stocked')
          ? 'Outcross batch added.'
          : undefined;
    return page(undefined, notice);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  if (form.action === 'edit_ceiling') {
    const id = form.id ? Number(form.id) : undefined;
    const gameDayFrom = Number(form.game_day_from);
    const conformationCeiling = Number(form.conformation_ceiling);
    const abilityCeiling = Number(form.ability_ceiling);
    if (!Number.isFinite(gameDayFrom) || !Number.isFinite(conformationCeiling) || !Number.isFinite(abilityCeiling)) {
      return page('Every ceiling-schedule field must be a number.');
    }
    await upsertNpcCeilingScheduleRow(ctx.env, { id, gameDayFrom, conformationCeiling, abilityCeiling });
    return redirect('/admin/npc?ceiling_saved=1');
  }

  if (form.action === 'found_stable') {
    const name = (form.name ?? '').trim();
    const prefix = (form.prefix ?? '').trim();
    const personalityCode = (form.personality_code ?? '').trim();
    const targetKind: 'conformation' | 'ability' | null = form.target_kind === 'ability' ? 'ability' : form.target_kind === 'conformation' ? 'conformation' : null;
    const targetBreedId = form.target_breed_id ? Number(form.target_breed_id) : null;
    const targetDisciplineCode = form.target_discipline_code || null;
    const selectionNoiseSd = Number(form.selection_noise_sd);
    const retentionBias = Number(form.retention_bias);
    const breedingIntervalGameDays = Number(form.breeding_interval_game_days);
    const maxPairsPerCycle = Number(form.max_pairs_per_cycle);
    const capacity = Number(form.capacity);

    if (!name || !prefix || !personalityCode || !targetKind) return page('Fill in a name, a prefix, a personality label and a target kind.');
    if (targetKind === 'conformation' && !targetBreedId) return page('Choose a breed for a conformation-specialist stable.');
    if (targetKind === 'ability' && !targetDisciplineCode) return page('Choose a discipline for a discipline-barn stable.');
    if (![selectionNoiseSd, retentionBias, breedingIntervalGameDays, maxPairsPerCycle, capacity].every(Number.isFinite)) {
      return page('Every breeding-policy number must be filled in.');
    }

    const result = await foundNpcStable(ctx.env, {
      name,
      prefix,
      personalityCode,
      targetKind,
      targetBreedId: targetKind === 'conformation' ? targetBreedId : null,
      targetDisciplineCode: targetKind === 'ability' ? targetDisciplineCode : null,
      selectionNoiseSd,
      retentionBias,
      breedingIntervalGameDays,
      maxPairsPerCycle,
      capacity,
      gameDay: ctx.world.game_day,
    });
    if (!result.ok) return page('That prefix is already taken - choose another.');
    return redirect('/admin/npc?founded=1');
  }

  if (form.action === 'outcross') {
    if (form.confirm !== 'yes') return page('Tick the box to confirm before adding an outcross batch.');
    const stableId = Number(form.stable_id);
    const breedId = Number(form.breed_id);
    const band = form.band ?? '';
    const count = Number(form.count);
    if (!Number.isFinite(stableId) || !Number.isFinite(breedId)) return page('Choose a stable and a breed.');
    if (ctx.config.values.quality_bands[band] === undefined) return page('Choose a quality band.');
    if (!Number.isInteger(count) || count <= 0) return page('The number to add must be a positive whole number.');

    await stockNpcStable(ctx.env, {
      stableId,
      breedId,
      config: ctx.config,
      gameDay: ctx.world.game_day,
      worldTickSeq: ctx.world.tick_seq,
      count,
      band,
    });
    return redirect('/admin/npc?stocked=1');
  }

  return notFound();
}

/**
 * /admin/security (slice 0016 §9.2). Sets or changes the admin PIN for the logged-in admin's own
 * account only - an admin can't set another admin's PIN, so there is no account picker here.
 * Changing it requires the account's own login password, verified server-side.
 */
export async function adminSecurityRoute(ctx: RequestContext, method: string): Promise<Response> {
  async function page(error?: string): Promise<Response> {
    const attempts = await listRecentPinAttemptsForDisplay(ctx.env, 20);
    const notice = new URL(ctx.request.url).searchParams.get('saved') ? 'PIN saved.' : undefined;
    return htmlResponse(renderAdminSecurityPage({ world: ctx.world, hasPinSet: ctx.account!.pin_hash !== null, attempts, error, notice }));
  }

  if (method === 'GET') return page();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const pin = form.pin ?? '';
  const password = form.password ?? '';

  if (!/^\d{4}$/.test(pin)) return page('The PIN must be exactly 4 digits.');

  const passwordOk = await verifyPassword(password, ctx.account!.password_hash);
  if (!passwordOk) return page('That password is incorrect.');

  const pinHash = await hashPassword(pin);
  await setPinHash(ctx.env, ctx.account!.id, pinHash);

  // Setting a PIN unlocks immediately - the admin who just set it should not be locked out on
  // their very next click.
  const response = redirect('/admin/security?saved=1');
  response.headers.append('Set-Cookie', await buildAdminUnlockCookie(ctx.account!.id, ctx.env.SESSION_SECRET));
  return response;
}

/** Never redirects anywhere but back into /admin - guards against an open-redirect via the
 * `redirect` query/form field, and against looping back into the unlock page itself. */
function safeAdminRedirectTarget(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/admin') || raw.startsWith('/admin/unlock')) return '/admin';
  return raw;
}

/**
 * /admin/unlock (slice 0016 §9.5/§9.7): the gate itself, and the sole exemption from it (checked in
 * router.ts before this route is ever reached in blocked form). The lockout (src/lib/pin.ts) is
 * checked before either the PIN or the forgotten-PIN password is even looked at, and applies to
 * both paths alike - one door, one attempt log, one lockout, per §9.3/§9.7.
 */
export async function adminUnlockRoute(ctx: RequestContext, method: string): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams;
  const redirectTo = safeAdminRedirectTarget(params.get('redirect'));
  const forgot = params.get('forgot') === '1';

  if (method === 'GET') return htmlResponse(renderAdminUnlockPage({ world: ctx.world, redirectTo, forgot }));
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const target = safeAdminRedirectTarget(form.redirect ?? redirectTo);
  const isForgotSubmit = form.action === 'forgot';
  const nowSeconds = nowUtcSeconds();

  const recentAttempts = await listRecentPinAttempts(ctx.env, 50);
  const decision = decidePinAttempt(recentAttempts, nowSeconds, {
    maxAttempts: ctx.config.values.pin_max_attempts,
    windowSeconds: ctx.config.values.pin_lockout_window_seconds,
  });
  if (!decision.allowed) {
    const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
    return htmlResponse(
      renderAdminUnlockPage({
        world: ctx.world,
        redirectTo: target,
        forgot: isForgotSubmit,
        error: `Too many wrong attempts. Try again in about ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`,
      })
    );
  }

  if (isForgotSubmit) {
    const password = form.password ?? '';
    const ok = await verifyPassword(password, ctx.account!.password_hash);
    await recordPinAttempt(ctx.env, { accountId: ctx.account!.id, attemptedByAccountId: ctx.account!.id, success: ok, nowSeconds });
    if (!ok) {
      return htmlResponse(renderAdminUnlockPage({ world: ctx.world, redirectTo: target, forgot: true, error: 'That password is incorrect.' }));
    }
    // §9.7: grants nothing new - knowing the password already means being this admin. Clears the
    // PIN so a forgotten four-digit number can't permanently lock a game the operator has no
    // terminal to fix from any other way.
    await setPinHash(ctx.env, ctx.account!.id, null);
    return redirect('/admin/security');
  }

  const pin = form.pin ?? '';
  const pinHash = ctx.account!.pin_hash;
  const ok = pinHash !== null && (await verifyPassword(pin, pinHash));
  await recordPinAttempt(ctx.env, { accountId: ctx.account!.id, attemptedByAccountId: ctx.account!.id, success: ok, nowSeconds });

  if (!ok) {
    return htmlResponse(renderAdminUnlockPage({ world: ctx.world, redirectTo: target, forgot: false, error: 'Wrong PIN.' }));
  }

  const response = redirect(target);
  response.headers.append('Set-Cookie', await buildAdminUnlockCookie(ctx.account!.id, ctx.env.SESSION_SECRET));
  return response;
}
