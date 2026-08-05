// Slice 0016 §6.6: these render functions receive plain view objects assembled by
// src/routes/world.ts. They must never take a HorseRow, a Genotype, a knowledge row or a config
// object. If a field is needed here that is not on one of these view types, the question to answer
// first is whether §2.2 of slice 0016 makes it public - not how to get it into scope.

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell } from './layout';
import { placingText, showResultGroupsHtml, rankBadgeHtml, type ShowResultGroup } from './shows';
import type { WorldRow } from '../db/world';
import type { HorseHighestRank } from '../db/shows';

export interface WorldStableListRow {
  id: number;
  name: string;
  prefix: string;
  isNpc: boolean;
  /** Null for an NPC stable or a stable whose owning account was deleted. */
  ownerDisplayName: string | null;
  horseCount: number;
  /** Ignored for an NPC stable - see the render function's own comment (§6.2.1). */
  balance: number;
  isMine: boolean;
}

function shellParams(world: WorldRow, isAdmin: boolean, actionsLeft: number | null, gameDaysPerYear: number) {
  return { world, loggedIn: true, isAdmin, actionsLeft, gameDaysPerYear };
}

export function renderWorldIndexPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stables: WorldStableListRow[];
}): SafeHtml {
  const rows = params.stables.map((s) => {
    const whoRunsIt = s.isNpc ? 'Run by the game' : (s.ownerDisplayName ?? 'a deleted account');
    // §6.2.1: an NPC stable's balance is a one-way counter measuring nothing a player's balance
    // measures (it earns prize money and pays no upkeep), so it is never shown as a number.
    const moneyCell = s.isNpc ? 'Run by the game' : String(s.balance);
    const horseCell = s.horseCount === 0 ? 'no horses yet' : String(s.horseCount);
    return html`
      <tr>
        <td><a href="/world/stables/${String(s.id)}">${s.name}</a> ${s.isMine ? html`<span class="badge">yours</span>` : raw('')}</td>
        <td>${s.prefix}</td>
        <td>${whoRunsIt}</td>
        <td>${horseCell}</td>
        <td>${moneyCell}</td>
      </tr>`;
  });

  const body = html`
    <h1>Everyone</h1>
    <p class="muted">You can see what everyone keeps and what they're worth. What a horse measures, what it has been tested for, and how each stable spends its money stay private.</p>
    <table>
      <thead><tr><th>Stable</th><th>Prefix</th><th>Run by</th><th>Horses</th><th>Money</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return pageShell({ ...shellParams(params.world, params.isAdmin, params.actionsLeft, params.gameDaysPerYear), title: 'Everyone', body });
}

export interface WorldRosterHorse {
  id: number;
  name: string;
  description: string;
  imageUrl: string | null;
  ribbon: string | null;
}

export function renderWorldStablePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: { id: number; name: string; prefix: string; isNpc: boolean; balance: number; capacity: number; aliveHorseCount: number };
  horses: WorldRosterHorse[];
}): SafeHtml {
  const s = params.stable;
  const moneyLine = s.isNpc ? 'Run by the game' : String(s.balance);

  const cards = params.horses.length
    ? params.horses.map(
        (h) => html`
        <div class="card horse-row">
          ${h.imageUrl ? html`<img class="horse-thumb" src="${h.imageUrl}" width="96" loading="lazy" alt="">` : html`<span class="horse-thumb horse-thumb--placeholder" aria-hidden="true"></span>`}
          <div>
            <h2><a href="/world/horses/${String(h.id)}">${h.name}</a> ${h.ribbon ? html`<span class="badge">${h.ribbon}</span>` : raw('')}</h2>
            <p>${h.description}</p>
          </div>
        </div>`
      )
    : html`<p>No horses here yet.</p>`;

  const body = html`
    <h1>${s.name}</h1>
    <div class="card">
      <p><strong>Prefix:</strong> ${s.prefix} &middot; <strong>Run by:</strong> ${s.isNpc ? 'the game' : 'a player'}</p>
      <p><strong>Money:</strong> ${moneyLine} &middot; <strong>Capacity:</strong> ${String(s.capacity)} &middot; <strong>Horses:</strong> ${String(s.aliveHorseCount)}</p>
    </div>
    ${cards}
    <p><a href="/world">Back to Everyone</a></p>
  `;
  return pageShell({ ...shellParams(params.world, params.isAdmin, params.actionsLeft, params.gameDaysPerYear), title: s.name, body });
}

export interface PublicHorseView {
  id: number;
  name: string;
  breedName: string | null;
  isCross: boolean;
  description: string;
  sex: 'mare' | 'stallion' | 'gelding';
  ageLabel: string;
  imageUrl: string | null;
  bredByLabel: string;
  currentStable: { id: number; name: string };
  sire: { id: number; name: string } | null;
  dam: { id: number; name: string } | null;
  starts: number;
  wins: number;
  bestPlacing: number | null;
  /** Placings grouped by class type, exactly as the owner's own horse page groups them. */
  recentResultGroups: ShowResultGroup[];
  /** Slice 0026 §3.1: rank is public - shown on this non-owner screen exactly as on the barn list. */
  highestRank: HorseHighestRank | undefined;
  /** "Died" / "Retired away" / null when alive. */
  statusLabel: string | null;
  atPasture: boolean;
  /** Slice 0017 §9: this horse's open listing, or null. Public information - an asking price is not
   * a measured value, so this does not breach §2.2's rule about what a stranger can see. The guide
   * value never appears here; only what the seller is asking. */
  listing: { listingId: number; price: number } | null;
}

function pedigreeSlot(slot: { id: number; name: string } | null): SafeHtml {
  return slot ? html`<a href="/world/horses/${String(slot.id)}">${slot.name}</a>` : html`<span class="muted">unknown</span>`;
}

export function renderWorldHorsePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  horse: PublicHorseView;
}): SafeHtml {
  const h = params.horse;

  const portrait = h.imageUrl
    ? html`<img class="horse-portrait" src="${h.imageUrl}" width="480" alt="">`
    : html`<div class="horse-portrait horse-portrait--placeholder"><p>${h.name} - no picture chosen.</p></div>`;

  const statusMarker = h.statusLabel ? html`<span class="badge">${h.statusLabel}</span>` : raw('');
  const pastureNote = h.atPasture ? html`<p class="muted">Out at pasture.</p>` : raw('');

  const body = html`
    <h1>${h.name}</h1>
    <div class="card">
      ${portrait}
      <p>${h.description}</p>
      <p><strong>Sex:</strong> ${h.sex} &middot; <strong>Age:</strong> ${h.ageLabel} ${statusMarker}</p>
      ${pastureNote}
      <p><strong>Breed:</strong> ${h.breedName ?? (h.isCross ? 'Cross' : 'Unknown')}</p>
      <p><strong>Bred by:</strong> ${h.bredByLabel}</p>
      <p><strong>Stable:</strong> <a href="/world/stables/${String(h.currentStable.id)}">${h.currentStable.name}</a></p>
      ${h.listing ? html`<p><strong>For sale — ${String(h.listing.price)}</strong> · <a href="/market/${String(h.listing.listingId)}">see the listing</a></p>` : raw('')}
    </div>
    <div class="card">
      <h2>Pedigree</h2>
      <table>
        <thead><tr><th>Sire</th><th>Dam</th></tr></thead>
        <tbody><tr><td>${pedigreeSlot(h.sire)}</td><td>${pedigreeSlot(h.dam)}</td></tr></tbody>
      </table>
    </div>
    <div class="card">
      <h2>Show record</h2>
      <p><strong>Starts:</strong> ${String(h.starts)} &middot; <strong>Wins:</strong> ${String(h.wins)} &middot; <strong>Best:</strong> ${h.bestPlacing !== null ? placingText(h.bestPlacing) : 'none yet'} ${rankBadgeHtml(h.highestRank)}</p>
      ${showResultGroupsHtml(h.recentResultGroups)}
    </div>
    <p><a href="/world">Back to Everyone</a></p>
  `;
  return pageShell({ ...shellParams(params.world, params.isAdmin, params.actionsLeft, params.gameDaysPerYear), title: h.name, body });
}
