// The stable's own money history (slice 0009 §7.1). Owner-only, same notFound()-for-a-non-owner
// shape every other stable-scoped route uses.

import { html, SafeHtml } from '../lib/html';
import { pageShell } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { LedgerRow } from '../db/ledger';

export function renderMoneyPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  rows: (LedgerRow & { runningBalance: number })[];
}): SafeHtml {
  const s = params.stable;
  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td>${String(r.game_day)}</td>
      <td>${r.description}</td>
      <td>${r.amount >= 0 ? '+' : ''}${String(r.amount)}</td>
      <td>${String(r.runningBalance)}</td>
    </tr>`
  );

  const body = html`
    <h1>${s.name} - money</h1>
    <p><strong>Current balance:</strong> ${String(s.balance)}</p>
    <table>
      <thead><tr><th>Game day</th><th>What for</th><th>Amount</th><th>Balance after</th></tr></thead>
      <tbody>${rows.length ? rows : html`<tr><td colspan="4" class="muted">Nothing here yet.</td></tr>`}</tbody>
    </table>
    <p class="muted">Newest first. The oldest row is this stable's starting balance.</p>
    <p><a href="/stables/${String(s.id)}">Back to ${s.name}</a></p>
  `;
  return pageShell({
    title: `${s.name} - money`,
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    subnav: stableSubnav(s.id, 'money', params.hasFoundingOffer),
    body,
  });
}
