import type { RequestContext } from '../lib/context';
import { actionsLeftFor, turnsRefusalMessage } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { ACTION_COSTS } from '../lib/actions';
import { spendAction } from '../db/accounts';
import {
  renderBarnList,
  renderBreedPage,
  renderHorsePage,
  renderImagePickerPage,
  renderTestPage,
  displayNameFor,
  type BreedPreview,
  type EnterShowInfo,
  type HealthConditionDisplay,
  type TestConditionOption,
} from '../render/horses';
import { eligibilityMessage, placingText } from '../render/shows';
import {
  listStableHorses,
  listStableHorsesWithDead,
  getHorse,
  previewCoi,
  registerHorseName,
  setBarnName,
  setHorseImage,
  countAliveHorses,
  type HorseRow,
} from '../db/horses';
import { getStableById, type StableRow } from '../db/stables';
import { getBreedById, getBreeds, getLoci, type LocusRow, type BreedRow } from '../db/breeds';
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
import { canTakeOnCost } from '../lib/money';
import { imageOptionsFor, isAllowedImagePath, NO_PICTURE_VALUE } from '../lib/images';
import { getConformationTraits, type QuantitativeTraitRow } from '../db/quantitativeTraits';
import { conformationValues, conformationDisplayRows, noiseFor, type RealizationConfig } from '../engines/conformation/model';
import {
  getShowSummary,
  listRecentResultsForHorse,
  getOpenClasses,
  checkHorseEligibilityForClass,
  enterHorseInClass,
} from '../db/shows';
import {
  getEnabledConditions,
  getKnowledgeForHorse,
  untestedConditions,
  visibleAffectedConditions,
  buildKnowledgePurchaseStatements,
  breedingHealthWarningsFor,
} from '../db/health';
import { buildLedgerStatements } from '../db/ledger';
import { conditionStatus, parseConditionTrigger, ownerVisibleStatus } from '../engines/health/status';
import type { Genotype } from '../engines/genetics/genotype';

function describeHorseRow(horse: HorseRow, gameDay: number, gameDaysPerYear: number): string {
  const genotype = parseGenotype(horse.genotype);
  const ageDays = gameDay - horse.born_game_day;
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear);
  return describeHorse(phenotype, horse.sex, ageDays / gameDaysPerYear);
}

/** Slice 0006 §6: the four conformation measurements for one horse, ready to hand to a render
 * function. Shared by the barn list, the horse page and (via a candidate's own genotype/seed) the
 * founding screen. */
function conformationForHorse(horse: HorseRow, ageYears: number, config: RealizationConfig, traitRows: QuantitativeTraitRow[]) {
  const genotype = parseGenotype(horse.genotype);
  const noise = noiseFor(horse.rng_seed, horse.environmental_noise);
  const values = conformationValues(genotype, noise, ageYears, horse.coi, config);
  return conformationDisplayRows(values, traitRows);
}

async function loadOwnedStable(ctx: RequestContext, stableId: number): Promise<StableRow | Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();
  return stable;
}

/** Slice 0008 §8.1: the horse page's "Enter in a show" button, or the plain sentence saying why
 * not. Only ever the first open class - today that's a horse's only possible open class, since
 * this slice never creates more than one at once (§3). */
async function buildEnterShowInfo(ctx: RequestContext, horse: HorseRow, breeds: BreedRow[]): Promise<EnterShowInfo | null> {
  const openClasses = await getOpenClasses(ctx.env, 5);
  if (openClasses.length === 0) return null;
  const cls = openClasses[0];
  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  const result = await checkHorseEligibilityForClass(ctx.env, cls, horse, ctx.world.game_day, gameDaysPerYear);
  if (result.ok) return { classId: cls.id, className: cls.name, eligible: true };

  const breedName = breeds.find((b) => b.id === cls.breed_id)?.name ?? 'that breed';
  const minAgeYears = Math.round(cls.min_age_game_days / gameDaysPerYear);
  return {
    classId: cls.id,
    className: cls.name,
    eligible: false,
    reasonSentence: `${displayNameFor(horse)} ${eligibilityMessage(result.reason, { breedName, minAgeYears })}`,
  };
}

export async function stableHorsesRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const cfg = ctx.config.values;
  // Slice 0010 §1 step 9: the barn list includes dead horses now, marked Died - every other reader
  // of a stable's horses (breeding, the NPC show barn's field, the image picker) still wants
  // listStableHorses' alive-only rows, unchanged.
  const [horses, traitRows, conditions] = await Promise.all([
    listStableHorsesWithDead(ctx.env, stableId),
    getConformationTraits(ctx.env),
    getEnabledConditions(ctx.env),
  ]);
  const rows = await Promise.all(
    horses.map(async (horse) => ({
      horse,
      description: describeHorseRow(horse, ctx.world.game_day, gameDaysPerYear),
      // Slice 0003 §7: a small badge on mares in season now, reusing horse.cycle_anchor_tick_seq
      // rather than a query per horse - it's already loaded on the row. Guarded to living horses
      // only (slice 0010) - a dead mare's stored cycle slot means nothing.
      inSeason:
        horse.status === 'alive' &&
        horse.sex === 'mare' &&
        horse.cycle_anchor_tick_seq !== null &&
        isInSeason(horse.cycle_anchor_tick_seq, ctx.world.tick_seq, cfg.estrous_cycle_ticks, cfg.estrus_ticks),
      conformation: conformationForHorse(horse, (ctx.world.game_day - horse.born_game_day) / gameDaysPerYear, cfg, traitRows),
      showSummary: await getShowSummary(ctx.env, horse.id),
      visibleConditions: visibleAffectedConditions(parseGenotype(horse.genotype), conditions),
    }))
  );

  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);
  return htmlResponse(
    renderBarnList({ world: ctx.world, isAdmin: ctx.account!.is_admin === 1, actionsLeft: actionsLeftFor(ctx), stable, hasFoundingOffer, horses: rows })
  );
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
  // Slice 0009 §2.4/§4.6: debt blocks expansion (booking adds a horse, and therefore adds cost),
  // never competing - see the comment on enterHorseInClass in src/db/shows.ts for the show side of
  // this rule. Checked here, and nowhere else in this slice.
  if (!canTakeOnCost(stable.balance)) {
    return `${stable.name} is ${String(Math.abs(stable.balance))} in the red. Win a show, or ask a grown-up to add money, before breeding again.`;
  }

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
  const actionsLeft = actionsLeftFor(ctx);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const describe = (h: HorseRow) => describeHorseRow(h, ctx.world.game_day, gameDaysPerYear);

  const allHorses = await listStableHorses(ctx.env, stableId);
  const mares = allHorses.filter((h) => h.sex === 'mare');
  const stallions = allHorses.filter((h) => h.sex === 'stallion');
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);

  if (method === 'GET') {
    return htmlResponse(renderBreedPage({ world: ctx.world, isAdmin, actionsLeft, stable, hasFoundingOffer, mares, stallions, describe }));
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const mareId = Number(form.mare_id);
  const stallionId = Number(form.stallion_id);
  const mare = allHorses.find((h) => h.id === mareId);
  const stallion = allHorses.find((h) => h.id === stallionId);

  if (!mare || !stallion) {
    return htmlResponse(
      renderBreedPage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
        stable,
        hasFoundingOffer,
        mares,
        stallions,
        describe,
        error: 'Choose a mare and a stallion from this stable.',
      })
    );
  }

  if (form.action === 'check') {
    const coi = await previewCoi(ctx.env, stallion.id, mare.id);
    const mareAgeYears = (ctx.world.game_day - mare.born_game_day) / gameDaysPerYear;
    const stallionAgeYears = (ctx.world.game_day - stallion.born_game_day) / gameDaysPerYear;
    const breakdown = estimateConceptionChance(mareAgeYears, stallionAgeYears, coi, ctx.config);
    // Slice 0010 §7.3: computed from this booking stable's own horse_knowledge rows only, never
    // from either horse's genotype (both already loaded above for the COI calculation, which is
    // exactly why this is delegated to a function that never has them in scope - see its comment).
    const healthWarnings = await breedingHealthWarningsFor(ctx.env, stableId, mare.id, stallion.id);
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
      healthWarnings,
    };
    return htmlResponse(
      renderBreedPage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
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
          actionsLeft,
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

    // Slice 0009 Part B §5.3: check, act, then spend - read the budget and refuse up front if it
    // looks empty, do the game action, then spend. If the spend below loses a race (two forms
    // submitted at the same instant), it's let through free rather than charged for nothing - a
    // child charged for something that did not happen has no way to find out why or get it back.
    if (actionsLeft !== null && actionsLeft < ACTION_COSTS.book_covering) {
      return htmlResponse(
        renderBreedPage({
          world: ctx.world,
          isAdmin,
          actionsLeft,
          stable,
          hasFoundingOffer,
          mares,
          stallions,
          describe,
          selectedMareId: mare.id,
          selectedStallionId: stallion.id,
          error: turnsRefusalMessage(ctx),
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
    await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.book_covering);
    return redirect(`/horses/${String(mare.id)}`);
  }

  return notFound();
}

/**
 * Slice 0010 §8/§2.4: the Health card's rows, resolved to what this viewer is entitled to see.
 * Non-owners (today, only an admin - horsePageRoute's own gate) get names only (§1 step 5). An
 * owner gets a paid-for result where one exists, else an observation for a signs_visible condition
 * their horse's genotype already reads as affected by (no charge, no test - §2.4), else "not
 * tested".
 */
async function healthRowsFor(ctx: RequestContext, owner: boolean, ownerStableId: number, horseId: number, genotype: Genotype): Promise<HealthConditionDisplay[]> {
  const conditions = await getEnabledConditions(ctx.env);
  if (!owner) {
    return conditions.map((c) => ({ code: c.code, name: c.name, teachingText: c.teaching_text, status: null, copies: null, testedGameDay: null, observedOnly: false }));
  }

  const knowledge = await getKnowledgeForHorse(ctx.env, ownerStableId, horseId);
  return conditions.map((c) => {
    const known = knowledge.find((k) => k.kind === 'genotype' && k.subject_code === c.code);
    // locus_code is only null for a future polygenic condition (none seeded yet) - nothing to
    // compute against a genotype for one of those, so it reads as never-tested-never-observed.
    if (c.locus_code === null) {
      return { code: c.code, name: c.name, teachingText: c.teaching_text, status: null, copies: null, testedGameDay: null, observedOnly: false };
    }
    const visible = ownerVisibleStatus(genotype, parseConditionTrigger(c.trigger), c.signs_visible === 1, known);
    return {
      code: c.code,
      name: c.name,
      teachingText: c.teaching_text,
      status: visible.status,
      copies: visible.copies,
      testedGameDay: known?.tested_game_day ?? null,
      observedOnly: visible.observedOnly,
    };
  });
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
  const enterShowError = params.get('show_error') ?? undefined;
  const enterShowNotice = params.get('entered_show') ? 'Entered!' : undefined;

  let loci: LocusRow[] | undefined;
  if (isAdmin) loci = await getLoci(ctx.env);

  const mareStatus = horse.sex === 'mare' ? await mareStatusLine(ctx, horse) : undefined;
  const hasFoundingOffer = owner ? await hasWaitingFoundingOffer(ctx.env, ownerStable.id) : false;
  const traitRows = await getConformationTraits(ctx.env);
  const conformation = conformationForHorse(horse, ageYears, ctx.config.values, traitRows);
  // Slice 0005 §5.3/§11: the Friesian pool carries a real recessive red (e at 8%), and a chestnut
  // Friesian is a genuine, if rare, outcome - it just can't be registered as one.
  const unregistrableFriesianChestnut = breed?.code === 'FR' && phenotype.baseColour === 'chestnut';

  const showSummary = await getShowSummary(ctx.env, horse.id);
  const recentResultsRaw = await listRecentResultsForHorse(ctx.env, horse.id, 5);
  const recentShowResults = recentResultsRaw.map((r) => `${placingText(r.placing)} at ${r.show_name} (game day ${String(r.scheduled_game_day)})`);
  const enterShow = owner ? await buildEnterShowInfo(ctx, horse, await getBreeds(ctx.env)) : null;
  const health = await healthRowsFor(ctx, owner, ownerStable.id, horse.id, genotype);

  return htmlResponse(
    renderHorsePage({
      world: ctx.world,
      isAdmin,
      actionsLeft: actionsLeftFor(ctx),
      owner,
      ownerStable,
      hasFoundingOffer,
      horse,
      description,
      visibleColour: phenotype.visibleColour,
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
      conformation,
      conformationMaturityYears: ctx.config.values.conformation_maturity_years,
      showInbreedingNote: horse.coi >= ctx.config.values.coi_warn_threshold,
      showSummary,
      recentShowResults,
      enterShow,
      enterShowError,
      enterShowNotice,
      health,
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

/** Slice 0008 §8.1: the horse page's "Enter in a show" button. Owner-only, same shape as every
 * other horse-scoped route. Re-checks eligibility server-side rather than trusting that the button
 * was only shown because it passed - the same discipline the image picker's POST uses (CLAUDE.md
 * §11, slice 0007's "never trust the submitted value" entry). */
export async function horseEnterShowRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const form = await parseForm(ctx.request);
  const classId = Number(form.class_id);
  if (!Number.isInteger(classId)) return redirect(`/horses/${String(horseId)}`);

  // Slice 0009 Part B §5.3: check, act, then spend - see the comment on the same pattern in
  // stableBreedRoute above.
  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.enter_show) {
    return redirect(`/horses/${String(horseId)}?show_error=${encodeURIComponent(turnsRefusalMessage(ctx))}`);
  }

  const result = await enterHorseInClass(ctx.env, {
    classId,
    horseId,
    gameDay: ctx.world.game_day,
    gameDaysPerYear: ctx.config.values.game_days_per_year,
    conformationConfig: ctx.config.values,
  });

  if (!result.ok) {
    const breeds = await getBreeds(ctx.env);
    const cls = (await getOpenClasses(ctx.env, 5)).find((c) => c.id === classId);
    const breedName = breeds.find((b) => b.id === cls?.breed_id)?.name ?? 'that breed';
    const minAgeYears = cls ? Math.round(cls.min_age_game_days / ctx.config.values.game_days_per_year) : 0;
    const message = `${displayNameFor(horse)} ${eligibilityMessage(result.reason, { breedName, minAgeYears })}`;
    return redirect(`/horses/${String(horseId)}?show_error=${encodeURIComponent(message)}`);
  }

  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.enter_show);
  return redirect(`/horses/${String(horseId)}?entered_show=1`);
}

/** The picker - slice 0007 §2.6/§6.2. Owner-only on both GET and POST, same shape as every other
 * stable-scoped route (CLAUDE.md §11, 2026-08-02 sessions entry): a non-owner gets notFound(),
 * never a 403 that would confirm the horse exists. */
export async function horseImageRoute(ctx: RequestContext, method: string, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const [breeds, stableHorses] = await Promise.all([getBreeds(ctx.env), listStableHorses(ctx.env, ownerStable.id)]);
  const composition = JSON.parse(horse.composition) as Record<string, number>;
  const options = imageOptionsFor(composition, breeds);

  const groups: { breedCode: string; breedName: string; options: typeof options }[] = [];
  for (const option of options) {
    let group = groups.find((g) => g.breedCode === option.breedCode);
    if (!group) {
      group = { breedCode: option.breedCode, breedName: option.breedName, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }

  // Slice 0007 §6.2's courtesy label - one extra pass over a stable's own horses, already loaded
  // above. Two horses may share a picture; this only tells the child so, it never prevents the choice.
  const usedBy = new Map<string, string>();
  for (const other of stableHorses) {
    if (other.id === horseId || !other.image_url) continue;
    usedBy.set(other.image_url, displayNameFor(other));
  }

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const genotype = parseGenotype(horse.genotype);
  const ageDays = ctx.world.game_day - horse.born_game_day;
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear);
  const isAdmin = ctx.account!.is_admin === 1;
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, ownerStable.id);

  const render = (error?: string) =>
    renderImagePickerPage({
      world: ctx.world,
      isAdmin,
      actionsLeft: actionsLeftFor(ctx),
      ownerStable,
      hasFoundingOffer,
      horse,
      visibleColour: phenotype.visibleColour,
      groups,
      usedBy,
      error,
    });

  if (method === 'GET') return htmlResponse(render());
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const submitted = form.image ?? NO_PICTURE_VALUE;

  if (submitted === NO_PICTURE_VALUE) {
    await setHorseImage(ctx.env, horseId, null);
    return redirect(`/horses/${String(horseId)}`);
  }
  // The POST never trusts the submitted value (slice 0007 §2.6) - the allowed set is re-derived
  // above from the horse's own composition and the live image_counts, not accepted from the form.
  if (!isAllowedImagePath(submitted, options)) {
    return htmlResponse(render('Choose one of the pictures shown, or "No picture".'));
  }
  await setHorseImage(ctx.env, horseId, submitted);
  return redirect(`/horses/${String(horseId)}`);
}

/** Slice 0010 §7.1: the test page's rows - what is already known (with tested date) or what it
 * costs, re-derived fresh on every render rather than trusted from a form. */
async function buildTestPageRows(
  ctx: RequestContext,
  ownerStableId: number,
  horseId: number,
  genotype: Genotype
): Promise<{ rows: TestConditionOption[]; untested: ReturnType<typeof untestedConditions> }> {
  const [conditions, knowledge] = await Promise.all([getEnabledConditions(ctx.env), getKnowledgeForHorse(ctx.env, ownerStableId, horseId)]);
  const untested = untestedConditions(conditions, knowledge);
  const untestedCodes = new Set(untested.map((c) => c.code));

  const rows: TestConditionOption[] = conditions.map((c) => {
    const known = knowledge.find((k) => k.kind === 'genotype' && k.subject_code === c.code);
    const copies = known && c.locus_code !== null ? conditionStatus(genotype, parseConditionTrigger(c.trigger)).copies : null;
    return {
      code: c.code,
      name: c.name,
      teachingText: c.teaching_text,
      status: known ? known.result : null,
      copies,
      testedGameDay: known ? known.tested_game_day : null,
      price: untestedCodes.has(c.code) ? ctx.config.values.genotype_test_cost : null,
    };
  });

  return { rows, untested };
}

/**
 * /horses/:id/test - slice 0010 §7.1/§7.2. Owner-only on both GET and POST, the same
 * notFound()-for-a-non-owner shape every stable-scoped route already uses. GET lists every enabled
 * condition; POST buys either one (`condition_code`) or the whole remaining panel (`action=panel`).
 */
export async function horseTestRoute(ctx: RequestContext, method: string, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const genotype = parseGenotype(horse.genotype);
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, ownerStable.id);

  const render = async (error?: string) => {
    const { rows, untested } = await buildTestPageRows(ctx, ownerStable.id, horseId, genotype);
    return htmlResponse(
      renderTestPage({
        world: ctx.world,
        isAdmin: ctx.account!.is_admin === 1,
        actionsLeft: actionsLeftFor(ctx),
        ownerStable,
        hasFoundingOffer,
        horse,
        rows,
        untestedCount: untested.length,
        panelPrice: ctx.config.values.genotype_panel_cost,
        error,
      })
    );
  };

  if (method === 'GET') return render();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  // Slice 0010 §7.1 step 1: re-derive what is untested from the knowledge rows rather than
  // trusting the form - the same "re-derive and check membership" rule isAllowedImagePath
  // established in slice 0007. A submitted condition code that is already known or not applicable
  // is rejected and nothing is charged.
  const { untested } = await buildTestPageRows(ctx, ownerStable.id, horseId, genotype);

  let toBuy: (typeof untested)[number][];
  let totalCost: number;
  let description: string;

  if (form.action === 'panel') {
    if (untested.length === 0) return render('Nothing is left to test.');
    toBuy = untested;
    totalCost = ctx.config.values.genotype_panel_cost;
    description = `Five-panel genotype test, ${displayNameFor(horse)}.`;
  } else {
    const found = untested.find((c) => c.code === form.condition_code);
    if (!found) return render("That test isn't available for this horse.");
    toBuy = [found];
    totalCost = ctx.config.values.genotype_test_cost;
    description = `Genotype test for ${found.name}, ${displayNameFor(horse)}.`;
  }

  // Slice 0009 Part B §5.3: check, act, then spend - the turn budget is checked up front, same
  // pattern as booking a covering and entering a show.
  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.genotype_test) {
    return render(turnsRefusalMessage(ctx));
  }

  // Slice 0010 §7.2: a discretionary purchase, not a way out of debt - blocked like breeding, and
  // unlike showing (see the comment on enterHorseInClass in src/db/shows.ts for why shows differ).
  if (!canTakeOnCost(ownerStable.balance)) {
    return render(`${ownerStable.name} is ${String(Math.abs(ownerStable.balance))} in the red. Win a show, or ask a grown-up to add money, before testing.`);
  }

  // Costs are split as evenly as whole numbers allow across the rows bought together, with any
  // remainder on the last one - money is always an integer (CLAUDE.md §7), and the sum of what
  // each row's receipt says it cost must equal what the ledger actually charged.
  const costByCode: Record<string, number> = {};
  const base = Math.floor(totalCost / toBuy.length);
  toBuy.forEach((c) => {
    costByCode[c.code] = base;
  });
  costByCode[toBuy[toBuy.length - 1].code] += totalCost - base * toBuy.length;

  try {
    await ctx.env.DB.batch([
      ...buildKnowledgePurchaseStatements(ctx.env, {
        stableId: ownerStable.id,
        horseId,
        gameDay: ctx.world.game_day,
        genotype,
        conditions: toBuy,
        costByCode,
      }),
      ...buildLedgerStatements(ctx.env, [
        {
          stableId: ownerStable.id,
          amount: -totalCost,
          kind: 'vet',
          referenceType: 'horse',
          referenceId: horseId,
          description,
          gameDay: ctx.world.game_day,
        },
      ]),
    ]);
  } catch (err) {
    // The unique index on (stable_id, horse_id, subject_code) means a race - two submissions for
    // the same condition - fails the whole batch (one D1 transaction), so nothing was charged.
    if (err instanceof Error && /unique constraint failed/i.test(err.message)) {
      return render('That result is already known - nothing was charged.');
    }
    throw err;
  }

  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.genotype_test);
  return redirect(`/horses/${String(horseId)}`);
}
