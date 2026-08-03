import type { RequestContext } from '../lib/context';
import { actionsLeftFor, turnsRefusalMessage } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { ACTION_COSTS } from '../lib/actions';
import { spendAction } from '../db/accounts';
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
  getNextShow,
  listRecentJudgedShows,
  getShow,
  getShowClass,
  getShowClassesForShow,
  listClassEntriesForDisplay,
  getEntryFull,
  enterHorseInClass,
  checkHorseEligibilityForClass,
  type ShowClassRow,
} from '../db/shows';
import { getJudgeById } from '../db/judges';
import { getBreeds, type BreedRow } from '../db/breeds';
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

export async function showsIndexRoute(ctx: RequestContext): Promise<Response> {
  const breeds = await getBreeds(ctx.env);
  const gameDaysPerYear = ctx.config.values.game_days_per_year;

  const nextShowRow = await getNextShow(ctx.env);
  const nextShow = nextShowRow
    ? {
        show: nextShowRow,
        classes: await Promise.all(
          (await getShowClassesForShow(ctx.env, nextShowRow.id)).map(async (cls) => {
            const [judge, entries] = await Promise.all([getJudgeById(ctx.env, cls.judge_id), listClassEntriesForDisplay(ctx.env, cls.id)]);
            return {
              cls,
              judge,
              breedName: breedNameFor(breeds, cls.breed_id),
              entryCount: entries.length,
              minAgeYears: Math.round(cls.min_age_game_days / gameDaysPerYear),
            };
          })
        ),
      }
    : null;

  const recentShowRows = await listRecentJudgedShows(ctx.env, 6);
  const recentShows = await Promise.all(
    recentShowRows.map(async (show) => ({
      show,
      classes: await Promise.all(
        (await getShowClassesForShow(ctx.env, show.id)).map(async (cls) => {
          const [judge, entries] = await Promise.all([getJudgeById(ctx.env, cls.judge_id), listClassEntriesForDisplay(ctx.env, cls.id)]);
          const winner = entries.find((e) => e.placing === 1);
          return { cls, judge, breedName: breedNameFor(breeds, cls.breed_id), winnerName: winner ? nameForEntry(winner) : null };
        })
      ),
    }))
  );

  return htmlResponse(
    renderShowsIndexPage({ world: ctx.world, isAdmin: ctx.account!.is_admin === 1, actionsLeft: actionsLeftFor(ctx), nextShow, recentShows })
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

async function buildClassViews(ctx: RequestContext, showId: number, breeds: BreedRow[]): Promise<ShowPageClassView[]> {
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const classes = await getShowClassesForShow(ctx.env, showId);

  return Promise.all(
    classes.map(async (cls) => {
      const [judge, entryRows] = await Promise.all([getJudgeById(ctx.env, cls.judge_id), listClassEntriesForDisplay(ctx.env, cls.id)]);
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
  const breeds = await getBreeds(ctx.env);

  if (method === 'GET') {
    const notice = new URL(ctx.request.url).searchParams.get('entered') ? 'Entered.' : undefined;
    return htmlResponse(
      renderShowPage({ world: ctx.world, isAdmin, actionsLeft, show, classes: await buildClassViews(ctx, show.id, breeds), notice })
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
        show,
        classes: await buildClassViews(ctx, show.id, breeds),
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
        show,
        classes: await buildClassViews(ctx, show.id, breeds),
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
      renderShowPage({ world: ctx.world, isAdmin, actionsLeft, show, classes: await buildClassViews(ctx, show.id, breeds), error: message })
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

  const isAdmin = ctx.account!.is_admin === 1;
  // A player-owned horse's result is visible to its owner (or an admin) only - the same ownership
  // discipline every other horse-scoped page uses. The show barn's own results are visible to
  // anyone, since an NPC horse has no owning account to protect (§8.1's "no genotype it wouldn't
  // show a player" rule is about hidden traits, not about who can see a public placing).
  if (entry.is_npc === 0) {
    const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
    if (!ownerStable || (ownerStable.account_id !== ctx.account!.id && !isAdmin)) return notFound();
  }

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
      show,
      cls,
      horseName: displayNameFor(horse),
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
