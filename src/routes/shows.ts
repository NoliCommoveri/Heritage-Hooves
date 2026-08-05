import type { RequestContext } from '../lib/context';
import { actionsLeftFor, turnsRefusalMessage } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { ACTION_COSTS } from '../lib/actions';
import { spendAction, getAccountById } from '../db/accounts';
import {
  renderShowsIndexPage,
  renderShowPage,
  renderEntryResultPage,
  eligibilityMessage,
  type ShowPageClassView,
  type EntryResultTraitRow,
} from '../render/shows';
import { displayNameFor } from '../render/horses';
import {
  listOpenShows,
  getShow,
  getShowClass,
  getShowClassesForShow,
  listClassEntriesForDisplay,
  getEntryFull,
  enterHorseInClass,
  checkHorseEligibilityForClass,
  classMatchesShowsFilter,
  classHasPlayerEntry,
  listRecentJudgedShowsFiltered,
  type ShowClassRow,
  type ShowsFilterParams,
} from '../db/shows';
import { getJudgeById } from '../db/judges';
import { getBreeds, type BreedRow } from '../db/breeds';
import { getEnabledDisciplines } from '../db/disciplines';
import { getHorse, listStableHorses } from '../db/horses';
import { getStableById, listStablesForAccount } from '../db/stables';
import { getConformationTraits, getAbilityTraits } from '../db/quantitativeTraits';

function breedNameFor(breeds: BreedRow[], breedId: number | null): string {
  return breeds.find((b) => b.id === breedId)?.name ?? 'that breed';
}

function nameForEntry(row: { registered_name: string | null; barn_name: string | null; sex: 'mare' | 'stallion' | 'gelding' }): string {
  if (row.registered_name) return row.registered_name;
  if (row.barn_name) return row.barn_name;
  return row.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt';
}

/** A missing or empty `breed` param must parse as "no breed filter" (null), not breed id 0 -
 * `Number(null)` and `Number('')` both evaluate to 0, so an absent/blank param has to be caught
 * before Number() ever sees it, or "All breeds" silently filters every class out (breed_id is
 * never 0, and a discipline class's breed_id is NULL, which also fails `!== 0`). Exported as its
 * own pure function so this parsing rule can be unit tested without a request or a database. */
export function parseBreedIdParam(raw: string | null): number | null {
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : null;
}

/** Slice 0016 §5.1: parses `class`/`breed` off the query string, validated against the disciplines
 * actually enabled - an unrecognised class tab reads as 'all' (Part A's "a filter is not an
 * assertion" applies here too). breed is only meaningful for 'all'/'conformation' - a discipline
 * class never carries a breed_id (§5.1's "mutually exclusive by construction"). Slice 0025 stage 3
 * adds 'young' (young_conformation + ability_test together, classMatchesShowsFilter's own rule) -
 * no breed picker on that tab, since half of what it shows (ability_test) has no breed_id at all. */
async function resolveShowsFilter(ctx: RequestContext): Promise<ShowsFilterParams> {
  const params = new URL(ctx.request.url).searchParams;
  const rawClass = params.get('class') ?? 'all';
  const disciplines = await getEnabledDisciplines(ctx.env);
  const classType =
    rawClass === 'all' || rawClass === 'conformation' || rawClass === 'young' || disciplines.some((d) => d.code === rawClass) ? rawClass : 'all';
  const usesBreed = classType === 'all' || classType === 'conformation';
  const breedId = usesBreed ? parseBreedIdParam(params.get('breed')) : null;
  return { classType, breedId };
}

/**
 * Slice 0016 §5.2/§5.3: every class of one show that passes the class-type/breed filter AND (for a
 * judged class only - item 8, §5.3) has at least one player entry. Shared by every place a show's
 * classes are listed (the next-show card, the recent-results card, the show page itself) so the
 * same show can never appear in one view with a different set of classes in another.
 */
async function loadVisibleClasses(
  ctx: RequestContext,
  showId: number,
  filter: ShowsFilterParams
): Promise<{ cls: ShowClassRow; judge: Awaited<ReturnType<typeof getJudgeById>>; entries: Awaited<ReturnType<typeof listClassEntriesForDisplay>> }[]> {
  const allClasses = await getShowClassesForShow(ctx.env, showId);
  const matching = allClasses.filter((c) => classMatchesShowsFilter(c, filter));
  const out: { cls: ShowClassRow; judge: Awaited<ReturnType<typeof getJudgeById>>; entries: Awaited<ReturnType<typeof listClassEntriesForDisplay>> }[] = [];
  for (const cls of matching) {
    const [judge, entries] = await Promise.all([getJudgeById(ctx.env, cls.judge_id), listClassEntriesForDisplay(ctx.env, cls.id)]);
    if (cls.status === 'judged' && !entries.some((e) => e.is_npc === 0)) continue;
    out.push({ cls, judge, entries });
  }
  return out;
}

export async function showsIndexRoute(ctx: RequestContext): Promise<Response> {
  const breeds = await getBreeds(ctx.env);
  const disciplines = await getEnabledDisciplines(ctx.env);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const filter = await resolveShowsFilter(ctx);

  // Slice 0025 stage 4 §7.5a: classes are minted on demand now, so more than one show can be open
  // for entries at once (a family showing in Barrels and in Dressage the same week gets two open
  // shows, not one that happens to hold both). openShows lists every one of them rather than
  // assuming there is only ever "the next show" - a show with no class matching the current filter
  // is dropped, same as the old single-nextShow card was skipped entirely in that case.
  const openShowRows = await listOpenShows(ctx.env, 50);
  const openShows = (
    await Promise.all(
      openShowRows.map(async (show) => {
        const visibleClasses = await loadVisibleClasses(ctx, show.id, filter);
        return { show, visibleClasses };
      })
    )
  )
    .filter(({ visibleClasses }) => visibleClasses.length > 0)
    .map(({ show, visibleClasses }) => ({
      show,
      classes: visibleClasses.map(({ cls, judge, entries }) => ({
        cls,
        judge,
        breedName: breedNameFor(breeds, cls.breed_id),
        entryCount: entries.length,
        minAgeYears: Math.round(cls.min_age_game_days / gameDaysPerYear),
      })),
    }));

  const recentShowRows = await listRecentJudgedShowsFiltered(ctx.env, ctx.config.values.shows_recent_count, filter);
  const recentShows = await Promise.all(
    recentShowRows.map(async (show) => ({
      show,
      classes: (await loadVisibleClasses(ctx, show.id, filter)).map(({ cls, judge, entries }) => {
        const winner = entries.find((e) => e.placing === 1);
        return { cls, judge, breedName: breedNameFor(breeds, cls.breed_id), winnerName: winner ? nameForEntry(winner) : null };
      }),
    }))
  );

  const eligibleBreeds = breeds.filter((b) => b.ideal_vector !== null);

  return htmlResponse(
    renderShowsIndexPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      openShows,
      recentShows,
      classType: filter.classType,
      breedId: filter.breedId,
      disciplines: disciplines.map((d) => ({ code: d.code, name: d.name })),
      eligibleBreeds,
    })
  );
}

/** The logged-in account's own horses eligible to enter one class, across every stable it owns -
 * §8.1's "a form to enter one of your eligible horses". Ineligible horses are counted, not
 * individually explained here; a per-horse reason lives on that horse's own page instead. */
async function loadAccountEligibility(
  ctx: RequestContext,
  cls: ShowClassRow
): Promise<{ eligible: { horseId: number; name: string }[]; ineligibleCount: number }> {
  const stables = await listStablesForAccount(ctx.env, ctx.account!.id);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const eligible: { horseId: number; name: string }[] = [];
  let ineligibleCount = 0;

  for (const stable of stables) {
    const horses = await listStableHorses(ctx.env, stable.id);
    for (const horse of horses) {
      const result = await checkHorseEligibilityForClass(ctx.env, cls, horse, ctx.world.game_day, gameDaysPerYear, ctx.config);
      if (result.ok) eligible.push({ horseId: horse.id, name: displayNameFor(horse) });
      else ineligibleCount++;
    }
  }
  return { eligible, ineligibleCount };
}

async function buildClassViews(ctx: RequestContext, showId: number, breeds: BreedRow[], filter: ShowsFilterParams): Promise<ShowPageClassView[]> {
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const visible = await loadVisibleClasses(ctx, showId, filter);

  return Promise.all(
    visible.map(async ({ cls, judge, entries: entryRows }) => {
      const entries = entryRows.map((e) => ({ ...e, name: nameForEntry(e) }));
      const view: ShowPageClassView = {
        cls,
        judge,
        breedName: breedNameFor(breeds, cls.breed_id),
        minAgeYears: Math.round(cls.min_age_game_days / gameDaysPerYear),
        entries,
      };
      if (cls.status === 'scheduled') {
        const { eligible, ineligibleCount } = await loadAccountEligibility(ctx, cls);
        view.eligibleHorses = eligible;
        view.ineligibleCount = ineligibleCount;
      }
      return view;
    })
  );
}

export async function showRoute(ctx: RequestContext, method: string, showId: number): Promise<Response> {
  const show = await getShow(ctx.env, showId);
  if (!show) return notFound();
  const isAdmin = ctx.account!.is_admin === 1;
  const actionsLeft = actionsLeftFor(ctx);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const breeds = await getBreeds(ctx.env);
  // §5.2: the same filter helper the /shows list uses - a show opened from a filtered link (or a
  // bare /shows/:id, which defaults to 'all') never disagrees with what the list just showed.
  const filter = await resolveShowsFilter(ctx);

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('entered') ? 'Entered.' : undefined;
    return htmlResponse(
      renderShowPage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, show, classes: await buildClassViews(ctx, show.id, breeds, filter), notice })
    );
  }
  if (method !== 'POST') return notFound();

  const form = await parseForm(ctx.request);
  if (form.action !== 'enter') return notFound();

  const classId = Number(form.class_id);
  const horseId = Number(form.horse_id);
  const horse = await getHorse(ctx.env, horseId);
  const ownerStable = horse ? await getStableById(ctx.env, horse.owner_stable_id) : null;

  if (!horse || !ownerStable || ownerStable.account_id !== ctx.account!.id) {
    return htmlResponse(
      renderShowPage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
        gameDaysPerYear,
        show,
        classes: await buildClassViews(ctx, show.id, breeds, filter),
        error: 'Choose one of your own horses.',
      })
    );
  }

  // Slice 0009 Part B §5.3: check, act, then spend - see the comment on the same pattern in
  // routes/horses.ts's stableBreedRoute.
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.enter_show) {
    return htmlResponse(
      renderShowPage({
        world: ctx.world,
        isAdmin,
        actionsLeft,
        gameDaysPerYear,
        show,
        classes: await buildClassViews(ctx, show.id, breeds, filter),
        error: turnsRefusalMessage(ctx),
      })
    );
  }

  const result = await enterHorseInClass(ctx.env, {
    classId,
    horseId,
    gameDay: ctx.world.game_day,
    gameDaysPerYear: ctx.config.values.game_days_per_year,
    conformationConfig: ctx.config.values,
    config: ctx.config,
  });

  if (!result.ok) {
    const cls = await getShowClass(ctx.env, classId);
    const minAgeYears = cls ? Math.round(cls.min_age_game_days / ctx.config.values.game_days_per_year) : 0;
    const message = `${displayNameFor(horse)} ${eligibilityMessage(result.reason, { breedName: breedNameFor(breeds, cls?.breed_id ?? null), minAgeYears })}`;
    return htmlResponse(
      renderShowPage({ world: ctx.world, isAdmin, actionsLeft, gameDaysPerYear, show, classes: await buildClassViews(ctx, show.id, breeds, filter), error: message })
    );
  }

  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.enter_show);
  return redirect(`/shows/${String(showId)}?entered=1`);
}

export async function showEntryResultRoute(ctx: RequestContext, showId: number, entryId: number): Promise<Response> {
  const full = await getEntryFull(ctx.env, entryId);
  if (!full || full.show.id !== showId) return notFound();
  const { entry, cls, show } = full;
  if (entry.placing === null || !entry.score_breakdown) return notFound();

  const horse = await getHorse(ctx.env, entry.horse_id);
  if (!horse) return notFound();

  // Slice 0016 §7.1: the entering stable is entry.entered_by_stable_id, not horse.owner_stable_id -
  // they agree today (there is no transfer path yet) but this is the field that actually means
  // "who entered this".
  const enteringStable = await getStableById(ctx.env, entry.entered_by_stable_id);
  if (!enteringStable) return notFound();

  const isAdmin = ctx.account!.is_admin === 1;
  // A player-owned horse's result is visible to its owner (or an admin) only - the same ownership
  // discipline every other horse-scoped page uses. The show barn's own results are visible to
  // anyone, since an NPC horse has no owning account to protect (§8.1's "no genotype it wouldn't
  // show a player" rule is about hidden traits, not about who can see a public placing).
  if (entry.is_npc === 0) {
    if (enteringStable.account_id !== ctx.account!.id && !isAdmin) return notFound();
  } else if (!(await classHasPlayerEntry(ctx.env, cls.id))) {
    // Item 8 (§5.3): a judged class nobody's own horse entered publishes no results at all -
    // including an NPC entry's own "Why?" breakdown.
    return notFound();
  }

  const ownerAccount = enteringStable.account_id !== null ? await getAccountById(ctx.env, enteringStable.account_id) : null;

  const judge = await getJudgeById(ctx.env, cls.judge_id);
  // Slice 0012 §9.1: an old row with no "kind" key reads as conformation (there is no such row
  // after the world reset, but the fallback costs nothing and matches the migration's own note).
  interface CareBreakdown {
    modifier: number;
    farrier_status: string;
    wellness_status: string;
  }

  interface AgeBreakdown {
    modifier: number;
    phase: 'prime' | 'past_peak' | 'floor';
    age_years: number;
  }

  const breakdown = JSON.parse(entry.score_breakdown) as
    | {
        kind?: 'conformation';
        traits: { code: string; expressed: number; target: number; weight: number; trait_score: number }[];
        weight_sum: number;
        raw_score: number;
        noise: number;
        final_score: number;
        care?: CareBreakdown;
        age?: AgeBreakdown;
      }
    | {
        kind: 'ability';
        traits: { code: string; expressed: number; weight: number; contribution: number }[];
        weight_sum: number;
        raw_score: number;
        noise: number;
        final_score: number;
        care?: CareBreakdown;
        age?: AgeBreakdown;
      };

  // Slice 0013 §8.4: named from the breakdown's own snapshot, not recomputed - a horse's care state
  // keeps moving after judging, and the whole point of the snapshot is that this note never changes.
  function careNoteFor(care: CareBreakdown): string | undefined {
    const notes: string[] = [];
    if (care.farrier_status === 'overdue') notes.push('shoes overdue');
    else if (care.farrier_status === 'fresh') notes.push('shoes freshly done');
    if (care.wellness_status === 'overdue') notes.push('wellness overdue');
    else if (care.wellness_status === 'fresh') notes.push('wellness freshly done');
    return notes.length ? notes.join(', ') : undefined;
  }
  const careNote = breakdown.care ? careNoteFor(breakdown.care) : undefined;

  // Slice 0014 §8.3: named from the breakdown's own snapshot, same discipline as careNoteFor -
  // never recomputed against the horse's current age, which keeps moving after judging.
  function ageNoteFor(age: AgeBreakdown): string | undefined {
    if (age.phase === 'prime') return undefined;
    return `${String(age.age_years)} years old`;
  }
  const ageNote = breakdown.age ? ageNoteFor(breakdown.age) : undefined;

  const traitRows = breakdown.kind === 'ability' ? await getAbilityTraits(ctx.env) : await getConformationTraits(ctx.env);
  const traits: EntryResultTraitRow[] =
    breakdown.kind === 'ability'
      ? breakdown.traits.map((t) => ({
          kind: 'ability' as const,
          name: traitRows.find((r) => r.code === t.code)?.name ?? t.code,
          expressed: t.expressed,
          weight: t.weight,
          contribution: t.contribution,
        }))
      : breakdown.traits.map((t) => ({
          kind: 'conformation' as const,
          name: traitRows.find((r) => r.code === t.code)?.name ?? t.code,
          expressed: t.expressed,
          target: t.target,
          weight: t.weight,
          traitScore: t.trait_score,
        }));

  return htmlResponse(
    renderEntryResultPage({
      world: ctx.world,
      isAdmin,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      show,
      cls,
      horseId: horse.id,
      horseName: displayNameFor(horse),
      stableId: enteringStable.id,
      stableName: enteringStable.name,
      stableIsNpc: enteringStable.is_npc === 1,
      ownerDisplayName: ownerAccount?.display_name ?? null,
      judge,
      placing: entry.placing,
      prizePaid: entry.prize_paid,
      traits,
      weightSum: breakdown.weight_sum,
      rawScore: breakdown.raw_score,
      noise: breakdown.noise,
      finalScore: breakdown.final_score,
      careModifierApplied: entry.care_modifier_applied,
      careNote,
      ageModifierApplied: entry.age_modifier_applied,
      ageNote,
    })
  );
}
