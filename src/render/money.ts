// The stable's own money history (slice 0009 §7.1). Owner-only, same notFound()-for-a-non-owner
// shape every other stable-scoped route uses.

import { html, raw, SafeHtml } from '../lib/html';
import { pageShell } from './layout';
import { stableSubnav } from './stables';
import type { WorldRow } from '../db/world';
import type { StableRow } from '../db/stables';
import type { LedgerDisplayRow, LedgerKind } from '../db/ledger';

/** Slice 0017 §9: a plain-English name for what each movement is, so the three market kinds read as
 * three different things rather than as three amounts. The description sentence still carries the
 * detail; this is the column a child scans. */
const KIND_LABELS: Record<LedgerKind, string> = {
  opening: 'Starting balance',
  upkeep: 'Board',
  prize: 'Prize money',
  adjustment: 'Adjustment',
  vet: 'Vet',
  farrier: 'Farrier',
  sale: 'Sold a horse',
  purchase: 'Bought a horse',
  // Slice 0017 Part D: renamed from "Sale commission" now that a stud fee carries the same
  // commission a sale does - the description sentence on the row still says which.
  commission: 'Market commission',
  stud_fee_paid: 'Stud fee paid',
  stud_fee_received: 'Stud fee received',
  pet_home_payout: 'Went to a pet home',
  evaluation: 'Conformation evaluation',
  time_warp: 'Grew a horse up',
  gelding: 'Gelding',
  prenatal_care: 'Prenatal care',
};

export function renderMoneyPage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  stable: StableRow;
  hasFoundingOffer: boolean;
  rows: (LedgerDisplayRow & { runningBalance: number })[];
}): SafeHtml {
  const s = params.stable;
  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td>${String(r.game_day)}</td>
      <td>${KIND_LABELS[r.kind] ?? r.kind}</td>
      <td>${r.description}${r.counterparty_stable_name ? html` <span class="muted">(with ${r.counterparty_stable_name})</span>` : raw('')}</td>
      <td>${r.amount >= 0 ? '+' : ''}${String(r.amount)}</td>
      <td>${String(r.runningBalance)}</td>
    </tr>`
  );

  const body = html`
    <h1>${s.name} - money</h1>
    <p><strong>Current balance:</strong> ${String(s.balance)}</p>
    <table>
      <thead><tr><th>Game day</th><th>Kind</th><th>What for</th><th>Amount</th><th>Balance after</th></tr></thead>
      <tbody>${rows.length ? rows : html`<tr><td colspan="5" class="muted">Nothing here yet.</td></tr>`}</tbody>
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
