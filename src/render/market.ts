// The market's screens (slice 0017 §6). Routes do all the loading and resolve every id into a name
// before calling here - these functions only template what they're given, the same split every
// other render/ file follows.
//
// **Two rules this file must not break.** A listing shows the seller's health results and the
// horse's show record, and **no measured number and no genotype** (§2.4) - slice 0016 §2.2's
// "what a stranger at a show could see" rule is broken exactly once, for health, because §2.3 says
// disclosure is compulsory, and not again for conformation. And the guide value is the owner's
// alone (§2.7): it appears on the sell form and the owner's own horse page, never on /market,
// /market/:id or /world.

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import type { WorldRow } from '../db/world';
import { formatCalendarDate } from '../lib/calendar';
import type { BarnBucket } from '../lib/barnFilter';

export interface MarketListingRow {
  listingId: number;
  horseId: number;
  name: string;
  breedName: string;
  colourPhrase: string;
  ageLabel: string;
  sex: 'mare' | 'stallion' | 'gelding';
  price: number;
  sellerStableId: number;
  sellerStableName: string;
  /** True when the selling stable belongs to the viewing account - the row is marked and carries a
   * Withdraw control instead of a buy link. Account-level rather than stable-level because /market
   * is a global page with no single stable in scope; see the route's own comment. */
  isMine: boolean;
  expiresGameDay: number;
}

export type MarketTab = BarnBucket | 'all' | 'yours' | 'offers';

function marketTabs(activeTab: MarketTab, breedId: number | null): SafeHtml {
  const tabs: { key: MarketTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'mares', label: 'Mares' },
    { key: 'stallions', label: 'Stallions' },
    { key: 'foals', label: 'Foals' },
    { key: 'geldings', label: 'Geldings' },
    { key: 'yours', label: 'Yours' },
    { key: 'offers', label: 'Offers' },
  ];
  const href = (key: string): string => {
    const qs = new URLSearchParams({ show: key });
    if (breedId !== null) qs.set('breed', String(breedId));
    return `/market?${qs.toString()}`;
  };
  return html`
    <nav class="subnav">
      ${tabs.map((t) => html`<a href="${href(t.key)}" class="${t.key === activeTab ? 'subnav-link is-active' : 'subnav-link'}">${t.label}</a>`)}
      <a href="/market/sold" class="subnav-link">Sold</a>
      <a href="/market/stud" class="subnav-link">Stud</a>
    </nav>`;
}

/** The shows page's breed picker, reused rather than reinvented (§6.1) - a plain GET form, no
 * JavaScript (build log, 2 Aug 2026). Only rendered when two or more breeds actually have a horse
 * on the market; with one, it is a control with nothing to choose. */
function breedPicker(activeTab: string, breedId: number | null, breeds: { id: number; name: string }[]): SafeHtml {
  if (breeds.length < 2) return raw('');
  return html`
    <form method="get" action="/market">
      <input type="hidden" name="show" value="${activeTab}">
      <label>Breed
        <select name="breed">
          <option value="" ${breedId === null ? raw('selected') : raw('')}>All breeds</option>
          ${breeds.map((b) => html`<option value="${String(b.id)}" ${b.id === breedId ? raw('selected') : raw('')}>${b.name}</option>`)}
        </select>
      </label>
      <button type="submit">Show</button>
    </form>`;
}

/** slice 0017 §12 (Part C): one row of the Offers tab - an NPC stable's standing demand, in plain
 * English, with nothing to click but "Look" (the offer detail page is where a horse is picked). */
export interface MarketOfferRow {
  offerId: number;
  buyerStableId: number;
  buyerStableName: string;
  /** e.g. "Quarter Horses" or "Barrel Racing prospects" - src/db/buyOffers.ts's offerWantsLabel. */
  wantsLabel: string;
  /** e.g. "a mare or a stallion (not a gelding), at least 3 years old, scoring at least 50 against
   * what this stable is breeding for" - src/db/buyOffers.ts's criteriaLabel. */
  criteriaLabel: string;
  maxPrice: number;
}

function offersTable(offers: MarketOfferRow[]): SafeHtml {
  if (offers.length === 0) return html`<p>No NPC stable is buying right now. Check back later - offers come and go with each stable's own capacity and balance.</p>`;
  return html`
    <table>
      <thead><tr><th>Buyer</th><th>Wants</th><th>Looking for</th><th>Pays up to</th><th></th></tr></thead>
      <tbody>
        ${offers.map(
          (o) => html`
          <tr>
            <td><a href="/world/stables/${String(o.buyerStableId)}">${o.buyerStableName}</a></td>
            <td>${o.wantsLabel}</td>
            <td>${o.criteriaLabel}</td>
            <td>${String(o.maxPrice)}</td>
            <td><a href="/market/offers/${String(o.offerId)}">Look</a></td>
          </tr>`
        )}
      </tbody>
    </table>`;
}

export function renderMarketIndexPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  rows: MarketListingRow[];
  activeTab: MarketTab;
  breedId: number | null;
  breeds: { id: number; name: string }[];
  /** Only populated (and only rendered) when activeTab is 'offers' (slice 0017 §12). */
  offers?: MarketOfferRow[];
  notice?: string;
  error?: string;
}): SafeHtml {
  if (params.activeTab === 'offers') {
    const body = html`
      <h1>Market</h1>
      ${errorBox(params.error)}
      ${noticeBox(params.notice)}
      <p class="muted">What NPC stables are standing ready to buy right now, and the most each will pay. Sell into one straight from the offer's own page - no listing, no waiting.</p>
      ${marketTabs(params.activeTab, params.breedId)}
      ${offersTable(params.offers ?? [])}
      <p><a href="/market/sold">What has sold recently</a></p>
    `;
    return pageShell({
      title: 'Market',
      world: params.world,
      loggedIn: true,
      isAdmin: params.isAdmin,
      actionsLeft: params.actionsLeft,
      gameDaysPerYear: params.gameDaysPerYear,
      body,
    });
  }

  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td><a href="/market/${String(r.listingId)}">${r.name}</a> ${r.isMine ? html`<span class="badge">yours</span>` : raw('')}</td>
      <td>${r.breedName}</td>
      <td>${r.colourPhrase}</td>
      <td>${r.ageLabel}</td>
      <td>${r.sex}</td>
      <td><a href="/world/stables/${String(r.sellerStableId)}">${r.sellerStableName}</a></td>
      <td>${String(r.price)}</td>
      <td>
        ${r.isMine
          ? html`
            <form method="post" action="/market/${String(r.listingId)}/withdraw">
              <input type="hidden" name="return_to" value="market">
              <button type="submit" class="secondary">Withdraw</button>
            </form>`
          : html`<a href="/market/${String(r.listingId)}">Look</a>`}
      </td>
    </tr>`
  );

  const body = html`
    <h1>Market</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <p class="muted">Every horse for sale right now, from every stable. Listing one of your own is free, and it stays yours until somebody buys it - you can still show it, breed it and feed it in the meantime.</p>
    ${marketTabs(params.activeTab, params.breedId)}
    ${breedPicker(params.activeTab, params.breedId, params.breeds)}
    ${rows.length
      ? html`
        <table>
          <thead><tr><th>Horse</th><th>Breed</th><th>Colour</th><th>Age</th><th>Sex</th><th>Stable</th><th>Price</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : html`<p>${params.activeTab === 'yours' ? "You haven't got anything on the market right now. Put a horse up from its own page." : 'Nothing is for sale here right now.'}</p>`}
    <p><a href="/market/sold">What has sold recently</a></p>
  `;
  return pageShell({
    title: 'Market',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

/** §2.3/§6.2: one row per condition the game tests for, each with the seller's result or "not
 * tested" - never one row per result the seller happens to hold. A list of three clear results with
 * two conditions silently absent reads to a nine-year-old as a clean bill of health, and it is not
 * one. This is the single most important rendering detail in the slice. */
export interface DisclosedCondition {
  name: string;
  teachingText: string;
  /** Null means the seller has never bought this test - rendered as loudly as a result. */
  result: 'clear' | 'carrier' | 'affected' | null;
  testedGameDay: number | null;
}

function disclosureBadge(result: DisclosedCondition['result']): SafeHtml {
  if (result === null) return html`<span class="badge badge-warning">Not tested</span>`;
  if (result === 'clear') return html`<span class="badge badge-success">Clear</span>`;
  if (result === 'carrier') return html`<span class="badge badge-warning">Carrier</span>`;
  return html`<span class="badge badge-danger">Affected</span>`;
}

/** Exported for slice 0017 Part D's stud listing detail page (renderStudDetailPage below), which
 * reuses this unchanged rather than a second copy of §2.3's "not tested is a displayed row" rule -
 * a mare owner deciding whether to book to a stallion needs the same disclosure a buyer does. */
export function healthPanel(conditions: DisclosedCondition[], gameDaysPerYear: number): SafeHtml {
  if (conditions.length === 0) return raw('');
  const untested = conditions.filter((c) => c.result === null).length;
  const nothingTested = untested === conditions.length;
  return html`
    <div class="card">
      <h2>What this seller has tested for</h2>
      <p class="muted">These are the seller's own test results - their paperwork, not the horse's biology. A horse that has not been tested for something might carry it and might not; nobody knows, including the seller.</p>
      ${nothingTested
        ? html`<p class="notice">This seller has not tested this horse for anything at all. Everything below is unknown, and buying is a gamble - you can test it yourself once it is yours.</p>`
        : raw('')}
      ${conditions.map(
        (c) => html`
        <div class="health-row">
          <p><strong>${c.name}:</strong> ${disclosureBadge(c.result)} ${c.testedGameDay !== null ? html`<span class="muted">(tested ${formatCalendarDate(c.testedGameDay, gameDaysPerYear)})</span>` : raw('')}</p>
          <p class="muted">${c.teachingText}</p>
        </div>`
      )}
    </div>`;
}

export interface ListingDetailView {
  listingId: number;
  horseId: number;
  name: string;
  breedName: string;
  description: string;
  sex: 'mare' | 'stallion' | 'gelding';
  ageLabel: string;
  imageUrl: string | null;
  bredByLabel: string;
  sellerStableId: number;
  sellerStableName: string;
  sire: { id: number; name: string } | null;
  dam: { id: number; name: string } | null;
  starts: number;
  wins: number;
  bestPlacingText: string;
  recentResults: string[];
  price: number;
  expiresGameDay: number;
  conditions: DisclosedCondition[];
  /** §2.6: what comes with her, named by name and by date before the button is pressed. Empty when
   * there is nothing - never an empty "None" row. */
  comesWith: string[];
  isMine: boolean;
}

export interface BuyerStableOption {
  id: number;
  name: string;
  balance: number;
  freeStalls: number;
}

export function renderListingPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  listing: ListingDetailView;
  /** The account's own stables, for the buyer picker. Empty when the viewer owns the listing. */
  buyerOptions: BuyerStableOption[];
  selectedBuyerStableId: number | null;
  /** A plain sentence saying why there is no buy button, or undefined when there is one (§6.2). */
  refusal?: string;
  error?: string;
}): SafeHtml {
  const l = params.listing;

  const portrait = l.imageUrl
    ? html`<img class="horse-portrait" src="${l.imageUrl}" width="480" alt="">`
    : html`<div class="horse-portrait horse-portrait--placeholder"><p>${l.name} - no picture chosen.</p></div>`;

  const pedigreeCell = (slot: { id: number; name: string } | null): SafeHtml =>
    slot ? html`<td><a href="/world/horses/${String(slot.id)}">${slot.name}</a></td>` : html`<td class="muted">unknown</td>`;

  const comesWithBlock = l.comesWith.length
    ? html`
      <div class="card">
        <h2>What comes with ${l.sex === 'mare' ? 'her' : 'him'}</h2>
        ${l.comesWith.map((s) => html`<p class="notice">${s}</p>`)}
      </div>`
    : raw('');

  const selected = params.buyerOptions.find((o) => o.id === params.selectedBuyerStableId) ?? params.buyerOptions[0];
  const balanceAfterLine = selected
    ? html`<p><strong>${selected.name}</strong> has ${String(selected.balance)} now, and would have <strong>${String(selected.balance - l.price)}</strong> after buying.</p>`
    : raw('');

  // A stable picker only when there is genuinely a choice to make - one stable submits a hidden
  // field instead, so nobody is asked to pick from a list of one.
  const stableField =
    params.buyerOptions.length > 1
      ? html`
        <label>Buying stable
          <select name="stable_id">
            ${params.buyerOptions.map(
              (o) => html`<option value="${String(o.id)}" ${o.id === selected?.id ? raw('selected') : raw('')}>${o.name} - ${String(o.balance)}, ${String(o.freeStalls)} free stall${o.freeStalls === 1 ? '' : 's'}</option>`
            )}
          </select>
        </label>`
      : selected
        ? html`<input type="hidden" name="stable_id" value="${String(selected.id)}">`
        : raw('');

  const buyBlock = l.isMine
    ? html`
      <div class="card">
        <p>This is your own horse. It stays yours - and fully yours to show, breed and feed - until somebody buys it.</p>
        <form method="post" action="/market/${String(l.listingId)}/withdraw">
          <input type="hidden" name="return_to" value="market">
          <button type="submit" class="secondary">Withdraw from the market</button>
        </form>
      </div>`
    : params.refusal
      ? html`<div class="card"><p class="notice">${params.refusal}</p></div>`
      : html`
        <div class="card">
          <h2>Buy ${l.name}</h2>
          ${balanceAfterLine}
          <p class="muted">Buying costs one turn. ${l.name}'s barn name is cleared when the horse changes hands - the registered name never changes - and the seller's test results come with ${l.sex === 'mare' ? 'her' : 'him'}.</p>
          <form method="post" action="/market/${String(l.listingId)}/buy">
            ${stableField}
            <button type="submit">Buy for ${String(l.price)}</button>
          </form>
        </div>`;

  const body = html`
    <h1>${l.name}</h1>
    ${errorBox(params.error)}
    <div class="card">
      ${portrait}
      <p>${l.description}</p>
      <p><strong>Asking price:</strong> ${String(l.price)}</p>
      <p><strong>Sex:</strong> ${l.sex} &middot; <strong>Age:</strong> ${l.ageLabel}</p>
      <p><strong>Breed:</strong> ${l.breedName}</p>
      <p><strong>Bred by:</strong> ${l.bredByLabel}</p>
      <p><strong>Selling stable:</strong> <a href="/world/stables/${String(l.sellerStableId)}">${l.sellerStableName}</a></p>
      <p class="muted">Listed until game day ${String(l.expiresGameDay)}.</p>
    </div>
    ${healthPanel(l.conditions, params.gameDaysPerYear)}
    ${comesWithBlock}
    <div class="card">
      <h2>Show record</h2>
      <p><strong>Starts:</strong> ${String(l.starts)} &middot; <strong>Wins:</strong> ${String(l.wins)} &middot; <strong>Best:</strong> ${l.bestPlacingText}</p>
      ${l.recentResults.length ? html`<ul>${l.recentResults.map((r) => html`<li>${r}</li>`)}</ul>` : raw('')}
      <p class="muted">A show record is the honest measure of a horse you do not own. An untested, unshown youngster is genuinely a gamble - that is what makes showing your own stock worth doing.</p>
    </div>
    <div class="card">
      <h2>Pedigree</h2>
      <table>
        <thead><tr><th>Sire</th><th>Dam</th></tr></thead>
        <tbody><tr>${pedigreeCell(l.sire)}${pedigreeCell(l.dam)}</tr></tbody>
      </table>
    </div>
    ${buyBlock}
    <p><a href="/market">Back to the market</a></p>
  `;
  return pageShell({
    title: l.name,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

/** slice 0017 §12 (Part C): one of the account's own horses that fits an offer's criteria - the
 * quality is shown so a player understands why the game thinks it qualifies, the same "teach, don't
 * just assert" reasoning the appraisal's own factors list follows (§4.5). */
export interface EligibleHorseOption {
  id: number;
  stableId: number;
  stableName: string;
  name: string;
  quality: number;
}

export interface OfferDetailView {
  offerId: number;
  buyerStableId: number;
  buyerStableName: string;
  wantsLabel: string;
  criteriaLabel: string;
  maxPrice: number;
}

/** The offer detail page: what a standing offer wants, and (for anyone who owns a horse that
 * fits) a picker to sell straight into it. No browsing period, no auction - the sale happens the
 * moment the button is pressed, same as any other fixed-price sale (§2.1). */
export function renderOfferDetailPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  offer: OfferDetailView;
  /** Every alive horse across the viewer's own stables that currently fits this offer's criteria -
   * built fresh on every render (§2.6's own reasoning: it must still be true the moment the button
   * is pressed). Empty means nobody currently has anything that qualifies. */
  eligibleHorses: EligibleHorseOption[];
  selectedHorseId: number | null;
  /** A plain sentence saying why there is no sell button right now (offer's buyer can't afford it,
   * or nothing of the viewer's qualifies), or undefined when there is one. */
  refusal?: string;
  error?: string;
}): SafeHtml {
  const o = params.offer;
  const selected = params.eligibleHorses.find((h) => h.id === params.selectedHorseId) ?? params.eligibleHorses[0];

  const horseField =
    params.eligibleHorses.length > 1
      ? html`
        <label>Which horse
          <select name="horse_id">
            ${params.eligibleHorses.map(
              (h) => html`<option value="${String(h.id)}" ${h.id === selected?.id ? raw('selected') : raw('')}>${h.name} (${h.stableName}) - scores ${String(Math.round(h.quality))}</option>`
            )}
          </select>
        </label>`
      : selected
        ? html`<input type="hidden" name="horse_id" value="${String(selected.id)}"><p>Selling <strong>${selected.name}</strong> (${selected.stableName}), which scores ${String(Math.round(selected.quality))} against what this stable is breeding for.</p>`
        : raw('');

  const sellBlock = params.refusal
    ? html`<div class="card"><p class="notice">${params.refusal}</p></div>`
    : html`
      <div class="card">
        <h2>Sell into this offer</h2>
        <p class="muted">Selling costs one turn. The barn name is cleared when the horse changes hands, and your own test results go with it, the same as any other sale.</p>
        <form method="post" action="/market/offers/${String(o.offerId)}/sell">
          ${horseField}
          <button type="submit">Sell for ${String(o.maxPrice)}</button>
        </form>
      </div>`;

  const body = html`
    <h1>${o.buyerStableName} wants ${o.wantsLabel}</h1>
    ${errorBox(params.error)}
    <div class="card">
      <p><strong>Buying stable:</strong> <a href="/world/stables/${String(o.buyerStableId)}">${o.buyerStableName}</a></p>
      <p><strong>Looking for:</strong> ${o.criteriaLabel}</p>
      <p><strong>Pays:</strong> ${String(o.maxPrice)}</p>
      <p class="muted">This is a standing offer, not a listing - there is nothing here to browse. Any horse of yours that fits can be sold into it instantly.</p>
    </div>
    ${sellBlock}
    <p><a href="/market?show=offers">Back to the offers board</a></p>
  `;
  return pageShell({
    title: `${o.buyerStableName}'s offer`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

export interface SoldRow {
  horseId: number;
  name: string;
  price: number;
  sellerStableName: string;
  buyerStableName: string;
  soldGameDay: number;
}

/** §6.4/§2.9: public to every logged-in player, because public prices are the only mechanism that
 * teaches a child what a horse is worth - and because §2.2's whole defence against a same-account
 * sale rests on a sale being visible to a sibling after the fact. Commission is deliberately not
 * shown: it is the seller's business and appears in their own ledger. */
export function renderSoldPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  rows: SoldRow[];
}): SafeHtml {
  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td><a href="/world/horses/${String(r.horseId)}">${r.name}</a></td>
      <td>${String(r.price)}</td>
      <td>${r.sellerStableName}</td>
      <td>${r.buyerStableName}</td>
      <td>${formatCalendarDate(r.soldGameDay, params.gameDaysPerYear)}</td>
    </tr>`
  );

  const body = html`
    <h1>Sold</h1>
    <p class="muted">Every horse that has changed hands, newest first. Everyone can see this - it is how you find out what a horse is actually worth.</p>
    ${rows.length
      ? html`
        <table>
          <thead><tr><th>Horse</th><th>Price</th><th>Sold by</th><th>Bought by</th><th>When</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : html`<p>Nothing has sold yet.</p>`}
    <p><a href="/market">Back to the market</a></p>
  `;
  return pageShell({
    title: 'Sold',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

// ---------------------------------------------------------------------------
// Stud services (slice 0017 §13, Part D)
// ---------------------------------------------------------------------------

export interface StudListRow {
  studListingId: number;
  stallionId: number;
  name: string;
  breedName: string;
  colourPhrase: string;
  ageLabel: string;
  fee: number;
  stableId: number;
  stableName: string;
  isMine: boolean;
}

export type StudTab = 'all' | 'yours';

function studTabs(activeTab: StudTab, breedId: number | null): SafeHtml {
  const href = (key: StudTab): string => {
    const qs = new URLSearchParams({ show: key });
    if (breedId !== null) qs.set('breed', String(breedId));
    return `/market/stud?${qs.toString()}`;
  };
  return html`
    <nav class="subnav">
      <a href="${href('all')}" class="${activeTab === 'all' ? 'subnav-link is-active' : 'subnav-link'}">All</a>
      <a href="${href('yours')}" class="${activeTab === 'yours' ? 'subnav-link is-active' : 'subnav-link'}">Yours</a>
      <a href="/market" class="subnav-link">Back to the market</a>
    </nav>`;
}

export function renderStudIndexPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  rows: StudListRow[];
  activeTab: StudTab;
  breedId: number | null;
  breeds: { id: number; name: string }[];
  notice?: string;
  error?: string;
}): SafeHtml {
  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td><a href="/market/stud/${String(r.studListingId)}">${r.name}</a> ${r.isMine ? html`<span class="badge">yours</span>` : raw('')}</td>
      <td>${r.breedName}</td>
      <td>${r.colourPhrase}</td>
      <td>${r.ageLabel}</td>
      <td><a href="/world/stables/${String(r.stableId)}">${r.stableName}</a></td>
      <td>${String(r.fee)}</td>
      <td>
        ${r.isMine
          ? html`
            <form method="post" action="/market/stud/${String(r.studListingId)}/withdraw">
              <input type="hidden" name="return_to" value="stud">
              <button type="submit" class="secondary">Withdraw</button>
            </form>`
          : html`<a href="/market/stud/${String(r.studListingId)}">Look</a>`}
      </td>
    </tr>`
  );

  const body = html`
    <h1>Stud</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <p class="muted">Every stallion standing at stud right now. Booking a mare to one costs one turn and the fee shown - neither horse ever changes hands, and there's no refund if the covering doesn't take, the same as breeding two horses in your own barn.</p>
    ${studTabs(params.activeTab, params.breedId)}
    ${breedPicker(params.activeTab, params.breedId, params.breeds)}
    ${rows.length
      ? html`
        <table>
          <thead><tr><th>Stallion</th><th>Breed</th><th>Colour</th><th>Age</th><th>Stable</th><th>Fee</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : html`<p>${params.activeTab === 'yours' ? "You haven't offered a stallion at stud right now. Do it from his own page." : 'No stallion is standing at stud right now.'}</p>`}
  `;
  return pageShell({
    title: 'Stud',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

export interface EligibleMareOption {
  id: number;
  stableId: number;
  stableName: string;
  name: string;
}

export interface StudListingDetailView {
  studListingId: number;
  stallionId: number;
  name: string;
  breedName: string;
  description: string;
  ageLabel: string;
  imageUrl: string | null;
  bredByLabel: string;
  stableId: number;
  stableName: string;
  sire: { id: number; name: string } | null;
  dam: { id: number; name: string } | null;
  starts: number;
  wins: number;
  bestPlacingText: string;
  recentResults: string[];
  fee: number;
  seasonCap: number;
  bookedThisSeason: number;
  conditions: DisclosedCondition[];
  isMine: boolean;
}

export function renderStudDetailPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  listing: StudListingDetailView;
  /** Every mare across the viewer's own stables that could plausibly be booked - built fresh on
   * every render, the same "must still be true the moment the button is pressed" reasoning
   * comesWithSentences already follows. Empty when the viewer owns the listing. */
  mareOptions: EligibleMareOption[];
  selectedMareId: number | null;
  /** A plain sentence saying why there is no book button, or undefined when there is one. */
  refusal?: string;
  error?: string;
}): SafeHtml {
  const l = params.listing;

  const portrait = l.imageUrl
    ? html`<img class="horse-portrait" src="${l.imageUrl}" width="480" alt="">`
    : html`<div class="horse-portrait horse-portrait--placeholder"><p>${l.name} - no picture chosen.</p></div>`;

  const pedigreeCell = (slot: { id: number; name: string } | null): SafeHtml =>
    slot ? html`<td><a href="/world/horses/${String(slot.id)}">${slot.name}</a></td>` : html`<td class="muted">unknown</td>`;

  const selected = params.mareOptions.find((o) => o.id === params.selectedMareId) ?? params.mareOptions[0];

  const mareField =
    params.mareOptions.length > 1
      ? html`
        <label>Which mare
          <select name="mare_id">
            ${params.mareOptions.map((o) => html`<option value="${String(o.id)}" ${o.id === selected?.id ? raw('selected') : raw('')}>${o.name} (${o.stableName})</option>`)}
          </select>
        </label>`
      : selected
        ? html`<input type="hidden" name="mare_id" value="${String(selected.id)}"><p>Booking <strong>${selected.name}</strong> (${selected.stableName}).</p>`
        : raw('');

  const bookBlock = l.isMine
    ? html`
      <div class="card">
        <p>${l.name} is standing at stud from your own barn. Booked ${String(l.bookedThisSeason)} of ${String(l.seasonCap)} this season.</p>
        <form method="post" action="/market/stud/${String(l.studListingId)}/withdraw">
          <input type="hidden" name="return_to" value="stud">
          <button type="submit" class="secondary">Take him off stud</button>
        </form>
      </div>`
    : params.refusal
      ? html`<div class="card"><p class="notice">${params.refusal}</p></div>`
      : html`
        <div class="card">
          <h2>Book a mare to ${l.name}</h2>
          <p class="muted">Booking costs one turn and takes the fee out of your stable's balance right away. Neither horse changes hands - she is covered next time she comes into season, and you'll be told whether it took. There is no refund if it doesn't.</p>
          <form method="post" action="/market/stud/${String(l.studListingId)}/book">
            ${mareField}
            <button type="submit">Book for ${String(l.fee)}</button>
          </form>
        </div>`;

  const body = html`
    <h1>${l.name}</h1>
    ${errorBox(params.error)}
    <div class="card">
      ${portrait}
      <p>${l.description}</p>
      <p><strong>Stud fee:</strong> ${String(l.fee)} &middot; <strong>Booked this season:</strong> ${String(l.bookedThisSeason)} of ${String(l.seasonCap)}</p>
      <p><strong>Age:</strong> ${l.ageLabel}</p>
      <p><strong>Breed:</strong> ${l.breedName}</p>
      <p><strong>Bred by:</strong> ${l.bredByLabel}</p>
      <p><strong>Standing at:</strong> <a href="/world/stables/${String(l.stableId)}">${l.stableName}</a></p>
    </div>
    ${healthPanel(l.conditions, params.gameDaysPerYear)}
    <div class="card">
      <h2>Show record</h2>
      <p><strong>Starts:</strong> ${String(l.starts)} &middot; <strong>Wins:</strong> ${String(l.wins)} &middot; <strong>Best:</strong> ${l.bestPlacingText}</p>
      ${l.recentResults.length ? html`<ul>${l.recentResults.map((r) => html`<li>${r}</li>`)}</ul>` : raw('')}
    </div>
    <div class="card">
      <h2>Pedigree</h2>
      <table>
        <thead><tr><th>Sire</th><th>Dam</th></tr></thead>
        <tbody><tr>${pedigreeCell(l.sire)}${pedigreeCell(l.dam)}</tr></tbody>
      </table>
    </div>
    ${bookBlock}
    <p><a href="/market/stud">Back to stud</a></p>
  `;
  return pageShell({
    title: l.name,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}
