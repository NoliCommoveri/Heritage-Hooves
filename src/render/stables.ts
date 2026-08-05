import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, type NavLink } from './layout';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { EventRow } from '../db/events';
import { placingText } from './shows';
import { formatCalendarDate } from '../lib/calendar';

export type StableSubnavPage = 'overview' | 'horses' | 'breed' | 'prefix' | 'founding' | 'money';

export interface AwayEvent {
  id: number;
  gameDay: number;
  sentence: string;
  horseId: number | null;
}

/** Turns one event row's payload into the one sentence the "While you were away" panel (§6.3) and
 * a stable's own home-page feed both show. A missing payload key is legal (§6.2's "v" convention -
 * the same discipline horses.genotype's missing-locus rule follows) and renders defensively rather
 * than throwing. */
export function eventSentence(row: EventRow): AwayEvent {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const str = (key: string, fallback: string): string => (typeof payload[key] === 'string' ? (payload[key] as string) : fallback);

  let sentence: string;
  switch (row.kind) {
    case 'foaled': {
      const sex = str('sex', 'foal');
      sentence = `${str('foal_name', `A new ${sex}`)} was born to ${str('dam_name', 'a mare')} and ${str('sire_name', 'a stallion')}.`;
      break;
    }
    case 'covering_conceived': {
      const due = typeof payload.due_game_day === 'number' ? payload.due_game_day : null;
      sentence = `${str('mare_name', 'A mare')}'s covering to ${str('stallion_name', 'a stallion')} took${due !== null ? ` - due around game day ${String(due)}` : ''}.`;
      break;
    }
    case 'covering_missed':
      sentence = `${str('mare_name', 'A mare')}'s covering to ${str('stallion_name', 'a stallion')} didn't take this time.`;
      break;
    case 'show_result': {
      const placing = typeof payload.placing === 'number' ? payload.placing : null;
      const prize = typeof payload.prize === 'number' ? payload.prize : 0;
      const prizeSentence = prize > 0 ? ` - paid ${String(prize)}` : '';
      sentence = `${str('horse_name', 'A horse')} placed ${placing !== null ? placingText(placing) : 'unranked'} at ${str('show_name', 'a show')}${prizeSentence}.`;
      break;
    }
    // Slice 0010 §6.4/§6.3: written the moment a newborn or founding horse's genotype already
    // reads as affected by a condition with signs_visible = 1 - "signs" here means "identifiable
    // from birth", since no onset model exists yet (that slice's §3.2).
    case 'condition_signs':
      sentence = `${str('horse_name', 'A horse')} shows signs of ${str('condition_name', 'a condition')}.`;
      break;
    // Slice 0010 §6.4/§5.6: the one place conditions.event_text is shown in full rather than
    // summarised - it is drafted, calm, multi-paragraph prose, and the feed gives it room. The
    // heading names whoever is easiest to identify the loss by, which for an unnamed foal is
    // usually its dam, not the foal's own "Unnamed filly/colt".
    case 'horse_died': {
      const eventText = str('event_text', `${str('horse_name', 'A foal')} has died from ${str('condition_name', 'a condition')}.`);
      sentence = `${str('dam_name', 'A mare')}'s foal has died.\n\n${eventText}`;
      break;
    }
    // Slice 0011 §2.1/§7.7: informative, unhurried, and specific about what is still possible - the
    // whole point of announcing death rather than letting it arrive silently (§2.1's argument
    // against a second unannounced mode).
    case 'horse_failing': {
      const name = str('horse_name', 'A horse');
      const age = typeof payload.age_years === 'number' ? String(payload.age_years) : 'old';
      const isMare = payload.sex === 'mare';
      const subject = isMare ? 'she' : 'he';
      const object = isMare ? 'her' : 'him';
      sentence = `${name} is ${age} now, and ${subject} is starting to slow down. ${subject[0].toUpperCase()}${subject.slice(1)} can still be shown and still be bred, and there is nothing that needs treating - this is just what getting old looks like. If there is a show you wanted ${object} to have, this is the season for it.`;
      break;
    }
    // Slice 0011 §2.1/§7.7: short, warm, no euphemism and no drama - drafted now rather than at the
    // point of failure, per slice 0010 §5.6's own reasoning for the GBED wording.
    // Slice 0013 §7.4/§7.5: one line per crossing, for the whole barn - drafted deliberately
    // unalarming (§7.5's own reasoning: the farrier being late is not an emergency and should never
    // read as one). Names the count for whichever service(s) are newly overdue; the barn list has
    // the button to fix it.
    case 'care_due': {
      const farrierCount = typeof payload.farrier_count === 'number' ? payload.farrier_count : 0;
      const wellnessCount = typeof payload.wellness_count === 'number' ? payload.wellness_count : 0;
      const parts: string[] = [];
      if (farrierCount > 0) parts.push(`${String(farrierCount)} for the farrier`);
      if (wellnessCount > 0) parts.push(`${String(wellnessCount)} for a wellness visit`);
      sentence = `${parts.join(' and ')} - not urgent, but placing a little below their best until it's done. You can do the whole barn at once from your barn page.`;
      break;
    }
    case 'horse_died_old_age': {
      const name = str('horse_name', 'A horse');
      const age = typeof payload.age_years === 'number' ? String(payload.age_years) : 'old age';
      const isMare = payload.sex === 'mare';
      const possessive = isMare ? 'her' : 'his';
      const subject = isMare ? 'She' : 'He';
      const foals = typeof payload.foals === 'number' ? payload.foals : 0;
      const foalsSentence = foals > 0 ? ` ${subject} leaves ${String(foals)} foal${foals === 1 ? '' : 's'}, and every one of them carries ${possessive} line.` : '';
      sentence = `${name} died peacefully in ${possessive} paddock at ${age}, after a long life.${foalsSentence} ${subject === 'She' ? 'Her' : 'His'} page is still there whenever you want to look.`;
      break;
    }
    // Slice 0017 §7.2/§8: both written for the seller only - the buyer was there, pressing the
    // button, and an expiry is news only to the stable whose horse did not sell.
    case 'horse_sold': {
      const price = typeof payload.price === 'number' ? String(payload.price) : 'an agreed price';
      sentence = `${str('horse_name', 'A horse')} was sold to ${str('buyer_stable_name', 'another stable')} for ${price}.`;
      break;
    }
    case 'listing_expired': {
      const price = typeof payload.price === 'number' ? String(payload.price) : null;
      sentence = `${str('horse_name', 'A horse')} didn't sell${price ? ` at ${price}` : ''} and has come off the market. You can put them back on at any time, at any price you like.`;
      break;
    }
    // Amendment 0017a §5.7: the consignment dealer's own 90-game-day batch landing.
    case 'consignment_batch': {
      const count = typeof payload.count === 'number' ? payload.count : 1;
      sentence = `The consignment dealer has ${String(count)} new horse${count === 1 ? '' : 's'} on the market. Standing for 90 game days, or until claimed.`;
      break;
    }
    // Slice 0020 §7.4: the acute-incident lifecycle's two events. Calm and specific, per §4.5's own
    // instruction that the wording never read as blame - the same register slice 0010 §5.6
    // established for GBED, applied here to an incident with no genetic cause at all.
    case 'incident_onset': {
      const name = str('horse_name', 'A horse');
      const condition = str('condition_name', 'a condition');
      const window = typeof payload.window_game_days === 'number' ? payload.window_game_days : null;
      const cost = typeof payload.treatment_cost === 'number' ? payload.treatment_cost : null;
      const windowSentence = window !== null ? ` Call the vet within ${String(window)} day${window === 1 ? '' : 's'}${cost !== null ? ` - ${String(cost)}` : ''}.` : '';
      sentence = `${name} has ${condition}.${windowSentence}`;
      break;
    }
    case 'incident_resolved': {
      const name = str('horse_name', 'A horse');
      const condition = str('condition_name', 'a condition');
      const outcome = str('outcome', 'resolved');
      const treated = payload.treated === true;
      const outcomeSentence =
        outcome === 'resolved'
          ? `${name} has recovered from ${condition}.`
          : outcome === 'manageable'
            ? `${name}'s ${condition} has settled into an ongoing management plan.`
            : outcome === 'degenerative'
              ? `${name}'s ${condition} has left a lasting problem, and ${name} can no longer be shown.`
              : `${name} did not survive ${condition}. ${name} stays in the barn's records, in every pedigree ${name} belongs to, exactly as ${name} was.`;
      sentence = treated || outcome === 'death' ? outcomeSentence : `${outcomeSentence} (untreated)`;
      break;
    }
    // Slice 0026 §1.2.
    case 'gelded':
      sentence = `${str('horse_name', 'A stallion')} was gelded.`;
      break;
    default:
      sentence = row.kind;
  }

  return { id: row.id, gameDay: row.game_day, sentence, horseId: row.subject_horse_id };
}

/** The "While you were away" panel (§6.3): the account's unread events across every stable it
 * owns, newest first. A `POST` "Mark all read" button, never a side effect of the GET that shows
 * this panel. Empty and silent when there is nothing new, rather than an empty box. */
function awayPanel(events: AwayEvent[]): SafeHtml {
  if (events.length === 0) return raw('');
  const rows = events.map(
    (e) =>
      html`<li class="${e.sentence.includes('\n') ? 'event-long' : ''}">${e.horseId !== null ? html`<a href="/horses/${String(e.horseId)}">${e.sentence}</a>` : html`${e.sentence}`} <span class="muted">(game day ${String(e.gameDay)})</span></li>`
  );
  return html`
    <div class="card">
      <h2>While you were away</h2>
      <ul>${rows}</ul>
      <form method="post" action="/stables">
        <input type="hidden" name="action" value="mark_read">
        <button type="submit" class="secondary">Mark all read</button>
      </form>
    </div>
  `;
}

/** hasFoundingOffer (slice 0005 §11): "New horses" only appears while there is something waiting -
 * a pending breed choice or an open batch to claim - not once it's been claimed. */
export function stableSubnav(stableId: number, active: StableSubnavPage, hasFoundingOffer: boolean): NavLink[] {
  const links: NavLink[] = [
    { label: 'Overview', href: `/stables/${String(stableId)}`, active: active === 'overview' },
    { label: 'Horses', href: `/stables/${String(stableId)}/horses`, active: active === 'horses' },
    { label: 'Breed', href: `/stables/${String(stableId)}/breed`, active: active === 'breed' },
    { label: 'Money', href: `/stables/${String(stableId)}/money`, active: active === 'money' },
    { label: 'Change prefix', href: `/stables/${String(stableId)}/prefix`, active: active === 'prefix' },
  ];
  if (hasFoundingOffer) {
    links.push({ label: 'New horses', href: `/stables/${String(stableId)}/founding`, active: active === 'founding' });
  }
  return links;
}

export function renderStablesPicker(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stables: StableRow[];
  canCreateMore: boolean;
  maxStables: number;
  awayEvents: AwayEvent[];
}): SafeHtml {
  const list = params.stables.length
    ? html`${params.stables.map(
        (s) => html`
        <div class="card">
          <h2>${s.name}</h2>
          <p class="muted">Prefix: ${s.prefix}</p>
          <form method="post" action="/stables/${String(s.id)}/select">
            <button type="submit">Choose ${s.name}</button>
          </form>
        </div>`
      )}`
    : html`<p>You don't have a stable yet.</p>`;

  const createLink = params.canCreateMore
    ? html`<p><a class="button-link" href="/stables/new">Create a new stable</a></p>`
    : html`<p class="muted">You already have ${String(params.maxStables)} stables, the most one account can hold.</p>`;

  const body = html`
    <h1>Your stables</h1>
    ${awayPanel(params.awayEvents)}
    ${list}
    ${createLink}
  `;
  return pageShell({ title: 'Your stables', world: params.world, loggedIn: true, isAdmin: params.isAdmin, actionsLeft: params.actionsLeft, gameDaysPerYear: params.gameDaysPerYear, body });
}

export function renderNewStablePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  error?: string;
  name?: string;
  prefix?: string;
}): SafeHtml {
  const body = html`
    <h1>Create a stable</h1>
    ${errorBox(params.error)}
    <form method="post" action="/stables/new">
      <label>Stable name
        <input type="text" name="name" required value="${params.name ?? ''}">
      </label>
      <label>Breeding prefix
        <input type="text" name="prefix" required value="${params.prefix ?? ''}">
      </label>
      <p class="muted">Every horse this stable breeds carries this prefix, permanently, once the stable's first foal is born. You can change it freely until then.</p>
      <button type="submit">Create stable</button>
    </form>
  `;
  return pageShell({ title: 'Create a stable', world: params.world, loggedIn: true, isAdmin: params.isAdmin, actionsLeft: params.actionsLeft, gameDaysPerYear: params.gameDaysPerYear, body });
}

/** The stable home page's own feed (§6.3): read and unread together, most recent 20 - a compact
 * list, not the "While you were away" panel's own unread-only, mark-as-read treatment. */
function stableFeed(events: AwayEvent[]): SafeHtml {
  if (events.length === 0) return raw('');
  const rows = events.map(
    (e) =>
      html`<li class="${e.sentence.includes('\n') ? 'event-long' : ''}">${e.horseId !== null ? html`<a href="/horses/${String(e.horseId)}">${e.sentence}</a>` : html`${e.sentence}`} <span class="muted">(game day ${String(e.gameDay)})</span></li>`
  );
  return html`
    <div class="card">
      <h2>Recent happenings</h2>
      <ul>${rows}</ul>
    </div>
  `;
}

export function renderStableHomePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  aliveHorseCount: number;
  upkeepPerHorsePerGameDay: number;
  recentEvents: AwayEvent[];
}): SafeHtml {
  const s = params.stable;
  const foundingCallout = params.hasFoundingOffer
    ? html`<p class="notice">New horses are waiting. <a href="/stables/${String(s.id)}/founding">Take a look</a>.</p>`
    : raw('');
  const dailyCost = params.aliveHorseCount * params.upkeepPerHorsePerGameDay;
  const upkeepLine =
    params.aliveHorseCount > 0
      ? html`<p class="muted">${String(params.aliveHorseCount)} horse${params.aliveHorseCount === 1 ? '' : 's'}, ${String(dailyCost)} a day to keep.</p>`
      : html`<p class="muted">No horses yet, so nothing costs anything to keep.</p>`;
  const balanceLine =
    s.balance < 0
      ? html`<p class="error"><strong>Balance:</strong> ${String(s.balance)} - this stable is in the red.</p>`
      : html`<p><strong>Balance:</strong> ${String(s.balance)}</p>`;
  const body = html`
    <h1>${s.name}</h1>
    ${foundingCallout}
    <div class="card">
      <p><strong>Prefix:</strong> ${s.prefix} ${s.prefix_locked ? raw('<span class="muted">(locked)</span>') : html``}</p>
      ${balanceLine}
      ${upkeepLine}
      <p><a href="/stables/${String(s.id)}/money">See the money history</a></p>
      <p><strong>Capacity:</strong> ${String(s.capacity)}</p>
      <p><strong>Founded:</strong> ${formatCalendarDate(s.created_game_day, params.gameDaysPerYear)} <span class="muted">(game day ${String(s.created_game_day)})</span></p>
    </div>
    <p><a class="button-link" href="/stables/${String(s.id)}/horses">Horses</a></p>
    <p><a class="button-link" href="/stables/${String(s.id)}/breed">Breed</a></p>
    ${stableFeed(params.recentEvents)}
    <p><a href="/stables">Back to your stables</a></p>
  `;
  return pageShell({
    title: s.name,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(s.id, 'overview', params.hasFoundingOffer),
    body,
  });
}

export function renderPrefixPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  error?: string;
}): SafeHtml {
  const s = params.stable;
  const body = s.prefix_locked
    ? html`
      <h1>Prefix locked</h1>
      <p>${s.name} has bred its first horse, so its prefix (${s.prefix}) is permanent and can no longer change.</p>
      <p><a href="/stables/${String(s.id)}">Back to ${s.name}</a></p>
    `
    : html`
      <h1>Change ${s.name}'s prefix</h1>
      ${errorBox(params.error)}
      <form method="post" action="/stables/${String(s.id)}/prefix">
        <label>New prefix
          <input type="text" name="prefix" required value="${s.prefix}">
        </label>
        <button type="submit">Save prefix</button>
      </form>
      <p><a href="/stables/${String(s.id)}">Cancel</a></p>
    `;
  return pageShell({
    title: 'Change prefix',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(s.id, 'prefix', params.hasFoundingOffer),
    body,
  });
}
