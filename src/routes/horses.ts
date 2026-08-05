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
  renderRetireConfirmPage,
  renderPetHomeConfirmPage,
  renderPastHorsesPage,
  displayNameFor,
  type BreedPreview,
  type OutsideStudOption,
  type EnterShowInfo,
  type HealthConditionDisplay,
  type TestConditionOption,
  type ColourLocusOption,
  type ColourInferenceRow,
  type MareExclusion,
  type EvaluationSectionView,
} from '../render/horses';
import { eligibilityMessage, buildShowResultGroups, SHOW_RESULT_FETCH_LIMIT } from '../render/shows';
import {
  listStableHorses,
  listStableHorsesWithDead,
  listPastHorses,
  getHorse,
  previewCoi,
  registerHorseName,
  setBarnName,
  setHorseImage,
  countAliveHorses,
  type HorseRow,
} from '../db/horses';
import { getStableById, type StableRow } from '../db/stables';
import { getBreedById, getBreeds, getLoci, getBreedImageLabels, type LocusRow, type BreedRow } from '../db/breeds';
import { parseGenotype, sortAllelePair, type AllelePair } from '../engines/genetics/genotype';
import { expressPhenotype, type PatternPenetrance } from '../engines/genetics/expression';
import { deriveSeed } from '../lib/rng';
import { describeHorse, PATTERN_LABELS } from '../engines/genetics/describe';
import { validateHorseNamePart } from '../lib/validation';
import { getBookedCoveringForMare, bookCovering, estimateConceptionChance, listBookedCoveringsInvolvingHorse, type CoveringRow } from '../db/coverings';
import { getActivePregnancyForMare, listActivePregnanciesInvolvingHorse, type PregnancyRow } from '../db/pregnancies';
import { formatCalendarDate } from '../lib/calendar';
import { buildEndHorseParticipationStatements, ageModifierForHorse } from '../db/ageing';
import { petHomePayout, sellHorseToPetHome } from '../db/petHome';
import { isHorseDeletable, buildDeleteHorseStatements } from '../db/horseRemoval';
import { ageState } from '../engines/ageing/lifespan';
import { isInSeason, ticksUntilNextEstrus } from '../engines/breeding/cycle';
import { isInBreedingSeason, nextSeasonStartGameDay } from '../engines/breeding/season';
import { isOldEnoughToBreed } from '../engines/breeding/maturity';
import { mareIneligibility, stallionIneligibility } from '../engines/breeding/eligibility';
import type { ConceptionBreakdown } from '../engines/breeding/fertility';
import { hasWaitingFoundingOffer } from '../db/founding';
import { canTakeOnCost } from '../lib/money';
import { availabilityForHorse, turnOutToPasture, bringInFromPasture } from '../db/care';
import { imageOptionsFor, isAllowedImagePath, NO_PICTURE_VALUE, buildImageLabelMap } from '../lib/images';
import { getConformationTraits, getAbilityTraits, type QuantitativeTraitRow } from '../db/quantitativeTraits';
import { conformationValues, conformationDisplayRows, noiseFor, type RealizationConfig } from '../engines/conformation/model';
import { ABILITY_TRAITS } from '../engines/conformation/traits';
import { conformationLabelsFor, CONFORMATION_LABEL_TEXT, type ConformationLabel, type ConformationLabelBands } from '../engines/conformation/labels';
import { evaluateHorse, wouldSharpen, type StoredEvaluation } from '../engines/conformation/evaluation';
import { bandForTraitScore } from '../engines/conformation/labels';
import { foalExpressedDistribution, centralInterval } from '../engines/genetics/foalPrediction';
import { buildEvaluationStatements, evaluationCost, getLatestEvaluation } from '../db/evaluations';
import { getAbilityWordsForHorse } from '../db/abilityTests';
import { planTimeWarp, buildTimeWarpStatements } from '../db/timeWarp';
import { parseIdealVector, traitScoreFor } from '../engines/showing/score';
import type { TraitCode } from '../engines/genetics/polygenic';
import type { ConfigValues } from '../lib/config-cache';
import {
  getShowSummary,
  listRecentResultsForHorse,
  buildCatalogueStatusForHorse,
  buildShowCatalogue,
  requestClassEntry,
  listOpenEntriesForHorse,
} from '../db/shows';
import {
  getEnabledConditions,
  getKnowledgeForHorse,
  untestedConditions,
  visibleAffectedConditions,
  buildKnowledgePurchaseStatements,
  breedingHealthWarningsFor,
  conditionDeltaMapForHorses,
  getKnownGenotypeSubjectsForHorses,
  testedColourLoci,
  buildLocusKnowledgePurchaseStatements,
  LOCUS_KNOWLEDGE_PREFIX,
  conditionsPanelForHorse,
  getHorseConditionSigns,
  signsGameDayMapsByHorse,
  pedigreeBreedCodes,
} from '../db/health';
import { panelFor } from '../engines/health/panel';
import { parseAllelePool } from '../engines/founding/pool';
import { displayColourName } from '../render/colour';
import { inferFromPhenotype } from '../engines/genetics/inference';
import { foalColourPossibilities } from '../engines/genetics/foal-colours';
import { buildLedgerStatements } from '../db/ledger';
import { conditionStatus, parseConditionTrigger, ownerVisibleStatus } from '../engines/health/status';
import type { Genotype } from '../engines/genetics/genotype';
import { careCardViewFor, callOneHorseCare, callOneConditionManagement, managementPlanRowsForHorse, type CareService } from '../db/care';
import { bucketFor, type BarnBucket } from '../lib/barnFilter';
import {
  appraiseHorseForStable,
  createListing,
  getOpenListingForHorse,
  openListingsBySellerStable,
  buildWithdrawListingsForHorseStatement,
} from '../db/listings';
import {
  createStudListing,
  getActiveStudListingForHorse,
  bookingsThisSeasonCount,
  buildWithdrawStudListingsForHorseStatement,
  listActiveStudListings,
  getStudListing,
  validateStudBooking,
} from '../db/stud';
import { incidentsForHorse, treatOneIncident, openIncidentHorseIds, acuteCarePenaltyMapForHorses } from '../db/incidents';

/** Also used by src/routes/world.ts (slice 0016 §6): a colour-and-markings sentence is public
 * (§2.2's "you could learn it standing at the rail"), so the /world pages reuse this exact function
 * rather than a second copy.
 *
 * Amendment 0017a §4.3: `creamTested` defaults to false, which is the safe direction - a spectator
 * "at the rail" cannot tell smoky black from plain black either, so the untested reading is the
 * correct public one, not merely a fallback. Pass true only where the caller has actually checked
 * this specific viewing stable's own horse_knowledge for `locus:CR`. */
export function describeHorseRow(
  horse: Pick<HorseRow, 'genotype' | 'born_game_day' | 'sex' | 'rng_seed'>,
  gameDay: number,
  gameDaysPerYear: number,
  patternPenetrance: PatternPenetrance,
  creamTested = false
): string {
  const genotype = parseGenotype(horse.genotype);
  const ageDays = gameDay - horse.born_game_day;
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear, patternSeed, patternPenetrance);
  const displayPhenotype = { ...phenotype, visibleColour: displayColourName(phenotype.visibleColour, creamTested), bornColour: displayColourName(phenotype.bornColour, creamTested) };
  return describeHorse(displayPhenotype, horse.sex, ageDays / gameDaysPerYear);
}

/** Amendment 0017a §4.2/§4.5: what this horse's phenotype, narrowed by this stable's own
 * horse_knowledge, still leaves open at each colour/gait locus - never horses.genotype directly.
 * Shared by the horse page's own colour card and the breeding preview's foal-colour prediction so
 * there is exactly one place a locus's knowledge row narrows an inferred set. */
async function narrowedColourInference(
  ctx: RequestContext,
  stableId: number,
  horse: Pick<HorseRow, 'id' | 'genotype' | 'born_game_day' | 'sex' | 'rng_seed'>
): Promise<Record<string, AllelePair[]>> {
  const genotype = parseGenotype(horse.genotype);
  const ageDays = ctx.world.game_day - horse.born_game_day;
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageDays, ctx.config.values.game_days_per_year, patternSeed, ctx.config.values.pattern_penetrance);
  const inferred = inferFromPhenotype(phenotype);
  const knowledge = await getKnowledgeForHorse(ctx.env, stableId, horse.id);
  for (const k of knowledge) {
    if (k.kind !== 'genotype' || !k.subject_code.startsWith(LOCUS_KNOWLEDGE_PREFIX)) continue;
    const code = k.subject_code.slice(LOCUS_KNOWLEDGE_PREFIX.length);
    if (!(code in inferred)) continue;
    const [a, b] = k.result.split('/');
    inferred[code] = [sortAllelePair(code, a, b)];
  }
  return inferred;
}

const COLOUR_LOCUS_LABEL: Record<string, string> = {
  E: 'red/black (Extension)',
  A: 'Agouti',
  CR: 'cream',
  G: 'grey',
  DMRT3: 'gait',
  D: 'dun',
  Z: 'silver',
  CH: 'champagne',
  RN: 'roan',
  TO: 'tobiano',
  O: 'frame overo',
  SW1: 'splashed white',
  SB1: 'Sabino1',
  LP: 'leopard complex',
  PATN1: 'appaloosa pattern (PATN1)',
};

/** Amendment 0017a §4.4/§4.5 point 1: foalColourPossibilities turned into the sentences the
 * breeding preview shows - the worked example from the amendment's own §4.4. */
function foalColourSentences(result: ReturnType<typeof foalColourPossibilities>): string[] {
  const sentences: string[] = [];
  if (result.certain.length > 0) {
    const parts = result.certain
      .slice()
      .sort((a, b) => b.probability - a.probability)
      .map((c) => `about ${String(Math.round(c.probability * 100))}% ${c.colour}`);
    sentences.push(`Foals from this pairing: ${parts.join(', ')}.`);
  }
  for (const u of result.uncertain) {
    const who = u.untestedParents.length === 2 ? 'Neither parent has' : u.untestedParents[0] === 'sire' ? 'The stallion has not' : 'The mare has not';
    const label = COLOUR_LOCUS_LABEL[u.locusCode] ?? u.locusCode;
    const unlocked = u.unlockedColours.length > 0 ? ` If tested, ${u.unlockedColours.join(' or ')} foals become possible.` : '';
    sentences.push(`${who} been tested for ${label}.${unlocked}`);
  }
  return sentences;
}

/** Slice 0006 §6 (a fifth trait, head_profile, added in slice 0021 §3): the conformation
 * measurements for one horse, ready to hand to a render
 * function. Shared by the barn list, the horse page and (via a candidate's own genotype/seed) the
 * founding screen. */
function conformationForHorse(horse: HorseRow, ageYears: number, config: RealizationConfig, traitRows: QuantitativeTraitRow[]) {
  const genotype = parseGenotype(horse.genotype);
  const noise = noiseFor(horse.rng_seed, horse.environmental_noise);
  const values = conformationValues(genotype, noise, ageYears, horse.coi, config);
  return conformationDisplayRows(values, traitRows);
}

/** Slice 0022 §B2: the four band edges, read straight off live config. */
function conformationLabelBands(cfg: ConfigValues): ConformationLabelBands {
  return {
    outstandingMin: cfg.conformation_label_outstanding_min,
    goodMin: cfg.conformation_label_good_min,
    acceptableMin: cfg.conformation_label_acceptable_min,
    weakMin: cfg.conformation_label_weak_min,
  };
}

/**
 * §B2/§B3: one word per trait against this horse's OWN breed - never a shared or foal's-breed
 * vector (§B5's own warning applies here too, even though this helper serves both the horse page
 * and the breeding preview). `eligible` is the horse-level gate: at least one show start, and a
 * breed with an ideal_vector to judge against.
 */
function conformationLabelsForHorse(
  conformation: { code: TraitCode; expressed: number }[],
  breed: BreedRow | undefined,
  eligible: boolean,
  cfg: ConfigValues
): Map<TraitCode, ConformationLabel> {
  const ideal = breed?.ideal_vector ? parseIdealVector(breed.ideal_vector) : null;
  return conformationLabelsFor(conformation, ideal, cfg.show_ideal_falloff, conformationLabelBands(cfg), eligible);
}

export interface AbilityDisplayRow {
  code: TraitCode;
  name: string;
  label: ConformationLabel;
}

/**
 * Slice 0025 stage 3 §7.4: the horse page's Ability card - every ABILITY_TRAITS trait, in order,
 * with the word an ability_test class already earned (horse_ability_words) or 'unknown' for one
 * never tested. Deliberately reads the STORED word rather than recomputing abilityValues() at
 * request time: "the result permanently records a word" (the slice's own phrase) means the word a
 * horse earned on the day it was judged, not a live re-read of its current (possibly since-matured)
 * ability - the same distinction the paid evaluation draws between "judged now" and "judged at
 * maturity", except here the class itself already did the judging.
 */
function abilityRowsForHorse(traitRows: QuantitativeTraitRow[], words: Map<TraitCode, ConformationLabel>): AbilityDisplayRow[] {
  return ABILITY_TRAITS.map((trait) => ({
    code: trait,
    name: traitRows.find((t) => t.code === trait)?.name ?? trait,
    label: words.get(trait) ?? 'unknown',
  }));
}

async function loadOwnedStable(ctx: RequestContext, stableId: number): Promise<StableRow | Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();
  return stable;
}

/** Slice 0008 §8.1/slice 0012 §9, rebuilt for slice 0025 stage 4 §7.5a: the horse page's "Enter in a
 * show" section is now the whole catalogue - every class type this horse could conceivably enter,
 * not only the classes that currently happen to have a live show_classes row, since on demand there
 * is no calendar to have pre-minted one. Each eligible row says whether pressing it joins something
 * already live or starts something new (§7.5a's own example rows); an ineligible row still names why
 * not, exactly as before.
 *
 * buildCatalogueStatusForHorse does the actual batching (§7.5a.1's required fix) - this function
 * only turns its EligibilityReason answers into the sentences a child reads, the same split
 * eligibilityMessage already draws elsewhere. */
async function buildEnterShowInfos(ctx: RequestContext, horse: HorseRow): Promise<EnterShowInfo[]> {
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const [rows, breeds] = await Promise.all([
    buildCatalogueStatusForHorse(ctx.env, horse, ctx.world.game_day, gameDaysPerYear, ctx.config),
    getBreeds(ctx.env),
  ]);

  return rows.map((row) => {
    const statusSentence =
      row.liveClassId !== null
        ? `${String(row.entryCount)} entered, judged in ${String(row.judgedInDays)} days.`
        : `Nobody yet - starts a show, judged in ${String(row.judgedInDays)} days.`;

    if (row.result.ok) {
      return { classKey: row.spec.classKey, className: row.spec.name, eligible: true, statusSentence };
    }

    const breedName = breeds.find((b) => b.id === row.spec.breedId)?.name ?? 'that breed';
    const minAgeYears = Math.round(row.spec.minAgeGameDays / gameDaysPerYear);
    return {
      classKey: row.spec.classKey,
      className: row.spec.name,
      eligible: false,
      reasonSentence: `${displayNameFor(horse)} ${eligibilityMessage(row.result.reason, { breedName, minAgeYears })}`,
    };
  });
}

export async function stableHorsesRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const cfg = ctx.config.values;
  // Slice 0010 §1 step 9/slice 0011 §8.1: the barn list includes dead and retired-away horses for
  // a while after they ended, marked Died/Retired away - every other reader of a stable's horses
  // (breeding, the NPC show barn's field, the image picker) still wants listStableHorses'
  // alive-only rows, unchanged.
  const [allHorses, traitRows, conditions, openListings] = await Promise.all([
    listStableHorsesWithDead(ctx.env, stableId, ctx.world.game_day - cfg.barn_shows_ended_game_days),
    getConformationTraits(ctx.env),
    getEnabledConditions(ctx.env),
    // Slice 0017 §6.5: one query for the whole barn's open listings, not one per row.
    openListingsBySellerStable(ctx.env, stableId),
  ]);

  // Slice 0016 §4.5: counts come off the full list, filtering happens before the per-horse
  // Promise.all mapping below (which does a getShowSummary query per horse) - otherwise a tab
  // filter would still pay for thirty queries to display four rows.
  const tabCounts: Record<BarnBucket, number> = { foals: 0, mares: 0, stallions: 0, geldings: 0 };
  for (const horse of allHorses) tabCounts[bucketFor(horse, ctx.world.game_day, cfg.foal_max_age_game_days)]++;

  const rawShow = new URL(ctx.request.url).searchParams.get('show');
  const activeTab: BarnBucket | 'all' = rawShow === 'mares' || rawShow === 'stallions' || rawShow === 'foals' || rawShow === 'geldings' ? rawShow : 'all';
  const horses = activeTab === 'all' ? allHorses : allHorses.filter((h) => bucketFor(h, ctx.world.game_day, cfg.foal_max_age_game_days) === activeTab);

  // Amendment 0017a §4.3: one query for the whole barn's cream knowledge, not one per row - the
  // same discipline getKnownGenotypeSubjectsForHorses was already built for (slice 0014 §5.2).
  const creamKnownRows = await getKnownGenotypeSubjectsForHorses(ctx.env, horses.map((h) => h.id));
  const creamTestedHorseIds = new Set(creamKnownRows.filter((r) => r.subject_code === 'locus:CR').map((r) => r.horse_id));
  // Slice 0020 §8.3: one query for the whole barn's open incidents, not one per row.
  const openIncidentIds = await openIncidentHorseIds(ctx.env, horses.map((h) => h.id));
  // docs/fixes/breed-disease-panels.md: one query for the whole barn's signs_game_day rows, not one
  // per horse - visibleAffectedConditions is truth, never panel-filtered, but now also needs to know
  // whether each affected condition's delay has actually elapsed.
  const signsMapsByHorse = signsGameDayMapsByHorse(await getHorseConditionSigns(ctx.env, horses.map((h) => h.id)));

  const rows = await Promise.all(
    horses.map(async (horse) => ({
      horse,
      description: describeHorseRow(horse, ctx.world.game_day, gameDaysPerYear, cfg.pattern_penetrance, creamTestedHorseIds.has(horse.id)),
      // Slice 0003 §7: a small badge on mares in season now, reusing horse.cycle_anchor_tick_seq
      // rather than a query per horse - it's already loaded on the row. Guarded to living horses
      // only (slice 0010) - a dead mare's stored cycle slot means nothing. docs/fixes/
      // breeding-eligibility-display.md §1: also guarded to a mare old enough to breed - isInSeason
      // itself is not wrong, the badge was asking it about foals who cannot be cycling yet.
      inSeason:
        horse.status === 'alive' &&
        horse.sex === 'mare' &&
        horse.cycle_anchor_tick_seq !== null &&
        isOldEnoughToBreed(horse.born_game_day, ctx.world.game_day, cfg.min_breeding_age_game_days) &&
        isInSeason(horse.cycle_anchor_tick_seq, ctx.world.tick_seq, cfg.estrous_cycle_ticks, cfg.estrus_ticks),
      conformation: conformationForHorse(horse, (ctx.world.game_day - horse.born_game_day) / gameDaysPerYear, cfg, traitRows),
      showSummary: await getShowSummary(ctx.env, horse.id),
      visibleConditions: visibleAffectedConditions(parseGenotype(horse.genotype), conditions, signsMapsByHorse.get(horse.id) ?? new Map(), ctx.world.game_day),
      hasOpenIncident: openIncidentIds.has(horse.id),
      // Slice 0011 §4.3/§8.1: one glanceable marker for a living horse's own Veteran/Failing state
      // - 'ended' horses show their existing Died/Retired away badge instead (healthBarnBadge
      // already has that logic; this is additive to it, not a replacement).
      ageState: ageState({ bornGameDay: horse.born_game_day, naturalDeathGameDay: horse.natural_death_game_day, status: horse.status }, ctx.world.game_day, cfg),
      // Slice 0014 §8.4: null for an ended horse, mirroring the care row just below - the
      // Died/Retired away badge already covers it.
      ageModifier: horse.status === 'alive' ? ageModifierForHorse(horse.born_game_day, cfg, ctx.world.game_day) : null,
      // The location flag: one badge per row, so a barn with three horses out reads at a glance.
      availability: horse.status === 'alive' ? availabilityForHorse(horse, cfg, ctx.world.game_day) : null,
      // Slice 0013 §8.2: null for an ended horse - care means nothing for a horse that isn't being
      // kept anymore, and stableHorsesWithDead's rows never had their care columns written for one.
      care: horse.status === 'alive' ? careCardViewFor(horse, stable.feed_level, cfg, ctx.world.game_day) : null,
      listingPrice: openListings.get(horse.id)?.price ?? null,
    }))
  );

  // Slice 0013 §8.2: the barn-wide summary line ("3 due for the farrier..."), counted from the same
  // rows already computed above rather than a second query.
  const careSummary = rows.reduce(
    (acc, r) => ({
      farrierDue: acc.farrierDue + (r.care?.needsFarrier ? 1 : 0),
      wellnessDue: acc.wellnessDue + (r.care?.needsWellness ? 1 : 0),
    }),
    { farrierDue: 0, wellnessDue: 0 }
  );

  const params = new URL(ctx.request.url).searchParams;
  const careNotice = params.get('care_notice') ?? undefined;
  const careError = params.get('care_error') ?? undefined;

  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);
  return htmlResponse(
    renderBarnList({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      stable,
      hasFoundingOffer,
      horses: rows,
      feedLevels: cfg.feed_levels.levels,
      careSummary,
      careNotice,
      careError,
      activeTab,
      tabCounts,
    })
  );
}

/** /stables/:id/past (slice 0011 §8.1): every ended horse this stable ever owned, with no cutoff -
 * linked from the barn list, since listStableHorsesWithDead itself drops an ended horse after
 * barn_shows_ended_game_days. */
export async function stablePastHorsesRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;

  const [horses, hasFoundingOffer] = await Promise.all([listPastHorses(ctx.env, stableId), hasWaitingFoundingOffer(ctx.env, stableId)]);
  return htmlResponse(
    renderPastHorsesPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      stable,
      hasFoundingOffer,
      horses,
    })
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

  // The location flag, checked before every fact about the horses themselves: a horse that is not
  // in work is not a breeding candidate, and saying so plainly beats "she is not old enough" style
  // reasons that are true of a different horse. Both sides are checked - a mare in the barn booked
  // to a stallion at grass is just as impossible as the reverse.
  for (const horse of [mare, stallion]) {
    const availability = availabilityForHorse(horse, ctx.config.values, ctx.world.game_day);
    if (availability.available) continue;
    const name = displayNameFor(horse);
    const subject = horse.sex === 'mare' ? 'she' : 'he';
    if (availability.reason === 'at_pasture') {
      return `${name} is out at pasture. Bring ${horse.sex === 'mare' ? 'her' : 'him'} into the barn first - ${subject} will need a little while to settle in before ${subject} can be bred.`;
    }
    return `${name} came in from pasture recently and is still settling in - ${subject} can be bred again in ${String(availability.daysRemaining)} more day${availability.daysRemaining === 1 ? '' : 's'}.`;
  }

  if (stallion.sex === 'gelding') return 'Geldings cannot breed.';
  if (mare.sex !== 'mare' || stallion.sex !== 'stallion') return 'Breeding needs one mare and one stallion.';

  const minAge = ctx.config.values.min_breeding_age_game_days;
  if (!isOldEnoughToBreed(mare.born_game_day, ctx.world.game_day, minAge)) return `${displayNameFor(mare)} is not old enough to breed yet.`;
  if (!isOldEnoughToBreed(stallion.born_game_day, ctx.world.game_day, minAge)) return `${displayNameFor(stallion)} is not old enough to breed yet.`;

  const [activePregnancy, activeCovering] = await Promise.all([
    getActivePregnancyForMare(ctx.env, mare.id),
    getBookedCoveringForMare(ctx.env, mare.id),
  ]);
  // docs/fixes/breeding-eligibility-display.md §2: location and age were already checked above (for
  // both horses, not just the mare), so only the mare-only reasons below this point can still fire -
  // reusing mareIneligibility rather than restating "recovering / in_foal / booked" a third time.
  const mareReason = mareIneligibility({
    bornGameDay: mare.born_game_day,
    gameDay: ctx.world.game_day,
    minBreedingAgeGameDays: minAge,
    availability: availabilityForHorse(mare, ctx.config.values, ctx.world.game_day),
    lastFoaledGameDay: mare.last_foaled_game_day,
    mareRecoveryGameDays: ctx.config.values.mare_recovery_game_days,
    inFoal: activePregnancy !== null,
    booked: activeCovering !== null,
  });
  if (mareReason === 'recovering') return `${displayNameFor(mare)} has just foaled and needs more time to recover before breeding again.`;
  if (mareReason === 'in_foal') return `${displayNameFor(mare)} is already in foal.`;
  if (mareReason === 'booked') return `${displayNameFor(mare)} is already booked to a covering.`;

  const cfg = ctx.config.values;
  if (!isInBreedingSeason(ctx.world.game_day, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year)) {
    const next = nextSeasonStartGameDay(ctx.world.game_day, cfg.breeding_season_start_game_day, cfg.breeding_season_length_game_days, cfg.game_days_per_year);
    const openingNote = next !== null ? ` The season next opens around ${formatCalendarDate(next, cfg.game_days_per_year)}.` : '';
    return `It's out of season for breeding right now.${openingNote}`;
  }

  const aliveCount = await countAliveHorses(ctx.env, stable.id);
  if (aliveCount >= stable.capacity) return `${stable.name} doesn't have room for another horse.`;

  return undefined;
}

/**
 * The pairing preview both stallion pickers produce, built once so the outside-stud path can never
 * drift from the same-stable one - the numbers a child compares two stallions on have to be the
 * same numbers, whichever picker the stallion came from.
 *
 * Two things differ for a stallion at another ranch, and they are the two parameters:
 *
 *  - `stallionKnowledgeStableId` - whose horse_knowledge stands for what is known about him. His
 *    own owner's, for a stud listing: that is the disclosure the market already makes on his stud
 *    page (slice 0017 §2.3), not a widening of it.
 *  - `stallionConformationKnown` - **true since 2026-08-05 for a stallion standing at stud**, false
 *    for anyone else's stallion. It used to be false everywhere, on the reasoning that his
 *    conformation was shown nowhere else in the game to anyone but his owner. That reasoning expired
 *    when stud listings started showing those words for free (src/db/conformationLabels.ts): the
 *    preview would otherwise read Unknown down his column while his own stud page printed the same
 *    words in full. A stallion who is neither at stud nor for sale still reads Unknown.
 */
async function buildBreedPreview(
  ctx: RequestContext,
  stableId: number,
  mare: HorseRow,
  stallion: HorseRow,
  describe: (h: HorseRow) => string,
  options: { stallionKnowledgeStableId?: number; stallionConformationKnown?: boolean } = {}
): Promise<BreedPreview> {
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const stallionKnowledgeStableId = options.stallionKnowledgeStableId ?? stableId;
  const stallionConformationKnown = options.stallionConformationKnown ?? true;

  const coi = await previewCoi(ctx.env, stallion.id, mare.id);
  const mareAgeYears = (ctx.world.game_day - mare.born_game_day) / gameDaysPerYear;
  const stallionAgeYears = (ctx.world.game_day - stallion.born_game_day) / gameDaysPerYear;
  const breakdown = estimateConceptionChance(mareAgeYears, stallionAgeYears, coi, ctx.config);
  // Slice 0010 §7.3: computed from horse_knowledge rows only, never from either horse's genotype
  // (both already loaded above for the COI calculation, which is exactly why this is delegated to a
  // function that never has them in scope - see its comment).
  const healthWarnings = await breedingHealthWarningsFor(ctx.env, stableId, mare.id, stallion.id, stallionKnowledgeStableId);
  // Amendment 0017a §4.4/§4.5 point 1: computed only from this booking stable's own knowledge of
  // each parent (narrowedColourInference), never from either horse's genotype directly. Deliberately
  // NOT widened to the stallion's owner the way the health line is: colour test results are not part
  // of what a listing discloses anywhere in the market, so an outside stallion's colour reads off
  // his coat, the same as it does for anyone standing at the rail.
  const [stallionColour, mareColour] = await Promise.all([
    narrowedColourInference(ctx, stableId, stallion),
    narrowedColourInference(ctx, stableId, mare),
  ]);
  const colourNotes = foalColourSentences(
    foalColourPossibilities({ sire: stallionColour, dam: mareColour, gameDaysPerYear, patternPenetrance: ctx.config.values.pattern_penetrance })
  );
  // Slice 0022 §B5: the conformation block, one row per trait, each parent judged against ITS OWN
  // breed's ideal - never a shared vector, and never the foal's, which doesn't exist yet and has
  // no breed to have an opinion (§B5's own warning). The gate is per parent (§B5): an unshown mare
  // booked to a proven stallion reads Unknown down her column and real words down his.
  const [traitRows, mareBreed, stallionBreed, mareShowSummary, stallionShowSummary] = await Promise.all([
    getConformationTraits(ctx.env),
    mare.breed_id ? getBreedById(ctx.env, mare.breed_id) : Promise.resolve(undefined),
    stallion.breed_id ? getBreedById(ctx.env, stallion.breed_id) : Promise.resolve(undefined),
    getShowSummary(ctx.env, mare.id),
    getShowSummary(ctx.env, stallion.id),
  ]);
  const mareConformation = conformationForHorse(mare, mareAgeYears, ctx.config.values, traitRows);
  const stallionConformation = conformationForHorse(stallion, stallionAgeYears, ctx.config.values, traitRows);
  const mareLabels = conformationLabelsForHorse(mareConformation, mareBreed, (mareShowSummary?.starts ?? 0) >= 1, ctx.config.values);
  const stallionLabels = conformationLabelsForHorse(
    stallionConformation,
    stallionBreed,
    stallionConformationKnown && (stallionShowSummary?.starts ?? 0) >= 1,
    ctx.config.values
  );
  // 2026-08-05: the third column - what this pairing is actually likely to throw. The operator's
  // decision was to fix the expectation rather than the genetics ("they still say it's too random
  // whether babies born are good or not"), so nothing about inheritance changed; this is an exact
  // calculation over the foal's own distribution (src/engines/genetics/foalPrediction.ts).
  //
  // A foal has no breed of its own until it exists, so the range is only computed for a same-breed
  // pairing, judged against that breed's standard. A cross has no single standard to be judged
  // against - which is a real fact about the game, not a gap, and the row says so rather than
  // quietly picking the dam's breed.
  const sameBreedIdeal = mare.breed_id !== null && mare.breed_id === stallion.breed_id && mareBreed?.ideal_vector ? parseIdealVector(mareBreed.ideal_vector) : null;
  const mareGenotype = parseGenotype(mare.genotype);
  const stallionGenotype = parseGenotype(stallion.genotype);

  const conformationRows = mareConformation.map((row) => {
    const mareLabel = mareLabels.get(row.code) ?? 'unknown';
    const stallionLabel = stallionLabels.get(row.code) ?? 'unknown';
    return {
      name: row.name,
      mareLabel: CONFORMATION_LABEL_TEXT[mareLabel],
      stallionLabel: CONFORMATION_LABEL_TEXT[stallionLabel],
      // The knowledge boundary the operator chose (Q27): the range is honest only if both parents
      // are actually known, so an unknown parent makes the foal column Unknown too rather than
      // handing over a prediction built from values this player has not earned the right to see.
      foalRange:
        mareLabel === 'unknown' || stallionLabel === 'unknown'
          ? 'Unknown'
          : sameBreedIdeal
            ? foalRangeText(mareGenotype, stallionGenotype, row.code, coi, sameBreedIdeal, ctx.config.values)
            : 'No single standard',
    };
  });

  return {
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
    colourNotes,
    conformationRows,
  };
}

/**
 * docs/fixes/breeding-eligibility-display.md §2: which of this stable's mares can actually be
 * picked right now, and a short reason for each one that can't. Only the mare-side,
 * stallion-independent checks mareIneligibility already knows - a stallion has not been chosen yet
 * when this runs, so booked/in_foal/recovering can only ever be about the mare.
 */
async function mareEligibilityFor(ctx: RequestContext, mares: HorseRow[]): Promise<{ eligible: HorseRow[]; excluded: MareExclusion[] }> {
  const cfg = ctx.config.values;
  const eligible: HorseRow[] = [];
  const excluded: MareExclusion[] = [];
  for (const mare of mares) {
    const [activePregnancy, activeCovering] = await Promise.all([
      getActivePregnancyForMare(ctx.env, mare.id),
      getBookedCoveringForMare(ctx.env, mare.id),
    ]);
    const reason = mareIneligibility({
      bornGameDay: mare.born_game_day,
      gameDay: ctx.world.game_day,
      minBreedingAgeGameDays: cfg.min_breeding_age_game_days,
      availability: availabilityForHorse(mare, cfg, ctx.world.game_day),
      lastFoaledGameDay: mare.last_foaled_game_day,
      mareRecoveryGameDays: cfg.mare_recovery_game_days,
      inFoal: activePregnancy !== null,
      booked: activeCovering !== null,
    });
    if (!reason) {
      eligible.push(mare);
      continue;
    }
    const stallionName =
      reason === 'booked' && activeCovering
        ? displayNameFor((await getHorse(ctx.env, activeCovering.stallion_id)) ?? { sex: 'stallion' as const, registered_name: null, barn_name: null })
        : undefined;
    const recoversGameDay = reason === 'recovering' && mare.last_foaled_game_day !== null ? mare.last_foaled_game_day + cfg.mare_recovery_game_days : undefined;
    excluded.push({ name: displayNameFor(mare), reason, stallionName, recoversGameDay });
  }
  return { eligible, excluded };
}

/** The stallion-side counterpart, filtered to the two reasons a stallion (not yet paired with any
 * mare) can be ineligible for: too young, or not available to work. No DB access needed - both
 * facts are already on the loaded row. */
function stallionEligibilityFor(stallions: HorseRow[], gameDay: number, cfg: ConfigValues): { eligible: HorseRow[]; excluded: MareExclusion[] } {
  const eligible: HorseRow[] = [];
  const excluded: MareExclusion[] = [];
  for (const stallion of stallions) {
    const reason = stallionIneligibility({
      bornGameDay: stallion.born_game_day,
      gameDay,
      minBreedingAgeGameDays: cfg.min_breeding_age_game_days,
      availability: availabilityForHorse(stallion, cfg, gameDay),
    });
    if (!reason) {
      eligible.push(stallion);
      continue;
    }
    excluded.push({ name: displayNameFor(stallion), reason });
  }
  return { eligible, excluded };
}

export async function stableBreedRoute(ctx: RequestContext, method: string, stableId: number): Promise<Response> {
  const stable = await loadOwnedStable(ctx, stableId);
  if (stable instanceof Response) return stable;
  const isAdmin = ctx.account!.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  const allHorses = await listStableHorses(ctx.env, stableId);
  const creamKnownRows = await getKnownGenotypeSubjectsForHorses(ctx.env, allHorses.map((h) => h.id));
  const creamTestedHorseIds = new Set(creamKnownRows.filter((r) => r.subject_code === 'locus:CR').map((r) => r.horse_id));
  const describe = (h: HorseRow) => describeHorseRow(h, ctx.world.game_day, gameDaysPerYear, ctx.config.values.pattern_penetrance, creamTestedHorseIds.has(h.id));

  // docs/fixes/breeding-eligibility-display.md §2: both pickers only offer what could actually be
  // picked right now - allHorses (below, in the form-submit branches) stays the full list, since a
  // stale form has to be re-validated by validateBooking regardless of what the picker showed.
  const { eligible: mares, excluded: mareExclusions } = await mareEligibilityFor(ctx, allHorses.filter((h) => h.sex === 'mare'));
  const { eligible: stallions, excluded: stallionExclusions } = stallionEligibilityFor(allHorses.filter((h) => h.sex === 'stallion'), ctx.world.game_day, ctx.config.values);
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, stableId);

  // The third picker: every stallion standing at stud somewhere this account does not own, NPC
  // ranches included (their stable_account_id is null, which is never this account's id). Cross-
  // stable breeding already exists at /market/stud - this only puts the same stallions in front of
  // a child who came to the Breed page to breed, rather than expecting them to know the market has
  // a stud section.
  const [outsideStudListings, breedRows] = await Promise.all([
    listActiveStudListings(ctx.env, null).then((rows) => rows.filter((l) => l.stable_account_id !== ctx.account!.id)),
    getBreeds(ctx.env),
  ]);
  const outsideStudOptions: OutsideStudOption[] = outsideStudListings.map((l) => ({
    studListingId: l.id,
    breedId: l.breed_id,
    // Same fallback the /market/stud list uses, so a stallion reads the same on both screens.
    breedName: breedRows.find((b) => b.id === l.breed_id)?.name ?? (l.is_cross ? 'Cross' : 'Unknown'),
    stallionName: displayNameFor({ ...l, sex: 'stallion' as const }),
    stableName: l.stable_name,
    fee: l.fee,
  }));

  /**
   * The mare's own breed first, then every other breed alphabetically, and stallions within a breed
   * by name. Cross-breed pairings are legal and this does not stop one - it just stops a child
   * hunting for the Quarter Horse stallions through a list ordered by nothing at all.
   *
   * The mare it sorts around is whichever one the mare picker is currently showing, which on a
   * fresh page view is the first in that list - so the order always matches the pairing the form
   * would submit if the button were pressed right now.
   */
  const outsideStudsFor = (mareBreedId: number | null): OutsideStudOption[] =>
    [...outsideStudOptions].sort((a, b) => {
      const aOwnBreed = mareBreedId !== null && a.breedId === mareBreedId ? 0 : 1;
      const bOwnBreed = mareBreedId !== null && b.breedId === mareBreedId ? 0 : 1;
      if (aOwnBreed !== bOwnBreed) return aOwnBreed - bOwnBreed;
      const byBreed = a.breedName.localeCompare(b.breedName);
      return byBreed !== 0 ? byBreed : a.stallionName.localeCompare(b.stallionName);
    });

  const page = (extra: Partial<Parameters<typeof renderBreedPage>[0]> = {}) =>
    htmlResponse(
      renderBreedPage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
        gameDaysPerYear,
        stable,
        hasFoundingOffer,
        mares,
        mareExclusions,
        stallions,
        stallionExclusions,
        // The mare picker's own default, so the two agree before anything is chosen. A call site
        // that knows which mare was picked passes its own list in `extra` and overrides this.
        outsideStuds: outsideStudsFor(mares[0]?.breed_id ?? null),
        describe,
        ...extra,
      })
    );

  if (method === 'GET') return page();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  const mareId = Number(form.mare_id);
  const mare = allHorses.find((h) => h.id === mareId);
  if (!mare) return page({ error: 'Choose a mare from this stable.' });

  // The outside-stud picker wins when something is chosen in it - the label on the form says so,
  // and leaving it on its "none" default is how a player asks for their own stallion instead.
  const studListingId = typeof form.stud_listing_id === 'string' && form.stud_listing_id !== '' ? Number(form.stud_listing_id) : null;
  if (studListingId !== null) {
    if (form.action !== 'check') return notFound();
    const listing = Number.isInteger(studListingId) ? await getStudListing(ctx.env, studListingId) : null;
    // Rechecked here rather than trusted from the form (the same discipline slice 0010 §7.1 step 1
    // uses for a test purchase): the option list was built a page view ago and he may have been
    // withdrawn, sold or died since.
    if (!listing || listing.active !== 1 || listing.stable_account_id === ctx.account!.id) {
      return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), error: 'That stallion is not standing at stud anymore.' });
    }
    const outsideStallion = await getHorse(ctx.env, listing.stallion_id);
    if (!outsideStallion || outsideStallion.status !== 'alive') {
      return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), error: 'That stallion is not standing at stud anymore.' });
    }

    // 2026-08-05: his conformation words are now public on his stud listing (the operator's oldest
    // daughter's point - you can look a stud over before paying), so the preview shows them here
    // too rather than reading Unknown down his column while /market/stud/:id prints them in full.
    // Still the same gate: he must have started at least one show, or the words are Unknown anyway.
    const preview = await buildBreedPreview(ctx, stableId, mare, outsideStallion, describe, {
      stallionKnowledgeStableId: listing.stable_id,
      stallionConformationKnown: true,
    });
    // Shown in place of the Book button rather than after pressing it - the refusal is about this
    // mare, and a player with four of them needs to be able to try another without being bounced to
    // a different page first (the same lesson /market/stud/:id's own picker just had to learn).
    let refusal = await validateStudBooking(ctx.env, ctx.config, ctx.world.game_day, listing, ctx.world.season_index, mare, stable, outsideStallion);
    if (!refusal && actionsLeft !== null && actionsLeft < ACTION_COSTS.book_stud) refusal = turnsRefusalMessage(ctx);
    preview.outsideStud = { studListingId: listing.id, stableName: listing.stable_name, fee: listing.fee, refusal };

    return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), selectedStudListingId: listing.id, preview });
  }

  const stallionId = Number(form.stallion_id);
  const stallion = allHorses.find((h) => h.id === stallionId);
  if (!stallion) return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), error: 'Choose a stallion - one of your own, or one standing at another ranch.' });

  if (form.action === 'check') {
    const preview = await buildBreedPreview(ctx, stableId, mare, stallion, describe);
    return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), selectedStallionId: stallion.id, preview });
  }

  if (form.action === 'book') {
    const refusal = await validateBooking(ctx, stable, mare, stallion);
    if (refusal) return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), selectedStallionId: stallion.id, error: refusal });

    // Slice 0009 Part B §5.3: check, act, then spend - read the budget and refuse up front if it
    // looks empty, do the game action, then spend. If the spend below loses a race (two forms
    // submitted at the same instant), it's let through free rather than charged for nothing - a
    // child charged for something that did not happen has no way to find out why or get it back.
    if (actionsLeft !== null && actionsLeft < ACTION_COSTS.book_covering) {
      return page({ selectedMareId: mare.id, outsideStuds: outsideStudsFor(mare.breed_id), selectedStallionId: stallion.id, error: turnsRefusalMessage(ctx) });
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
 * Slice 0010 §8/§2.4, revised by slice 0016's follow-up: the Health card's rows, resolved to what
 * this viewer is entitled to see. An owner gets a paid-for result where one exists, else an
 * observation for a signs_visible condition their horse's genotype already reads as affected by (no
 * charge, no test - §2.4), else "not tested". An admin viewing someone else's horse gets the truth
 * straight from the genotype for every applicable condition, bypassing knowledge entirely - the
 * truth-vs-knowledge split protects one player from another, not the operator from their own game.
 * Anyone who is neither gets names only.
 */
async function healthRowsFor(ctx: RequestContext, owner: boolean, isAdmin: boolean, ownerStableId: number, horseId: number, genotype: Genotype): Promise<HealthConditionDisplay[]> {
  // Slice 0022 Part A: the twelve acquired incidents (colic, laminitis, and the rest) live in their
  // own table now - they belong on their own Incidents card, not this one, and getEnabledConditions
  // already returns genetics-only rows.
  // docs/fixes/breed-disease-panels.md: panel-filtered, all three branches below - a Friesian gets
  // no HYPP row at all, rather than a guaranteed-clear one worth nothing.
  const conditions = await conditionsPanelForHorse(ctx.env, horseId, await getEnabledConditions(ctx.env));

  if (isAdmin && !owner) {
    return conditions.map((c) => {
      if (c.locus_code === null) {
        return { code: c.code, name: c.name, teachingText: c.teaching_text, status: null, copies: null, testedGameDay: null, observedOnly: false };
      }
      const result = conditionStatus(genotype, parseConditionTrigger(c.trigger));
      return { code: c.code, name: c.name, teachingText: c.teaching_text, status: result.status, copies: result.copies, testedGameDay: null, observedOnly: false };
    });
  }

  if (!owner) {
    return conditions.map((c) => ({ code: c.code, name: c.name, teachingText: c.teaching_text, status: null, copies: null, testedGameDay: null, observedOnly: false }));
  }

  const [knowledge, signsRows] = await Promise.all([getKnowledgeForHorse(ctx.env, ownerStableId, horseId), getHorseConditionSigns(ctx.env, [horseId])]);
  const signsByCode = new Map(signsRows.map((r) => [r.condition_code, r.signs_game_day]));
  return conditions.map((c) => {
    const known = knowledge.find((k) => k.kind === 'genotype' && k.subject_code === c.code);
    // locus_code is only null for a future polygenic condition (none seeded yet) - nothing to
    // compute against a genotype for one of those, so it reads as never-tested-never-observed.
    if (c.locus_code === null) {
      return { code: c.code, name: c.name, teachingText: c.teaching_text, status: null, copies: null, testedGameDay: null, observedOnly: false };
    }
    // docs/fixes/breed-disease-panels.md: signs_visible alone is no longer enough for the free
    // observation - the delay drawn at write time must have actually elapsed too.
    const signsGameDay = signsByCode.get(c.code) ?? null;
    const signsDue = signsGameDay === null || signsGameDay <= ctx.world.game_day;
    const visible = ownerVisibleStatus(genotype, parseConditionTrigger(c.trigger), c.signs_visible === 1 && signsDue, known);
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
  // Slice 0016 §6.5: a non-owner (and non-admin) lands on the public page instead of a dead end -
  // a link pasted between two children now resolves to something.
  if (!owner && !isAdmin) return redirect(`/world/horses/${String(horseId)}`);

  // Slice 0011 §8.1: the one flag that hides Enter in a show, Test, Choose/Change picture and
  // Retire away for a horse that has already ended - reading content is never gated by this.
  const canManage = owner && horse.status === 'alive';

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const ageDays = ctx.world.game_day - horse.born_game_day;
  const ageYears = ageDays / gameDaysPerYear;
  const genotype = parseGenotype(horse.genotype);
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear, patternSeed, ctx.config.values.pattern_penetrance);
  // Amendment 0017a §4.3: only this stable's own cream test unmasks smoky black - a non-owner (or
  // an owner who has not tested) reads the same "black" a spectator at the rail would see.
  const ownKnowledge = owner ? await getKnowledgeForHorse(ctx.env, ownerStable.id, horse.id) : [];
  const creamTested = ownKnowledge.some((r) => r.kind === 'genotype' && r.subject_code === 'locus:CR');
  const displayPhenotype = { ...phenotype, visibleColour: displayColourName(phenotype.visibleColour, creamTested), bornColour: displayColourName(phenotype.bornColour, creamTested) };
  const description = describeHorse(displayPhenotype, horse.sex, ageYears);

  // Amendment 0017a §4.5 point 2: what this horse can pass on, per locus - owner (or admin) only.
  const colour: ColourInferenceRow[] = [];
  if (owner || isAdmin) {
    const inferred = await narrowedColourInference(ctx, ownerStable.id, horse);
    const colourLoci = (await getLoci(ctx.env)).filter((l) => l.category !== 'disease');
    for (const l of colourLoci) {
      const known = ownKnowledge.find((k) => k.kind === 'genotype' && k.subject_code === `locus:${l.code}`);
      const possible = inferred[l.code] ?? [];
      const summary = known
        ? `${known.result} (tested)`
        : possible.length === 1
          ? `${possible[0].join('/')} (certain from looks)`
          : `untested - ${String(possible.length)} possibilities`;
      colour.push({ code: l.code, name: l.name, summary });
    }
  }

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
  const careError = params.get('care_error') ?? undefined;
  const careNotice =
    params.get('care_done') === 'farrier'
      ? 'Farrier called.'
      : params.get('care_done') === 'wellness'
        ? 'Vet visit booked.'
        : params.get('care_done') === 'management'
          ? 'Management plan booked.'
          : undefined;

  let loci: LocusRow[] | undefined;
  if (isAdmin) loci = await getLoci(ctx.env);

  const mareStatus = horse.sex === 'mare' && horse.status === 'alive' ? await mareStatusLine(ctx, horse) : undefined;
  // The operator's third rule: a mare carrying a foal stays in until she has foaled. Explained on
  // the card in place of the Turn out button rather than as an error after pressing it - a child
  // should not have to press a button to find out it was never going to work.
  const locationBlockedReason = await turnOutBlockedReason(ctx, horse);
  const hasFoundingOffer = owner ? await hasWaitingFoundingOffer(ctx.env, ownerStable.id) : false;
  const traitRows = await getConformationTraits(ctx.env);
  const conformation = conformationForHorse(horse, ageYears, ctx.config.values, traitRows);
  // Slice 0005 §5.3/§11: the Friesian pool carries a real recessive red (e at 8%), and a chestnut
  // Friesian is a genuine, if rare, outcome - it just can't be registered as one.
  const unregistrableFriesianChestnut = breed?.code === 'FR' && phenotype.baseColour === 'chestnut';

  const showSummary = await getShowSummary(ctx.env, horse.id);
  // Slice 0022 §B3: gated on real show starts, not on the horse's status - a retired or dead horse
  // that showed in its life keeps its labels (the show record outlives the horse on purpose).
  const conformationLabels = conformationLabelsForHorse(conformation, breed, (showSummary?.starts ?? 0) >= 1, ctx.config.values);
  // Slice 0025 stage 3 §7.4: the Ability card - only ever reads what an ability_test class has
  // already earned this horse (never recomputed live - see abilityRowsForHorse's own comment).
  const abilityTraitRows = await getAbilityTraits(ctx.env);
  const abilityWords = await getAbilityWordsForHorse(ctx.env, horse.id);
  const abilityRows = abilityRowsForHorse(abilityTraitRows, abilityWords);
  // Grouped by class type (Conformation vs. each discipline) rather than a single flat list: a
  // made-up show name tells a player nothing, but which kind of class a result came from does.
  const recentResultsRaw = await listRecentResultsForHorse(ctx.env, horse.id, SHOW_RESULT_FETCH_LIMIT);
  const recentShowResultGroups = buildShowResultGroups(recentResultsRaw, gameDaysPerYear);
  const enterShow = canManage ? await buildEnterShowInfos(ctx, horse) : [];
  const health = await healthRowsFor(ctx, owner, isAdmin, ownerStable.id, horse.id, genotype);
  // Slice 0014 §5.3: the Management section, and the delta it feeds into the Care card's own
  // modifier so the number shown here matches what a show would actually apply.
  const enabledConditions = await getEnabledConditions(ctx.env);
  const managementPlans =
    horse.status === 'alive' ? await managementPlanRowsForHorse(ctx.env, horse, enabledConditions, ctx.world.game_day, ctx.config.values) : [];
  const conditionDeltaMap =
    horse.status === 'alive' ? await conditionDeltaMapForHorses(ctx.env, [horse], enabledConditions, ctx.world.game_day, ctx.config.values.unmanaged_condition_penalty) : null;
  // Slice 0020 §2.9: careModifier's conditionDelta slot gains a second contributor - a flat penalty
  // while any acquired condition reads state = 'acute', summed with the unmanaged-single-gene delta
  // above rather than a second modifier slot.
  const acuteDeltaMap =
    horse.status === 'alive' ? await acuteCarePenaltyMapForHorses(ctx.env, [horse.id], ctx.config.values.acute_incident_care_penalty) : null;
  const care =
    horse.status === 'alive'
      ? careCardViewFor(
          horse,
          ownerStable.feed_level,
          ctx.config.values,
          ctx.world.game_day,
          (conditionDeltaMap?.get(horse.id)?.delta ?? 0) + (acuteDeltaMap?.get(horse.id) ?? 0)
        )
      : null;
  const ageModifier = ageModifierForHorse(horse.born_game_day, ctx.config.values, ctx.world.game_day);
  // Slice 0020 §8.2: the Incidents card - open acute incidents and past outcomes, truth with no
  // knowledge boundary to cross (§2.7), so shown to the owner and admin alike; nobody else sees it.
  const incidents = owner || isAdmin ? await incidentsForHorse(ctx.env, horse.id, ctx.world.game_day, ctx.config.values) : { open: [], history: [], hiddenCount: 0 };
  const incidentError = params.get('incident_error') ?? undefined;
  const incidentNotice = params.get('incident_treated') ? 'Vet called.' : undefined;

  // Slice 0017 §6.3/§2.7: the listing state, and the guide value - which the owner sees and nobody
  // else does, admin included. It is computed against the OWNER's knowledge rows, since a
  // tested-clear premium belongs to whoever paid for the tests.
  const listingRow = await getOpenListingForHorse(ctx.env, horse.id);
  const guideValue =
    owner && horse.status === 'alive' ? await appraiseHorseForStable(ctx.env, horse, ownerStable.id, ctx.world.game_day, ctx.config.values) : null;

  // Slice 0017 §13 (Part D): the stud state, mirroring the listing state right above it. A
  // suggested fee reuses npc_stud_fee_fraction (the same shared "what's a typical stud fee, as a
  // fraction of a horse's worth" number an NPC stallion's own fee is derived from) against the
  // guide value already computed above, rather than a second config key.
  // The admin delete card's state. Computed only for an admin looking at an ended horse - a living
  // horse leaves through the pet home, which pays for it, and this must never look like a second
  // way to do that. horseAdminDeleteRoute asks the same question again on submit rather than
  // trusting the page that drew the button.
  const adminDelete =
    isAdmin && horse.status !== 'alive'
      ? (await isHorseDeletable(ctx.env, horse.id))
        ? { deletable: true, reason: '' }
        : { deletable: false, reason: 'it has foals, a pedigree, a show record or a stud booking behind it, and other records point at it.' }
      : null;

  // 2026-08-05: the paid evaluation. The owner pays from the stable that owns the horse; anyone else
  // looking at this page is not offered one here (the sale and stud listing pages are where a
  // non-owner can buy one, and they pass their own paying stable).
  const evaluation = owner
    ? await buildEvaluationSectionView(ctx, horse, ownerStable, `/horses/${String(horse.id)}`, {
        error: params.get('evaluation_error') ?? undefined,
        notice: params.get('evaluated') ? 'Evaluation done.' : undefined,
      })
    : null;

  // 2026-08-05: the "Grow up" card. Planned here so the button can name the real number of days -
  // near the maturity cap the last warp is a short one, and saying "six months" would be a lie.
  const warpPlan = owner ? planTimeWarp(horse, ctx.world.game_day, ctx.config.values) : null;
  const timeWarp = warpPlan
    ? {
        horseId: horse.id,
        days: warpPlan.days,
        cost: warpPlan.cost,
        clamped: warpPlan.clamped,
        affordable: canTakeOnCost(ownerStable.balance) && ownerStable.balance >= warpPlan.cost,
        // Months while it still reads as months - "0 years old" is not a thing anybody says about a
        // foal, and this card is aimed squarely at a ten-year-old looking at one.
        ageLabel:
          ageYears < 1
            ? `${String(Math.max(1, Math.round(ageYears * 12)))} months`
            : `${String(Math.floor(ageYears))} year${Math.floor(ageYears) === 1 ? '' : 's'}`,
        monthsLabel: `${String(Math.round((warpPlan.days / gameDaysPerYear) * 12))} months`,
        error: params.get('warp_error') ?? undefined,
        notice: params.get('warped') ? 'Grown up.' : undefined,
      }
    : null;

  const studListingRow = owner && horse.sex === 'stallion' ? await getActiveStudListingForHorse(ctx.env, horse.id) : null;
  const bookedThisSeason = studListingRow ? await bookingsThisSeasonCount(ctx.env, studListingRow.id, ctx.world.season_index) : 0;
  const suggestedStudFee = guideValue ? Math.max(10, Math.round((guideValue.value * ctx.config.values.npc_stud_fee_fraction) / 10) * 10) : null;
  // docs/fixes/breeding-eligibility-display.md §1: the "Offer at stud" card renders on any live
  // stallion's own page, colts included, even though validateStudBooking would refuse him for being
  // too young the moment anyone tried to book him. Passed through so studCard can show a muted "not
  // yet" line in its place rather than a form that was always going to fail.
  const stallionOldEnoughForStud = isOldEnoughToBreed(horse.born_game_day, ctx.world.game_day, ctx.config.values.min_breeding_age_game_days);
  const stallionStudEligibleFromGameDay = horse.born_game_day + ctx.config.values.min_breeding_age_game_days;

  return htmlResponse(
    renderHorsePage({
      world: ctx.world,
      isAdmin,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      owner,
      ownerStable,
      hasFoundingOffer,
      horse,
      description,
      visibleColour: displayPhenotype.visibleColour,
      ageYears,
      ageModifier,
      breed,
      gaited: phenotype.gaited,
      breederStableName: breederStable ? breederStable.name : null,
      unregistrableFriesianChestnut,
      pedigree: { sire, dam, sireSire, sireDam, damSire, damDam },
      canRegisterName: owner && horse.registered_name === null,
      nameError,
      barnNameNotice,
      genotype: isAdmin ? genotype : undefined,
      adminDelete,
      adminError: params.get('admin_error') ?? undefined,
      loci,
      mareStatus,
      conformation,
      conformationLabels,
      conformationMaturityYears: ctx.config.values.conformation_maturity_years,
      abilityRows,
      evaluation,
      timeWarp,
      showInbreedingNote: horse.coi >= ctx.config.values.coi_warn_threshold,
      showSummary,
      recentShowResultGroups,
      enterShow,
      enterShowError,
      enterShowNotice,
      ageState: ageState({ bornGameDay: horse.born_game_day, naturalDeathGameDay: horse.natural_death_game_day, status: horse.status }, ctx.world.game_day, ctx.config.values),
      canManage,
      // The location flag. Null for an ended horse - the card renders nothing for one, the same way
      // every other action is hidden once a horse has died or been retired away.
      availability: horse.status === 'alive' ? availabilityForHorse(horse, ctx.config.values, ctx.world.game_day) : null,
      locationBlockedReason,
      locationError: params.get('location_error') ?? undefined,
      health,
      colour,
      patternWords: displayPhenotype.patterns.map((p) => PATTERN_LABELS[p]),
      care,
      managementPlans,
      careError,
      careNotice,
      feedLevelName: ctx.config.values.feed_levels.levels[ownerStable.feed_level]?.name ?? ownerStable.feed_level,
      listing: listingRow ? { listingId: listingRow.id, price: listingRow.price, expiresGameDay: listingRow.expires_game_day } : null,
      guideValue,
      marketCommissionPercent: ctx.config.values.market_commission_percent,
      marketError: params.get('market_error') ?? undefined,
      marketNotice: params.get('market_notice') ?? undefined,
      studListing: studListingRow ? { studListingId: studListingRow.id, fee: studListingRow.fee, seasonCap: studListingRow.season_cap, bookedThisSeason } : null,
      stallionOldEnoughForStud,
      stallionStudEligibleFromGameDay,
      suggestedStudFee,
      defaultStudSeasonCap: ctx.config.values.stud_default_season_cap,
      studError: params.get('stud_error') ?? undefined,
      studNotice: params.get('stud_notice') ?? undefined,
      incidents,
      incidentError,
      incidentNotice,
    })
  );
}

/**
 * POST /horses/:id/admin-delete - the operator's own broom, for a horse that has *already* ended.
 *
 * Why this exists: the pet home's delete rule (src/db/horseRemoval.ts) decides at the moment a horse
 * leaves whether its row is worth keeping, and until 2026-08-04 it answered "keep" for every
 * home-bred and founding horse because of two pointer clauses that were universal in practice. That
 * is fixed for every horse that leaves from now on, but nothing goes back over the ones already
 * marked `removed` - so the operator was left with rows the rule says should never have survived and
 * no way, from a browser, to be rid of them. This is that way.
 *
 * Three deliberate limits, all of them about not making this a bigger tool than the job:
 *
 * - **Admin only**, and never offered to an owner. A player's route out is the pet home, which pays
 *   them; this one pays nothing and writes no ledger row, because the horse already left and was
 *   already paid for. Two paths that both end a horse but only one of which settles up would be a
 *   real hazard if a child could reach either.
 * - **Ended horses only.** An alive horse has an owner, a balance owed to it and a departure to
 *   account for - that is sellHorseToPetHome's job, not this one. Refusing here keeps this route
 *   incapable of skipping the money.
 * - **The same deletability rule, not a stronger one.** It reuses isHorseDeletable unchanged, so a
 *   horse with foals, a pedigree hanging off it, a show record or a stud booking is refused exactly
 *   as it would be at the pet home. That rule is also the proof the delete cannot break a foreign
 *   key, so overriding it here would turn a tidy-up button into a way to corrupt the database.
 */
export async function horseAdminDeleteRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  if (ctx.account!.is_admin !== 1) return notFound();

  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();

  const back = (message: string) => redirect(`/horses/${String(horseId)}?admin_error=${encodeURIComponent(message)}`);

  if (horse.status === 'alive') {
    return back('That horse is still alive. Send it to a pet home or retire it first - this only clears up a horse that has already gone.');
  }
  if (!(await isHorseDeletable(ctx.env, horse.id))) {
    return back('That horse has foals, a show record or a stud booking behind it, so its row is holding up somebody else\'s pedigree or results. It has to stay.');
  }

  const form = await parseForm(ctx.request);
  if (form.confirm !== 'yes') return back('Tick the box to confirm - deleting a horse\'s row cannot be undone.');

  await ctx.env.DB.batch(buildDeleteHorseStatements(ctx.env, horse.id));

  // The horse page this was pressed from no longer exists, so there is nowhere to go back to.
  return redirect('/admin/horses?deleted=1');
}

/**
 * /horses/:id/list - slice 0017 §6.3. Owner-only, the same notFound()-for-a-non-owner shape every
 * horse-scoped route in this file uses. **Free: no turn, no fee** (§2.5). The guide value is advice
 * and nothing enforces it - any whole number from 1 to market_max_price is accepted, and an
 * over-priced listing is a choice (§2.7).
 *
 * A listed horse is still fully its owner's (§2.8), so there is nothing here that freezes, escrows
 * or blocks anything - listing a horse changes exactly one thing about it, which is that a row now
 * exists in `listings`.
 */
export async function horseListRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const fail = (message: string) => redirect(`/horses/${String(horseId)}?market_error=${encodeURIComponent(message)}`);

  const form = await parseForm(ctx.request);
  const price = Number((form.price ?? '').trim());
  const maxPrice = ctx.config.values.market_max_price;
  if (!Number.isInteger(price) || price < 1) return fail('Type a whole number for the asking price - at least 1.');
  if (price > maxPrice) return fail(`That's more than the highest price the market takes (${String(maxPrice)}).`);

  const guide = await appraiseHorseForStable(ctx.env, horse, ownerStable.id, ctx.world.game_day, ctx.config.values);
  const result = await createListing(ctx.env, {
    horseId,
    sellerStableId: ownerStable.id,
    price,
    guideValue: guide.value,
    gameDay: ctx.world.game_day,
    listingGameDays: ctx.config.values.market_listing_game_days,
  });

  if (!result.ok) return fail(`${displayNameFor(horse)} is already on the market.`);
  return redirect(`/market/${String(result.listingId)}`);
}

/**
 * /horses/:id/stud - slice 0017 §13 (Part D). Owner-only, the same notFound()-for-a-non-owner shape
 * every horse-scoped route in this file uses. Only a stallion can be offered. Free: no turn, no fee
 * (§2.5's own reasoning for listing a horse applies here too). Withdrawing runs through
 * /market/stud/:id/withdraw, the same split listing/withdraw already uses.
 */
export async function horseStudRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();
  if (horse.sex !== 'stallion') return notFound();

  const fail = (message: string) => redirect(`/horses/${String(horseId)}?stud_error=${encodeURIComponent(message)}`);

  const form = await parseForm(ctx.request);
  const fee = Number((form.fee ?? '').trim());
  const seasonCap = Number((form.season_cap ?? '').trim());
  const maxFee = ctx.config.values.stud_max_fee;
  if (!Number.isInteger(fee) || fee < 1) return fail('Type a whole number for the stud fee - at least 1.');
  if (fee > maxFee) return fail(`That's more than the highest fee the market takes (${String(maxFee)}).`);
  if (!Number.isInteger(seasonCap) || seasonCap < 1) return fail('Type a whole number for how many mares he can cover this season - at least 1.');

  const result = await createStudListing(ctx.env, { stallionId: horseId, stableId: ownerStable.id, fee, seasonCap, gameDay: ctx.world.game_day });
  if (!result.ok) return fail(`${displayNameFor(horse)} is already standing at stud.`);
  return redirect(`/horses/${String(horseId)}`);
}

/** Slice 0003 §7: one line of state on a mare's page - in season now, due back in season around a
 * day, booked to a stallion, in foal with a due date, or recovering. Checked in that priority
 * order because a mare who is (say) both recovering and technically "due back in season" should
 * only ever show the more informative of the two. */
async function mareStatusLine(ctx: RequestContext, mare: HorseRow): Promise<string> {
  const cfg = ctx.config.values;

  // docs/fixes/breeding-eligibility-display.md §1: checked above every other branch, because nothing
  // else in this ladder can be true of a mare who has never been old enough to breed - a filly with
  // no pregnancy, no covering and no cycle yet was reading "In season now." or a "due back around"
  // date for a heat she was not actually having.
  if (!isOldEnoughToBreed(mare.born_game_day, ctx.world.game_day, cfg.min_breeding_age_game_days)) {
    const eligibleFrom = mare.born_game_day + cfg.min_breeding_age_game_days;
    return `Too young to breed. She can be bred from around ${formatCalendarDate(eligibleFrom, cfg.game_days_per_year)}.`;
  }

  const pregnancy: PregnancyRow | null = await getActivePregnancyForMare(ctx.env, mare.id);
  if (pregnancy) {
    const sire = await getHorse(ctx.env, pregnancy.sire_id);
    return `In foal to ${sire ? displayNameFor(sire) : 'an unknown stallion'}, due around ${formatCalendarDate(pregnancy.due_game_day, cfg.game_days_per_year)}.`;
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
    return next !== null ? ` The breeding season opens again around ${formatCalendarDate(next, cfg.game_days_per_year)}.` : '';
  };

  if (mare.last_foaled_game_day !== null) {
    const recoverUntil = mare.last_foaled_game_day + cfg.mare_recovery_game_days;
    if (ctx.world.game_day < recoverUntil) {
      return `Recovering from foaling; can breed again from around ${formatCalendarDate(recoverUntil, cfg.game_days_per_year)}.${seasonNote()}`;
    }
  }

  if (mare.cycle_anchor_tick_seq === null) {
    // The age check above makes this unreachable for the common case (a filly too young to be
    // cycling yet) - it stays here rather than being deleted because it is still the correct
    // answer for a mare who is old enough but has no cycle anchor set for some other reason.
    return `Not yet cycling.${seasonNote()}`;
  }

  const ticksUntil = ticksUntilNextEstrus(mare.cycle_anchor_tick_seq, ctx.world.tick_seq, cfg.estrous_cycle_ticks, cfg.estrus_ticks);
  if (ticksUntil === 0) return `In season now.${seasonNote()}`;

  const estimatedDay = ctx.world.game_day + ticksUntil * cfg.game_days_per_tick;
  return `Due back in season around ${formatCalendarDate(estimatedDay, cfg.game_days_per_year)}.${seasonNote()}`;
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

/** Slice 0008 §8.1, rebuilt for slice 0025 stage 4 §7.5a: the horse page's "Enter in a show" button.
 * Owner-only, same shape as every other horse-scoped route. Posts a catalogue class_key rather than
 * a class_id, since there may be no live class yet - requestClassEntry joins one if it's open or
 * mints exactly one otherwise. Re-checks eligibility server-side rather than trusting that the
 * button was only shown because it passed - the same discipline the image picker's POST uses
 * (CLAUDE.md §11, slice 0007's "never trust the submitted value" entry). */
export async function horseEnterShowRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const form = await parseForm(ctx.request);
  const classKey = form.class_key ?? '';
  if (!classKey) return redirect(`/horses/${String(horseId)}`);

  // Slice 0009 Part B §5.3: check, act, then spend - see the comment on the same pattern in
  // stableBreedRoute above.
  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.enter_show) {
    return redirect(`/horses/${String(horseId)}?show_error=${encodeURIComponent(turnsRefusalMessage(ctx))}`);
  }

  const result = await requestClassEntry(ctx.env, {
    classKey,
    horseId,
    gameDay: ctx.world.game_day,
    gameDaysPerYear: ctx.config.values.game_days_per_year,
    conformationConfig: ctx.config.values,
    config: ctx.config,
  });

  if (!result.ok) {
    const [breeds, catalogue] = await Promise.all([getBreeds(ctx.env), buildShowCatalogue(ctx.env, ctx.config)]);
    const spec = catalogue.find((c) => c.classKey === classKey);
    const breedName = breeds.find((b) => b.id === spec?.breedId)?.name ?? 'that breed';
    const minAgeYears = spec ? Math.round(spec.minAgeGameDays / ctx.config.values.game_days_per_year) : 0;
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

  const [breeds, imageLabelRows, stableHorses] = await Promise.all([
    getBreeds(ctx.env),
    getBreedImageLabels(ctx.env),
    listStableHorses(ctx.env, ownerStable.id),
  ]);
  const composition = JSON.parse(horse.composition) as Record<string, number>;
  const labels = buildImageLabelMap(
    imageLabelRows.map((r) => ({ breedId: r.breed_id, imageIndex: r.image_index, label: r.label })),
    breeds
  );
  const options = imageOptionsFor(composition, breeds, labels);

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
  const patternSeed = deriveSeed(horse.rng_seed, 'pattern_expression');
  const phenotype = expressPhenotype(genotype, ageDays, gameDaysPerYear, patternSeed, ctx.config.values.pattern_penetrance);
  const isAdmin = ctx.account!.is_admin === 1;
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, ownerStable.id);
  const ownCreamKnowledge = await getKnownGenotypeSubjectsForHorses(ctx.env, [horse.id]);
  const creamTested = ownCreamKnowledge.some((r) => r.subject_code === 'locus:CR');

  const render = (error?: string) =>
    renderImagePickerPage({
      world: ctx.world,
      isAdmin,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      ownerStable,
      hasFoundingOffer,
      horse,
      visibleColour: displayColourName(phenotype.visibleColour, creamTested),
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
  genotype: Genotype,
  ownBreedId: number | null
): Promise<{ rows: TestConditionOption[]; untested: ReturnType<typeof untestedConditions>; ancestryBreedNames: string[] }> {
  // Slice 0022 Part A: the twelve acquired incidents no longer live in `conditions` at all, so
  // getEnabledConditions already returns genetics-only rows - nothing to filter here.
  // docs/fixes/breed-disease-panels.md: panel-filtered before untestedConditions ever sees the
  // list, so a condition this horse's breeds cannot carry is never offered for sale.
  const [enabledConditions, knowledge, breedCodes, breeds] = await Promise.all([
    getEnabledConditions(ctx.env),
    getKnowledgeForHorse(ctx.env, ownerStableId, horseId),
    pedigreeBreedCodes(ctx.env, horseId),
    getBreeds(ctx.env),
  ]);
  const conditions = panelFor(enabledConditions, new Map(breeds.map((b) => [b.code, parseAllelePool(b.founding_allele_pool)])), breedCodes);
  const untested = untestedConditions(conditions, knowledge);
  const untestedCodes = new Set(untested.map((c) => c.code));

  // docs/fixes/breed-disease-panels.md: "This horse has Arabian in its pedigree, so the Arabian
  // conditions are on its panel too" - named so a Quarter Horse showing an Arabian test doesn't
  // read as a bug. Own breed excluded; every other breed in the pedigree, by name.
  const ownCode = breeds.find((b) => b.id === ownBreedId)?.code ?? null;
  const ancestryBreedNames = breeds.filter((b) => b.code !== ownCode && breedCodes.has(b.code)).map((b) => b.name);

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

  return { rows, untested, ancestryBreedNames };
}

/** Amendment 0017a §4.5 point 4/§4.6: the colour panel, alongside the disease one above - same
 * page, same mechanism, priced from the same genotype_test_cost/genotype_panel_cost keys (§4.6: add
 * no new config). */
async function buildColourTestPageRows(
  ctx: RequestContext,
  ownerStableId: number,
  horseId: number
): Promise<{ rows: ColourLocusOption[]; untestedCodes: string[] }> {
  const [loci, knowledge] = await Promise.all([getLoci(ctx.env), getKnowledgeForHorse(ctx.env, ownerStableId, horseId)]);
  const colourLoci = loci.filter((l) => l.category !== 'disease');
  const tested = testedColourLoci(knowledge);

  const rows: ColourLocusOption[] = colourLoci.map((l) => {
    const known = knowledge.find((k) => k.kind === 'genotype' && k.subject_code === `${LOCUS_KNOWLEDGE_PREFIX}${l.code}`);
    return {
      code: l.code,
      name: l.name,
      teachingText: l.teaching_text,
      known: known ? known.result : null,
      testedGameDay: known ? known.tested_game_day : null,
      price: tested.has(l.code) ? null : ctx.config.values.genotype_test_cost,
    };
  });
  const untestedCodes = colourLoci.filter((l) => !tested.has(l.code)).map((l) => l.code);

  return { rows, untestedCodes };
}

/**
 * /horses/:id/test - slice 0010 §7.1/§7.2, extended by amendment 0017a §4 for colour loci. Owner-only
 * on both GET and POST, the same notFound()-for-a-non-owner shape every stable-scoped route already
 * uses. GET lists every enabled condition plus every colour/gait locus; POST buys either one disease
 * condition (`condition_code`), the disease panel (`action=panel`), one locus (`locus_code`), or the
 * colour panel (`action=colour_panel`) - two panels, priced separately (§4.6).
 */
export async function horseTestRoute(ctx: RequestContext, method: string, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const genotype = parseGenotype(horse.genotype);
  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, ownerStable.id);

  const render = async (error?: string) => {
    const [{ rows, untested, ancestryBreedNames }, colour] = await Promise.all([
      buildTestPageRows(ctx, ownerStable.id, horseId, genotype, horse.breed_id),
      buildColourTestPageRows(ctx, ownerStable.id, horseId),
    ]);
    return htmlResponse(
      renderTestPage({
        world: ctx.world,
        isAdmin: ctx.account!.is_admin === 1,
        actionsLeft: actionsLeftFor(ctx),
        gameDaysPerYear: ctx.config.values.game_days_per_year,
        ownerStable,
        hasFoundingOffer,
        horse,
        rows,
        untestedCount: untested.length,
        panelPrice: ctx.config.values.genotype_panel_cost,
        ancestryBreedNames,
        colourRows: colour.rows,
        untestedColourCount: colour.untestedCodes.length,
        colourPanelPrice: ctx.config.values.genotype_panel_cost,
        error,
      })
    );
  };

  if (method === 'GET') return render();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);

  // Amendment 0017a §4.6: the colour panel and single-locus purchases, handled entirely separately
  // from the disease path below - same table, same mechanism, but a different builder
  // (buildLocusKnowledgePurchaseStatements) since a colour result has no trigger to evaluate.
  if (form.action === 'colour_panel' || typeof form.locus_code === 'string') {
    const { untestedCodes } = await buildColourTestPageRows(ctx, ownerStable.id, horseId);
    let codesToBuy: string[];
    let colourTotalCost: number;
    let colourDescription: string;

    if (form.action === 'colour_panel') {
      if (untestedCodes.length === 0) return render('Nothing is left to test.');
      codesToBuy = untestedCodes;
      colourTotalCost = ctx.config.values.genotype_panel_cost;
      colourDescription = `Colour panel test, ${displayNameFor(horse)}.`;
    } else {
      const found = untestedCodes.find((c) => c === form.locus_code);
      if (!found) return render("That test isn't available for this horse.");
      codesToBuy = [found];
      colourTotalCost = ctx.config.values.genotype_test_cost;
      colourDescription = `Colour test (${found}), ${displayNameFor(horse)}.`;
    }

    const actionsLeftForColour = actionsLeftFor(ctx);
    if (actionsLeftForColour !== null && actionsLeftForColour < ACTION_COSTS.genotype_test) {
      return render(turnsRefusalMessage(ctx));
    }
    if (!canTakeOnCost(ownerStable.balance)) {
      return render(`${ownerStable.name} is ${String(Math.abs(ownerStable.balance))} in the red. Win a show, or ask a grown-up to add money, before testing.`);
    }

    const colourCostByCode: Record<string, number> = {};
    const colourBase = Math.floor(colourTotalCost / codesToBuy.length);
    codesToBuy.forEach((code) => {
      colourCostByCode[code] = colourBase;
    });
    colourCostByCode[codesToBuy[codesToBuy.length - 1]] += colourTotalCost - colourBase * codesToBuy.length;

    try {
      await ctx.env.DB.batch([
        ...buildLocusKnowledgePurchaseStatements(ctx.env, {
          stableId: ownerStable.id,
          horseId,
          gameDay: ctx.world.game_day,
          genotype,
          locusCodes: codesToBuy,
          costByCode: colourCostByCode,
        }),
        ...buildLedgerStatements(ctx.env, [
          {
            stableId: ownerStable.id,
            amount: -colourTotalCost,
            kind: 'vet',
            referenceType: 'horse',
            referenceId: horseId,
            description: colourDescription,
            gameDay: ctx.world.game_day,
          },
        ]),
      ]);
    } catch (err) {
      if (err instanceof Error && /unique constraint failed/i.test(err.message)) {
        return render('That result is already known - nothing was charged.');
      }
      throw err;
    }

    await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.genotype_test);
    return redirect(`/horses/${String(horseId)}`);
  }

  // Slice 0010 §7.1 step 1: re-derive what is untested from the knowledge rows rather than
  // trusting the form - the same "re-derive and check membership" rule isAllowedImagePath
  // established in slice 0007. A submitted condition code that is already known or not applicable
  // is rejected and nothing is charged.
  const { untested } = await buildTestPageRows(ctx, ownerStable.id, horseId, genotype, horse.breed_id);

  let toBuy: (typeof untested)[number][];
  let totalCost: number;
  let description: string;

  if (form.action === 'panel') {
    if (untested.length === 0) return render('Nothing is left to test.');
    toBuy = untested;
    totalCost = ctx.config.values.genotype_panel_cost;
    // docs/fixes/breed-disease-panels.md: the panel's own size now varies by breed (an Arabian's is
    // three conditions, a Thoroughbred's is none) - "Five-panel" was only ever true for a Quarter
    // Horse, so the count is read off what is actually being bought.
    description = `${String(toBuy.length)}-condition panel test, ${displayNameFor(horse)}.`;
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

/**
 * Why this horse cannot be turned out right now, or undefined if it can be. The operator's third
 * rule: a mare carrying a foal stays in until she has foaled.
 *
 * The reasoning behind that rule rather than the obvious alternative (let her foal at grass, which
 * is what actually happens on a real farm): "at pasture" in this game means "nothing is happening
 * to this horse". A pregnancy is something happening. Letting a mare foal out there would mean a
 * newborn arriving into a location whose whole definition is that its care timers do not run, on
 * the one day of a horse's life when that matters most.
 *
 * Used by both the page (to explain instead of offering the button) and the POST (to refuse), so
 * the two can never disagree - the same shape buildRetireWarnings uses for the same reason.
 */
async function turnOutBlockedReason(ctx: RequestContext, horse: HorseRow): Promise<string | undefined> {
  if (horse.status !== 'alive' || horse.location !== 'barn') return undefined;
  if (horse.sex !== 'mare') return undefined;

  const pregnancy = await getActivePregnancyForMare(ctx.env, horse.id);
  if (pregnancy) {
    return `${displayNameFor(horse)} is in foal, due around ${formatCalendarDate(pregnancy.due_game_day, ctx.config.values.game_days_per_year)}. She stays in the barn until she has foaled - then she can go out.`;
  }
  return undefined;
}

/**
 * /horses/:id/location - the location flag's one route. Owner-only, the same
 * notFound()-for-a-non-owner shape every horse-scoped route in this file uses.
 *
 * Costs no turn and no money, in either direction. Turning a horse out is a management decision,
 * not a purchase, and the whole point of pasture is that it is the lever a stable reaches for when
 * money is tight - gating it behind the debt rule or the action budget would take it away from
 * exactly the player who needs it. (Contrast horseCareRoute above, which is a purchase and is
 * blocked by canTakeOnCost.)
 *
 * Both directions re-check server-side rather than trusting that the button was rendered, and both
 * are idempotent at the database (the UPDATEs carry their own location guard), so a double-tap on
 * a phone changes nothing the second time.
 */
export async function horseLocationRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const form = await parseForm(ctx.request);
  const action = form.action === 'turn_out' ? 'turn_out' : form.action === 'bring_in' ? 'bring_in' : null;
  if (!action) return redirect(`/horses/${String(horseId)}`);

  const fail = (message: string) => redirect(`/horses/${String(horseId)}?location_error=${encodeURIComponent(message)}`);

  if (action === 'turn_out') {
    const blocked = await turnOutBlockedReason(ctx, horse);
    if (blocked) return fail(blocked);
    // A horse already at pasture is not an error worth a message - the page it lands on already
    // shows where the horse is.
    await turnOutToPasture(ctx.env, horseId, ctx.world.game_day);
    return redirect(`/horses/${String(horseId)}?location_done=out`);
  }

  await bringInFromPasture(ctx.env, horse, ctx.world.game_day);
  return redirect(`/horses/${String(horseId)}?location_done=in`);
}

/** Slice 0011 §6.2: what retiring this horse away is about to cancel or withdraw, named plainly -
 * "a child should never discover this afterwards". Built fresh on every render rather than cached,
 * since it must still be true the moment the confirm button is actually pressed. */
async function buildRetireWarnings(ctx: RequestContext, horse: HorseRow): Promise<string[]> {
  const [pregnancies, coverings, openEntries] = await Promise.all([
    listActivePregnanciesInvolvingHorse(ctx.env, horse.id),
    listBookedCoveringsInvolvingHorse(ctx.env, horse.id),
    listOpenEntriesForHorse(ctx.env, horse.id),
  ]);
  const name = displayNameFor(horse);
  const possessive = horse.sex === 'mare' ? 'her' : 'his';
  const warnings: string[] = [];

  for (const p of pregnancies) {
    const isDam = p.dam_id === horse.id;
    const other = await getHorse(ctx.env, isDam ? p.sire_id : p.dam_id);
    const otherName = other ? displayNameFor(other) : isDam ? 'a stallion' : 'a mare';
    const dueLabel = formatCalendarDate(p.due_game_day, ctx.config.values.game_days_per_year);
    warnings.push(
      isDam
        ? `${name} is in foal to ${otherName}, due around ${dueLabel}. Retiring ${name} away ends the pregnancy.`
        : `${otherName} is in foal to ${name}, due around ${dueLabel}. Retiring ${name} away ends that pregnancy too.`
    );
  }

  for (const c of coverings) {
    const isMareSide = c.mare_id === horse.id;
    const other = await getHorse(ctx.env, isMareSide ? c.stallion_id : c.mare_id);
    const otherName = other ? displayNameFor(other) : isMareSide ? 'a stallion' : 'a mare';
    warnings.push(
      isMareSide
        ? `${name} is booked to ${otherName}, waiting to be covered. Retiring ${name} away cancels the booking.`
        : `${otherName} is booked to ${name}, waiting to be covered. Retiring ${name} away cancels that booking too.`
    );
  }

  for (const entry of openEntries) {
    warnings.push(`${name} is entered in ${entry.className}, not yet judged. Retiring ${name} away withdraws ${possessive === 'her' ? 'her' : 'his'} entry.`);
  }

  // Slice 0017 §7.4/§2.8: retiring a listed horse away takes it off the market, named here beside
  // the pregnancies, coverings and entries this page already names.
  const listing = await getOpenListingForHorse(ctx.env, horse.id);
  if (listing) {
    warnings.push(`${name} is on the market for ${String(listing.price)}. Retiring ${name} away takes ${possessive === 'her' ? 'her' : 'him'} off it - nobody can buy ${possessive === 'her' ? 'her' : 'him'} afterwards.`);
  }

  // Slice 0017 §13 (Part D): the same reasoning as the listing warning right above it.
  if (horse.sex === 'stallion') {
    const studListing = await getActiveStudListingForHorse(ctx.env, horse.id);
    if (studListing) {
      warnings.push(`${name} is standing at stud for ${String(studListing.fee)}. Retiring ${name} away takes him off it - nobody can book him afterwards.`);
    }
  }

  return warnings;
}

/**
 * /horses/:id/care - slice 0013 §6.1/§6.2. One horse, one service. Owner-only, the same
 * notFound()-for-a-non-owner shape every horse-scoped route in this file uses. Calling the farrier
 * for a horse that is already fresh is allowed on purpose - it wastes money and resets the timer,
 * which is the player's business (§6.2). No turn is spent (§2.2).
 */
export async function horseCareRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const form = await parseForm(ctx.request);
  const cfg = ctx.config.values;

  // Slice 0014 §5.3: a management plan purchase/renewal, distinguished from the farrier/wellness
  // POST by carrying condition_code instead of service.
  if (typeof form.condition_code === 'string' && form.condition_code.length > 0) {
    if (!canTakeOnCost(ownerStable.balance)) {
      return redirect(
        `/horses/${String(horseId)}?care_error=${encodeURIComponent(`${ownerStable.name} is ${String(Math.abs(ownerStable.balance))} in the red. Try dropping to poor feed, or ask a grown-up to add money, before calling the vet.`)}`
      );
    }
    const conditions = await getEnabledConditions(ctx.env);
    // Re-derived from the horse's own entitlement, never trusted from the form (the same discipline
    // slice 0010 §7.1 step 1 uses for a test purchase) - a form field naming a condition this stable
    // is not entitled to know about, or one that isn't manageable, is simply ignored.
    const rows = await managementPlanRowsForHorse(ctx.env, horse, conditions, ctx.world.game_day, cfg);
    const row = rows.find((r) => r.conditionCode === form.condition_code);
    if (!row) return redirect(`/horses/${String(horseId)}`);

    await callOneConditionManagement(ctx.env, {
      horseId: horse.id,
      horseName: displayNameFor(horse),
      ownerStableId: ownerStable.id,
      conditionCode: row.conditionCode,
      cost: cfg.condition_management_cost,
      intervalGameDays: cfg.condition_management_interval_game_days,
      gameDay: ctx.world.game_day,
    });
    return redirect(`/horses/${String(horseId)}?care_done=management`);
  }

  const service: CareService | null = form.service === 'farrier' ? 'farrier' : form.service === 'wellness' ? 'wellness' : null;
  if (!service) return redirect(`/horses/${String(horseId)}`);

  const careView = careCardViewFor(horse, ownerStable.feed_level, cfg, ctx.world.game_day);
  if (careView.tooYoung) {
    return redirect(`/horses/${String(horseId)}?care_error=${encodeURIComponent('Too young to need the farrier yet - care starts at three.')}`);
  }

  // Slice 0013 §2.7: a purchase, blocked by the debt rule the same way a genotype test is - poor
  // feed is always the way out, named here so a child sees the lever, not just the refusal.
  if (!canTakeOnCost(ownerStable.balance)) {
    const who = service === 'farrier' ? 'the farrier' : 'the vet';
    return redirect(
      `/horses/${String(horseId)}?care_error=${encodeURIComponent(`${ownerStable.name} is ${String(Math.abs(ownerStable.balance))} in the red. Try dropping to poor feed, or ask a grown-up to add money, before calling ${who}.`)}`
    );
  }

  const cost = service === 'farrier' ? cfg.farrier_cost : cfg.vet_wellness_cost;
  await callOneHorseCare(ctx.env, { horse, ownerStableId: ownerStable.id, service, cost, gameDay: ctx.world.game_day });
  return redirect(`/horses/${String(horseId)}?care_done=${service}`);
}

/**
 * /horses/:id/pet-home - the player's half of the pet home (src/db/petHome.ts). Owner-only, the same
 * notFound()-for-a-non-owner shape every horse-scoped route in this file uses, and shaped
 * deliberately like horseRetireRoute below: same confirmation, same one-way warning.
 *
 * Spends no turn. Retiring a horse away already costs none (slice 0011 §6.4), and this is the same
 * decision with money attached - a child who has run out of turns should still be able to stop
 * paying board on a horse they have given up on. It is also never blocked by canTakeOnCost: it pays
 * *in*, and a stable in debt is exactly the one that needs it.
 *
 * An open market listing or stud listing is withdrawn rather than refused, matching horseRetireRoute
 * - a child who wants a horse gone should not have to go and un-list it first to be allowed to say
 * so.
 */
export async function horsePetHomeRoute(ctx: RequestContext, method: string, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const appraisal = await appraiseHorseForStable(ctx.env, horse, ownerStable.id, ctx.world.game_day, ctx.config.values);
  const payout = petHomePayout(appraisal.value, ctx.config);

  const render = async (error?: string) => {
    const [hasFoundingOffer, warnings, willBeDeleted] = await Promise.all([
      hasWaitingFoundingOffer(ctx.env, ownerStable.id),
      buildRetireWarnings(ctx, horse),
      isHorseDeletable(ctx.env, horse.id),
    ]);
    return htmlResponse(
      renderPetHomeConfirmPage({
        world: ctx.world,
        isAdmin: ctx.account!.is_admin === 1,
        actionsLeft: actionsLeftFor(ctx),
        gameDaysPerYear: ctx.config.values.game_days_per_year,
        ownerStable,
        hasFoundingOffer,
        horse,
        ageYears: (ctx.world.game_day - horse.born_game_day) / ctx.config.values.game_days_per_year,
        appraisedValue: appraisal.value,
        payout,
        willBeDeleted,
        warnings,
        error,
      })
    );
  };

  if (method === 'GET') return render();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.confirm !== 'yes') return render("Tick the box to confirm - sending a horse to a pet home can't be undone.");

  await sellHorseToPetHome(ctx.env, {
    horse,
    sellerStableId: ownerStable.id,
    appraisedValue: appraisal.value,
    gameDay: ctx.world.game_day,
    config: ctx.config,
    // In the same batch as the payment and the departure, so no `status = 'open'` race can leave a
    // live listing pointing at a horse that has gone - the reasoning horseRetireRoute's own listing
    // withdrawal already follows.
    withdrawStatements: [
      ...buildWithdrawListingsForHorseStatement(ctx.env, horseId, ctx.world.game_day),
      ...buildWithdrawStudListingsForHorseStatement(ctx.env, horseId, ctx.world.game_day),
    ],
  });

  return redirect(`/stables/${String(ownerStable.id)}/horses`);
}

/**
 * /horses/:id/treat - slice 0020 §8.1. Owner-only, the same notFound()-for-a-non-owner shape every
 * horse-scoped route in this file uses. Re-derives the open incident from horse_conditions itself
 * (never trusted from the form, the same discipline slice 0010 §7.1 step 1 uses for a test
 * purchase). Refused via canTakeOnCost if the stable is in the red - a discretionary purchase, even
 * an urgent one, the same rule callOneHorseCare and callOneConditionManagement already follow. No
 * turn spent, matching every other care-shaped purchase in this game (slice 0013 §2.2).
 */
export async function horseTreatRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const form = await parseForm(ctx.request);
  const conditionCode = typeof form.condition_code === 'string' ? form.condition_code : null;
  if (!conditionCode) return redirect(`/horses/${String(horseId)}`);

  const { open } = await incidentsForHorse(ctx.env, horse.id, ctx.world.game_day, ctx.config.values);
  const incident = open.find((o) => o.conditionCode === conditionCode);
  if (!incident) return redirect(`/horses/${String(horseId)}`);

  if (!canTakeOnCost(ownerStable.balance)) {
    return redirect(
      `/horses/${String(horseId)}?incident_error=${encodeURIComponent(`${ownerStable.name} is ${String(Math.abs(ownerStable.balance))} in the red. Try dropping to poor feed, or ask a grown-up to add money, before calling the vet.`)}`
    );
  }

  const treated = await treatOneIncident(ctx.env, {
    horseId: horse.id,
    horseName: displayNameFor(horse),
    ownerStableId: ownerStable.id,
    conditionCode: incident.conditionCode,
    cost: incident.cost,
    gameDay: ctx.world.game_day,
  });
  if (!treated) return redirect(`/horses/${String(horseId)}`);
  return redirect(`/horses/${String(horseId)}?incident_treated=1`);
}

/**
 * /horses/:id/evaluate - the paid conformation evaluation, 2026-08-05. Money only, no turn (the
 * operator's decision: a child evaluating a whole crop of foals should not spend a day's actions
 * looking rather than doing).
 *
 * Who may buy, also the operator's decision: the owner, and anyone looking at a horse that is
 * currently for sale or standing at stud. That second case is checked here against the live
 * listing/stud rows rather than trusted from whichever page drew the button, the same discipline
 * every other POST in this file keeps.
 */
export async function horseEvaluateRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const form = await parseForm(ctx.request);
  // Where the button was pressed, so a buyer looking at a sale listing lands back on it rather than
  // on a horse page they may not even be allowed to see. Only a same-site path is ever honoured.
  const rawBack = typeof form.back === 'string' ? form.back : '';
  const back = /^\/[A-Za-z0-9/_?=&-]*$/.test(rawBack) ? rawBack : `/horses/${String(horseId)}`;
  const fail = (message: string) => redirect(`${back}${back.includes('?') ? '&' : '?'}evaluation_error=${encodeURIComponent(message)}`);

  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  if (horse.status !== 'alive') return fail('That horse is no longer alive.');

  const payerStable = await getStableById(ctx.env, Number(form.stable_id));
  if (!payerStable || payerStable.account_id !== ctx.account!.id) return notFound();

  if (payerStable.id !== horse.owner_stable_id) {
    const [listing, studListing] = await Promise.all([getOpenListingForHorse(ctx.env, horse.id), getActiveStudListingForHorse(ctx.env, horse.id)]);
    if (!listing && !studListing) return notFound();
  }

  const cost = evaluationCost(ctx.config);
  if (!canTakeOnCost(payerStable.balance) || payerStable.balance < cost) {
    return fail(`${payerStable.name} has ${String(payerStable.balance)} and an evaluation costs ${String(cost)}. Win a show, sell a horse, or ask a grown-up to add money first.`);
  }

  const built = await buildEvaluationFor(ctx, horse);
  if (!built) {
    return fail(`Nobody can judge ${displayNameFor(horse)} against a breed standard, so there is nothing worth paying for here.`);
  }

  await ctx.env.DB.batch(
    buildEvaluationStatements(ctx.env, {
      stableId: payerStable.id,
      horseId: horse.id,
      horseName: displayNameFor(horse),
      gameDay: ctx.world.game_day,
      ageGameDays: ctx.world.game_day - horse.born_game_day,
      verdicts: built,
      cost,
    })
  );

  return redirect(`${back}${back.includes('?') ? '&' : '?'}evaluated=1`);
}

/** The share of foals a predicted range is drawn to cover. 0.8 is the operator's own number:
 * "say what they'd get 80% of the time". */
const FOAL_RANGE_COVERAGE = 0.8;

/**
 * The plain-words prediction for one trait: the best and worst label inside the central 80% of the
 * foal distribution. Taking the extremes of the SET of labels rather than the labels at the two ends
 * of the value interval is the whole subtlety here - a trait's label is not monotonic in its value
 * (too far above the breed's target is as bad as too far below), so an interval that straddles the
 * target contains its best word in the middle, not at an edge.
 */
function foalRangeText(
  sire: Genotype,
  dam: Genotype,
  trait: TraitCode,
  coi: number,
  ideal: ReturnType<typeof parseIdealVector>,
  cfg: ConfigValues
): string {
  const target = ideal[trait];
  if (target === undefined) return 'Unknown';

  const distribution = foalExpressedDistribution({ sire, dam, trait, coi, noiseSd: cfg.conformation_noise_sd, config: cfg });
  const { low, high } = centralInterval(distribution, FOAL_RANGE_COVERAGE);
  const bands = conformationLabelBands(cfg);

  let best = -1;
  let worst = LABEL_ORDER.length;
  for (let value = low; value <= high; value++) {
    const index = LABEL_ORDER.indexOf(bandForTraitScore(traitScoreFor(value, target.target, cfg.show_ideal_falloff), bands));
    if (index > best) best = index;
    if (index < worst) worst = index;
  }
  if (best < 0) return 'Unknown';

  const worstText = CONFORMATION_LABEL_TEXT[LABEL_ORDER[worst]];
  const bestText = CONFORMATION_LABEL_TEXT[LABEL_ORDER[best]];
  return worstText === bestText ? worstText : `${worstText} to ${bestText}`;
}

const LABEL_ORDER: ConformationLabel[] = ['poor', 'weak', 'acceptable', 'good', 'outstanding'];

/** "Good", or "Weak to Good" while the evaluator is still hedging. */
function verdictText(verdict: { low: ConformationLabel; high: ConformationLabel }): string {
  const low = CONFORMATION_LABEL_TEXT[verdict.low];
  const high = CONFORMATION_LABEL_TEXT[verdict.high];
  return low === high ? low : `${low} to ${high}`;
}

/**
 * The Evaluation block's whole view, shared by the horse page, a sale listing and a stud listing -
 * one builder, so the words a buyer sees and the words an owner sees can never drift apart.
 *
 * Returns null when there is nobody to bill (a viewer with no stable) or nothing to sell (an ended
 * horse, or a breed with no standard to be judged against) - in every one of those cases the section
 * simply does not render, rather than drawing a button that horseEvaluateRoute would refuse.
 */
export async function buildEvaluationSectionView(
  ctx: RequestContext,
  horse: HorseRow,
  payerStable: StableRow | null,
  back: string,
  messages: { error?: string; notice?: string }
): Promise<EvaluationSectionView | null> {
  if (!payerStable || horse.status !== 'alive') return null;

  const breed = horse.breed_id ? await getBreedById(ctx.env, horse.breed_id) : undefined;
  if (!breed?.ideal_vector) return null;

  const [traitRows, latest] = await Promise.all([getConformationTraits(ctx.env), getLatestEvaluation(ctx.env, payerStable.id, horse.id)]);
  const traitName = new Map(traitRows.map((row) => [row.code, row.name]));
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const ageYears = (ctx.world.game_day - horse.born_game_day) / gameDaysPerYear;
  const cost = evaluationCost(ctx.config);

  const current = latest
    ? {
        rows: Object.entries(latest.verdicts.traits).flatMap(([code, verdict]) =>
          verdict ? [{ name: traitName.get(code) ?? code, text: verdictText(verdict) }] : []
        ),
        ageYears: latest.row.age_game_days / gameDaysPerYear,
        certain: Object.values(latest.verdicts.traits).every((v) => v && v.low === v.high),
      }
    : null;

  return {
    horseId: horse.id,
    cost,
    payerStableId: payerStable.id,
    back,
    current,
    worthBuyingAgain: latest ? wouldSharpen(latest.row.age_game_days / gameDaysPerYear, ageYears, ctx.config.values) : true,
    affordable: canTakeOnCost(payerStable.balance) && payerStable.balance >= cost,
    error: messages.error,
    notice: messages.notice,
  };
}

/**
 * The evaluation itself, for one horse, at today's age. Returns null when the horse's breed has no
 * ideal_vector to be judged against - the caller refuses the purchase rather than charging for a
 * page of Unknowns.
 *
 * The horse is judged on its MATURE conformation, not today's: a four-month-old's expressed values
 * have barely realised, and the question a child is actually asking is what the foal will become.
 * See src/engines/conformation/evaluation.ts for why the vagueness is derived from the horse's own
 * seed rather than drawn per purchase.
 */
async function buildEvaluationFor(ctx: RequestContext, horse: HorseRow): Promise<StoredEvaluation | null> {
  const [traitRows, breed] = await Promise.all([
    getConformationTraits(ctx.env),
    horse.breed_id ? getBreedById(ctx.env, horse.breed_id) : Promise.resolve(undefined),
  ]);
  const ideal = breed?.ideal_vector ? parseIdealVector(breed.ideal_vector) : null;
  if (!ideal) return null;

  const ageYears = (ctx.world.game_day - horse.born_game_day) / ctx.config.values.game_days_per_year;
  const conformation = conformationForHorse(horse, ageYears, ctx.config.values, traitRows);

  return evaluateHorse(
    {
      rngSeed: horse.rng_seed,
      matureConformation: conformation.map((row) => ({ code: row.code, expressed: row.matureExpressed })),
      ideal,
      falloff: ctx.config.values.show_ideal_falloff,
      bands: conformationLabelBands(ctx.config.values),
      ageYears,
    },
    ctx.config.values
  );
}

/**
 * /horses/:id/warp - the per-horse time warp, 2026-08-05. Owner-only, money and one turn, capped at
 * maturity. See src/db/timeWarp.ts for what it does and deliberately does not simulate.
 */
export async function horseWarpRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();

  const fail = (message: string) => redirect(`/horses/${String(horseId)}?warp_error=${encodeURIComponent(message)}`);

  // Re-planned here rather than trusted from the page that drew the button: a tick may have run
  // since, and the horse may already be grown.
  const plan = planTimeWarp(horse, ctx.world.game_day, ctx.config.values);
  if (!plan) return fail(`${displayNameFor(horse)} is already grown up.`);

  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.time_warp) return fail(turnsRefusalMessage(ctx));
  if (!canTakeOnCost(ownerStable.balance) || ownerStable.balance < plan.cost) {
    return fail(`${ownerStable.name} has ${String(ownerStable.balance)} and growing a horse up costs ${String(plan.cost)}. Win a show, sell a horse, or ask a grown-up to add money first.`);
  }

  await ctx.env.DB.batch(buildTimeWarpStatements(ctx.env, { horse, horseName: displayNameFor(horse), days: plan.days, cost: plan.cost, gameDay: ctx.world.game_day }));
  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.time_warp);

  return redirect(`/horses/${String(horseId)}?warped=1`);
}

/**
 * /horses/:id/retire - slice 0011 §6.1-§6.4. Owner-only, the same notFound()-for-a-non-owner shape
 * every horse-scoped route in this file uses. A horse that is already dead or removed 404s rather
 * than rendering a confirmation for an action already taken. Spends no turn (§6.4) and moves no
 * money (§3.3) - the shared exit path (src/db/ageing.ts) does the rest.
 */
export async function horseRetireRoute(ctx: RequestContext, method: string, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable || ownerStable.account_id !== ctx.account!.id) return notFound();
  if (horse.status !== 'alive') return notFound();

  const hasFoundingOffer = await hasWaitingFoundingOffer(ctx.env, ownerStable.id);
  const ageYears = (ctx.world.game_day - horse.born_game_day) / ctx.config.values.game_days_per_year;

  const render = async (error?: string) => {
    const warnings = await buildRetireWarnings(ctx, horse);
    return htmlResponse(
      renderRetireConfirmPage({
        world: ctx.world,
        isAdmin: ctx.account!.is_admin === 1,
        actionsLeft: actionsLeftFor(ctx),
        gameDaysPerYear: ctx.config.values.game_days_per_year,
        ownerStable,
        hasFoundingOffer,
        horse,
        ageYears,
        warnings,
        error,
      })
    );
  };

  if (method === 'GET') return render();
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.confirm !== 'yes') return render("Tick the box to confirm - retiring a horse away can't be undone.");

  await ctx.env.DB.batch([
    ...buildEndHorseParticipationStatements(ctx.env, {
      horseId,
      sex: horse.sex,
      gameDay: ctx.world.game_day,
      status: 'removed',
      endReason: 'retired_away',
    }),
    // Slice 0017 §7.4: in the same batch as the horse's own status change, so no `status = 'open'`
    // race can leave a live listing pointing at a retired horse.
    ...buildWithdrawListingsForHorseStatement(ctx.env, horseId, ctx.world.game_day),
    // Slice 0017 §13 (Part D): same reasoning, for a stud listing.
    ...buildWithdrawStudListingsForHorseStatement(ctx.env, horseId, ctx.world.game_day),
  ]);

  return redirect(`/stables/${String(ownerStable.id)}/horses`);
}
