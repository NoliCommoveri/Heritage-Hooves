import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderBarnList, renderBreedPage, renderHorsePage, displayNameFor, type BreedPreview } from '../render/horses';
import {
  listStableHorses,
  getHorse,
  previewCoi,
  breedNow,
  registerHorseName,
  setBarnName,
  countAliveHorses,
  type HorseRow,
} from '../db/horses';
import { getStableById, type StableRow } from '../db/stables';
import { getBreedById, getLoci, type LocusRow } from '../db/breeds';
import { parseGenotype } from '../engines/genetics/genotype';
import { expressPhenotype } from '../engines/genetics/expression';
import { describeHorse } from '../engines/genetics/describe';
import { validateHorseNamePart } from '../lib/validation';

function describeHorseRow(horse: HorseRow, gameDay: number, gameDaysPerYear: number): string {
  const genotype = parseGenotype(horse.genotype);
  const ageDays = gameDay - horse.born_game_day;
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear);
  return describeHorse(phenotype, horse.sex, ageDays / gameDaysPerYear);
}

async function loadOwnedStable(ctx: RequestContext, stableId: number): Promise<StableRow | Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();
  return stable;
}

export async function stableHorsesRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const horses = await listStableHorses(ctx.env, stableId);
  const rows = horses.map((horse) => ({ horse, description: describeHorseRow(horse, ctx.world.game_day, gameDaysPerYear) }));

  return htmlResponse(renderBarnList({ world: ctx.world, isAdmin: ctx.account!.is_admin === 1, stable, horses: rows }));
}

function coiWarning(coi: number, threshold: number): string | undefined {
  if (coi >= 0.25) return 'These two are closely related - a foal from this pairing would be significantly inbred.';
  if (coi >= threshold) return 'These two are closely related; a foal from this pairing would be noticeably inbred.';
  return undefined;
}

async function validateBreedingPair(ctx: RequestContext, stable: StableRow, mare: HorseRow, stallion: HorseRow): Promise<string | undefined> {
  if (stallion.sex === 'gelding') return 'Geldings cannot breed.';
  if (mare.sex !== 'mare' || stallion.sex !== 'stallion') return 'Breeding needs one mare and one stallion.';

  const minAge = ctx.config.values.min_breeding_age_game_days;
  if (ctx.world.game_day - mare.born_game_day < minAge) return `${displayNameFor(mare)} is not old enough to breed yet.`;
  if (ctx.world.game_day - stallion.born_game_day < minAge) return `${displayNameFor(stallion)} is not old enough to breed yet.`;

  if (mare.last_foaled_game_day !== null) {
    const recovery = ctx.config.values.mare_recovery_game_days;
    if (ctx.world.game_day - mare.last_foaled_game_day < recovery) {
      return `${displayNameFor(mare)} has just foaled and needs more time to recover before breeding again.`;
    }
  }

  const aliveCount = await countAliveHorses(ctx.env, stable.id);
  if (aliveCount >= stable.capacity) return `${stable.name} doesn't have room for another horse.`;

  return undefined;
}

export async function stableBreedRoute(ctx: RequestContext, method: string, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  const isAdmin = ctx.account!.is_admin === 1;
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const describe = (h: HorseRow) => describeHorseRow(h, ctx.world.game_day, gameDaysPerYear);

  const allHorses = await listStableHorses(ctx.env, stableId);
  const mares = allHorses.filter((h) => h.sex === 'mare');
  const stallions = allHorses.filter((h) => h.sex === 'stallion');

  if (method === 'GET') {
    return htmlResponse(renderBreedPage({ world: ctx.world, isAdmin, stable, mares, stallions, describe }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const mareId = Number(form.mare_id);
  const stallionId = Number(form.stallion_id);
  const mare = allHorses.find((h) => h.id === mareId);
  const stallion = allHorses.find((h) => h.id === stallionId);

  if (!mare || !stallion) {
    return htmlResponse(
      renderBreedPage({ world: ctx.world, isAdmin, stable, mares, stallions, describe, error: 'Choose a mare and a stallion from this stable.' })
    );
  }

  if (form.action === 'check') {
    const coi = await previewCoi(ctx.env, stallion.id, mare.id);
    const preview: BreedPreview = {
      mareId: mare.id,
      stallionId: stallion.id,
      mareDescription: describe(mare),
      mareAgeYears: (ctx.world.game_day - mare.born_game_day) / gameDaysPerYear,
      stallionDescription: describe(stallion),
      stallionAgeYears: (ctx.world.game_day - stallion.born_game_day) / gameDaysPerYear,
      coiPercent: `${(coi * 100).toFixed(1)}%`,
      warning: coiWarning(coi, ctx.config.values.coi_warn_threshold),
    };
    return htmlResponse(
      renderBreedPage({
        world: ctx.world,
        isAdmin,
        stable,
        mares,
        stallions,
        describe,
        selectedMareId: mare.id,
        selectedStallionId: stallion.id,
        preview,
      })
    );
  }

  if (form.action === 'confirm') {
    const refusal = await validateBreedingPair(ctx, stable, mare, stallion);
    if (refusal) {
      return htmlResponse(
        renderBreedPage({
          world: ctx.world,
          isAdmin,
          stable,
          mares,
          stallions,
          describe,
          selectedMareId: mare.id,
          selectedStallionId: stallion.id,
          error: refusal,
        })
      );
    }
    const result = await breedNow(ctx.env, { stableId, sireId: stallion.id, damId: mare.id, gameDay: ctx.world.game_day });
    return redirect(`/horses/${String(result.foalId)}`);
  }

  return notFound();
}

export async function horsePageRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable) return notFound();

  const isAdmin = ctx.account!.is_admin === 1;
  const owner = ownerStable.account_id === ctx.account!.id;
  if (!owner && !isAdmin) return notFound();

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const ageDays = ctx.world.game_day - horse.born_game_day;
  const ageYears = ageDays / gameDaysPerYear;
  const genotype = parseGenotype(horse.genotype);
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear);
  const description = describeHorse(phenotype, horse.sex, ageYears);

  const breed = horse.breed_id ? await getBreedById(ctx.env, horse.breed_id) : undefined;
  const breederStable = horse.breeder_stable_id ? await getStableById(ctx.env, horse.breeder_stable_id) : null;

  const [sire, dam] = await Promise.all([
    horse.sire_id ? getHorse(ctx.env, horse.sire_id) : Promise.resolve(null),
    horse.dam_id ? getHorse(ctx.env, horse.dam_id) : Promise.resolve(null),
  ]);
  const [sireSire, sireDam, damSire, damDam] = await Promise.all([
    sire?.sire_id ? getHorse(ctx.env, sire.sire_id) : Promise.resolve(null),
    sire?.dam_id ? getHorse(ctx.env, sire.dam_id) : Promise.resolve(null),
    dam?.sire_id ? getHorse(ctx.env, dam.sire_id) : Promise.resolve(null),
    dam?.dam_id ? getHorse(ctx.env, dam.dam_id) : Promise.resolve(null),
  ]);

  const params = new URL(ctx.request.url).searchParams;
  const nameError = params.get('name_error') ?? undefined;
  const barnNameNotice = params.get('barn_saved') ? 'Barn name saved.' : undefined;

  let loci: LocusRow[] | undefined;
  if (isAdmin) loci = await getLoci(ctx.env);

  return htmlResponse(
    renderHorsePage({
      world: ctx.world,
      isAdmin,
      owner,
      ownerStable,
      horse,
      description,
      ageYears,
      breed,
      gaited: phenotype.gaited,
      breederStableName: breederStable ? breederStable.name : null,
      pedigree: { sire, dam, sireSire, sireDam, damSire, damDam },
      canRegisterName: owner && horse.registered_name === null,
      nameError,
      barnNameNotice,
      genotype: isAdmin ? genotype : undefined,
      loci,
    })
  );
}

export async function horseNameRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.registered_name !== null) return redirect(`/horses/${String(horseId)}`);

  const form = await parseForm(ctx.request);
  const namePart = (form.name ?? '').trim();
  const validation = validateHorseNamePart(namePart);
  if (!validation.ok) {
    return redirect(`/horses/${String(horseId)}?name_error=${encodeURIComponent(validation.error ?? 'Invalid name.')}`);
  }

  const prefix = horse.breeder_prefix ?? ownerStable.prefix;
  const registeredName = `${prefix} ${namePart}`;
  const result = await registerHorseName(ctx.env, horseId, registeredName);
  if (!result.ok) {
    const message = result.error === 'taken' ? 'That name is already registered to another horse.' : 'This horse already has a registered name.';
    return redirect(`/horses/${String(horseId)}?name_error=${encodeURIComponent(message)}`);
  }
  return redirect(`/horses/${String(horseId)}`);
}

export async function horseBarnNameRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const form = await parseForm(ctx.request);
  const barnName = (form.barn_name ?? '').trim();
  await setBarnName(ctx.env, horseId, barnName.length ? barnName : null);
  return redirect(`/horses/${String(horseId)}?barn_saved=1`);
}
