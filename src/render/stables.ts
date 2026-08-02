import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, type NavLink } from './layout';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';

export type StableSubnavPage = 'overview' | 'horses' | 'breed' | 'prefix';

export function stableSubnav(stableId: number, active: StableSubnavPage): NavLink[] {
  return [
    { label: 'Overview', href: `/stables/${String(stableId)}`, active: active === 'overview' },
    { label: 'Horses', href: `/stables/${String(stableId)}/horses`, active: active === 'horses' },
    { label: 'Breed', href: `/stables/${String(stableId)}/breed`, active: active === 'breed' },
    { label: 'Change prefix', href: `/stables/${String(stableId)}/prefix`, active: active === 'prefix' },
  ];
}

export function renderStablesPicker(params: {
  world: WorldRow;
  isAdmin: boolean;
  stables: StableRow[];
  canCreateMore: boolean;
  maxStables: number;
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
    ${list}
    ${createLink}
  `;
  return pageShell({ title: 'Your stables', world: params.world, loggedIn: true, isAdmin: params.isAdmin, body });
}

export function renderNewStablePage(params: {
  world: WorldRow;
  isAdmin: boolean;
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
  return pageShell({ title: 'Create a stable', world: params.world, loggedIn: true, isAdmin: params.isAdmin, body });
}

export function renderStableHomePage(params: { world: WorldRow; isAdmin: boolean; stable: StableRow }): SafeHtml {
  const s = params.stable;
  const body = html`
    <h1>${s.name}</h1>
    <div class="card">
      <p><strong>Prefix:</strong> ${s.prefix} ${s.prefix_locked ? raw('<span class="muted">(locked)</span>') : html``}</p>
      <p><strong>Balance:</strong> ${String(s.balance)}</p>
      <p><strong>Capacity:</strong> ${String(s.capacity)}</p>
      <p><strong>Founded:</strong> game day ${String(s.created_game_day)}</p>
    </div>
    <p><a class="button-link" href="/stables/${String(s.id)}/horses">Horses</a></p>
    <p><a class="button-link" href="/stables/${String(s.id)}/breed">Breed</a></p>
    <p><a href="/stables">Back to your stables</a></p>
  `;
  return pageShell({
    title: s.name,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    subnav: stableSubnav(s.id, 'overview'),
    body,
  });
}

export function renderPrefixPage(params: { world: WorldRow; isAdmin: boolean; stable: StableRow; error?: string }): SafeHtml {
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
    subnav: stableSubnav(s.id, 'prefix'),
    body,
  });
}
