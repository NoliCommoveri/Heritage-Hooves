// /world (slice 0016 §6): a read-only section any logged-in account can see, regardless of
// ownership. See CLAUDE.md's slice 0016 entry and this file's own comment on buildPublicHorseView
// for the line between what is public (§2.2 - "if you could learn it standing at the rail") and
// what stays the owner's (a measured number, a test result, a genotype).

import type { RequestContext } from '../lib/context';
import { actionsLeftFor } from '../lib/context';
import { htmlResponse, notFound } from '../lib/http';
import { renderWorldIndexPage, renderWorldStablePage, renderWorldHorsePage, type WorldStableListRow, type WorldRosterHorse, type PublicHorseView } from '../render/world';
import { describeHorseRow } from './horses';
import { removedHorseLabel } from '../render/horses';
import { placingText, buildShowResultGroups, SHOW_RESULT_FETCH_LIMIT, type ShowResultGroup } from '../render/shows';
import { listStablesForWorld, getStableById } from '../db/stables';
import { countAliveHorsesByStable, getHorse, listStableHorses, horseDisplayName, type HorseRow } from '../db/horses';
import { getBreedById } from '../db/breeds';
import { getShowSummary, listRecentResultsForHorse, horseClassRanksMap, highestRanksForHorses, type HorseHighestRank } from '../db/shows';
import { getOpenListingForHorse } from '../db/listings';

export async function worldIndexRoute(ctx: RequestContext): Promise<Response> {
  const [stables, horseCounts] = await Promise.all([listStablesForWorld(ctx.env), countAliveHorsesByStable(ctx.env)]);

  const rows: WorldStableListRow[] = stables.map((s) => ({
    id: s.id,
    name: s.name,
    prefix: s.prefix,
    isNpc: s.is_npc === 1,
    ownerDisplayName: s.owner_display_name,
    horseCount: horseCounts.get(s.id) ?? 0,
    balance: s.balance,
    isMine: s.is_npc === 0 && s.account_id === ctx.account!.id,
  }));

  return htmlResponse(
    renderWorldIndexPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      stables: rows,
    })
  );
}

/** Slice 0008's own ribbon-count badge, reused here (§6.3: "the ribbon badge from getShowSummary"). */
function ribbonBadge(summary: { starts: number; wins: number; best_placing: number | null } | null): string | null {
  if (!summary || summary.starts === 0) return null;
  return `${String(summary.wins)} win${summary.wins === 1 ? '' : 's'}, best ${placingText(summary.best_placing)}`;
}

export async function worldStableRoute(ctx: RequestContext, stableId: number): Promise<Response> {
  const stable = await getStableById(ctx.env, stableId);
  if (!stable || stable.active !== 1) return notFound();

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const horses = await listStableHorses(ctx.env, stableId);

  const rows: WorldRosterHorse[] = await Promise.all(
    horses.map(async (h) => ({
      id: h.id,
      name: horseDisplayName(h),
      description: describeHorseRow(h, ctx.world.game_day, gameDaysPerYear, ctx.config.values.pattern_penetrance),
      imageUrl: h.image_url,
      ribbon: ribbonBadge(await getShowSummary(ctx.env, h.id)),
    }))
  );

  return htmlResponse(
    renderWorldStablePage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      stable: {
        id: stable.id,
        name: stable.name,
        prefix: stable.prefix,
        isNpc: stable.is_npc === 1,
        balance: stable.balance,
        capacity: stable.capacity,
        aliveHorseCount: rows.length,
      },
      horses: rows,
    })
  );
}

/**
 * Slice 0016 §6.6: assembles the one view object render/world.ts's horse page is allowed to see.
 * Pure - no database access of its own, only already-resolved inputs - so it is testable without a
 * database (test/world.test.ts) and so a future field can only reach the render layer by being
 * added here explicitly, never by widening a spread. `horse` is typed to the narrow public subset
 * of HorseRow on purpose: passing the full row in is fine (structural typing), but this function's
 * own body can never read a field - coi, genotype, care state - that isn't named in that subset.
 */
// end_reason joins the list so /world can say "Went to a pet home" rather than calling every ended
// horse "Retired away" - the same wording the owner's own screens use (removedHorseLabel).
export type PublicHorseSource = Pick<
  HorseRow,
  'id' | 'registered_name' | 'barn_name' | 'sex' | 'breeder_prefix' | 'image_url' | 'status' | 'location' | 'is_cross' | 'end_reason'
>;

export function buildPublicHorseView(params: {
  horse: PublicHorseSource;
  description: string;
  ageLabel: string;
  breedName: string | null;
  currentStable: { id: number; name: string };
  breederStableName: string | null;
  sire: { id: number; name: string } | null;
  dam: { id: number; name: string } | null;
  showSummary: { starts: number; wins: number; best_placing: number | null } | null;
  recentResultGroups: ShowResultGroup[];
  highestRank: HorseHighestRank | undefined;
  /** Slice 0017 §9: the open listing, if there is one. An asking price is public. */
  listing: { listingId: number; price: number } | null;
}): PublicHorseView {
  const h = params.horse;
  const bredByLabel = h.breeder_prefix
    ? params.breederStableName
      ? `${h.breeder_prefix} (${params.breederStableName})`
      : `${h.breeder_prefix} (a founding stable, not one in this game)`
    : 'a founding stable (unbred stock)';

  return {
    id: h.id,
    name: horseDisplayName(h),
    breedName: params.breedName,
    isCross: h.is_cross === 1,
    description: params.description,
    sex: h.sex,
    ageLabel: params.ageLabel,
    imageUrl: h.image_url,
    bredByLabel,
    currentStable: params.currentStable,
    sire: params.sire,
    dam: params.dam,
    starts: params.showSummary?.starts ?? 0,
    wins: params.showSummary?.wins ?? 0,
    bestPlacing: params.showSummary?.best_placing ?? null,
    recentResultGroups: params.recentResultGroups,
    highestRank: params.highestRank,
    statusLabel: h.status === 'dead' ? 'Died' : h.status === 'removed' ? removedHorseLabel(h.end_reason) : null,
    atPasture: h.status === 'alive' && h.location === 'pasture',
    listing: params.listing,
  };
}

export async function worldHorseRoute(ctx: RequestContext, horseId: number): Promise<Response> {
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();
  const ownerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!ownerStable) return notFound();

  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const ageYears = (ctx.world.game_day - horse.born_game_day) / gameDaysPerYear;
  const ageLabel = ageYears < 1 ? 'under a year' : `${String(Math.floor(ageYears))} years`;
  const description = describeHorseRow(horse, ctx.world.game_day, gameDaysPerYear, ctx.config.values.pattern_penetrance);

  const breed = horse.breed_id ? await getBreedById(ctx.env, horse.breed_id) : undefined;
  const breederStable = horse.breeder_stable_id ? await getStableById(ctx.env, horse.breeder_stable_id) : null;

  const [sireRow, damRow] = await Promise.all([
    horse.sire_id ? getHorse(ctx.env, horse.sire_id) : Promise.resolve(null),
    horse.dam_id ? getHorse(ctx.env, horse.dam_id) : Promise.resolve(null),
  ]);

  const [showSummary, recentResultsRaw, currentRanks, highestRanks, listingRow] = await Promise.all([
    getShowSummary(ctx.env, horseId),
    listRecentResultsForHorse(ctx.env, horseId, SHOW_RESULT_FETCH_LIMIT),
    horseClassRanksMap(ctx.env, horseId),
    highestRanksForHorses(ctx.env, [horseId]),
    getOpenListingForHorse(ctx.env, horseId),
  ]);
  const recentResultGroups = buildShowResultGroups(recentResultsRaw, gameDaysPerYear, currentRanks);

  const view: PublicHorseView = buildPublicHorseView({
    horse,
    description,
    ageLabel,
    breedName: breed ? breed.name : horse.is_cross ? 'Cross' : null,
    currentStable: { id: ownerStable.id, name: ownerStable.name },
    breederStableName: breederStable ? breederStable.name : null,
    sire: sireRow ? { id: sireRow.id, name: horseDisplayName(sireRow) } : null,
    dam: damRow ? { id: damRow.id, name: horseDisplayName(damRow) } : null,
    showSummary,
    recentResultGroups,
    highestRank: highestRanks.get(horseId),
    listing: listingRow ? { listingId: listingRow.id, price: listingRow.price } : null,
  });

  return htmlResponse(
    renderWorldHorsePage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear,
      horse: view,
    })
  );
}
