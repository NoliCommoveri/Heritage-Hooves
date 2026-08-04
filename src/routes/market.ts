// /market (slice 0017 §6/§7): the open listings, one listing, the sale itself, withdrawing, and the
// public sold list. Any logged-in account, no ownership required to look - the same shape /world
// and /shows already use.
//
// **Which stable buys.** /market is a global page and an account may hold several stables, so
// unlike every existing purchase in this codebase (a test, a farrier call - all reached through a
// horse, which names its own stable) a purchase here has to be told which of the buyer's stables is
// buying. The buy form carries a stable_id, re-checked server-side against the account like every
// other stable-scoped route, and collapses to a hidden field when the account has only one stable.
// The consequence for §6.1's "a row for a horse the viewing stable owns is marked yours": with no
// single viewing stable in scope, a row is marked yours when the *account* owns the selling stable.

import type { RequestContext } from '../lib/context';
import { actionsLeftFor, turnsRefusalMessage } from '../lib/context';
import { htmlResponse, redirect, notFound, parseForm } from '../lib/http';
import { ACTION_COSTS } from '../lib/actions';
import { spendAction } from '../db/accounts';
import { bucketFor } from '../lib/barnFilter';
import {
  renderMarketIndexPage,
  renderListingPage,
  renderSoldPage,
  renderOfferDetailPage,
  renderStudIndexPage,
  renderStudDetailPage,
  type MarketListingRow,
  type DisclosedCondition,
  type ListingDetailView,
  type BuyerStableOption,
  type MarketTab,
  type MarketOfferRow,
  type OfferDetailView,
  type EligibleHorseOption,
  type StudListRow,
  type StudTab,
  type StudListingDetailView,
  type EligibleMareOption,
} from '../render/market';
import { getListing, listOpenListings, listSoldListings, sellListing, withdrawListing, type OpenListingRow } from '../db/listings';
import { getHorse, horseDisplayName, countAliveHorses, listStableHorses, type HorseRow } from '../db/horses';
import { getStableById, listStablesForAccount } from '../db/stables';
import { getBreeds, type BreedRow } from '../db/breeds';
import { getDisciplines } from '../db/disciplines';
import { getEnabledConditions, getKnowledgeForHorse } from '../db/health';
import { getShowSummary, listRecentResultsForHorse, listOpenEntriesForHorse } from '../db/shows';
import { getActivePregnancyForMare } from '../db/pregnancies';
import { getBookedCoveringForMare } from '../db/coverings';
import {
  listActiveBuyOffers,
  getActiveBuyOffer,
  offerWantsLabel,
  criteriaLabel,
  parseCriteria,
  evaluateOfferForHorse,
  buyerRefusalForOffer,
  sellIntoOffer,
  type ActiveBuyOfferView,
} from '../db/buyOffers';
import {
  listActiveStudListings,
  getStudListing,
  withdrawStudListing,
  bookingsThisSeasonCount,
  validateStudBooking,
  bookStud,
  type OpenStudListingRow,
} from '../db/stud';
import { describeHorseRow } from './horses';
import { placingText } from '../render/shows';
import { formatCalendarDate } from '../lib/calendar';

const SOLD_LIST_LIMIT = 40;

function ageLabelFor(bornGameDay: number, gameDay: number, gameDaysPerYear: number): string {
  const years = (gameDay - bornGameDay) / gameDaysPerYear;
  return years < 1 ? 'under a year' : `${String(Math.floor(years))} years`;
}

/** slice 0017 §12 (Part C): one offer, resolved into the plain-English row the Offers tab shows. */
function buildOfferRow(ctx: RequestContext, offer: ActiveBuyOfferView, breedById: Map<number, BreedRow>, disciplineNameByCode: Map<string, string>): MarketOfferRow {
  const criteria = parseCriteria(offer.criteria);
  return {
    offerId: offer.id,
    buyerStableId: offer.stable_id,
    buyerStableName: offer.buyer_stable_name,
    wantsLabel: offerWantsLabel(offer, breedById, disciplineNameByCode),
    criteriaLabel: criteriaLabel(criteria, ctx.config.values.game_days_per_year),
    maxPrice: offer.max_price,
  };
}

export async function marketIndexRoute(ctx: RequestContext): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams;
  const rawShow = params.get('show');
  // Slice 0016 §4.1's rule, reused: a filter is not an assertion - an unrecognised tab reads as
  // 'all' rather than 404ing.
  const activeTab: MarketTab =
    rawShow === 'mares' || rawShow === 'stallions' || rawShow === 'foals' || rawShow === 'geldings' || rawShow === 'yours' || rawShow === 'offers'
      ? rawShow
      : 'all';
  const rawBreed = Number(params.get('breed'));
  const breedId = Number.isInteger(rawBreed) && rawBreed > 0 ? rawBreed : null;
  const cfg = ctx.config.values;

  // §12: the Offers tab is a wholly different query (buy_offers, not listings) - branch before
  // touching listOpenListings at all, the same shape /market/sold's own separate route follows.
  if (activeTab === 'offers') {
    const [offers, breeds, disciplines] = await Promise.all([listActiveBuyOffers(ctx.env), getBreeds(ctx.env), getDisciplines(ctx.env)]);
    const breedById = new Map(breeds.map((b) => [b.id, b]));
    const disciplineNameByCode = new Map(disciplines.map((d) => [d.code, d.name]));
    const offerRows = offers.map((o) => buildOfferRow(ctx, o, breedById, disciplineNameByCode));
    return htmlResponse(
      renderMarketIndexPage({
        world: ctx.world,
        isAdmin: ctx.account!.is_admin === 1,
        actionsLeft: actionsLeftFor(ctx),
        gameDaysPerYear: cfg.game_days_per_year,
        rows: [],
        activeTab,
        breedId: null,
        breeds: [],
        offers: offerRows,
        notice: params.get('notice') ?? undefined,
        error: params.get('error') ?? undefined,
      })
    );
  }

  const [listings, breeds] = await Promise.all([listOpenListings(ctx.env, breedId), getBreeds(ctx.env)]);

  // §6.1: the Yours tab is the account's own open listings, each with a Withdraw control; every
  // other tab is the barn list's own bucket rule, reused rather than re-expressed as SQL.
  const isMine = (sellerAccountId: number | null) => sellerAccountId !== null && sellerAccountId === ctx.account!.id;
  const filtered =
    activeTab === 'all'
      ? listings
      : activeTab === 'yours'
        ? listings.filter((l) => isMine(l.seller_account_id))
        : listings.filter((l) => bucketFor(l, ctx.world.game_day, cfg.foal_max_age_game_days) === activeTab);

  const rows: MarketListingRow[] = filtered.map((l) => ({
    listingId: l.id,
    horseId: l.horse_id,
    name: horseDisplayName(l),
    breedName: breeds.find((b) => b.id === l.breed_id)?.name ?? (l.is_cross ? 'Cross' : 'Unknown'),
    colourPhrase: describeHorseRow(l, ctx.world.game_day, cfg.game_days_per_year, cfg.pattern_penetrance),
    ageLabel: ageLabelFor(l.born_game_day, ctx.world.game_day, cfg.game_days_per_year),
    sex: l.sex,
    price: l.price,
    sellerStableId: l.seller_stable_id,
    sellerStableName: l.seller_stable_name,
    isMine: isMine(l.seller_account_id),
    expiresGameDay: l.expires_game_day,
  }));

  // Only breeds that actually have something on the market - a picker offering a breed with no
  // listings behind it is a control that can only ever produce an empty page.
  const breedIdsOnMarket = new Set(listings.map((l) => l.breed_id));
  const pickerBreeds = breeds.filter((b) => breedIdsOnMarket.has(b.id)).map((b) => ({ id: b.id, name: b.name }));

  return htmlResponse(
    renderMarketIndexPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: cfg.game_days_per_year,
      rows,
      activeTab,
      breedId,
      breeds: pickerBreeds,
      notice: params.get('notice') ?? undefined,
      error: params.get('error') ?? undefined,
    })
  );
}

/**
 * §2.3/§6.2: one row per condition the game tests for, carrying the SELLER's result or "not
 * tested". Reads horse_knowledge - what the seller has paid to learn - and never horse_conditions
 * or horses.genotype, which is what is true. A seller cannot hide a result they hold, and cannot
 * let silence read as clear.
 */
async function disclosedConditionsFor(ctx: RequestContext, sellerStableId: number, horseId: number): Promise<DisclosedCondition[]> {
  // Slice 0022 Part A: the twelve acquired incidents live in their own table now and carry no
  // horse_knowledge row at all (§2.7) - a listing's open/past incidents are a different disclosure,
  // not this genotype-test one - and getEnabledConditions already returns genetics-only rows.
  const [conditions, knowledge] = await Promise.all([getEnabledConditions(ctx.env), getKnowledgeForHorse(ctx.env, sellerStableId, horseId)]);
  return conditions.map((c) => {
    const known = knowledge.find((k) => k.kind === 'genotype' && k.subject_code === c.code);
    return {
      name: c.name,
      teachingText: c.teaching_text,
      result: known ? known.result : null,
      testedGameDay: known ? known.tested_game_day : null,
    };
  });
}

/**
 * §2.6: the pregnancy, the covering and the unjudged entry, each named by name and by date, so
 * nobody presses buy without knowing what they are also buying. "A child who did not realise they
 * were buying a pregnancy is a family argument."
 *
 * Built fresh on every render rather than cached, since it must still be true the moment the button
 * is actually pressed - the same shape buildRetireWarnings uses for the same reason.
 */
export async function comesWithSentences(ctx: RequestContext, horse: HorseRow): Promise<string[]> {
  const out: string[] = [];
  const gameDaysPerYear = ctx.config.values.game_days_per_year;
  const name = horseDisplayName(horse);
  const object = horse.sex === 'mare' ? 'her' : 'him';

  if (horse.sex === 'mare') {
    const pregnancy = await getActivePregnancyForMare(ctx.env, horse.id);
    if (pregnancy) {
      const sire = await getHorse(ctx.env, pregnancy.sire_id);
      out.push(
        `${name} is in foal to ${sire ? horseDisplayName(sire) : 'a stallion'}, due about ${formatCalendarDate(pregnancy.due_game_day, gameDaysPerYear)} (game day ${String(pregnancy.due_game_day)}). The foal will be born in your barn, under your prefix, and is yours to keep.`
      );
    }
    const covering = await getBookedCoveringForMare(ctx.env, horse.id);
    if (covering) {
      const stallion = await getHorse(ctx.env, covering.stallion_id);
      out.push(
        `${name} is booked to ${stallion ? horseDisplayName(stallion) : 'a stallion'} and has not been covered yet. The booking comes with ${object} - whether it takes or not, you will be the one told.`
      );
    }
  }

  for (const entry of await listOpenEntriesForHorse(ctx.env, horse.id)) {
    out.push(`${name} is entered in ${entry.className}, not yet judged. That entry comes with ${object}, and so does any prize money it wins.`);
  }
  return out;
}

/** The account's own stables as buyer options, with the two numbers §7.1 steps 5 and 6 check. */
async function buyerOptionsFor(ctx: RequestContext, excludeStableId: number): Promise<BuyerStableOption[]> {
  const stables = await listStablesForAccount(ctx.env, ctx.account!.id);
  return Promise.all(
    stables
      .filter((s) => s.id !== excludeStableId)
      .map(async (s) => ({ id: s.id, name: s.name, balance: s.balance, freeStalls: s.capacity - (await countAliveHorses(ctx.env, s.id)) }))
  );
}

async function buildListingView(ctx: RequestContext, listing: OpenListingRow, horse: HorseRow, isMine: boolean): Promise<ListingDetailView> {
  const cfg = ctx.config.values;
  const [breeds, conditions, comesWith, summary, recentRaw, sire, dam] = await Promise.all([
    getBreeds(ctx.env),
    disclosedConditionsFor(ctx, listing.seller_stable_id, horse.id),
    comesWithSentences(ctx, horse),
    getShowSummary(ctx.env, horse.id),
    listRecentResultsForHorse(ctx.env, horse.id, 5),
    horse.sire_id ? getHorse(ctx.env, horse.sire_id) : Promise.resolve(null),
    horse.dam_id ? getHorse(ctx.env, horse.dam_id) : Promise.resolve(null),
  ]);

  const breederStable = horse.breeder_stable_id ? await getStableById(ctx.env, horse.breeder_stable_id) : null;
  const bredByLabel = horse.breeder_prefix
    ? breederStable
      ? `${horse.breeder_prefix} (${breederStable.name})`
      : `${horse.breeder_prefix} (a founding stable, not one in this game)`
    : 'a founding stable (unbred stock)';

  return {
    listingId: listing.id,
    horseId: horse.id,
    name: horseDisplayName(horse),
    breedName: breeds.find((b) => b.id === horse.breed_id)?.name ?? (horse.is_cross ? 'Cross' : 'Unknown'),
    description: describeHorseRow(horse, ctx.world.game_day, cfg.game_days_per_year, cfg.pattern_penetrance),
    sex: horse.sex,
    ageLabel: ageLabelFor(horse.born_game_day, ctx.world.game_day, cfg.game_days_per_year),
    imageUrl: horse.image_url,
    bredByLabel,
    sellerStableId: listing.seller_stable_id,
    sellerStableName: listing.seller_stable_name,
    sire: sire ? { id: sire.id, name: horseDisplayName(sire) } : null,
    dam: dam ? { id: dam.id, name: horseDisplayName(dam) } : null,
    starts: summary?.starts ?? 0,
    wins: summary?.wins ?? 0,
    bestPlacingText: summary?.best_placing != null ? placingText(summary.best_placing) : 'none yet',
    recentResults: recentRaw.map((r) => `${placingText(r.placing)} at ${r.show_name} (${formatCalendarDate(r.scheduled_game_day, cfg.game_days_per_year)})`),
    price: listing.price,
    expiresGameDay: listing.expires_game_day,
    conditions,
    comesWith,
    isMine,
  };
}

export async function listingPageRoute(ctx: RequestContext, listingId: number): Promise<Response> {
  const listing = await getListing(ctx.env, listingId);
  if (!listing) return notFound();
  const horse = await getHorse(ctx.env, listing.horse_id);
  if (!horse) return notFound();

  // A closed listing (sold, withdrawn, expired) is not a page anybody needs - the sold list is the
  // public record of a completed sale, and a withdrawn one is nobody's business.
  if (listing.status !== 'open') return redirect('/market');

  const isMine = listing.seller_account_id !== null && listing.seller_account_id === ctx.account!.id;
  const buyerOptions = isMine ? [] : await buyerOptionsFor(ctx, listing.seller_stable_id);
  const params = new URL(ctx.request.url).searchParams;
  const requested = Number(params.get('stable'));
  const selected = buyerOptions.find((o) => o.id === requested) ?? buyerOptions.find((o) => o.id === ctx.account!.last_active_stable_id) ?? buyerOptions[0];

  const view = await buildListingView(ctx, listing, horse, isMine);
  const refusal = isMine ? undefined : buyRefusal(ctx, view, selected, horse);

  return htmlResponse(
    renderListingPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      listing: view,
      buyerOptions,
      selectedBuyerStableId: selected?.id ?? null,
      refusal,
      error: params.get('error') ?? undefined,
    })
  );
}

/**
 * §7.1's refusals as plain sentences, each naming the horse - the page-side half of the same rules
 * the POST re-checks. Both call this, so the button and the refusal can never disagree (the same
 * shape turnOutBlockedReason uses in src/routes/horses.ts).
 *
 * Note step 5 is stricter than canTakeOnCost: that helper is the debt rule ("a stable in the red
 * may not expand") and it still applies, but a purchase additionally needs the money actually in
 * hand. A stable at 0 with a positive balance rule passing is still not a stable that can spend
 * 4,000.
 */
function buyRefusal(ctx: RequestContext, view: ListingDetailView, buyer: BuyerStableOption | undefined, horse: HorseRow): string | undefined {
  if (horse.status !== 'alive') return `${view.name} is no longer alive, so this listing can't be bought.`;
  if (!buyer) return 'You have no other stable that could buy this horse. Make one from your stables page first.';
  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.buy_horse) return turnsRefusalMessage(ctx);
  if (buyer.balance - view.price < 0) {
    return `${buyer.name} has ${String(buyer.balance)} and ${view.name} costs ${String(view.price)}. Win a show, sell a horse, or ask a grown-up to add money first.`;
  }
  if (buyer.freeStalls <= 0) return `${buyer.name} doesn't have room for another horse. Turning one out to pasture doesn't free a stall - the horse is still yours.`;
  return undefined;
}

export async function listingBuyRoute(ctx: RequestContext, listingId: number): Promise<Response> {
  const form = await parseForm(ctx.request);
  const back = (message: string) => redirect(`/market/${String(listingId)}?error=${encodeURIComponent(message)}`);

  // §7.1 step 1: the listing is still open, and has not expired against today's game day. Checked
  // before anything else, since every other refusal names a horse this listing may no longer be for.
  const listing = await getListing(ctx.env, listingId);
  if (!listing) return notFound();
  if (listing.status !== 'open') return back('That listing has already been closed - somebody else may have bought this one first.');
  if (listing.expires_game_day <= ctx.world.game_day) return back('That listing has run out and is no longer for sale.');

  const horse = await getHorse(ctx.env, listing.horse_id);
  if (!horse) return notFound();
  const horseName = horseDisplayName(horse);

  // §7.1 step 3: still alive, and still owned by the seller named on the listing.
  if (horse.status !== 'alive') return back(`${horseName} is no longer alive, so this listing can't be bought.`);
  if (horse.owner_stable_id !== listing.seller_stable_id) return back(`${horseName} doesn't belong to that stable anymore.`);

  // §7.1 step 2: the buyer is not the seller. A *different* stable under the same account can buy -
  // that is the intended trade route between two barns one child runs (overview §1a), and §2.2's
  // ledger flag rather than a refusal is what makes it visible.
  const buyerStableId = Number(form.stable_id);
  if (!Number.isInteger(buyerStableId)) return back('Choose which of your stables is buying.');
  if (buyerStableId === listing.seller_stable_id) return back('A stable cannot buy its own horse.');

  const buyerStable = await getStableById(ctx.env, buyerStableId);
  if (!buyerStable || buyerStable.account_id !== ctx.account!.id) return notFound();

  // §7.1 steps 4-6, re-derived server-side rather than trusted from the page that rendered the
  // button (the same discipline every other POST in this codebase uses).
  const view = await buildListingView(ctx, listing, horse, false);
  const buyerOption: BuyerStableOption = {
    id: buyerStable.id,
    name: buyerStable.name,
    balance: buyerStable.balance,
    freeStalls: buyerStable.capacity - (await countAliveHorses(ctx.env, buyerStable.id)),
  };
  const refusal = buyRefusal(ctx, view, buyerOption, horse);
  if (refusal) return back(refusal);

  const sellerStable = await getStableById(ctx.env, listing.seller_stable_id);
  if (!sellerStable) return notFound();

  const result = await sellListing(ctx.env, {
    listing,
    horseName,
    buyerStableId: buyerStable.id,
    buyerStableName: buyerStable.name,
    buyerAccountId: buyerStable.account_id,
    sellerStableId: sellerStable.id,
    sellerStableName: sellerStable.name,
    sellerAccountId: sellerStable.account_id,
    gameDay: ctx.world.game_day,
    commissionPercent: ctx.config.values.market_commission_percent,
  });

  // §7.3: two children can press buy on the same listing within the same second, and the route's
  // read-then-write has a gap between them. The batch's own WHERE clauses close it; a zero-row
  // result gets a real sentence, not a 500, and nothing was charged because the whole batch is one
  // transaction.
  if (!result.ok) return back(`Somebody else bought ${horseName} first - nothing was taken from your balance.`);

  // Slice 0009 Part B §5.3: check, act, then spend. A spend that loses a race is let through free
  // rather than charged for nothing.
  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.buy_horse);
  return redirect(`/horses/${String(horse.id)}`);
}

/** §7.4: free, no action, no event. Reachable from /market's own row and from the horse page. */
export async function listingWithdrawRoute(ctx: RequestContext, listingId: number): Promise<Response> {
  const listing = await getListing(ctx.env, listingId);
  if (!listing) return notFound();
  const sellerStable = await getStableById(ctx.env, listing.seller_stable_id);
  if (!sellerStable || sellerStable.account_id !== ctx.account!.id) return notFound();

  const form = await parseForm(ctx.request);
  await withdrawListing(ctx.env, listingId, listing.seller_stable_id, ctx.world.game_day);

  if (form.return_to === 'horse') return redirect(`/horses/${String(listing.horse_id)}?market_notice=${encodeURIComponent('Taken off the market.')}`);
  return redirect(`/market?notice=${encodeURIComponent('Taken off the market.')}`);
}

export async function marketSoldRoute(ctx: RequestContext): Promise<Response> {
  const rows = await listSoldListings(ctx.env, SOLD_LIST_LIMIT);
  return htmlResponse(
    renderSoldPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      rows: rows.map((r) => ({
        horseId: r.horse_id,
        name: horseDisplayName(r),
        price: r.price,
        sellerStableName: r.seller_stable_name,
        buyerStableName: r.buyer_stable_name ?? 'another stable',
        soldGameDay: r.sold_game_day ?? r.closed_game_day ?? 0,
      })),
    })
  );
}

// ---------------------------------------------------------------------------
// The standing offers board (slice 0017 §12, Part C)
// ---------------------------------------------------------------------------

function offerDetailView(offer: ActiveBuyOfferView, breedById: Map<number, BreedRow>, disciplineNameByCode: Map<string, string>, gameDaysPerYear: number): OfferDetailView {
  return {
    offerId: offer.id,
    buyerStableId: offer.stable_id,
    buyerStableName: offer.buyer_stable_name,
    wantsLabel: offerWantsLabel(offer, breedById, disciplineNameByCode),
    criteriaLabel: criteriaLabel(parseCriteria(offer.criteria), gameDaysPerYear),
    maxPrice: offer.max_price,
  };
}

/** Every alive horse across the account's own stables that currently fits this offer, scored and
 * sorted best-first - built fresh on every render (§2.6's own reasoning: it must still be true the
 * moment the button is pressed). A horse already on the open market is skipped: selling it into an
 * offer would need a second open listing on the same horse, which idx_listings_one_open_per_horse
 * refuses - withdraw it first is the honest answer, not a confusing failure at the sell step. */
async function eligibleHorsesForOffer(ctx: RequestContext, offer: ActiveBuyOfferView): Promise<EligibleHorseOption[]> {
  const stables = await listStablesForAccount(ctx.env, ctx.account!.id);
  const options: EligibleHorseOption[] = [];
  for (const stable of stables) {
    const [horses, openListings] = await Promise.all([listStableHorses(ctx.env, stable.id), listOpenListings(ctx.env, null)]);
    const listedHorseIds = new Set(openListings.filter((l) => l.seller_stable_id === stable.id).map((l) => l.horse_id));
    for (const horse of horses) {
      if (listedHorseIds.has(horse.id)) continue;
      const evaluation = await evaluateOfferForHorse(ctx.env, offer, horse, ctx.world.game_day, ctx.config);
      if (evaluation.eligible && evaluation.quality !== null) {
        options.push({ id: horse.id, stableId: stable.id, stableName: stable.name, name: horseDisplayName(horse), quality: evaluation.quality });
      }
    }
  }
  return options.sort((a, b) => b.quality - a.quality);
}

export async function offerDetailRoute(ctx: RequestContext, offerId: number): Promise<Response> {
  const offer = await getActiveBuyOffer(ctx.env, offerId);
  if (!offer) return redirect(`/market?show=offers&notice=${encodeURIComponent('That offer is no longer available.')}`);

  const [breeds, disciplines, eligible] = await Promise.all([getBreeds(ctx.env), getDisciplines(ctx.env), eligibleHorsesForOffer(ctx, offer)]);
  const breedById = new Map(breeds.map((b) => [b.id, b]));
  const disciplineNameByCode = new Map(disciplines.map((d) => [d.code, d.name]));
  const view = offerDetailView(offer, breedById, disciplineNameByCode, ctx.config.values.game_days_per_year);

  const params = new URL(ctx.request.url).searchParams;
  const requested = Number(params.get('horse'));
  const selected = eligible.find((h) => h.id === requested) ?? eligible[0];

  let refusal: string | undefined;
  if (eligible.length === 0) {
    refusal = 'None of your horses currently fit this offer - too young, the wrong breed, a gelding, or not yet scoring highly enough.';
  } else {
    const actionsLeft = actionsLeftFor(ctx);
    if (actionsLeft !== null && actionsLeft < ACTION_COSTS.sell_to_offer) {
      refusal = turnsRefusalMessage(ctx);
    } else {
      const buyerStable = await getStableById(ctx.env, offer.stable_id);
      refusal = buyerStable ? await buyerRefusalForOffer(ctx.env, buyerStable, offer.max_price) : 'That offer is no longer available.';
    }
  }

  return htmlResponse(
    renderOfferDetailPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      offer: view,
      eligibleHorses: eligible,
      selectedHorseId: selected?.id ?? null,
      refusal,
      error: params.get('error') ?? undefined,
    })
  );
}

export async function offerSellRoute(ctx: RequestContext, offerId: number): Promise<Response> {
  const form = await parseForm(ctx.request);
  const back = (message: string) => redirect(`/market/offers/${String(offerId)}?error=${encodeURIComponent(message)}`);

  const offer = await getActiveBuyOffer(ctx.env, offerId);
  if (!offer) return redirect(`/market?show=offers&notice=${encodeURIComponent('That offer is no longer available.')}`);

  const horseId = Number(form.horse_id);
  if (!Number.isInteger(horseId)) return back('Choose which horse you are selling.');
  const horse = await getHorse(ctx.env, horseId);
  if (!horse) return notFound();

  const sellerStable = await getStableById(ctx.env, horse.owner_stable_id);
  if (!sellerStable || sellerStable.account_id !== ctx.account!.id) return notFound();
  const horseName = horseDisplayName(horse);

  // Re-derived server-side rather than trusted from the page that rendered the button, the same
  // discipline listingBuyRoute already follows for a fixed-price sale.
  if (horse.status !== 'alive') return back(`${horseName} is no longer alive.`);

  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.sell_to_offer) return back(turnsRefusalMessage(ctx));

  const evaluation = await evaluateOfferForHorse(ctx.env, offer, horse, ctx.world.game_day, ctx.config);
  if (!evaluation.eligible) return back(evaluation.reasons[0] ?? `${horseName} doesn't fit this offer.`);

  const buyerStable = await getStableById(ctx.env, offer.stable_id);
  if (!buyerStable) return back('That offer is no longer available.');
  const buyerRefusal = await buyerRefusalForOffer(ctx.env, buyerStable, offer.max_price);
  if (buyerRefusal) return back(buyerRefusal);

  const result = await sellIntoOffer(ctx.env, {
    offer,
    horse,
    horseName,
    sellerStableId: sellerStable.id,
    sellerStableName: sellerStable.name,
    sellerAccountId: sellerStable.account_id,
    buyerStable,
    gameDay: ctx.world.game_day,
    config: ctx.config.values,
  });

  if (!result.ok) {
    if (result.error === 'already_listed') return back(`${horseName} is already on the market - withdraw that listing first.`);
    return back(`Somebody else bought this offer's spot first - nothing was taken from ${sellerStable.name}.`);
  }

  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.sell_to_offer);
  return redirect(`/horses/${String(horse.id)}`);
}

// ---------------------------------------------------------------------------
// Stud services (slice 0017 §13, Part D)
// ---------------------------------------------------------------------------

export async function studIndexRoute(ctx: RequestContext): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams;
  const activeTab: StudTab = params.get('show') === 'yours' ? 'yours' : 'all';
  const rawBreed = Number(params.get('breed'));
  const breedId = Number.isInteger(rawBreed) && rawBreed > 0 ? rawBreed : null;
  const cfg = ctx.config.values;

  const [listings, breeds] = await Promise.all([listActiveStudListings(ctx.env, breedId), getBreeds(ctx.env)]);

  const isMine = (stableAccountId: number | null) => stableAccountId !== null && stableAccountId === ctx.account!.id;
  const filtered = activeTab === 'yours' ? listings.filter((l) => isMine(l.stable_account_id)) : listings;

  const rows: StudListRow[] = filtered.map((l) => ({
    studListingId: l.id,
    stallionId: l.stallion_id,
    name: horseDisplayName({ ...l, sex: 'stallion' as const }),
    breedName: breeds.find((b) => b.id === l.breed_id)?.name ?? (l.is_cross ? 'Cross' : 'Unknown'),
    colourPhrase: describeHorseRow({ ...l, sex: 'stallion' as const }, ctx.world.game_day, cfg.game_days_per_year, cfg.pattern_penetrance),
    ageLabel: ageLabelFor(l.born_game_day, ctx.world.game_day, cfg.game_days_per_year),
    fee: l.fee,
    stableId: l.stable_id,
    stableName: l.stable_name,
    isMine: isMine(l.stable_account_id),
  }));

  const breedIdsOnList = new Set(listings.map((l) => l.breed_id));
  const pickerBreeds = breeds.filter((b) => breedIdsOnList.has(b.id)).map((b) => ({ id: b.id, name: b.name }));

  return htmlResponse(
    renderStudIndexPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: cfg.game_days_per_year,
      rows,
      activeTab,
      breedId,
      breeds: pickerBreeds,
      notice: params.get('notice') ?? undefined,
      error: params.get('error') ?? undefined,
    })
  );
}

async function buildStudListingView(ctx: RequestContext, listing: OpenStudListingRow, stallion: HorseRow, isMine: boolean): Promise<StudListingDetailView> {
  const cfg = ctx.config.values;
  const [breeds, conditions, summary, recentRaw, sire, dam, bookedThisSeason] = await Promise.all([
    getBreeds(ctx.env),
    disclosedConditionsFor(ctx, listing.stable_id, stallion.id),
    getShowSummary(ctx.env, stallion.id),
    listRecentResultsForHorse(ctx.env, stallion.id, 5),
    stallion.sire_id ? getHorse(ctx.env, stallion.sire_id) : Promise.resolve(null),
    stallion.dam_id ? getHorse(ctx.env, stallion.dam_id) : Promise.resolve(null),
    bookingsThisSeasonCount(ctx.env, listing.id, ctx.world.season_index),
  ]);

  const breederStable = stallion.breeder_stable_id ? await getStableById(ctx.env, stallion.breeder_stable_id) : null;
  const bredByLabel = stallion.breeder_prefix
    ? breederStable
      ? `${stallion.breeder_prefix} (${breederStable.name})`
      : `${stallion.breeder_prefix} (a founding stable, not one in this game)`
    : 'a founding stable (unbred stock)';

  return {
    studListingId: listing.id,
    stallionId: stallion.id,
    name: horseDisplayName(stallion),
    breedName: breeds.find((b) => b.id === stallion.breed_id)?.name ?? (stallion.is_cross ? 'Cross' : 'Unknown'),
    description: describeHorseRow(stallion, ctx.world.game_day, cfg.game_days_per_year, cfg.pattern_penetrance),
    ageLabel: ageLabelFor(stallion.born_game_day, ctx.world.game_day, cfg.game_days_per_year),
    imageUrl: stallion.image_url,
    bredByLabel,
    stableId: listing.stable_id,
    stableName: listing.stable_name,
    sire: sire ? { id: sire.id, name: horseDisplayName(sire) } : null,
    dam: dam ? { id: dam.id, name: horseDisplayName(dam) } : null,
    starts: summary?.starts ?? 0,
    wins: summary?.wins ?? 0,
    bestPlacingText: summary?.best_placing != null ? placingText(summary.best_placing) : 'none yet',
    recentResults: recentRaw.map((r) => `${placingText(r.placing)} at ${r.show_name} (${formatCalendarDate(r.scheduled_game_day, cfg.game_days_per_year)})`),
    fee: listing.fee,
    seasonCap: listing.season_cap,
    bookedThisSeason,
    conditions,
    isMine,
  };
}

/** Every alive mare across the viewer's own stables - not pre-filtered against §13.2's breeding
 * rules the way validateStudBooking checks a specific mare, since the picker's job is "which of my
 * mares", not "which of my mares happens to be eligible right now". The refusal, once one is
 * picked, is what teaches why. */
async function mareOptionsFor(ctx: RequestContext): Promise<EligibleMareOption[]> {
  const stables = await listStablesForAccount(ctx.env, ctx.account!.id);
  const options: EligibleMareOption[] = [];
  for (const stable of stables) {
    const horses = await listStableHorses(ctx.env, stable.id);
    for (const horse of horses) {
      if (horse.sex === 'mare') options.push({ id: horse.id, stableId: stable.id, stableName: stable.name, name: horseDisplayName(horse) });
    }
  }
  return options;
}

export async function studDetailRoute(ctx: RequestContext, studListingId: number): Promise<Response> {
  const listing = await getStudListing(ctx.env, studListingId);
  if (!listing) return notFound();
  const stallion = await getHorse(ctx.env, listing.stallion_id);
  if (!stallion) return notFound();
  if (listing.active !== 1) return redirect('/market/stud');

  const isMine = listing.stable_account_id !== null && listing.stable_account_id === ctx.account!.id;
  const mareOptions = isMine ? [] : await mareOptionsFor(ctx);
  const params = new URL(ctx.request.url).searchParams;
  const requested = Number(params.get('mare'));
  const selected = mareOptions.find((o) => o.id === requested) ?? mareOptions[0];

  const view = await buildStudListingView(ctx, listing, stallion, isMine);

  let refusal: string | undefined;
  if (!isMine) {
    if (mareOptions.length === 0) {
      refusal = 'You have no mare to book. Any of your own mares can be booked, once she is old enough and not already in foal or booked elsewhere.';
    } else {
      const mareStable = await getStableById(ctx.env, selected.stableId);
      const mare = await getHorse(ctx.env, selected.id);
      const actionsLeft = actionsLeftFor(ctx);
      if (actionsLeft !== null && actionsLeft < ACTION_COSTS.book_stud) {
        refusal = turnsRefusalMessage(ctx);
      } else if (!mareStable || !mare) {
        refusal = 'That mare is no longer available.';
      } else {
        refusal = await validateStudBooking(ctx.env, ctx.config, ctx.world.game_day, listing, ctx.world.season_index, mare, mareStable, stallion);
      }
    }
  }

  return htmlResponse(
    renderStudDetailPage({
      world: ctx.world,
      isAdmin: ctx.account!.is_admin === 1,
      actionsLeft: actionsLeftFor(ctx),
      gameDaysPerYear: ctx.config.values.game_days_per_year,
      listing: view,
      mareOptions,
      selectedMareId: selected?.id ?? null,
      refusal,
      error: params.get('error') ?? undefined,
    })
  );
}

export async function studBookRoute(ctx: RequestContext, studListingId: number): Promise<Response> {
  const form = await parseForm(ctx.request);
  const back = (message: string) => redirect(`/market/stud/${String(studListingId)}?error=${encodeURIComponent(message)}`);

  const listing = await getStudListing(ctx.env, studListingId);
  if (!listing) return notFound();
  if (listing.active !== 1) return back('This stallion is no longer standing at stud.');

  const stallion = await getHorse(ctx.env, listing.stallion_id);
  if (!stallion) return notFound();
  if (stallion.status !== 'alive' || stallion.owner_stable_id !== listing.stable_id) {
    return back(`${horseDisplayName(stallion)} doesn't belong to that stable anymore.`);
  }

  const mareId = Number(form.mare_id);
  if (!Number.isInteger(mareId)) return back('Choose which mare you are booking.');
  const mare = await getHorse(ctx.env, mareId);
  if (!mare) return notFound();
  const mareStable = await getStableById(ctx.env, mare.owner_stable_id);
  if (!mareStable || mareStable.account_id !== ctx.account!.id) return notFound();

  if (mareStable.id === listing.stable_id) return back('A stallion and mare in the same stable use the ordinary breeding page instead.');

  const actionsLeft = actionsLeftFor(ctx);
  if (actionsLeft !== null && actionsLeft < ACTION_COSTS.book_stud) return back(turnsRefusalMessage(ctx));

  const refusal = await validateStudBooking(ctx.env, ctx.config, ctx.world.game_day, listing, ctx.world.season_index, mare, mareStable, stallion);
  if (refusal) return back(refusal);

  const stallionStable = await getStableById(ctx.env, listing.stable_id);
  if (!stallionStable) return notFound();

  await bookStud(ctx.env, {
    studListing: listing,
    mare,
    mareStableId: mareStable.id,
    mareStableName: mareStable.name,
    mareAccountId: mareStable.account_id,
    stallion,
    stallionStableId: stallionStable.id,
    stallionStableName: stallionStable.name,
    stallionAccountId: stallionStable.account_id,
    gameDay: ctx.world.game_day,
    tickSeq: ctx.world.tick_seq,
    seasonIndex: ctx.world.season_index,
    commissionPercent: ctx.config.values.market_commission_percent,
  });

  await spendAction(ctx.env, ctx.account!.id, ctx.world.tick_seq, ctx.config.values.actions_per_tick, ACTION_COSTS.book_stud);
  return redirect(`/horses/${String(mare.id)}`);
}

export async function studWithdrawRoute(ctx: RequestContext, studListingId: number): Promise<Response> {
  const listing = await getStudListing(ctx.env, studListingId);
  if (!listing) return notFound();
  const stable = await getStableById(ctx.env, listing.stable_id);
  if (!stable || stable.account_id !== ctx.account!.id) return notFound();

  const form = await parseForm(ctx.request);
  await withdrawStudListing(ctx.env, studListingId, listing.stable_id, ctx.world.game_day);

  if (form.return_to === 'horse') return redirect(`/horses/${String(listing.stallion_id)}?stud_notice=${encodeURIComponent('Taken off stud.')}`);
  return redirect(`/market/stud?notice=${encodeURIComponent('Taken off stud.')}`);
}
