import type { RequestContext } from '../lib/context';
import { actionsLeftFor, turnsRefusalMessage } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { ACTION_COSTS } from '../lib/actions';
import { spendAction } from '../db/accounts';
import { renderFoundingPage } from '../render/founding';
import { getStableById, type StableRow } from '../db/stables';
import {
  getLatestOfferForStable,
  getCandidatesForOffer,
  chooseBreedForOffer,
  claimOffer,
  type ImportOfferRow,
  type ClaimOfferResult,
} from '../db/founding';
import { getBreeds } from '../db/breeds';
import { getConformationTraits } from '../db/quantitativeTraits';
import { parseGenotype } from '../engines/genetics/genotype';
import { expressPhenotype } from '../engines/genetics/expression';
import { describeHorse } from '../engines/genetics/describe';
import { conformationValues, conformationDisplayRows, rollEnvironmentalNoise } from '../engines/conformation/model';

async function loadOwnedStable(ctx: RequestContext, stableId: number): Promise<StableRow | Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();
  return stable;
}

function claimErrorMessage(result: Extract<ClaimOfferResult, { ok: false }>): string {
  switch (result.error) {
    case 'wrong_mare_count':
      return `Choose exactly ${String(result.expected)} mare${result.expected === 1 ? '' : 's'}.`;
    case 'wrong_stallion_count':
      return `Choose exactly ${String(result.expected)} stallion${result.expected === 1 ? '' : 's'}.`;
    case 'no_room':
      return `${result.stableName} doesn't have room for that many more horses.`;
    case 'expired':
      return 'This batch has expired.';
    case 'not_open':
      return 'This batch is not ready to claim yet.';
  }
}

async function renderPage(
  ctx: RequestContext,
  stable: StableRow,
  offer: ImportOfferRow | null,
  extra: { error?: string; notice?: string } = {}
): Promise<Response> {
  const isAdmin = ctx.account!.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);

  if (offer && offer.status === 'pending') {
    const breeds = await getBreeds(ctx.env);
    return htmlResponse(renderFoundingPage({ world: ctx.world, isAdmin, actionsLeft, stable, offer, breeds, ...extra }));
  }

  if (offer && offer.status === 'open') {
    const gameDaysPerYear = ctx.config.values.game_days_per_year;
    const [rows, traitRows] = await Promise.all([getCandidatesForOffer(ctx.env, offer.id), getConformationTraits(ctx.env)]);
    const candidates = rows.map((candidate) => {
      const genotype = parseGenotype(candidate.genotype);
      const phenotype = expressPhenotype(genotype, candidate.age_game_days, gameDaysPerYear);
      const ageYears = candidate.age_game_days / gameDaysPerYear;
      const description = describeHorse(phenotype, candidate.sex, ageYears);
      // Slice 0006 §2.6: no noise column on import_candidates - the seed already carries it, and
      // this is exactly the noise the claimed horse will get (buildFoundingHorseInsertStatement
      // rolls it from the same rngSeed, unchanged on claim).
      const noise = rollEnvironmentalNoise(candidate.rng_seed, ctx.config.values.conformation_noise_sd);
      // A founding candidate has no pedigree, so coi is always 0 here.
      const conformation = conformationDisplayRows(conformationValues(genotype, noise, ageYears, 0, ctx.config.values), traitRows);
      return { candidate, description, gaited: phenotype.gaited, conformation };
    });
    return htmlResponse(renderFoundingPage({ world: ctx.world, isAdmin, actionsLeft, stable, offer, candidates, ...extra }));
  }

  return htmlResponse(renderFoundingPage({ world: ctx.world, isAdmin, actionsLeft, stable, offer, ...extra }));
}

export async function stableFoundingRoute(ctx: RequestContext, method: string, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const offer = await getLatestOfferForStable(ctx.env, stableId);

  if (method === 'GET') {
    return renderPage(ctx, stable, offer);
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  if (form.action === 'choose_breed') {
    if (!offer || offer.status !== 'pending') return notFound();
    if (form.confirm !== 'yes') {
      return renderPage(ctx, stable, offer, { error: "Tick the box to confirm - the breed choice can't be undone." });
    }
    const breedId = Number(form.breed_id);
    const breeds = await getBreeds(ctx.env);
    if (!breeds.some((b) => b.id === breedId)) {
      return renderPage(ctx, stable, offer, { error: 'Choose a breed.' });
    }
    await chooseBreedForOffer(ctx.env, offer.id, breedId, ctx.world.game_day);
    return redirect(`/stables/${String(stableId)}/founding`);
  }

  if (form.action === 'claim') {
    if (!offer || offer.status !== 'open') return notFound();

    // Slice 0009 Part B §5.3: check, act, then spend - see the comment on the same pattern in
    // routes/horses.ts's stableBreedRoute.
    const actionsLeft = actionsLeftFor(ctx);
    if (actionsLeft !== null && actionsLeft < ACTION_COSTS.claim_founding) {
      return renderPage(ctx, stable, offer, { error: turnsRefusalMessage(ctx) });
    }

    const candidates = await getCandidatesForOffer(ctx.env, offer.id);
    const chosenCandidateIds = candidates.filter((c) => form[`chosen_${String(c.slot_index)}`] === 'yes').map((c) => c.id);

    const result = await claimOffer(ctx.env, {
      offerId: offer.id,
      stableId,
      stableName: stable.name,
      stableCapacity: stable.capacity,
      chosenCandidateIds,
      gameDay: ctx.world.game_day,
      worldTickSeq: ctx.world.tick_seq,
      estrousCycleTicks: ctx.config.values.estrous_cycle_ticks,
      conformationNoiseSd: ctx.config.values.conformation_noise_sd,
      accountId: stable.account_id,
      lethalFoalDeathGameDays: ctx.config.values.lethal_foal_death_game_days,
      lifespanConfig: ctx.config.values,
    });

    if (!result.ok) {
      return renderPage(ctx, stable, offer, { error: claimErrorMessage(result) });
    }
    await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.claim_founding);
    return redirect(`/stables/${String(stableId)}/horses`);
  }

  return notFound();
}
