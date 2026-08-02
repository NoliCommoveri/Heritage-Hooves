import type { RequestContext } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { renderBarnList, renderBreedPage, renderHorsePage, displayNameFor, type BreedPreview } from '../render/horses';
import {
  listStableHorses,
  getHorse,
  previewCoi,
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
import { getBookedCoveringForMare, bookCovering, estimateConceptionChance, type CoveringRow } from '../db/coverings';
import { getActivePregnancyForMare, type PregnancyRow } from '../db/pregnancies';
import { isInSeason, ticksUntilNextEstrus } from '../engines/breeding/cycle';
import { isInBreedingSeason, nextSeasonStartGameDay } from '../engines/breeding/season';
import type { ConceptionBreakdown } from '../engines/breeding/fertility';
import { hasWaitingFoundingOffer } from '../db/founding';

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
  const cfg = ctx.config.values;
  const horses = await listStableHorses(ctx.env, stableId);
  const rows = horses.map((horse) => ({
    horse,
    description: describeHorseRow(horse, ctx.world.game_day, gameDaysPerYear),
    // Slice 0003 §7: a small badge on mares in season now, reusing horse.cycle_anchor_tick_seq
    // rather than a query per horse - it's already loaded on the row.
    inSeason:
      horse.sex === 'mare' &&
      horse.cycle_anchor_tick_seq !== null &&
      isInSeason(horse.cycle_anchor_tick_seq, ctx.world.tick_seq, cfg.estrous_cycle_ticks, cfg.estrus_ticks),
  }));

  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);
  return htmlResponse(renderBarnList({ world: ctx.world, isAdmin: ctx.account!.is_admin === 1, stable, hasFoundingOffer, horses: rows }));
}

function coiWarning(coi: number, threshold: number): string | undefined {
  if (coi >= 0.25) return 'These two are closely related - a foal from this pairing would be significantly inbred.';
  if (coi >= threshold) return 'These two are closely related; a foal from this pairing would be noticeably inbred.';
  return undefined;
}

/** Turns the non-trivial factors in a conception breakdown into the sentences slice 0003 §4 wants:
 * "she is 18 (-25%)", "these two are closely related (-6%)". Fertility/condition/method factors
 * never appear here in this slice - the estimate always passes them as 1.0 (unknown-average), per
 * slice 0003 §5, so they never produce a reason. */
function conceptionReasons(breakdown: ConceptionBreakdown, mareAgeYears: number, stallionAgeYears: number): string[] {
  const reasons: string[] = [];
  const factorSentence = (label: string, factor: number): string | undefined => {
    const pct = Math.round((factor - 1) * 100);
    if (pct === 0) return undefined;
    return `${label} (${pct > 0 ? '+' : ''}${String(pct)}%)`;
  };
  const mareAge = factorSentence(`she is ${String(Math.round(mareAgeYears))}`, breakdown.mareAgeFactor);
  if (mareAge) reasons.push(mareAge);
  const stallionAge = factorSentence(`he is ${String(Math.round(stallionAgeYears))}`, breakdown.stallionAgeFactor);
  if (stallionAge) reasons.push(stallionAge);
  const inbreeding = factorSentence('these two are closely related', breakdown.inbreedingFactor);
  if (inbreeding) reasons.push(inbreeding);
  return reasons;
}

async function validateBooking(ctx: RequestContext, stable: StableRow, mare: HorseRow, stallion: HorseRow): Promise<string | undefined> {
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

  const [activePregnancy, activeCovering] = await Promise.all([
    getActivePregnancyForMare(ctx.env, mare.id),
    getBookedCoveringForMare(ctx.env, mare.id),
  ]);
  if (activePregnancy) return `${displayNameFor(mare)} is already in foal.`;
  if (activeCovering) return `${displayNameFor(mare)} is already booked to a covering.`;

  const cfg = ctx.config.values;
  if (!isInBreedingSeason(ctx.world.game_day, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year)) {
    const next = nextSeasonStartGameDay(ctx.world.game_day, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year);
    return `It's out of season for breeding right now. The season next opens around game day ${String(next)}.`;
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
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);

  if (method === 'GET') {
    return htmlResponse(renderBreedPage({ world: ctx.world, isAdmin, stable, hasFoundingOffer, mares, stallions, describe }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const mareId = Number(form.mare_id);
  const stallionId = Number(form.stallion_id);
  const mare = allHorses.find((h) => h.id === mareId);
  const stallion = allHorses.find((h) => h.id === stallionId);

  if (!mare || !stallion) {
    return htmlResponse(
      renderBreedPage({ world: ctx.world, isAdmin, stable, hasFoundingOffer, mares, stallions, describe, error: 'Choose a mare and a stallion from this stable.' })
    );
  }

  if (form.action === 'check') {
    const coi = await previewCoi(ctx.env, stallion.id, mare.id);
    const mareAgeYears = (ctx.world.game_day - mare.born_game_day) / gameDaysPerYear;
    const stallionAgeYears = (ctx.world.game_day - stallion.born_game_day) / gameDaysPerYear;
    const breakdown = estimateConceptionChance(mareAgeYears, stallionAgeYears, coi, ctx.config);
    const preview: BreedPreview = {
      mareId: mare.id,
      stallionId: stallion.id,
      mareDescription: describe(mare),
      mareAgeYears,
      stallionDescription: describe(stallion),
      stallionAgeYears,
      coiPercent: `${(coi * 100).toFixed(1)}%`,
      warning: coiWarning(coi, ctx.config.values.coi_warn_threshold),
      conceptionPercent: `${String(Math.round(breakdown.p * 100))}%`,
      conceptionReasons: conceptionReasons(breakdown, mareAgeYears, stallionAgeYears),
    };
    return htmlResponse(
      renderBreedPage({
        world: ctx.world,
        isAdmin,
        stable,
        hasFoundingOffer,
        mares,
        stallions,
        describe,
        selectedMareId: mare.id,
        selectedStallionId: stallion.id,
        preview,
      })
    );
  }

  if (form.action === 'book') {
    const refusal = await validateBooking(ctx, stable, mare, stallion);
    if (refusal) {
      return htmlResponse(
        renderBreedPage({
          world: ctx.world,
          isAdmin,
          stable,
          hasFoundingOffer,
          mares,
          stallions,
          describe,
          selectedMareId: mare.id,
          selectedStallionId: stallion.id,
          error: refusal,
        })
      );
    }
    await bookCovering(ctx.env, {
      stableId,
      mareId: mare.id,
      stallionId: stallion.id,
      gameDay: ctx.world.game_day,
      tickSeq: ctx.world.tick_seq,
    });
    return redirect(`/horses/${String(mare.id)}`);
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

  const mareStatus = horse.sex === 'mare' ? await mareStatusLine(ctx, horse) : undefined;
  const hasFoundingOffer = owner ? await hasWaitingFoundingOffer(ctx.env, ownerStable.id) : false;
  // Slice 0005 §5.3/§11: the Friesian pool carries a real recessive red (e at 8%), and a chestnut
  // Friesian is a genuine, if rare, outcome - it just can't be registered as one.
  const unregistrableFriesianChestnut = breed?.code === 'FR' && phenotype.baseColour === 'chestnut';

  return htmlResponse(
    renderHorsePage({
      world: ctx.world,
      isAdmin,
      owner,
      ownerStable,
      hasFoundingOffer,
      horse,
      description,
      ageYears,
      breed,
      gaited: phenotype.gaited,
      breederStableName: breederStable ? breederStable.name : null,
      unregistrableFriesianChestnut,
      pedigree: { sire, dam, sireSire, sireDam, damSire, damDam },
      canRegisterName: owner && horse.registered_name === null,
      nameError,
      barnNameNotice,
      genotype: isAdmin ? genotype : undefined,
      loci,
      mareStatus,
    })
  );
}

/** Slice 0003 §7: one line of state on a mare's page - in season now, due back in season around a
 * day, booked to a stallion, in foal with a due date, or recovering. Checked in that priority
 * order because a mare who is (say) both recovering and technically "due back in season" should
 * only ever show the more informative of the two. */
async function mareStatusLine(ctx: RequestContext, mare: HorseRow): Promise<string> {
  const cfg = ctx.config.values;

  const pregnancy: PregnancyRow | null = await getActivePregnancyForMare(ctx.env, mare.id);
  if (pregnancy) {
    const sire = await getHorse(ctx.env, pregnancy.sire_id);
    return `In foal to ${sire ? displayNameFor(sire) : 'an unknown stallion'}, due around game day ${String(pregnancy.due_game_day)}.`;
  }

  const covering: CoveringRow | null = await getBookedCoveringForMare(ctx.env, mare.id);
  if (covering) {
    const stallion = await getHorse(ctx.env, covering.stallion_id);
    return `Booked to ${stallion ? displayNameFor(stallion) : 'a stallion'}, to be covered when she next comes into season.`;
  }

  const seasonNote = (): string => {
    if (isInBreedingSeason(ctx.world.game_day, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year)) {
      return '';
    }
    const next = nextSeasonStartGameDay(
      ctx.world.game_day,
      cfg.breeding_season_start_game_day,
      cfg.breeding_season_length_game_days,
      cfg.game_days_per_year
    );
    return next !== null ? ` The breeding season opens again around game day ${String(next)}.` : '';
  };

  if (mare.last_foaled_game_day !== null) {
    const recoverUntil = mare.last_foaled_game_day + cfg.mare_recovery_game_days;
    if (ctx.world.game_day < recoverUntil) {
      return `Recovering from foaling; can breed again from around game day ${String(recoverUntil)}.${seasonNote()}`;
    }
  }

  if (mare.cycle_anchor_tick_seq === null) {
    return `Not yet cycling.${seasonNote()}`;
  }

  const ticksUntil = ticksUntilNextEstrus(mare.cycle_anchor_tick_seq, ctx.world.tick_seq, cfg.estrous_cycle_ticks, cfg.estrus_ticks);
  if (ticksUntil === 0) return `In season now.${seasonNote()}`;

  const estimatedDay = ctx.world.game_day + ticksUntil * cfg.game_days_per_tick;
  return `Due back in season around game day ${String(estimatedDay)}.${seasonNote()}`;
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
