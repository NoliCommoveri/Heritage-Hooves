import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import { horseDisplayName, type HorseRow } from '../db/horses';
import type { BreedRow, LocusRow } from '../db/breeds';
import type { Genotype } from '../engines/genetics/genotype';
import { LOCI } from '../engines/genetics/loci';
import { NO_PICTURE_VALUE, type ImageOption } from '../lib/images';
import type { ConformationDisplayRow } from '../engines/conformation/model';
import type { HorseShowSummaryRow } from '../db/shows';
import { placingText, showResultGroupsHtml, type ShowResultGroup } from './shows';
import type { ConditionRow } from '../db/health';
import type { AgeState } from '../engines/ageing/lifespan';
import type { AgeModifierResult } from '../engines/ageing/performance';
import { originStableFullName } from '../engines/founding/names';
import type { CareCardView, CareLineView, ManagementPlanRow } from '../db/care';
import type { WorkAvailability } from '../engines/care/location';
import type { CareStatus, FeedLevelDefinition } from '../engines/care/modifier';
import { formatCalendarDate } from '../lib/calendar';
import type { BarnBucket } from '../lib/barnFilter';
import type { OpenIncidentView, IncidentHistoryView } from '../db/incidents';
import { CONFORMATION_LABEL_TEXT, type ConformationLabel } from '../engines/conformation/labels';
import type { TraitCode } from '../engines/genetics/polygenic';
import type { MareIneligibility } from '../engines/breeding/eligibility';

export const displayNameFor = horseDisplayName;

/** A small thumbnail beside a barn-list row, or a neutral tile - slice 0007 §6.3. First thing to
 * drop if a heavy barn list ever becomes a problem (§4.3), which is why it's its own function
 * rather than folded into the card markup. */
function barnThumbnail(horse: HorseRow): SafeHtml {
  if (horse.image_url) {
    return html`<img class="horse-thumb" src="${horse.image_url}" width="96" loading="lazy" alt="">`;
  }
  return html`<span class="horse-thumb horse-thumb--placeholder" aria-hidden="true"></span>`;
}

/**
 * What to call a horse whose status is `removed`, in two words a child reads the same way on every
 * screen.
 *
 * It exists because the wording had drifted onto four screens independently and three of them were
 * wrong: the barn list, the horse's own page and /world all said "Retired away" for a horse that had
 * gone to a pet home, while the past-horses list (endedDescription, further down this file) said
 * "Went to a pet home". Same horse, same day, three different stories depending on which link a
 * child followed. One function now, so a fifth screen cannot invent a fourth answer.
 *
 * Only a horse with foals or a show record behind it is ever labelled at all - one with neither is
 * deleted outright when it leaves (src/db/horseRemoval.ts).
 */
export function removedHorseLabel(endReason: string | null): string {
  return endReason === 'pet_home' ? 'Went to a pet home' : 'Retired away';
}

/** Slice 0010 §8/slice 0011 §8.1: a small marker for a horse that is visibly affected (a
 * signs_visible condition its genotype reads as affected by, with no test needed - §2.4), dead, or
 * retired away. Kept to one glanceable badge, the same discipline this file's own comments already
 * apply to the compact conformation line and the show-record badge - the barn list is already dense. */
function healthBarnBadge(horse: HorseRow, visibleConditions: ConditionRow[]): SafeHtml {
  if (horse.status === 'dead') return html`<span class="badge badge-danger">Died</span>`;
  if (horse.status === 'removed') return html`<span class="badge">${removedHorseLabel(horse.end_reason)}</span>`;
  if (visibleConditions.length === 0) return raw('');
  return html`<span class="badge badge-warning">${visibleConditions.map((c) => c.name).join(', ')}</span>`;
}

/** Slice 0020 §8.3: the loudest badge in the barn list on purpose (§1 step 5) - "look at this now"
 * rather than "worth a look eventually", so it is placed first, ahead of even the health badge. */
function incidentBarnBadge(hasOpenIncident: boolean): SafeHtml {
  if (!hasOpenIncident) return raw('');
  return html`<span class="badge badge-danger">Needs the vet</span>`;
}

/** Slice 0011 §4.3/§8.1: the barn list's one-word Veteran/Failing marker - only ever shown for a
 * living horse's own two states, since an ended horse already gets healthBarnBadge's Died/Retired
 * away badge instead. */
function ageStateBarnBadge(state: AgeState): SafeHtml {
  if (state === 'veteran') return html`<span class="badge">Veteran</span>`;
  if (state === 'failing') return html`<span class="badge badge-warning">Failing</span>`;
  return raw('');
}

/** Slice 0013 §8.2: the barn list's small care badge - one word, the same visual weight as the
 * health and failing badges (never louder). Absent for a horse too young to need care, or one
 * already fresh on both timers. */
function careBarnBadge(care: CareCardView | null): SafeHtml {
  if (!care || care.tooYoung) return raw('');
  if (care.needsFarrier || care.needsWellness) return html`<span class="badge badge-warning">Care due</span>`;
  return raw('');
}

/** The location flag's barn-list marker. Neutral styling on purpose - turning a horse out is an
 * ordinary management decision, not a warning, and a child who put a horse at grass on purpose
 * should not see it flagged as if something were wrong. */
function locationBarnBadge(horse: HorseRow, availability: WorkAvailability | null): SafeHtml {
  if (horse.status !== 'alive' || !availability || availability.available) return raw('');
  if (availability.reason === 'at_pasture') return html`<span class="badge">At pasture</span>`;
  return html`<span class="badge">Settling in</span>`;
}

/** Slice 0014 §8.4: a quiet marker when the age modifier is below 1.0 - same place and weight as
 * the care badge, but never badge-warning. Being old is not neglect. Null for an ended horse,
 * mirroring careBarnBadge's own null-for-ended convention - the Died/Retired away badge already
 * covers it. */
function ageModifierBarnBadge(ageModifier: AgeModifierResult | null): SafeHtml {
  if (!ageModifier || ageModifier.phase === 'prime') return raw('');
  return html`<span class="badge">Past its peak</span>`;
}

const CARE_STATUS_LABEL: Record<CareStatus, string> = {
  not_yet: 'Not yet',
  fresh: 'Fresh',
  due_soon: 'Due soon',
  due: 'Due',
  overdue: 'Overdue',
  at_pasture: 'Not on the clock',
};

/** Slice 0013 §8.1: "next due in 12 days" / "overdue by 30 days" - daysUntilDue's own sign tells
 * which. 'due' reads as "due now" rather than "next due in 0 days". */
function careDueSentence(line: CareLineView): string {
  if (line.status === 'due') return 'due now';
  if (line.daysUntilDue >= 0) return `next due in ${String(line.daysUntilDue)} day${line.daysUntilDue === 1 ? '' : 's'}`;
  const overdueBy = Math.abs(line.daysUntilDue);
  return `overdue by ${String(overdueBy)} day${overdueBy === 1 ? '' : 's'}`;
}

/** Slice 0013 §8.1: the Care card, between Health and Show record. §2.3's discipline applies here
 * too - this card never touches the Conformation card's numbers, only its own modifier line. */
/** Slice 0014 §5.3/§8.2: one row per manageable condition the viewing stable is entitled to know
 * about - the section itself does not render at all when the list is empty, which is part of the
 * knowledge boundary (§5.1). Same page, same shape, same buttons as the farrier/wellness rows
 * above it - a button that either buys or renews, worded the same way the farrier row's "overdue"
 * language is, per §5.3's own instruction that vocabulary consistency here matters more than
 * variety. */
function managementSection(params: { plans: ManagementPlanRow[]; horseId: number; canManage: boolean }): SafeHtml {
  if (params.plans.length === 0) return raw('');

  const rows = params.plans.map((plan) => {
    const statusLine = plan.current
      ? html`<p><strong>${plan.conditionName}:</strong> managed, current until game day ${String(plan.managementUntilGameDay)}.</p>`
      : html`<p><strong>${plan.conditionName}:</strong> ${plan.managementUntilGameDay === null ? 'no plan on file' : 'overdue'}.</p>`;
    const button = params.canManage
      ? html`
        <form method="post" action="/horses/${String(params.horseId)}/care">
          <input type="hidden" name="condition_code" value="${plan.conditionCode}">
          <button type="submit" class="secondary">${plan.current ? 'Renew plan' : 'Start plan'} — ${String(plan.cost)}</button>
        </form>`
      : raw('');
    return html`
      ${statusLine}
      ${plan.managementText ? html`<p class="muted">${plan.managementText}</p>` : raw('')}
      ${button}`;
  });

  return html`
    <h3>Management</h3>
    ${rows}`;
}

function careCard(params: {
  care: CareCardView | null;
  feedLevelName: string;
  horseId: number;
  canManage: boolean;
  pronoun: string;
  careError?: string;
  careNotice?: string;
  managementPlans: ManagementPlanRow[];
}): SafeHtml {
  const c = params.care;
  if (!c) return raw('');

  if (c.tooYoung) {
    return html`
      <div class="card">
        <h2>Care</h2>
        ${errorBox(params.careError)}
        ${noticeBox(params.careNotice)}
        <p class="muted">Too young to need the farrier yet - care starts at three.</p>
      </div>`;
  }

  // At pasture the two timers are frozen and the modifier is exactly 1.00, so the ramp lines and
  // the call buttons would both be lies. One honest sentence instead. Management plans still run at
  // pasture (§5 has no location clause of its own), so that section still renders below.
  if (c.farrier.status === 'at_pasture') {
    return html`
      <div class="card">
        <h2>Care</h2>
        ${errorBox(params.careError)}
        ${noticeBox(params.careNotice)}
        <p class="muted">Out at pasture - no farrier or vet visits needed while ${params.pronoun} is turned out. The clock on both starts again when ${params.pronoun} comes in.</p>
        ${managementSection({ plans: params.managementPlans, horseId: params.horseId, canManage: params.canManage })}
      </div>`;
  }

  const modifierLine =
    c.modifier === 1
      ? raw('')
      : html`<p>Currently placing ${c.modifier > 1 ? 'slightly above' : 'slightly below'} normal (${c.modifier.toFixed(2)}).</p>`;

  const callButton = (service: 'farrier' | 'wellness', label: string, cost: number) =>
    params.canManage
      ? html`
        <form method="post" action="/horses/${String(params.horseId)}/care">
          <input type="hidden" name="service" value="${service}">
          <button type="submit" class="secondary">${label} — ${String(cost)}</button>
        </form>`
      : raw('');

  return html`
    <div class="card">
      <h2>Care</h2>
      ${errorBox(params.careError)}
      ${noticeBox(params.careNotice)}
      <p><strong>Shoes:</strong> ${CARE_STATUS_LABEL[c.farrier.status]} — ${careDueSentence(c.farrier)}</p>
      ${callButton('farrier', 'Call the farrier', c.farrier.cost)}
      <p><strong>Wellness:</strong> ${CARE_STATUS_LABEL[c.wellness.status]} — ${careDueSentence(c.wellness)}</p>
      ${callButton('wellness', 'Book a visit', c.wellness.cost)}
      <p><strong>Feed:</strong> ${params.feedLevelName} <span class="muted">(set for the whole barn)</span></p>
      ${modifierLine}
      ${managementSection({ plans: params.managementPlans, horseId: params.horseId, canManage: params.canManage })}
    </div>`;
}

/**
 * The location flag's own card, directly below Care because the two are read together: whether a
 * horse needs the farrier and whether it is even in the barn are one question in a child's head.
 *
 * Deliberately plain about the trade in both directions. Turning out says what it costs (no
 * breeding, no showing) before the button, not after; bringing in names the settling days left, so
 * "why can't I enter her?" is answered on the page that caused it rather than on the show page
 * three clicks away.
 */
function locationCard(params: {
  horse: HorseRow;
  availability: WorkAvailability | null;
  canManage: boolean;
  /** Set when turning out is refused for a reason the horse itself carries - today, a mare in foal
   * (the operator's rule 3). Rendered as the explanation in place of the button. */
  blockedReason?: string;
  error?: string;
}): SafeHtml {
  const h = params.horse;
  if (h.status !== 'alive' || !params.availability) return raw('');
  const subject = h.sex === 'mare' ? 'she' : 'he';
  const object = h.sex === 'mare' ? 'her' : 'him';
  const availability = params.availability;

  const button = (action: 'turn_out' | 'bring_in', label: string) =>
    params.canManage
      ? html`
        <form method="post" action="/horses/${String(h.id)}/location">
          <input type="hidden" name="action" value="${action}">
          <button type="submit" class="secondary">${label}</button>
        </form>`
      : raw('');

  if (availability.available) {
    return html`
      <div class="card">
        <h2>Where ${subject} is</h2>
        ${errorBox(params.error)}
        <p><strong>In the barn.</strong> ${subject[0].toUpperCase()}${subject.slice(1)} can be bred and shown, and needs the farrier and the vet as normal.</p>
        ${params.blockedReason
          ? html`<p class="muted">${params.blockedReason}</p>`
          : html`
            <p class="muted">Out at pasture ${object} would cost nothing to keep and need no farrier or vet - but ${subject} could not be bred or shown until brought back in and settled.</p>
            ${button('turn_out', 'Turn out to pasture')}`}
      </div>`;
  }

  if (availability.reason === 'at_pasture') {
    return html`
      <div class="card">
        <h2>Where ${subject} is</h2>
        ${errorBox(params.error)}
        <p><strong>Out at pasture.</strong> ${subject[0].toUpperCase()}${subject.slice(1)} is still growing up out there and costs nothing to keep, but cannot be bred or shown while ${subject} is turned out.</p>
        ${button('bring_in', `Bring ${object} in`)}
      </div>`;
  }

  const days = availability.daysRemaining;
  return html`
    <div class="card">
      <h2>Where ${subject} is</h2>
      ${errorBox(params.error)}
      <p><strong>Settling in.</strong> ${subject[0].toUpperCase()}${subject.slice(1)} came in from pasture and is getting back into work - ready to be bred or shown in ${String(days)} more day${days === 1 ? '' : 's'}.</p>
      <p class="muted">The farrier and the vet can come in the meantime, and board is being charged as normal.</p>
      ${button('turn_out', 'Turn back out to pasture')}
    </div>`;
}

/** Slice 0013 §8.2: the barn page's feed selector and the two round buttons, plus a one-line
 * summary ("3 due for the farrier · 1 due for a wellness visit") or nothing when the barn is
 * current. One click does the whole barn (§2.2) - no JavaScript anywhere in this codebase, so the
 * feed selector is a plain select-and-Save form, not an auto-submitting one. */
function careBarnControls(params: {
  stableId: number;
  feedLevels: Record<string, FeedLevelDefinition>;
  currentFeedLevel: string;
  careSummary: { farrierDue: number; wellnessDue: number };
  careError?: string;
  careNotice?: string;
  /** Slice 0016 §4.4: a hidden field on all four forms, so a care round or a feed save carries the
   * tab you were on back onto the redirect rather than always landing on All. */
  activeTab: string;
}): SafeHtml {
  const parts: string[] = [];
  if (params.careSummary.farrierDue > 0) parts.push(`${String(params.careSummary.farrierDue)} due for the farrier`);
  if (params.careSummary.wellnessDue > 0) parts.push(`${String(params.careSummary.wellnessDue)} due for a wellness visit`);
  const summaryLine = parts.length ? html`<p class="muted">${parts.join(' · ')}</p>` : raw('');

  const feedOptions = html`${Object.entries(params.feedLevels).map(
    ([key, def]) => html`<option value="${key}" ${key === params.currentFeedLevel ? raw('selected') : raw('')}>${def.name}</option>`
  )}`;

  const showField = html`<input type="hidden" name="show" value="${params.activeTab}">`;

  return html`
    <div class="card">
      ${errorBox(params.careError)}
      ${noticeBox(params.careNotice)}
      ${summaryLine}
      <form method="post" action="/stables/${String(params.stableId)}/care">
        <input type="hidden" name="service" value="farrier">
        ${showField}
        <button type="submit" class="secondary">Farrier round</button>
      </form>
      <form method="post" action="/stables/${String(params.stableId)}/care">
        <input type="hidden" name="service" value="wellness">
        ${showField}
        <button type="submit" class="secondary">Wellness round</button>
      </form>
      <form method="post" action="/stables/${String(params.stableId)}/care">
        <input type="hidden" name="service" value="management">
        ${showField}
        <button type="submit" class="secondary">Management round</button>
      </form>
      <form method="post" action="/stables/${String(params.stableId)}/feed">
        <label>Feed
          <select name="feed_level">${feedOptions}</select>
        </label>
        ${showField}
        <button type="submit">Save</button>
      </form>
    </div>`;
}

/** Slice 0017 §6.5: a horse with an open listing carries its asking price on the barn list - a
 * child listing eight horses needs to see at a glance which are up. Neutral styling: putting a horse
 * on the market is an ordinary decision, not a warning. */
function listingBarnBadge(price: number | null): SafeHtml {
  if (price === null) return raw('');
  return html`<span class="badge">For sale — ${String(price)}</span>`;
}

/**
 * Slice 0017 §6.3: the "Sell this horse" section, alongside the test, care, show-entry and
 * retire-away controls that already live on this page.
 *
 * **The guide value is shown here and to nobody else** (§2.7) - not on /market, not on /market/:id,
 * not on /world. It is advice: any price from 1 to market_max_price is accepted, no warning blocks a
 * submission, and finding out an over-priced horse does not sell is the lesson. The `factors` list
 * is what makes it teach something rather than assert a number.
 */
function sellCard(params: {
  horse: HorseRow;
  canManage: boolean;
  listing: { listingId: number; price: number; expiresGameDay: number } | null;
  guide: { value: number; factors: { label: string; detail: string }[]; qualityUnknown: boolean } | null;
  commissionPercent: number;
  error?: string;
  notice?: string;
}): SafeHtml {
  if (!params.canManage) return raw('');
  const h = params.horse;
  const object = h.sex === 'mare' ? 'her' : 'him';

  if (params.listing) {
    return html`
      <div class="card">
        <h2>On the market</h2>
        ${errorBox(params.error)}
        ${noticeBox(params.notice)}
        <p><a href="/market/${String(params.listing.listingId)}">Listed for ${String(params.listing.price)}</a>, until game day ${String(params.listing.expiresGameDay)}.</p>
        <p class="muted">${displayNameFor(h)} is still completely yours until somebody buys ${object} - show ${object}, breed ${object}, call the farrier, turn ${object} out. A listing is an advert, not a deposit.</p>
        <form method="post" action="/market/${String(params.listing.listingId)}/withdraw">
          <input type="hidden" name="return_to" value="horse">
          <button type="submit" class="secondary">Take off the market</button>
        </form>
      </div>`;
  }

  const guide = params.guide;
  const guideBlock = guide
    ? html`
      ${guide.qualityUnknown
        ? html`<p class="notice">We can't judge conformation for this breed yet, so this is a rough guess based on age, health and show record.</p>`
        : raw('')}
      <p><strong>What we reckon ${object} is worth:</strong> ${String(guide.value)}</p>
      <ul>${guide.factors.map((f) => html`<li><strong>${f.label}:</strong> ${f.detail}</li>`)}</ul>
      <p class="muted">That is our guess, not a rule. Ask whatever you like - if nobody buys, nothing is lost but the wait.</p>`
    : raw('');

  return html`
    <div class="card">
      <h2>Sell this horse</h2>
      ${errorBox(params.error)}
      ${noticeBox(params.notice)}
      ${guideBlock}
      <p class="muted">Listing is free and costs no turn. If ${object} sells, ${String(params.commissionPercent)}% of the price goes to the market and the rest is yours. ${displayNameFor(h)}'s barn name is cleared when the horse changes hands - the registered name never changes - your test results go with ${object}, and anything ${object} is carrying or entered in goes too.</p>
      <form method="post" action="/horses/${String(h.id)}/list">
        <label>Asking price
          <input type="text" inputmode="numeric" name="price" value="${guide ? String(guide.value) : ''}" required>
        </label>
        <button type="submit">Put ${object} on the market</button>
      </form>
    </div>`;
}

/**
 * Slice 0017 §13 (Part D): the "Offer at stud" section, on a stallion's own page only - mirroring
 * sellCard right above it. Booking itself happens from /market/stud/:id, not here: this card only
 * offers the stallion or withdraws him, the same split /horses/:id/list vs /market/:id/withdraw
 * already uses for a sale listing.
 */
function studCard(params: {
  horse: HorseRow;
  canManage: boolean;
  studListing: { studListingId: number; fee: number; seasonCap: number; bookedThisSeason: number } | null;
  /** docs/fixes/breeding-eligibility-display.md §1: false for a colt below min_breeding_age_game_days. */
  oldEnough: boolean;
  eligibleFromGameDay: number;
  gameDaysPerYear: number;
  suggestedFee: number | null;
  defaultSeasonCap: number;
  commissionPercent: number;
  error?: string;
  notice?: string;
}): SafeHtml {
  if (!params.canManage || params.horse.sex !== 'stallion') return raw('');
  const h = params.horse;

  if (params.studListing) {
    return html`
      <div class="card">
        <h2>Standing at stud</h2>
        ${errorBox(params.error)}
        ${noticeBox(params.notice)}
        <p><a href="/market/stud">Standing for ${String(params.studListing.fee)}</a>, booked ${String(params.studListing.bookedThisSeason)} of ${String(params.studListing.seasonCap)} this season.</p>
        <p class="muted">${displayNameFor(h)} stays completely yours while he stands - breed him in your own barn too if you like, show him, call the farrier. There is no live-foal guarantee: a booking's fee is not refunded if the covering doesn't take.</p>
        <form method="post" action="/market/stud/${String(params.studListing.studListingId)}/withdraw">
          <input type="hidden" name="return_to" value="horse">
          <button type="submit" class="secondary">Take him off stud</button>
        </form>
      </div>`;
  }

  if (!params.oldEnough) {
    return html`
      <div class="card">
        <h2>Offer at stud</h2>
        <p class="muted">Old enough to stand at stud from around ${formatCalendarDate(params.eligibleFromGameDay, params.gameDaysPerYear)}.</p>
      </div>`;
  }

  return html`
    <div class="card">
      <h2>Offer at stud</h2>
      ${errorBox(params.error)}
      ${noticeBox(params.notice)}
      <p class="muted">Another stable's mare can be booked to him without either of you giving up a horse. Offering is free and costs no turn; if he's booked, ${String(params.commissionPercent)}% of the fee goes to the market and the rest is yours. There is no live-foal guarantee - a booking's fee is not refunded if the covering doesn't take.</p>
      <form method="post" action="/horses/${String(h.id)}/stud">
        <label>Stud fee
          <input type="text" inputmode="numeric" name="fee" value="${params.suggestedFee !== null ? String(params.suggestedFee) : ''}" required>
        </label>
        <label>Mares per season
          <input type="text" inputmode="numeric" name="season_cap" value="${String(params.defaultSeasonCap)}" required>
        </label>
        <button type="submit">Offer ${displayNameFor(h)} at stud</button>
      </form>
    </div>`;
}

/** Slice 0016 §4.1: the barn list's tabs - plain links with a query parameter, no JavaScript
 * (§3). Counts come off the full, unfiltered horse list (§4.5). Geldings only appears when the
 * stable actually has one (§4.1) - there is no gelding path in the game today. */
function barnTabs(stableId: number, activeTab: BarnBucket | 'all', counts: Record<BarnBucket, number>): SafeHtml {
  const tabs: { key: BarnBucket | 'all'; label: string; count: number | null }[] = [
    { key: 'all', label: 'All', count: null },
    { key: 'mares', label: 'Mares', count: counts.mares },
    { key: 'stallions', label: 'Stallions', count: counts.stallions },
    { key: 'foals', label: 'Foals', count: counts.foals },
  ];
  if (counts.geldings > 0) tabs.push({ key: 'geldings', label: 'Geldings', count: counts.geldings });

  return html`
    <nav class="subnav">
      ${tabs.map(
        (t) => html`<a href="/stables/${String(stableId)}/horses?show=${t.key}" class="${t.key === activeTab ? 'subnav-link is-active' : 'subnav-link'}">${t.label}${t.count !== null ? ` (${String(t.count)})` : ''}</a>`
      )}
    </nav>`;
}

export function renderBarnList(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  horses: {
    horse: HorseRow;
    description: string;
    inSeason: boolean;
    conformation: ConformationDisplayRow[];
    showSummary: HorseShowSummaryRow | null;
    visibleConditions: ConditionRow[];
    ageState: AgeState;
    ageModifier: AgeModifierResult | null;
    care: CareCardView | null;
    availability: WorkAvailability | null;
    /** Slice 0017 §6.5: the asking price when this horse has an open listing, else null. */
    listingPrice: number | null;
    /** Slice 0020 §8.3: true when this horse has a currently open acute incident. */
    hasOpenIncident: boolean;
  }[];
  feedLevels: Record<string, FeedLevelDefinition>;
  careSummary: { farrierDue: number; wellnessDue: number };
  careNotice?: string;
  careError?: string;
  /** Slice 0016 §4.1: which tab is active - an unrecognised value has already been normalised to
   * 'all' by the route (§4.1's "a filter is not an assertion"). */
  activeTab: BarnBucket | 'all';
  /** Counts from the full, unfiltered list - see barnTabs' own comment. */
  tabCounts: Record<BarnBucket, number>;
}): SafeHtml {
  const rows = params.horses.length
    ? params.horses.map(
        ({ horse, description, inSeason, conformation, showSummary, visibleConditions, ageState, ageModifier, care, availability, listingPrice, hasOpenIncident }) => html`
        <div class="card horse-row">
          ${barnThumbnail(horse)}
          <div>
            <h2><a href="/horses/${String(horse.id)}">${displayNameFor(horse)}</a> ${incidentBarnBadge(hasOpenIncident)} ${inSeason ? html`<span class="badge badge-success">in season</span>` : raw('')} ${showBadge(showSummary)} ${healthBarnBadge(horse, visibleConditions)} ${ageStateBarnBadge(ageState)} ${ageModifierBarnBadge(ageModifier)} ${careBarnBadge(care)} ${locationBarnBadge(horse, availability)} ${listingBarnBadge(listingPrice)}</h2>
            <p>${description}</p>
            <p class="muted conformation-compact">${conformationCompactLine(conformation)}</p>
          </div>
        </div>`
      )
    : html`<p>No horses here${params.activeTab === 'all' ? ' yet' : ' in this tab'}.</p>`;

  const body = html`
    <h1>${params.stable.name}'s horses</h1>
    ${careBarnControls({
      stableId: params.stable.id,
      feedLevels: params.feedLevels,
      currentFeedLevel: params.stable.feed_level,
      careSummary: params.careSummary,
      careError: params.careError,
      careNotice: params.careNotice,
      activeTab: params.activeTab,
    })}
    ${barnTabs(params.stable.id, params.activeTab, params.tabCounts)}
    ${rows}
    <p><a href="/stables/${String(params.stable.id)}/breed">Breed two horses</a></p>
    <p><a href="/stables/${String(params.stable.id)}/past">Past horses</a></p>
  `;
  return pageShell({
    title: `${params.stable.name} · Horses`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.stable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

export interface BreedPreview {
  mareId: number;
  stallionId: number;
  mareDescription: string;
  mareAgeYears: number;
  stallionDescription: string;
  stallionAgeYears: number;
  coiPercent: string;
  warning?: string;
  conceptionPercent: string;
  conceptionReasons: string[];
  /** Slice 0010 §7.3 - one sentence per recessive condition this booking stable's own knowledge of
   * both horses implies is worth flagging. Empty when it knows nothing, or knows only clear
   * results - never computed from a genotype directly (see the route for where that boundary is
   * enforced). */
  healthWarnings: string[];
  /** Amendment 0017a §4.5 point 1: foalColourPossibilities, already turned into sentences - the
   * certain split first, then one sentence per untested locus explaining what testing it could
   * unlock. Never computed from either horse's genotype directly - same boundary as healthWarnings. */
  colourNotes: string[];
  /** Slice 0022 §B5: one row per conformation trait, each parent's own plain-word verdict against
   * ITS OWN breed's ideal - already resolved to display text ('Unknown' included), gated per
   * parent by that horse's own show record. */
  /** 2026-08-05: foalRange is the honest prediction - the best and worst word covering about eight
   * foals in ten from this exact pairing. "Unknown" when either parent's own label is unknown (a
   * prediction built from values the player has not earned would be cheating, not helpfulness), and
   * "No single standard" for a cross-breed pairing, whose foal has no one breed to be judged by. */
  conformationRows: { name: string; mareLabel: string; stallionLabel: string; foalRange: string }[];
  /**
   * Set only when the stallion is standing at another ranch, in which case the booking is a stud
   * booking (slice 0017 Part D) rather than an ordinary same-stable covering - a fee, a commission,
   * and no horse changing hands. Absent for one of this stable's own stallions, which is what every
   * caller before the third picker existed passed.
   */
  outsideStud?: {
    studListingId: number;
    stableName: string;
    fee: number;
    /** Why this booking cannot be made, from validateStudBooking - the Book button is replaced by
     * this sentence rather than sitting there ready to fail. */
    refusal?: string;
  };
}

/**
 * One stallion standing at a ranch that is not this account's - what the third picker offers.
 *
 * Breed first, and no colour blurb: this is a dropdown a child scrolls on a phone looking for a
 * stallion of the right breed, not a shop window. The colour description that used to be here made
 * every option three lines long on a narrow screen and pushed the fee off the end.
 */
export interface OutsideStudOption {
  studListingId: number;
  /** Null for a cross - `breedName` then reads "Cross", which still sorts sensibly. */
  breedId: number | null;
  breedName: string;
  stallionName: string;
  stableName: string;
  fee: number;
}

/**
 * docs/fixes/breeding-eligibility-display.md §2: a horse a breeding picker is not offering, and
 * why - short, player-facing phrasing lives here rather than in the engine (which only returns a
 * code) or in the two refusal ladders' own longer sentences (which are about a chosen pairing, not
 * a picker deciding what to list).
 */
export interface MareExclusion {
  name: string;
  reason: MareIneligibility;
  /** Only set for 'booked' - the stallion she is booked to, when known. */
  stallionName?: string;
  /** Only set for 'recovering' - when she clears, for the fuller no-eligible-mares sentence. */
  recoversGameDay?: number;
}

/** Exported for src/render/market.ts's own mare picker (docs/fixes/breeding-eligibility-display.md
 * §2's third row) - one phrase map for both, so the wording can't drift between the two screens. */
export function mareExclusionPhrase(e: MareExclusion): string {
  switch (e.reason) {
    case 'too_young':
      return 'too young to breed yet';
    case 'at_pasture':
      return 'out at pasture';
    case 'settling_in':
      return 'still settling in from pasture';
    case 'recovering':
      return 'recovering from foaling';
    case 'in_foal':
      return 'in foal';
    case 'booked':
      return e.stallionName ? `booked to ${e.stallionName}` : 'already booked to a covering';
  }
}

/** The short parenthetical line under a picker that still has at least one eligible option left. */
function exclusionsLine(exclusions: MareExclusion[]): SafeHtml {
  if (exclusions.length === 0) return raw('');
  const parts = exclusions.map((e) => `${e.name} (${mareExclusionPhrase(e)})`);
  return html`<p class="muted">Not shown: ${parts.join(', ')}.</p>`;
}

/** Every mare is ineligible - replaces the picker (and the button beneath it) with a sentence
 * saying why, rather than drawing an empty <select> with a live button next to it. */
function noEligibleMaresLine(exclusions: MareExclusion[], gameDaysPerYear: number): SafeHtml {
  const sentences = exclusions.map((e) => {
    const dated = e.reason === 'recovering' && e.recoversGameDay !== undefined
      ? `${mareExclusionPhrase(e)} until around ${formatCalendarDate(e.recoversGameDay, gameDaysPerYear)}`
      : mareExclusionPhrase(e);
    return `${e.name} is ${dated}`;
  });
  const joined = sentences.length <= 1 ? sentences.join('') : `${sentences.slice(0, -1).join(', ')}, and ${sentences[sentences.length - 1]}`;
  return html`<p class="muted">None of your mares can be bred right now. ${joined}.</p>`;
}

function optionsFor(horses: HorseRow[], selectedId: number | undefined, describe: (h: HorseRow) => string): SafeHtml {
  if (horses.length === 0) return html`<option value="" disabled selected>None available</option>`;
  return html`${horses.map(
    (h) => html`<option value="${String(h.id)}" ${h.id === selectedId ? raw('selected') : raw('')}>${displayNameFor(h)} - ${describe(h)}</option>`
  )}`;
}

export function renderBreedPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  /** Already filtered to mares that can actually be picked right now (docs/fixes/
   * breeding-eligibility-display.md §2) - mareExclusions says who was left out and why. */
  mares: HorseRow[];
  mareExclusions: MareExclusion[];
  stallions: HorseRow[];
  stallionExclusions: MareExclusion[];
  /** Every stallion standing at stud at a ranch this account does not own - NPC ranches included.
   * Empty when nobody else is standing one. */
  outsideStuds: OutsideStudOption[];
  describe: (h: HorseRow) => string;
  selectedMareId?: number;
  selectedStallionId?: number;
  selectedStudListingId?: number;
  preview?: BreedPreview;
  error?: string;
}): SafeHtml {
  const preview = params.preview;

  const conceptionReasonsBlock = preview && preview.conceptionReasons.length
    ? html`<p class="muted">${preview.conceptionReasons.join(', ')}</p>`
    : raw('');

  // Slice 0022 §B5: words only, no bars - five traits x two horses is ten bars on a card that
  // already carries four other blocks, and the same phone-width argument that shortens the bars on
  // the horse page (§B4) says not to put bars here at all. A plain sentence guards against the
  // labels quietly teaching the wrong rule: two Outstanding parents can still throw a poor foal.
  const conformationBlock = preview && preview.conformationRows.length
    ? html`
      <h3>Conformation</h3>
      <table>
        <thead><tr><th>Trait</th><th>Mare</th><th>Stallion</th><th>Likely foal</th></tr></thead>
        <tbody>${preview.conformationRows.map((r) => html`<tr><td>${r.name}</td><td>${r.mareLabel}</td><td>${r.stallionLabel}</td><td><strong>${r.foalRange}</strong></td></tr>`)}</tbody>
      </table>
      <p class="muted">Judged against each parent's own breed. The last column is what about eight foals out of ten from this pairing would come out as - the other two land outside it, in either direction. A foal is not the average of its parents - two Outstanding parents can still throw one with a poor trait, and that's the genetics working as intended, not a mistake.</p>
      ${preview.conformationRows.some((r) => r.foalRange === 'Unknown')
        ? html`<p class="muted">Where the last column says Unknown, one of the parents has never been shown and never been evaluated, so there is nothing honest to predict from. Show them, or pay for an evaluation from the horse's own page.</p>`
        : raw('')}`
    : raw('');

  // The one place the two kinds of booking differ on this page. An own-stallion pairing posts back
  // here and books an ordinary covering; an outside stud posts to the market's own stud booking
  // route (slice 0017 Part D) with this mare - the same endpoint /market/stud/:id's own button
  // uses, so there is exactly one cross-stable breeding path in the game, not a second one grown
  // here (CLAUDE.md §13's no-parallel-path rule).
  const bookBlock = (p: BreedPreview): SafeHtml => {
    if (!p.outsideStud) {
      return html`
        <form method="post" action="/stables/${String(params.stable.id)}/breed">
          <input type="hidden" name="action" value="book">
          <input type="hidden" name="mare_id" value="${String(p.mareId)}">
          <input type="hidden" name="stallion_id" value="${String(p.stallionId)}">
          <button type="submit">Book covering</button>
        </form>`;
    }
    const stud = p.outsideStud;
    return html`
      <p><strong>Stud fee:</strong> ${String(stud.fee)}, payable to ${stud.stableName} now. Neither horse changes hands - she is covered next time she comes into season, and there is no refund if it doesn't take.</p>
      ${stud.refusal
        ? html`<p class="notice">${stud.refusal}</p>`
        : html`
          <form method="post" action="/market/stud/${String(stud.studListingId)}/book">
            <input type="hidden" name="mare_id" value="${String(p.mareId)}">
            <button type="submit">Book for ${String(stud.fee)}</button>
          </form>`}
      <p class="muted"><a href="/market/stud/${String(stud.studListingId)}">See his full page</a> - his show record and what his owner has had him tested for.</p>`;
  };

  const previewBlock = preview
    ? html`
      <div class="card">
        <h2>This pairing</h2>
        <p><strong>Mare:</strong> ${preview.mareDescription}</p>
        <p><strong>Stallion:</strong> ${preview.stallionDescription}</p>
        <p><strong>Inbreeding coefficient of a foal from this pairing:</strong> ${preview.coiPercent}</p>
        ${preview.warning ? html`<p class="notice">${preview.warning}</p>` : raw('')}
        ${preview.healthWarnings.map((w) => html`<p class="notice">${w}</p>`)}
        ${preview.colourNotes.map((w) => html`<p class="muted">${w}</p>`)}
        ${conformationBlock}
        <p><strong>Estimated chance this covering takes:</strong> ${preview.conceptionPercent}</p>
        ${conceptionReasonsBlock}
        ${bookBlock(preview)}
      </div>
    `
    : raw('');

  // The third picker (and only it) carries a "nobody" default: a pairing needs exactly one
  // stallion, and leaving this one alone is how a player says "my own stallion above, thanks".
  // Choosing somebody here overrides the stallion picker, which the label says out loud rather
  // than leaving a child to find out by pressing the button.
  //
  // The list arrives already ordered by the route: the mare's own breed first, then the rest by
  // breed name. Breed leads each line for the same reason - it is the one thing being scanned for.
  const outsideStudPicker = params.outsideStuds.length
    ? html`
      <label>...or a stallion standing at another ranch
        <select name="stud_listing_id">
          <option value="">— none, use my own stallion above —</option>
          ${params.outsideStuds.map(
            (s) => html`<option value="${String(s.studListingId)}" ${s.studListingId === params.selectedStudListingId ? raw('selected') : raw('')}>${s.breedName} - ${s.stallionName} at ${s.stableName}. Fee ${String(s.fee)}.</option>`
          )}
        </select>
      </label>
      <p class="muted">Stallions of the mare's own breed come first, then the other breeds in alphabetical order. Booking one of these costs the fee shown and a turn, and no horse moves - the foal is born in this barn.</p>`
    : html`<p class="muted">Nobody else is standing a stallion at stud just now. When somebody does, they'll show up here.</p>`;

  // docs/fixes/breeding-eligibility-display.md §2: no mare, no pairing - shown in place of the
  // whole form rather than an empty <select> with a button that was always going to fail.
  const breedForm = params.mares.length === 0
    ? noEligibleMaresLine(params.mareExclusions, params.gameDaysPerYear)
    : html`
      <form method="post" action="/stables/${String(params.stable.id)}/breed">
        <input type="hidden" name="action" value="check">
        <label>Mare
          <select name="mare_id" required>${optionsFor(params.mares, params.selectedMareId, params.describe)}</select>
        </label>
        ${exclusionsLine(params.mareExclusions)}
        <label>Your stallion
          <select name="stallion_id">${optionsFor(params.stallions, params.selectedStallionId, params.describe)}</select>
        </label>
        ${exclusionsLine(params.stallionExclusions)}
        ${outsideStudPicker}
        <button type="submit">Check pairing</button>
      </form>`;

  const body = html`
    <h1>Breed</h1>
    ${errorBox(params.error)}
    ${breedForm}
    ${previewBlock}
    <p><a href="/stables/${String(params.stable.id)}/horses">Back to horses</a></p>
  `;
  return pageShell({
    title: 'Breed',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.stable.id, 'breed', params.hasFoundingOffer),
    body,
  });
}

interface PedigreeSlot {
  label: string;
  horse: HorseRow | null;
}

function pedigreeCell(slot: PedigreeSlot): SafeHtml {
  if (!slot.horse) return html`<td class="muted">unknown</td>`;
  return html`<td><a href="/horses/${String(slot.horse.id)}">${displayNameFor(slot.horse)}</a></td>`;
}

/** One bar per trait - two nested <div>s with an inline width percentage, no JavaScript anywhere in
 * this codebase (CLAUDE.md §11). "Mature to" reads the extreme the horse's own genetics lean
 * towards - slice 0006 §2.2/§4.4, never a judgement of which end is wanted.
 *
 * Slice 0022 §B4: the bar and its word share one flex row, the bar taking what's left
 * (`.meter-line`/`.meter-verdict` in public/style.css) - `.meter` needs `min-width: 0` there or the
 * word pushes off the right edge of a phone screen, since a flex item defaults to refusing to
 * shrink below its own content.
 */
function conformationRow(row: ConformationDisplayRow, label: ConformationLabel): SafeHtml {
  const matureSideLabel = row.matureExpressed >= 50 ? row.highLabel : row.lowLabel;
  return html`
    <div class="conformation-row">
      <div class="meter-labels"><span>${row.lowLabel}</span><strong>${row.name}</strong><span>${row.highLabel}</span></div>
      <div class="meter-line">
        <div class="meter"><div class="meter-fill" style="width: ${String(row.expressed)}%"></div></div>
        <span class="meter-verdict conformation-label-${label}">${CONFORMATION_LABEL_TEXT[label]}</span>
      </div>
      <p class="muted">Now ${String(row.expressed)}, will mature to ${String(row.matureExpressed)} - ${matureSideLabel}.</p>
    </div>`;
}

/**
 * Slice 0006 §6.1: the horse page's Conformation card. §2.3 is the discipline this function must
 * never break - no score, no average, no word implying quality on its OWN numbers.
 *
 * Slice 0022 Part B keeps that discipline while finally keeping the card's own long-standing
 * promise: `labels` is one word per trait, read off the judge's own per-trait formula against this
 * horse's own breed (§B2) - `unknown` (rendered "Unknown", never blank - §B3) until `hasShown` is
 * true and the breed has an ideal_vector to judge against.
 */
function conformationCard(params: {
  conformation: ConformationDisplayRow[];
  labels: Map<TraitCode, ConformationLabel>;
  ageYears: number;
  maturityYears: number;
  name: string;
  possessive: string;
  hasShown: boolean;
  breedName: string | null;
  evaluation: EvaluationSectionView | null;
}): SafeHtml {
  const closingLine = params.hasShown
    ? html`<p class="muted">These words are measured against ${params.breedName ?? "this horse's own breed"}'s own standard - a different breed would score the same horse differently.</p>`
    : html`<p class="muted">These are measurements, not marks - which end a breed wants arrives with the first show class.</p>`;
  return html`
    <div class="card">
      <h2>Conformation</h2>
      ${params.ageYears < params.maturityYears
        ? html`<p class="muted">${params.name} hasn't grown into ${params.possessive} frame yet - these numbers will keep settling until around age ${String(params.maturityYears)}.</p>`
        : raw('')}
      ${params.conformation.map((row) => conformationRow(row, params.labels.get(row.code) ?? 'unknown'))}
      ${closingLine}
      ${params.evaluation ? evaluationSection(params.evaluation, params.name) : raw('')}
    </div>`;
}

export interface AbilityDisplayRow {
  code: TraitCode;
  name: string;
  label: ConformationLabel;
}

/**
 * Slice 0025 stage 3 §7.4: the Ability card - "the first time anything in the game has ever shown
 * an ability value to anyone" (the slice's own words). Deliberately word-only: no meter, no number,
 * ever - unlike Conformation's bar-plus-word, an ability trait has never had a number on screen
 * anywhere a player can see it, and this card does not start now. A row reads Unknown until this
 * horse has actually placed in that trait's own ability_test class at least once; the word itself
 * never moves again after that until a later test overwrites it (src/db/abilityTests.ts's own
 * comment on why the upsert is deliberate).
 */
function abilityCard(rows: AbilityDisplayRow[], name: string): SafeHtml {
  return html`
    <div class="card">
      <h2>Ability</h2>
      <p class="muted">Ability can't be judged by looking - it's revealed by entering ${name} in an ability test, and the word only ever describes ${name}'s own result, never how ${name} placed against the field.</p>
      <table>
        <thead><tr><th>Trait</th><th>Result</th></tr></thead>
        <tbody>
          ${rows.map((r) => html`<tr><td>${r.name}</td><td class="conformation-label-${r.label}">${CONFORMATION_LABEL_TEXT[r.label]}</td></tr>`)}
        </tbody>
      </table>
    </div>`;
}


/**
 * 2026-08-05: "Grow up" - the per-horse time warp. Placed on the horse's own page next to the other
 * things an owner does to one horse, and rendered only while the horse is young enough for it to be
 * possible at all, so a grown horse's page is not cluttered with a control it can never use.
 *
 * The card states all three costs before the press, because two of them are not money: a turn, and
 * six months off the far end of the horse's life. A child should not discover the third one later.
 */
function growUpCard(view: TimeWarpCardView, name: string): SafeHtml {
  return html`
    <div class="card">
      <h2>Grow up</h2>
      ${errorBox(view.error)}
      ${noticeBox(view.notice)}
      <p>${name} is ${view.ageLabel} old and can't be shown or bred yet. You can pay to skip ahead - ${name} wakes up ${String(view.monthsLabel)} older, and everything else in the world stays where it is.</p>
      <p class="muted">Costs ${String(view.cost)} and one turn. ${name} really is that much older afterwards, so ${name} will grow old that much sooner too - you are buying the time, not getting it free.${view.clamped ? ' This one takes ' + name + ' the rest of the way to grown, which is less than a full six months.' : ''}</p>
      <form method="post" action="/horses/${String(view.horseId)}/warp">
        <button type="submit" class="secondary" ${view.affordable ? raw('') : raw('disabled')}>Grow up by ${String(view.days)} days (${String(view.cost)})</button>
      </form>
      ${view.affordable ? raw('') : html`<p class="muted">Not enough money for that right now.</p>`}
    </div>`;
}

export interface TimeWarpCardView {
  horseId: number;
  days: number;
  cost: number;
  clamped: boolean;
  affordable: boolean;
  ageLabel: string;
  monthsLabel: string;
  error?: string;
  notice?: string;
}

/** One trait's evaluated verdict, already turned into words by the caller. */
export interface EvaluationVerdictRow {
  name: string;
  /** "Good", or "Weak to Good" when the evaluator is still hedging. */
  text: string;
}

export interface EvaluationSectionView {
  horseId: number;
  cost: number;
  /** Which of this account's stables pays, and where the POST returns to. */
  payerStableId: number;
  back: string;
  /** The most recent evaluation this stable holds, or null if it has never bought one. */
  current: { rows: EvaluationVerdictRow[]; ageYears: number; certain: boolean } | null;
  /** False when buying again today would return the identical words - the spread only narrows as
   * the horse ages, so this is the difference between a useful purchase and a wasted one. */
  worthBuyingAgain: boolean;
  /** False when the stable simply can't afford it; the button is still drawn, with the reason. */
  affordable: boolean;
  error?: string;
  notice?: string;
}

/**
 * The evaluation block inside the Conformation card, 2026-08-05. Deliberately part of that card
 * rather than a card of its own: it is the same subject, and a child comparing the bars to the words
 * should not have to scroll between them.
 *
 * The honest framing matters more than the words here. An evaluation is one person's opinion, given
 * with hedging that narrows as the horse grows, and the page says so - a range is never presented as
 * a measurement, and the "no sharper yet" line exists so a child does not spend the same money twice
 * for the same sentence.
 */
function evaluationSection(view: EvaluationSectionView, horseName: string): SafeHtml {
  const buyLabel = view.current ? 'Have another look' : 'Get an evaluation';
  const buyForm = html`
    <form method="post" action="/horses/${String(view.horseId)}/evaluate">
      <input type="hidden" name="stable_id" value="${String(view.payerStableId)}">
      <input type="hidden" name="back" value="${view.back}">
      <button type="submit" class="secondary" ${view.affordable ? raw('') : raw('disabled')}>${buyLabel} (${String(view.cost)})</button>
    </form>`;

  return html`
    <details class="section-collapse" ${view.error ? raw('open') : raw('')}>
      <summary>Evaluation${view.current ? '' : ' - not bought'}</summary>
      ${errorBox(view.error)}
      ${noticeBox(view.notice)}
      <p class="muted">A judge looks ${horseName} over and says how ${horseName === 'this horse' ? 'it' : 'they'} measure${' '}up against the breed standard, without ever giving you a number. On a young foal the answer is deliberately vague - nobody can tell yet - and it narrows every year until it is a single word.</p>
      ${view.current
        ? html`
          <table>
            <tbody>${view.current.rows.map((row) => html`<tr><td>${row.name}</td><td><strong>${row.text}</strong></td></tr>`)}</tbody>
          </table>
          <p class="muted">Bought at age ${view.current.ageYears < 1 ? 'under a year' : `${String(Math.floor(view.current.ageYears))}`}. ${
            view.current.certain
              ? 'Old enough now that the verdict is a single word - another look would say the same thing.'
              : view.worthBuyingAgain
                ? 'Another look now would be sharper.'
                : 'Another look would say exactly the same words until this horse is older - save the money.'
          }</p>`
        : raw('')}
      ${view.affordable ? buyForm : html`${buyForm}<p class="muted">Not enough money for that right now.</p>`}
    </details>`;
}

/** Slice 0006 §6.3: a compact one-line-per-horse comparison for the barn list, first word of each
 * trait's name (Neck, Shoulder, Back, Hock) so two horses can be compared without opening either. */
function conformationCompactLine(conformation: ConformationDisplayRow[]): SafeHtml {
  return html`${conformation.map((row) => `${row.name.split(' ')[0]} ${String(row.expressed)}`).join(' · ')}`;
}

export interface HealthConditionDisplay {
  code: string;
  name: string;
  teachingText: string;
  /** null means the viewer is not entitled to a result (not the owner, or genuinely not known and
   * not observable) - slice 0010 §2.4. Never guessed from a genotype the caller happens to have. */
  status: 'clear' | 'carrier' | 'affected' | null;
  copies: 0 | 1 | 2 | null;
  testedGameDay: number | null;
  /** True when status is 'affected' but was never paid for - a signs_visible condition, shown as
   * an observation rather than a test result (§2.4's sharp version of the truth/knowledge split). */
  observedOnly: boolean;
}

function healthStatusBadge(row: HealthConditionDisplay): SafeHtml {
  if (row.status === null) return html`<span class="badge">Not tested</span>`;
  if (row.status === 'clear') return html`<span class="badge badge-success">Clear</span>`;
  if (row.status === 'carrier') return html`<span class="badge badge-warning">Carrier</span>`;
  const label = row.observedOnly ? 'Shows signs' : 'Affected';
  const copiesNote = row.copies === 2 ? ' (two copies)' : '';
  return html`<span class="badge badge-danger">${label}${copiesNote}</span>`;
}

/** Slice 0010 §8, revised by slice 0016's follow-up: the Health card, below Conformation. For the
 * owner: one row per applicable enabled condition with the status they've paid to learn or can see
 * for free (§2.4's knowledge boundary). For an admin viewing someone else's horse: the same full
 * rows, but computed directly from the genotype (`conditionStatus`, not `ownerVisibleStatus`) - the
 * operator asked to see everything, and the truth-vs-knowledge split that protects a player from
 * another player was never meant to apply to the one person running the game. No Test button
 * either way for a non-owner - buying a test is a purchase on a stable's own account, not
 * something an admin does on someone else's behalf. */
function healthCard(params: { canSeeFullHealth: boolean; canTest: boolean; rows: HealthConditionDisplay[]; horseId: number; gameDaysPerYear: number }): SafeHtml {
  if (params.rows.length === 0) return raw('');
  const rows = params.canSeeFullHealth
    ? params.rows.map(
        (row) => html`
        <div class="health-row">
          <p><strong>${row.name}:</strong> ${healthStatusBadge(row)} ${row.testedGameDay !== null ? html`<span class="muted">(tested ${formatCalendarDate(row.testedGameDay, params.gameDaysPerYear)})</span>` : raw('')}</p>
          <p class="muted">${row.teachingText}</p>
        </div>`
      )
    : params.rows.map((row) => html`<p>${row.name}</p>`);

  return html`
    <div class="card">
      <h2>Health</h2>
      ${rows}
      ${params.canTest ? html`<p><a class="button-link" href="/horses/${String(params.horseId)}/test">Test</a></p>` : raw('')}
    </div>`;
}

const OUTCOME_LABEL: Record<IncidentHistoryView['outcome'], string> = {
  resolved: 'Recovered',
  manageable: 'Settled into ongoing management',
  degenerative: 'Left a lasting problem - cannot be shown',
  death: 'Did not survive',
};

/**
 * Slice 0020 §8.2: the Incidents card, between Health and Care - the same discipline §2.3
 * establishes elsewhere applies here too, this card never touches the Health card's own rows.
 * Nothing about an acquired incident is hidden (§2.7), so this renders for owner and admin alike,
 * omitting itself entirely for anyone else and when there is nothing to show at all.
 *
 * Slice 0022 §A6: `history` has already been trimmed to the last `incident_history_game_days` by
 * the caller (an open incident and a 'degenerative' outcome are never trimmed) - `hiddenCount`
 * says how many were left out, so the card ends on a plain count rather than silently dropping
 * them.
 */
function incidentsCard(params: {
  incidents: { open: OpenIncidentView[]; history: IncidentHistoryView[]; hiddenCount: number };
  horseId: number;
  canManage: boolean;
  incidentError?: string;
  incidentNotice?: string;
}): SafeHtml {
  const { open, history, hiddenCount } = params.incidents;
  if (open.length === 0 && history.length === 0 && hiddenCount === 0) return raw('');

  const openRows = open.map(
    (o) => html`
    <div class="health-row">
      <p><strong>${o.conditionName}.</strong> ${o.treated ? html`<span class="badge badge-success">Treated</span>` : html`<span class="badge badge-danger">${String(o.daysRemaining)} day${o.daysRemaining === 1 ? '' : 's'} left to call the vet</span>`}</p>
      <p class="muted">${o.teachingText}</p>
      ${!o.treated && params.canManage
        ? html`
          <form method="post" action="/horses/${String(params.horseId)}/treat">
            <input type="hidden" name="condition_code" value="${o.conditionCode}">
            <button type="submit">Call the vet — ${String(o.cost)}</button>
          </form>`
        : o.treated
          ? html`<p class="muted">Treated - being watched.</p>`
          : raw('')}
    </div>`
  );

  const historyRows = history.length
    ? html`
      <h3>Past incidents</h3>
      <ul>${history.map((h) => html`<li>${h.conditionName} (game day ${String(h.onsetGameDay)}) - ${OUTCOME_LABEL[h.outcome]}</li>`)}</ul>`
    : raw('');

  const hiddenLine = hiddenCount > 0 ? html`<p class="muted">${String(hiddenCount)} earlier incident${hiddenCount === 1 ? '' : 's'}, all resolved.</p>` : raw('');

  return html`
    <div class="card">
      <h2>Incidents</h2>
      ${errorBox(params.incidentError)}
      ${noticeBox(params.incidentNotice)}
      ${openRows}
      ${historyRows}
      ${hiddenLine}
    </div>`;
}

/** Amendment 0017a §4.5 point 2: what this horse can pass on, per colour/gait locus - "untested"
 * shown as loudly as a result, the same rule slice 0017 §2.3 applies to health knowledge. */
export interface ColourInferenceRow {
  code: string;
  name: string;
  summary: string;
}

/** Slice 0021 Part F (§7.2): which of the testing page's four presentational groups a locus code
 * belongs to. Presentational only, not the source of truth (loci.category remains that) - PATN1
 * sits in Patterns despite being category 'modifier' because that's where a player looking for the
 * appaloosa genes would look for it, and Grey joins Dilutions for the same reason (it modifies how
 * the base colour shows, same as cream/dun/champagne/silver) even though the slice's own §7.2 text
 * only named E/A/CR/D/Z/CH/RN/TO/O/SW1/SB1/LP/PATN1/DMRT3 and didn't say where G goes. */
function colourGroupFor(code: string): 'base' | 'dilution' | 'pattern' | 'gait' {
  if (code === 'E' || code === 'A') return 'base';
  if (code === 'CR' || code === 'D' || code === 'Z' || code === 'CH' || code === 'G') return 'dilution';
  if (code === 'DMRT3') return 'gait';
  return 'pattern'; // RN, TO, O, SW1, SB1, LP, PATN1 - and a safe default for any future locus
}

const COLOUR_GROUP_LABEL: Record<string, string> = { base: 'Base colour', dilution: 'Dilutions', pattern: 'Patterns', gait: 'Gait' };
const COLOUR_GROUP_ORDER = ['base', 'dilution', 'pattern', 'gait'] as const;

interface ColourGroup<T> {
  key: string;
  label: string;
  rows: T[];
}

function groupByColourCategory<T extends { code: string }>(rows: T[]): ColourGroup<T>[] {
  const byGroup = new Map<string, T[]>();
  for (const row of rows) {
    const key = colourGroupFor(row.code);
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }
  return COLOUR_GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => ({ key, label: COLOUR_GROUP_LABEL[key], rows: byGroup.get(key)! }));
}

/** Slice 0021 Part F (§7.2): collapsed by default - the fifteen-locus version of this card would
 * otherwise be the longest thing on the page a child looks at most. The summary line is the part
 * they actually came for (the horse's visible colour and pattern list); every per-locus detail sits
 * behind the disclosure. */
function colourCard(params: { rows: ColourInferenceRow[]; visibleColour: string; patternWords: string[]; canTest: boolean; horseId: number }): SafeHtml {
  if (params.rows.length === 0) return raw('');
  const summary = params.patternWords.length > 0 ? `${params.visibleColour} ${params.patternWords.join(' ')}` : params.visibleColour;
  return html`
    <div class="card">
      <h2>Colour and gait</h2>
      <details class="section-collapse">
        <summary>${summary}</summary>
        ${params.rows.map((row) => html`<p><strong>${row.name}:</strong> ${row.summary}</p>`)}
      </details>
      ${params.canTest ? html`<p><a class="button-link" href="/horses/${String(params.horseId)}/test">Test</a></p>` : raw('')}
    </div>`;
}

/** Slice 0008 §8.1: "a small ribbon count or best-placing badge per horse" for the barn list -
 * kept to one glanceable thing, since the barn list is already dense (slice 0006's own comment on
 * this file makes the same call for its compact conformation line). Nothing shown for a horse with
 * no starts yet, rather than a "hasn't shown" sentence that would just be noise on every row. */
function showBadge(summary: HorseShowSummaryRow | null): SafeHtml {
  if (!summary || summary.starts === 0) return raw('');
  return html`<span class="badge">${String(summary.wins)} win${summary.wins === 1 ? '' : 's'}, best ${placingText(summary.best_placing)}</span>`;
}

export interface EnterShowInfo {
  /** A CatalogueClassSpec.classKey (src/db/shows.ts) - identifies which catalogue row this is, not
   * a live show_classes id, since one may not exist yet (slice 0025 stage 4 §7.5a). */
  classKey: string;
  className: string;
  eligible: boolean;
  /** Present when !eligible - "isn't old enough yet - this class needs a horse at least..." etc,
   * from render/shows.ts's eligibilityMessage, with this horse's own name already prepended. */
  reasonSentence?: string;
  /** Present when eligible - "3 entered, judged in 6 days." or "Nobody yet - starts a show, judged
   * in 14 days." (§7.5a's own example rows), so pressing Enter never surprises about which of the
   * two it does. */
  statusSentence?: string;
}

/** Slice 0012 §9, widened by slice 0025 stage 4 §7.5a: one line per catalogue row the horse either
 * can or can't enter - the whole catalogue now, not only classes that happen to already be open,
 * since on demand there is no calendar to have pre-minted one. */
function enterShowBlock(horseId: number, infos: EnterShowInfo[]): SafeHtml {
  if (infos.length === 0) return raw('');
  return html`${infos.map((info) =>
    info.eligible
      ? html`
        <form method="post" action="/horses/${String(horseId)}/enter-show">
          <input type="hidden" name="class_key" value="${info.classKey}">
          <button type="submit">Enter in ${info.className}</button>
        </form>
        <p class="muted">${info.statusSentence}</p>`
      : html`<p class="muted">${info.reasonSentence}</p>`
  )}`;
}

/** Slice 0008 §8.1's Show record card: starts, wins, best result, and recent placings grouped by
 * class type. The groups themselves are built and templated by render/shows.ts, which is what lets
 * a sale listing, a stud listing and /world show the identical card. */
function showRecordCard(params: {
  summary: HorseShowSummaryRow | null;
  resultGroups: ShowResultGroup[];
  enterShow: EnterShowInfo[];
  enterShowError?: string;
  enterShowNotice?: string;
  horseId: number;
}): SafeHtml {
  const s = params.summary;
  return html`
    <div class="card">
      <h2>Show record</h2>
      ${errorBox(params.enterShowError)}
      ${noticeBox(params.enterShowNotice)}
      ${s
        ? html`<p><strong>Starts:</strong> ${String(s.starts)} &middot; <strong>Wins:</strong> ${String(s.wins)} &middot; <strong>Best:</strong> ${s.best_placing !== null ? placingText(s.best_placing) : 'none yet'}</p>`
        : html`<p class="muted">No shows entered yet.</p>`}
      ${showResultGroupsHtml(params.resultGroups)}
      ${enterShowBlock(params.horseId, params.enterShow)}
    </div>`;
}

export function renderHorsePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  owner: boolean;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  description: string;
  /** The horse's real colour in one word, e.g. "bay" - stated beside the placeholder so a picture
   * choice is made with the truth in view, per slice 0007 §2.1's required mitigation. */
  visibleColour: string;
  ageYears: number;
  /** Slice 0014 §4/§8.1: the age-based show performance decline. Beside the age in the vitals, not
   * a card of its own - silence is the correct display when phase is 'prime' (§8.1). */
  ageModifier: AgeModifierResult;
  breed: BreedRow | undefined;
  gaited: boolean;
  breederStableName: string | null;
  /** Bred by a Friesian pool but came out chestnut - the recessive e is real in the studbook and
   * unregistrable (slice 0005 §5.3). */
  unregistrableFriesianChestnut: boolean;
  pedigree: { sire: HorseRow | null; dam: HorseRow | null; sireSire: HorseRow | null; sireDam: HorseRow | null; damSire: HorseRow | null; damDam: HorseRow | null };
  canRegisterName: boolean;
  nameError?: string;
  barnNameNotice?: string;
  genotype?: Genotype;
  /** Admin-only, and only for a horse that has already ended - null for everyone and everything
   * else, which is what keeps the delete card off a living horse's page entirely. */
  adminDelete?: { deletable: boolean; reason: string } | null;
  adminError?: string;
  loci?: LocusRow[];
  mareStatus?: string;
  conformation: ConformationDisplayRow[];
  conformationLabels: Map<TraitCode, ConformationLabel>;
  conformationMaturityYears: number;
  /** Slice 0025 stage 3 §7.4: the Ability card - one row per ABILITY_TRAITS trait, 'unknown' until
   * an ability_test class has judged this horse in it at least once. */
  abilityRows: AbilityDisplayRow[];
  /** The paid evaluation block inside the Conformation card, 2026-08-05. Null for a viewer who
   * cannot buy one for this horse (no stable of their own, or an ended horse). */
  evaluation: EvaluationSectionView | null;
  /** 2026-08-05: the "Grow up" card, or null for a horse already old enough that a warp is refused. */
  timeWarp: TimeWarpCardView | null;
  /** True when horse.coi is at or above the existing coi_warn_threshold (slice 0006 §6.1). */
  showInbreedingNote: boolean;
  /** Slice 0008 §8.1/slice 0012 §9: the Show record card - starts, wins, best result, a few recent
   * placings already formatted as sentences and grouped by class type, and every open class this
   * horse can (or can't yet) enter. */
  showSummary: HorseShowSummaryRow | null;
  recentShowResultGroups: ShowResultGroup[];
  enterShow: EnterShowInfo[];
  enterShowError?: string;
  enterShowNotice?: string;
  /** Slice 0010 §8: the Health card's rows, already resolved to what this viewer is entitled to see. */
  health: HealthConditionDisplay[];
  /** Amendment 0017a §4.5 point 2: empty for a non-owner, non-admin viewer - the whole card omits
   * itself the same way health's does. */
  colour: ColourInferenceRow[];
  /** Slice 0021 Part F (§7.2): plain-English pattern words (PATTERN_LABELS), already display-mapped
   * for the collapsed colour card's summary line - not the raw PatternCode[] array. */
  patternWords: string[];
  /** Slice 0013 §8.1: null for an ended horse - the whole Care card is omitted for one. */
  care: CareCardView | null;
  careError?: string;
  careNotice?: string;
  feedLevelName: string;
  /** Slice 0014 §5.3: the Management section's rows - empty for an ended horse or one with nothing
   * this stable is entitled to know about, either of which means the section doesn't render at all. */
  managementPlans: ManagementPlanRow[];
  /** Slice 0011 §4.3/§8.1: this living horse's own Veteran/Failing/young/adult state - never
   * consulted for an ended horse (the status badge below covers that case instead). */
  ageState: AgeState;
  /** The location flag: this horse's barn/pasture/settling state, or null for an ended horse. */
  availability: WorkAvailability | null;
  /** Why turning out is refused right now, if it is - today only "she is in foal". */
  locationBlockedReason?: string;
  locationError?: string;
  /** Slice 0011 §8.1: owner AND alive - the one flag that gates every action a dead or removed
   * horse's page must hide (Enter in a show, Test, Choose/Change picture, Retire away). Reading
   * content (pedigree, conformation, health, show record, picture) is never gated by this. */
  canManage: boolean;
  /** Slice 0017 §6.3: this horse's open listing, or null. */
  listing: { listingId: number; price: number; expiresGameDay: number } | null;
  /** The guide value and its reasons - **the owner sees this and nobody else** (§2.7). Null for a
   * viewer who is not the owner, and for an ended horse. */
  guideValue: { value: number; factors: { label: string; detail: string }[]; qualityUnknown: boolean } | null;
  marketCommissionPercent: number;
  marketError?: string;
  marketNotice?: string;
  /** Slice 0017 §13 (Part D): this stallion's own active stud listing, or null. */
  studListing: { studListingId: number; fee: number; seasonCap: number; bookedThisSeason: number } | null;
  /** docs/fixes/breeding-eligibility-display.md §1: false for a colt below min_breeding_age_game_days -
   * the offer form is replaced with a muted "not yet" line rather than being shown to fail later. */
  stallionOldEnoughForStud: boolean;
  stallionStudEligibleFromGameDay: number;
  suggestedStudFee: number | null;
  defaultStudSeasonCap: number;
  studError?: string;
  studNotice?: string;
  /** Slice 0020 §8.2: open acute incidents and past outcomes - empty for a non-owner, non-admin
   * viewer, the same way health's does. */
  incidents: { open: OpenIncidentView[]; history: IncidentHistoryView[]; hiddenCount: number };
  incidentError?: string;
  incidentNotice?: string;
}): SafeHtml {
  const h = params.horse;
  const coiPercent = `${(h.coi * 100).toFixed(1)}%`;
  const possessive = h.sex === 'mare' ? 'her' : 'his';

  const originStableName = h.breeder_stable_id ? undefined : originStableFullName(h.breeder_prefix ?? '');
  const bredByLine = h.breeder_prefix
    ? h.breeder_stable_id
      ? html`${h.breeder_prefix}${params.breederStableName ? ` (${params.breederStableName})` : ''}`
      : html`${h.breeder_prefix}${originStableName ? ` — ${originStableName}` : ''} <span class="muted">(a founding stable, not one in this game)</span>`
    : html`a founding stable (unbred stock)`;

  const nameForm = params.canRegisterName
    ? html`
      <div class="card">
        <h2>Register a name</h2>
        ${errorBox(params.nameError)}
        <p class="muted">The stable's prefix is stamped on automatically. Once registered, the name is permanent.</p>
        <form method="post" action="/horses/${String(h.id)}/name">
          <label>${h.breeder_prefix ?? params.ownerStable.prefix}
            <input type="text" name="name" required maxlength="40">
          </label>
          <button type="submit">Register name</button>
        </form>
      </div>`
    : raw('');

  const barnNameForm = html`
    <div class="card">
      <h2>Barn name</h2>
      ${noticeBox(params.barnNameNotice)}
      <form method="post" action="/horses/${String(h.id)}/barn-name">
        <label>What you call ${h.sex === 'mare' ? 'her' : 'him'} around the barn
          <input type="text" name="barn_name" maxlength="60" value="${h.barn_name ?? ''}">
        </label>
        <button type="submit">Save</button>
      </form>
    </div>
  `;

  const pedigreeTable = html`
    <table>
      <thead><tr><th>Sire</th><th>Dam</th></tr></thead>
      <tbody>
        <tr>${pedigreeCell({ label: 'sire', horse: params.pedigree.sire })}${pedigreeCell({ label: 'dam', horse: params.pedigree.dam })}</tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Sire's sire</th><th>Sire's dam</th><th>Dam's sire</th><th>Dam's dam</th></tr></thead>
      <tbody>
        <tr>
          ${pedigreeCell({ label: '', horse: params.pedigree.sireSire })}
          ${pedigreeCell({ label: '', horse: params.pedigree.sireDam })}
          ${pedigreeCell({ label: '', horse: params.pedigree.damSire })}
          ${pedigreeCell({ label: '', horse: params.pedigree.damDam })}
        </tr>
      </tbody>
    </table>
  `;

  const portraitBlock = h.image_url
    ? html`<img class="horse-portrait" src="${h.image_url}" width="480" alt="">`
    : html`
      <div class="horse-portrait horse-portrait--placeholder">
        <p>${displayNameFor(h)} is ${params.visibleColour}.</p>
        ${params.canManage ? html`<a class="button-link" href="/horses/${String(h.id)}/image">Choose a picture</a>` : raw('')}
      </div>`;

  const pictureLink = params.canManage && h.image_url
    ? html`<p><a href="/horses/${String(h.id)}/image">Change picture</a></p>`
    : raw('');

  // Slice 0011 §4.3/§8.1: Died/Retired away for an ended horse (with the game day it ended, per
  // §8.1), or Veteran/Failing for a living one - never both, never neither's opposite state.
  const statusMarker =
    h.status === 'dead'
      ? html`<span class="badge badge-danger">Died${h.ended_game_day !== null ? html`, ${formatCalendarDate(h.ended_game_day, params.gameDaysPerYear)}` : raw('')}</span>`
      : h.status === 'removed'
        ? html`<span class="badge">${removedHorseLabel(h.end_reason)}${h.ended_game_day !== null ? html`, ${formatCalendarDate(h.ended_game_day, params.gameDaysPerYear)}` : raw('')}</span>`
        : params.ageState === 'veteran'
          ? html`<span class="badge">Veteran</span>`
          : params.ageState === 'failing'
            ? html`<span class="badge badge-warning">Failing</span>`
            : raw('');

  // Slice 0011 §2.1/§8.1: the failing paragraph, worded for a page rather than the events feed -
  // same content, same deliberate vagueness (never a number of days, never a date).
  const failingParagraph =
    params.ageState === 'failing'
      ? html`<p class="notice">${displayNameFor(h)} is getting on in years now, and ${possessive === 'her' ? 'she' : 'he'} is starting to slow down. ${possessive === 'her' ? 'She' : 'He'} can still be shown and still be bred, and there is nothing that needs treating - this is just what getting old looks like.</p>`
      : raw('');

  // Both one-way exits sit together: a child weighing one should see the other. The pet home pays
  // and takes the horse; retiring away pays nothing and is for a horse going to somebody known.
  const retireLink = params.canManage
    ? html`<p><a href="/horses/${String(h.id)}/pet-home">Send ${displayNameFor(h)} to a pet home</a></p>
           <p><a href="/horses/${String(h.id)}/retire">Retire ${displayNameFor(h)} away</a></p>`
    : raw('');

  // Slice 0014 §8.1: silence for 'prime' is the correct display for "no effect" - only past_peak
  // and floor get a line, beside the age rather than in a card of their own.
  const ageDeclineLine = (() => {
    const { phase, ageYears, modifier } = params.ageModifier;
    if (phase === 'prime') return raw('');
    const percentBelow = Math.round((1 - modifier) * 100);
    const clause = phase === 'floor' ? 'well past its peak' : 'past its peak';
    return html`<p class="muted">${String(ageYears)} years old &mdash; ${clause}. Scores about ${String(percentBelow)}% below what it would have in its prime.</p>`;
  })();

  const genotypeBlock =
    params.isAdmin && params.genotype && params.loci
      ? html`
        <details class="section-collapse">
          <summary>Genotype (admin only)</summary>
          <table>
            <thead><tr><th>Locus</th><th>Alleles</th><th>Notes</th></tr></thead>
            <tbody>
              ${params.loci.map((locus) => {
                const pair = params.genotype!.mendelian[locus.code];
                return html`<tr><td>${locus.name}</td><td>${pair ? `${pair[0]}/${pair[1]}` : 'unknown (predates this locus)'}</td><td class="muted">${locus.teaching_text}</td></tr>`;
              })}
            </tbody>
          </table>
        </details>`
      : raw('');

  // The operator's broom (POST /horses/:id/admin-delete). Only ever drawn for an admin looking at a
  // horse that has already ended, and only when the row is genuinely free of anything pointing at
  // it - the same rule the pet home uses, asked and answered by the route again on submit. When the
  // horse is ended but not deletable the card still appears, saying why not, because "why is there
  // no button here" is the question the operator would otherwise be left with.
  const adminDeleteBlock =
    params.isAdmin && params.adminDelete
      ? html`
        <div class="card">
          <h2>Delete this horse's row (admin only)</h2>
          ${
            params.adminDelete.deletable
              ? html`
                <p>${displayNameFor(h)} has already gone, never showed and never had a foal, so nothing in the game refers to ${h.sex === 'mare' ? 'her' : 'him'} anymore. The row can be cleared away for good.</p>
                <p class="muted">This pays nothing and writes no receipt - the horse already left and was already paid for. Any notices about ${h.sex === 'mare' ? 'her' : 'him'} in a stable's feed keep their words and stop being links.</p>
                <p><strong>This cannot be undone.</strong></p>
                <form method="post" action="/horses/${String(h.id)}/admin-delete">
                  <label class="confirm-checkbox">
                    <input type="checkbox" name="confirm" value="yes" required>
                    Yes, delete this row for good.
                  </label>
                  <button type="submit" class="secondary">Delete ${displayNameFor(h)}'s row</button>
                </form>`
              : html`<p class="notice">${displayNameFor(h)}'s row has to stay: ${params.adminDelete.reason}</p>`
          }
        </div>`
      : raw('');

  const body = html`
    <h1>${displayNameFor(h)}</h1>
    ${errorBox(params.adminError)}
    <div class="card">
      ${portraitBlock}
      ${pictureLink}
      <p>${params.description}</p>
      <p><strong>Sex:</strong> ${h.sex} &middot; <strong>Age:</strong> ${params.ageYears < 1 ? 'under a year' : `${Math.floor(params.ageYears)} years`} ${statusMarker}</p>
      ${ageDeclineLine}
      ${failingParagraph}
      <p><strong>Breed:</strong> ${params.breed ? params.breed.name : h.is_cross ? 'Cross' : 'Unknown'} ${params.gaited ? html`<span class="badge badge-success">gaited</span>` : raw('')}</p>
      <p><strong>Bred by:</strong> ${bredByLine}</p>
      ${params.unregistrableFriesianChestnut
        ? html`<p class="notice">This Friesian is chestnut - a recessive that hides for generations in a closed studbook and occasionally surfaces. It could not be registered as a Friesian.</p>`
        : raw('')}
      <p><strong>Inbreeding coefficient:</strong> ${coiPercent}</p>
      ${params.showInbreedingNote
        ? html`<p class="notice">Being this closely bred holds back growth - ${displayNameFor(h)}'s measurements below sit closer to the middle than ${possessive} genetics alone would give.</p>`
        : raw('')}
      ${params.mareStatus ? html`<p>${params.mareStatus}</p>` : raw('')}
    </div>
    ${conformationCard({
      conformation: params.conformation,
      labels: params.conformationLabels,
      ageYears: params.ageYears,
      maturityYears: params.conformationMaturityYears,
      name: displayNameFor(h),
      possessive,
      hasShown: (params.showSummary?.starts ?? 0) >= 1,
      breedName: params.breed?.name ?? null,
      evaluation: params.evaluation,
    })}
    ${abilityCard(params.abilityRows, displayNameFor(h))}
    ${params.canManage && params.timeWarp ? growUpCard(params.timeWarp, displayNameFor(h)) : raw('')}
    ${healthCard({ canSeeFullHealth: params.owner || params.isAdmin, canTest: params.canManage, rows: params.health, horseId: h.id, gameDaysPerYear: params.gameDaysPerYear })}
    ${params.owner || params.isAdmin
      ? incidentsCard({ incidents: params.incidents, horseId: h.id, canManage: params.canManage, incidentError: params.incidentError, incidentNotice: params.incidentNotice })
      : raw('')}
    ${colourCard({ rows: params.colour, visibleColour: params.visibleColour, patternWords: params.patternWords, canTest: params.canManage, horseId: h.id })}
    ${careCard({
      care: params.care,
      feedLevelName: params.feedLevelName,
      horseId: h.id,
      canManage: params.canManage,
      pronoun: h.sex === 'mare' ? 'she' : 'he',
      careError: params.careError,
      careNotice: params.careNotice,
      managementPlans: params.managementPlans,
    })}
    ${locationCard({ horse: h, availability: params.availability, canManage: params.canManage, blockedReason: params.locationBlockedReason, error: params.locationError })}
    ${showRecordCard({
      summary: params.showSummary,
      resultGroups: params.recentShowResultGroups,
      enterShow: params.enterShow,
      enterShowError: params.enterShowError,
      enterShowNotice: params.enterShowNotice,
      horseId: h.id,
    })}
    ${sellCard({
      horse: h,
      canManage: params.canManage,
      listing: params.listing,
      guide: params.guideValue,
      commissionPercent: params.marketCommissionPercent,
      error: params.marketError,
      notice: params.marketNotice,
    })}
    ${studCard({
      horse: h,
      canManage: params.canManage,
      studListing: params.studListing,
      oldEnough: params.stallionOldEnoughForStud,
      eligibleFromGameDay: params.stallionStudEligibleFromGameDay,
      gameDaysPerYear: params.gameDaysPerYear,
      suggestedFee: params.suggestedStudFee,
      defaultSeasonCap: params.defaultStudSeasonCap,
      commissionPercent: params.marketCommissionPercent,
      error: params.studError,
      notice: params.studNotice,
    })}
    <h2>Pedigree</h2>
    ${pedigreeTable}
    ${nameForm}
    ${params.owner ? barnNameForm : raw('')}
    ${retireLink}
    ${genotypeBlock}
    ${adminDeleteBlock}
    <p><a href="/stables/${String(params.ownerStable.id)}/horses">Back to horses</a></p>
  `;
  return pageShell({
    title: displayNameFor(h),
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: params.owner ? stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer) : undefined,
    body,
  });
}

export interface TestConditionOption {
  code: string;
  name: string;
  teachingText: string;
  status: 'clear' | 'carrier' | 'affected' | null;
  copies: 0 | 1 | 2 | null;
  testedGameDay: number | null;
  /** null when this condition is already known - nothing left to buy for it. */
  price: number | null;
}

/** Amendment 0017a §4.5 point 4: the colour panel's own row shape - `known` is the stored pair
 * string ("Cr/cr"), not a clear/carrier/affected status, since a colour locus has no severity. */
export interface ColourLocusOption {
  code: string;
  name: string;
  teachingText: string;
  known: string | null;
  testedGameDay: number | null;
  price: number | null;
}

/** Slice 0010 §7.1: /horses/:id/test, owner-only. Lists every enabled condition, what is already
 * known (with its tested date) or what it costs, then either a per-condition Test button or (if
 * everything is already known) a plain sentence saying so - never a button with nothing behind it. */
export function renderTestPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  rows: TestConditionOption[];
  untestedCount: number;
  panelPrice: number;
  /** docs/fixes/breed-disease-panels.md: every breed beyond this horse's own that contributed a
   * condition to the Health panel below, by name - empty when the panel is just the horse's own
   * breed. */
  ancestryBreedNames: string[];
  /** Amendment 0017a §4.5 point 4: the colour panel, rendered as a second section on this same page. */
  colourRows: ColourLocusOption[];
  untestedColourCount: number;
  colourPanelPrice: number;
  error?: string;
}): SafeHtml {
  const h = params.horse;
  const rows = params.rows.map((row) => {
    const known: HealthConditionDisplay = {
      code: row.code,
      name: row.name,
      teachingText: row.teachingText,
      status: row.status,
      copies: row.copies,
      testedGameDay: row.testedGameDay,
      observedOnly: false,
    };
    return html`
      <div class="health-row">
        <p><strong>${row.name}:</strong> ${row.price === null ? healthStatusBadge(known) : html`<span class="muted">${String(row.price)} to test</span>`} ${row.testedGameDay !== null ? html`<span class="muted">(tested ${formatCalendarDate(row.testedGameDay, params.gameDaysPerYear)})</span>` : raw('')}</p>
        <p class="muted">${row.teachingText}</p>
        ${row.price !== null
          ? html`
            <form method="post" action="/horses/${String(h.id)}/test">
              <input type="hidden" name="condition_code" value="${row.code}">
              <button type="submit">Test for ${row.name} (${String(row.price)})</button>
            </form>`
          : raw('')}
      </div>`;
  });

  const panelBlock =
    params.untestedCount > 1
      ? html`
        <div class="card">
          <form method="post" action="/horses/${String(h.id)}/test">
            <input type="hidden" name="action" value="panel">
            <button type="submit">Test everything still unknown, all ${String(params.untestedCount)} (${String(params.panelPrice)})</button>
          </form>
        </div>`
      : raw('');

  const nothingLeft = params.untestedCount === 0 ? html`<p>Nothing is left to test - ${displayNameFor(h)} has a known result for every condition on this panel.</p>` : raw('');

  // Amendment 0017a §4.5 point 4: a second panel, same page, same mechanism - a locus result shown
  // as its stored pair rather than a clear/carrier/affected badge, since colour has no severity.
  // Slice 0021 Part F (§7.2): grouped into four collapsed <details>, all closed by default - nine
  // rows became nineteen and the flat list stopped being something a child would read.
  const colourGroups = groupByColourCategory(params.colourRows).map((group) => {
    const stillUnknown = group.rows.filter((row) => row.price !== null).length;
    const summary = stillUnknown > 0 ? `${group.label} - ${String(stillUnknown)} of ${String(group.rows.length)} still unknown` : `${group.label} - all known`;
    return html`
    <details class="section-collapse">
      <summary>${summary}</summary>
      ${group.rows.map((row) => html`
        <div class="health-row">
          <p><strong>${row.name}:</strong> ${row.known !== null ? html`<span>${row.known}</span>` : html`<span class="muted">${String(row.price)} to test</span>`} ${row.testedGameDay !== null ? html`<span class="muted">(tested ${formatCalendarDate(row.testedGameDay, params.gameDaysPerYear)})</span>` : raw('')}</p>
          <p class="muted">${row.teachingText}</p>
          ${row.price !== null
            ? html`
              <form method="post" action="/horses/${String(h.id)}/test">
                <input type="hidden" name="locus_code" value="${row.code}">
                <button type="submit">Test for ${row.name} (${String(row.price)})</button>
              </form>`
            : raw('')}
        </div>`)}
    </details>`;
  });

  const colourPanelBlock =
    params.untestedColourCount > 1
      ? html`
        <div class="card">
          <form method="post" action="/horses/${String(h.id)}/test">
            <input type="hidden" name="action" value="colour_panel">
            <button type="submit">Test every colour/gait locus still unknown, all ${String(params.untestedColourCount)} (${String(params.colourPanelPrice)})</button>
          </form>
        </div>`
      : raw('');

  const colourNothingLeft =
    params.untestedColourCount === 0 ? html`<p>Nothing is left to test - ${displayNameFor(h)} has a known result for every colour/gait locus.</p>` : raw('');

  const body = html`
    <h1>Test ${displayNameFor(h)}</h1>
    ${errorBox(params.error)}
    <p class="muted">${params.ownerStable.name}'s balance: ${String(params.ownerStable.balance)}</p>
    <h2>Health</h2>
    <p class="muted">These are the conditions that run in this horse's breeds. A test for anything else would tell you nothing, the alleles simply are not in the line.</p>
    ${params.ancestryBreedNames.length > 0
      ? html`<p class="muted">This horse has ${params.ancestryBreedNames.join(' and ')} in its pedigree, so those breeds' conditions are on its panel too.</p>`
      : raw('')}
    ${rows}
    ${panelBlock}
    ${nothingLeft}
    <h2>Colour and gait</h2>
    ${colourPanelBlock}
    ${colourNothingLeft}
    ${colourGroups}
    <p><a href="/horses/${String(h.id)}">Back to ${displayNameFor(h)}</a></p>
  `;
  return pageShell({
    title: `Test ${displayNameFor(h)}`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

interface ImageOptionGroup {
  breedCode: string;
  breedName: string;
  options: ImageOption[];
}

function imageOptionTile(option: ImageOption, checked: boolean, usedByName: string | undefined): SafeHtml {
  const alt = option.label ? `${option.alt} - ${option.label}` : option.alt;
  return html`
    <label class="image-option">
      <input type="radio" name="image" value="${option.path}" ${checked ? raw('checked') : raw('')}>
      <img src="${option.path}" width="160" loading="lazy" alt="${alt}">
      ${option.label ? html`<span class="image-option-label">${option.label}</span>` : raw('')}
      ${usedByName ? html`<span class="image-option-note">also used by ${usedByName}</span>` : raw('')}
    </label>`;
}

/** The picker's page - slice 0007 §6.2. Owner-only on both GET and POST (the route enforces this;
 * this function just renders what it's given). No JavaScript: the selected tile is CSS on
 * `input:checked + img`, and the radio stays keyboard-focusable rather than display:none. */
export function renderImagePickerPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  visibleColour: string;
  groups: ImageOptionGroup[];
  usedBy: Map<string, string>;
  error?: string;
}): SafeHtml {
  const h = params.horse;
  const totalOptions = params.groups.reduce((n, g) => n + g.options.length, 0);
  const showGroupHeadings = params.groups.length > 1;

  const gridBody =
    totalOptions === 0
      ? html`<p>There are no pictures for ${displayNameFor(h)}'s breed yet.</p>`
      : html`
        <form method="post" action="/horses/${String(h.id)}/image">
          ${params.groups.map(
            (group) => html`
              ${showGroupHeadings ? html`<h2>${group.breedName}</h2>` : raw('')}
              <div class="image-grid">
                ${group.options.map((option) =>
                  imageOptionTile(option, option.path === h.image_url, params.usedBy.get(option.path))
                )}
              </div>`
          )}
          <div class="image-grid">
            <label class="image-option image-option--none">
              <input type="radio" name="image" value="${NO_PICTURE_VALUE}" ${h.image_url === null ? raw('checked') : raw('')}>
              <span class="image-placeholder-tile">No picture</span>
            </label>
          </div>
          <button type="submit">Save</button>
        </form>`;

  const body = html`
    <h1>Choose a picture for ${displayNameFor(h)}</h1>
    ${errorBox(params.error)}
    <p>${displayNameFor(h)} is really ${params.visibleColour} - pick whichever picture you like, it doesn't need to match.</p>
    ${gridBody}
    <p><a href="/horses/${String(h.id)}">Back to ${displayNameFor(h)}</a></p>
  `;
  return pageShell({
    title: `Picture for ${displayNameFor(h)}`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

/**
 * Slice 0011 §6.2: the retire-away confirmation page - not a JavaScript dialogue, a page with
 * everything §6.2 asks for in order: who this is, "this cannot be undone", what survives, then any
 * warnings naming a pregnancy, booking or unjudged entry that retiring cancels, then the button.
 */
export function renderRetireConfirmPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  ageYears: number;
  warnings: string[];
  error?: string;
}): SafeHtml {
  const h = params.horse;
  const possessive = h.sex === 'mare' ? 'her' : 'his';
  const ageText = params.ageYears < 1 ? 'under a year old' : `${String(Math.floor(params.ageYears))} years old`;

  const portrait = h.image_url ? html`<img class="horse-portrait" src="${h.image_url}" width="240" alt="">` : raw('');

  const body = html`
    <h1>Retire ${displayNameFor(h)} away</h1>
    ${errorBox(params.error)}
    <div class="card">
      ${portrait}
      <p><strong>${displayNameFor(h)}</strong>, ${ageText}.</p>
      <p><strong>This cannot be undone.</strong></p>
      <p>${possessive === 'her' ? 'Her' : 'His'} pedigree stays. Any foals ${possessive === 'her' ? 'she has had' : 'he has had'} keep their family tree, and ${possessive} show record stays on ${possessive} page.</p>
      ${params.warnings.map((w) => html`<p class="notice">${w}</p>`)}
      <form method="post" action="/horses/${String(h.id)}/retire">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, I understand this cannot be undone.
        </label>
        <button type="submit">Retire ${displayNameFor(h)} away</button>
      </form>
      <p><a href="/horses/${String(h.id)}">Cancel</a></p>
    </div>
  `;
  return pageShell({
    title: `Retire ${displayNameFor(h)} away`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

/**
 * The pet home confirmation (src/db/petHome.ts). Deliberately shaped like the retire-away page
 * above rather than like the market's own listing form - it is the same kind of decision, one that
 * cannot be undone, and a child who has seen one should recognise the other.
 *
 * Two things this page must be honest about, because they are the whole reason a child might regret
 * it: what the horse would fetch from a real buyer (so the pet home reads as the poor deal it is),
 * and whether the horse will be gone completely or stay on the past-horses list.
 */
export function renderPetHomeConfirmPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  ownerStable: StableRow;
  hasFoundingOffer: boolean;
  horse: HorseRow;
  ageYears: number;
  appraisedValue: number;
  payout: number;
  willBeDeleted: boolean;
  warnings: string[];
  error?: string;
}): SafeHtml {
  const h = params.horse;
  const possessive = h.sex === 'mare' ? 'her' : 'his';
  const subject = h.sex === 'mare' ? 'She' : 'He';
  const ageText = params.ageYears < 1 ? 'under a year old' : `${String(Math.floor(params.ageYears))} years old`;
  const portrait = h.image_url ? html`<img class="horse-portrait" src="${h.image_url}" width="240" alt="">` : raw('');

  const body = html`
    <h1>Send ${displayNameFor(h)} to a pet home</h1>
    ${errorBox(params.error)}
    <div class="card">
      ${portrait}
      <p><strong>${displayNameFor(h)}</strong>, ${ageText}.</p>
      <p>A pet home will take ${displayNameFor(h)} today and pay <strong>${String(params.payout)}</strong>.</p>
      <p class="notice">
        ${subject} is worth about ${String(params.appraisedValue)} to a real buyer. A pet home always pays less than that -
        it is somewhere for a horse to go when nobody wants to buy ${possessive === 'her' ? 'her' : 'him'}, not a way to
        make money. If you are not in a hurry, listing ${possessive === 'her' ? 'her' : 'him'} on the market is worth trying first.
      </p>
      <p><strong>This cannot be undone.</strong></p>
      ${
        params.willBeDeleted
          ? html`<p class="notice">
              ${displayNameFor(h)} has never been shown and has never had a foal, so once ${possessive === 'her' ? 'she' : 'he'} goes
              there will be nothing left on ${possessive} page and ${possessive === 'her' ? 'she' : 'he'} will not appear in your past
              horses. If you want to keep a record of ${possessive === 'her' ? 'her' : 'him'}, take a screenshot first.
            </p>`
          : html`<p>${possessive === 'her' ? 'Her' : 'His'} pedigree and show record stay. Any foals ${possessive === 'her' ? 'she has had' : 'he has had'} keep their family tree, and you will still find ${possessive === 'her' ? 'her' : 'him'} under your past horses.</p>`
      }
      ${params.warnings.map((w) => html`<p class="notice">${w}</p>`)}
      <form method="post" action="/horses/${String(h.id)}/pet-home">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, I understand this cannot be undone.
        </label>
        <button type="submit">Send ${displayNameFor(h)} to a pet home for ${String(params.payout)}</button>
      </form>
      <p><a href="/horses/${String(h.id)}">Cancel</a></p>
    </div>
  `;
  return pageShell({
    title: `Send ${displayNameFor(h)} to a pet home`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.ownerStable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

/** Slice 0011 §8.1: how a past horse ended, in plain words - kept deliberately generic rather than
 * naming a specific condition (§3.5: no special layout, no tribute card - the horse's own page
 * already carries that detail for a condition death). */
function endedDescription(h: HorseRow): string {
  // A pet-home horse is 'removed' too, so this has to read end_reason before falling through to the
  // generic word - otherwise every horse sent to a pet home would claim it was retired away. Shared
  // with the three badge screens via removedHorseLabel, which is where that reasoning now lives.
  if (h.status === 'removed') return removedHorseLabel(h.end_reason);
  if (h.end_reason === 'old_age') return 'Died of old age';
  return 'Died';
}

/**
 * /stables/:id/past (slice 0011 §8.1): every horse this stable ever owned that has since ended,
 * newest-ended first - a plain list, not a memorial page (§3.5). Linked from the barn list.
 */
export function renderPastHorsesPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  horses: HorseRow[];
}): SafeHtml {
  const rows = params.horses.map(
    (h) => html`
    <tr>
      <td><a href="/horses/${String(h.id)}">${displayNameFor(h)}</a></td>
      <td>${h.sex}</td>
      <td>${formatCalendarDate(h.born_game_day, params.gameDaysPerYear)}</td>
      <td>${h.ended_game_day !== null ? formatCalendarDate(h.ended_game_day, params.gameDaysPerYear) : ''}</td>
      <td>${endedDescription(h)}</td>
    </tr>`
  );

  const body = html`
    <h1>${params.stable.name}'s past horses</h1>
    ${params.horses.length
      ? html`
        <table>
          <thead><tr><th>Name</th><th>Sex</th><th>Born</th><th>Ended</th><th>How</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : html`<p>No horses here have ended yet.</p>`}
    <p><a href="/stables/${String(params.stable.id)}/horses">Back to horses</a></p>
  `;
  return pageShell({
    title: `${params.stable.name} · Past horses`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(params.stable.id, 'horses', params.hasFoundingOffer),
    body,
  });
}

export function renderAdminHorseNewPage(params: {
  world: WorldRow;
  stables: StableRow[];
  breeds: BreedRow[];
  loci: LocusRow[];
  error?: string;
  form?: Record<string, string>;
}): SafeHtml {
  const f = params.form ?? {};

  const stableOptions = html`${params.stables.map(
    (s) => html`<option value="${String(s.id)}" ${f.stable_id === String(s.id) ? raw('selected') : raw('')}>${s.name}</option>`
  )}`;

  const breedOptions = html`${params.breeds.map(
    (b) => html`<option value="${String(b.id)}" data-code="${b.code}" ${f.breed_id === String(b.id) ? raw('selected') : raw('')}>${b.name}</option>`
  )}`;

  const locusFieldset = (locus: (typeof LOCI)[number]): SafeHtml => {
    const locusRow = params.loci.find((l) => l.code === locus.code);
    const [a1, a2] = locus.alleles;
    const selected1 = f[`locus_${locus.code}_1`] ?? locus.wildType;
    const selected2 = f[`locus_${locus.code}_2`] ?? locus.wildType;
    const alleleOption = (value: string, selected: string) => html`<option value="${value}" ${value === selected ? raw('selected') : raw('')}>${value}</option>`;
    return html`
      <fieldset>
        <legend>${locusRow ? locusRow.name : locus.code} (${locus.code})</legend>
        <label>Allele 1
          <select name="locus_${locus.code}_1">${alleleOption(a1, selected1)}${alleleOption(a2, selected1)}</select>
        </label>
        <label>Allele 2
          <select name="locus_${locus.code}_2">${alleleOption(a1, selected2)}${alleleOption(a2, selected2)}</select>
        </label>
        ${locusRow ? html`<p class="muted">${locusRow.teaching_text}</p>` : raw('')}
      </fieldset>
    `;
  };

  // docs/fixes/breed-disease-panels.md: nineteen loci became twenty-six - grouped into collapsed
  // <details> by category, the same treatment slice 0021 Part F gave the test page's own colour
  // panel when nine rows became nineteen. Groups read off the loci table's own category column
  // rather than a second hardcoded map, since it is already loaded here.
  const ADMIN_LOCUS_GROUP_LABEL: Record<string, string> = { base: 'Base', dilution: 'Dilutions', pattern: 'Patterns', modifier: 'Patterns', gait: 'Gait', disease: 'Disease' };
  const ADMIN_LOCUS_GROUP_ORDER = ['base', 'dilution', 'pattern', 'gait', 'disease'] as const;
  const groupKeyFor = (code: string): (typeof ADMIN_LOCUS_GROUP_ORDER)[number] => {
    const category = params.loci.find((l) => l.code === code)?.category ?? 'pattern';
    if (category === 'modifier') return 'pattern';
    const known = (ADMIN_LOCUS_GROUP_ORDER as readonly string[]).includes(category);
    return known ? (category as (typeof ADMIN_LOCUS_GROUP_ORDER)[number]) : 'pattern';
  };
  const byGroup = new Map<string, (typeof LOCI)[number][]>();
  for (const locus of LOCI) {
    const key = groupKeyFor(locus.code);
    const list = byGroup.get(key) ?? [];
    list.push(locus);
    byGroup.set(key, list);
  }
  const locusGroups = ADMIN_LOCUS_GROUP_ORDER.filter((key) => byGroup.has(key)).map(
    (key) => html`
    <details class="section-collapse" ${key === 'base' ? raw('open') : raw('')}>
      <summary>${ADMIN_LOCUS_GROUP_LABEL[key]} (${String(byGroup.get(key)!.length)})</summary>
      ${byGroup.get(key)!.map(locusFieldset)}
    </details>`
  );

  const body = html`
    <h1>Create a founding horse</h1>
    ${errorBox(params.error)}
    <form method="post" action="/admin/horses/new">
      <label>Owning stable
        <select name="stable_id" required>${stableOptions}</select>
      </label>
      <label>Sex
        <select name="sex" required>
          <option value="mare" ${f.sex === 'mare' ? raw('selected') : raw('')}>Mare</option>
          <option value="stallion" ${f.sex === 'stallion' ? raw('selected') : raw('')}>Stallion</option>
        </select>
      </label>
      <label>Breed
        <select name="breed_id" required>${breedOptions}</select>
      </label>
      <label>Name
        <input type="text" name="name" required maxlength="40" value="${f.name ?? ''}">
      </label>
      <label>Age in years
        <input type="text" inputmode="numeric" name="age_years" required value="${f.age_years ?? '4'}">
      </label>
      <h2>Genotype</h2>
      <p class="muted">Any allele can be set on any breed here. A condition only appears on a horse's testing page if it runs in that horse's breeds, so an allele set outside its breed will be real but untestable.</p>
      ${locusGroups}
      <button type="submit">Create horse</button>
    </form>
  `;
  return pageShell({ title: 'Create a founding horse', world: params.world, loggedIn: true, isAdmin: true, actionsLeft: null, section: 'admin', body });
}
