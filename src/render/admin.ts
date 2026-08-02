import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox, type NavLink } from './layout';
import type { WorldRow } from '../db/world';
import type { AccountRow } from '../db/accounts';
import type { Config } from '../lib/config-cache';
import type { TickRunRow } from '../db/tickRuns';
import { formatLocal } from '../lib/time';

function adminSubnav(active: 'home' | 'accounts' | 'config' | 'world' | 'breeding' | 'migrations'): NavLink[] {
  return [
    { label: 'Admin home', href: '/admin', active: active === 'home' },
    { label: 'Accounts', href: '/admin/accounts', active: active === 'accounts' },
    { label: 'Config', href: '/admin/config', active: active === 'config' },
    { label: 'World clock', href: '/admin/world', active: active === 'world' },
    { label: 'Breeding', href: '/admin/breeding', active: active === 'breeding' },
    { label: 'Migrations', href: '/admin/migrations', active: active === 'migrations' },
  ];
}

function shell(
  world: WorldRow,
  body: SafeHtml,
  title: string,
  active: 'home' | 'accounts' | 'config' | 'world' | 'breeding' | 'migrations'
): SafeHtml {
  return pageShell({
    title,
    world,
    loggedIn: true,
    isAdmin: true,
    section: 'admin',
    subnav: adminSubnav(active),
    body,
  });
}

export function renderAdminHomePage(params: { world: WorldRow }): SafeHtml {
  const w = params.world;
  const body = html`
    <h1>Admin</h1>
    <div class="card">
      <p><strong>Game day:</strong> ${String(w.game_day)}</p>
      <p><strong>Tick sequence:</strong> ${String(w.tick_seq)}</p>
      <p><strong>Paused:</strong> ${w.paused ? 'yes' : 'no'}</p>
    </div>
    <p><a class="button-link" href="/admin/accounts">Accounts</a></p>
    <p><a class="button-link" href="/admin/config">Config</a></p>
    <p><a class="button-link" href="/admin/world">World clock</a></p>
    <p><a class="button-link" href="/admin/horses/new">Create a founding horse</a></p>
    <p><a class="button-link" href="/admin/breeding">Breeding</a></p>
    <p><a class="button-link" href="/admin/migrations">Migrations</a></p>
    <p><a class="button-link" href="/health">Health page</a></p>
  `;
  return shell(w, body, 'Admin', 'home');
}

export function renderAccountsPage(params: {
  world: WorldRow;
  accounts: AccountRow[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const rows = params.accounts.map(
    (a) => html`
    <tr>
      <td>${a.username}</td>
      <td>${a.display_name}</td>
      <td>${a.is_admin ? 'admin' : 'player'}</td>
      <td>${a.active ? 'active' : 'deactivated'}</td>
      <td>${a.must_change_password ? html`<span class="badge badge-warning">must change password</span>` : ''}</td>
      <td>
        <details class="row-actions">
          <summary>Manage</summary>
          <form method="post" action="/admin/accounts">
            <input type="hidden" name="action" value="${a.active ? 'deactivate' : 'reactivate'}">
            <input type="hidden" name="account_id" value="${String(a.id)}">
            <button type="submit" class="secondary">${a.active ? 'Deactivate' : 'Reactivate'}</button>
          </form>
          <form method="post" action="/admin/accounts">
            <input type="hidden" name="action" value="reset_password">
            <input type="hidden" name="account_id" value="${String(a.id)}">
            <label>New starting password
              <input type="password" name="starting_password" required>
            </label>
            <button type="submit" class="secondary">Reset password</button>
          </form>
        </details>
      </td>
    </tr>`
  );

  const body = html`
    <h1>Accounts</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <table>
      <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <details class="section-collapse" ${params.error ? raw('open') : raw('')}>
      <summary>Create an account</summary>
      <form method="post" action="/admin/accounts">
        <input type="hidden" name="action" value="create">
        <label>Their name
          <input type="text" name="display_name" required>
        </label>
        <label>Username
          <input type="text" name="username" required autocapitalize="off">
        </label>
        <label>Starting password
          <input type="password" name="starting_password" required>
        </label>
        <button type="submit">Create account</button>
      </form>
    </details>
  `;
  return shell(params.world, body, 'Accounts', 'accounts');
}

export function renderConfigPage(params: { world: WorldRow; config: Config; error?: string; notice?: string }): SafeHtml {
  const v = params.config.values;
  const body = html`
    <h1>Config</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <form method="post" action="/admin/config">
      <label>Display time zone
        <input type="text" name="display_timezone" value="${v.display_timezone}">
      </label>
      <label>Game days per tick
        <input type="text" inputmode="numeric" name="game_days_per_tick" value="${String(v.game_days_per_tick)}">
      </label>
      <label>Game days per year
        <input type="text" inputmode="numeric" name="game_days_per_year" value="${String(v.game_days_per_year)}">
      </label>
      <label>Max stables per account
        <input type="text" inputmode="numeric" name="max_stables_per_account" value="${String(v.max_stables_per_account)}">
      </label>
      <label>Starting stable capacity
        <input type="text" inputmode="numeric" name="starting_stable_capacity" value="${String(v.starting_stable_capacity)}">
      </label>
      <label>Starting balance
        <input type="text" inputmode="numeric" name="starting_balance" value="${String(v.starting_balance)}">
      </label>
      <label>Minimum password length
        <input type="text" inputmode="numeric" name="min_password_length" value="${String(v.min_password_length)}">
      </label>
      <button type="submit">Save changes</button>
    </form>
    <p class="muted">No feature flags exist yet.</p>
    <p><a href="/admin/config/history">Change history</a></p>
  `;
  return shell(params.world, body, 'Config', 'config');
}

interface ConfigAuditRow {
  id: number;
  changed_by_account_id: number | null;
  real_ts: number;
  game_day: number;
  path: string;
  old_value: string | null;
  new_value: string;
  changed_by_username: string | null;
}

export function renderConfigHistoryPage(params: { world: WorldRow; rows: ConfigAuditRow[] }): SafeHtml {
  const rows = params.rows.map(
    (r) => html`
    <tr>
      <td>${formatLocal(r.real_ts, params.world.tick_timezone)}</td>
      <td>${r.path}</td>
      <td>${r.old_value ?? ''}</td>
      <td>${r.new_value}</td>
      <td>${r.changed_by_username ?? 'unknown'}</td>
    </tr>`
  );
  const body = html`
    <h1>Config change history</h1>
    <table>
      <thead><tr><th>When</th><th>Key</th><th>Old</th><th>New</th><th>Who</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><a href="/admin/config">Back to config</a></p>
  `;
  return shell(params.world, body, 'Config history', 'config');
}

export function renderWorldPage(params: { world: WorldRow; tickRuns: TickRunRow[]; notice?: string }): SafeHtml {
  const w = params.world;
  const rows = params.tickRuns.map(
    (t) => html`
    <tr>
      <td>${String(t.tick_seq)}</td>
      <td>${t.trigger_source}</td>
      <td>${t.intended_local_time ?? raw('<span class="muted">manual</span>')}</td>
      <td>${t.fired_local_time}</td>
      <td>${t.local_date}</td>
      <td>${t.status}</td>
      <td>${String(t.game_day_before)} → ${t.game_day_after === null ? '?' : String(t.game_day_after)}</td>
    </tr>`
  );

  const body = html`
    <h1>World clock</h1>
    ${noticeBox(params.notice)}
    <div class="card">
      <p><strong>Game day:</strong> ${String(w.game_day)}</p>
      <p><strong>Tick sequence:</strong> ${String(w.tick_seq)}</p>
      <p><strong>Paused:</strong> ${w.paused ? 'yes' : 'no'}</p>
      <p><strong>Tick slots (${w.tick_timezone}):</strong> ${JSON.parse(w.tick_times_local).join(', ')}</p>
    </div>
    <form method="post" action="/admin/world">
      <input type="hidden" name="action" value="${w.paused ? 'unpause' : 'pause'}">
      <button type="submit">${w.paused ? 'Unpause the world' : 'Pause the world'}</button>
    </form>
    <form method="post" action="/admin/world">
      <input type="hidden" name="action" value="advance">
      <label class="confirm-checkbox">
        <input type="checkbox" name="confirm" value="yes" required>
        Yes, advance the world by one tick right now.
      </label>
      <button type="submit" class="secondary">Advance one tick now</button>
    </form>
    <p class="confirm-note">Advancing moves the game day forward by one tick's worth (paused worlds only move the tick sequence). It does not disturb the schedule - the next real tick still fires when it was always going to.</p>
    <details class="section-collapse" open>
      <summary>Recent ticks</summary>
      <table>
        <thead><tr><th>Seq</th><th>Trigger</th><th>Intended</th><th>Fired</th><th>Date</th><th>Status</th><th>Day</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
  return shell(w, body, 'World clock', 'world');
}

/**
 * Slice 0003 §7: read-only view of the live fertility/twin tunables (editing them isn't asked for
 * this slice - CLAUDE.md §13, "no polished admin UI"), plus the force-twins control from §1 step 9
 * (a mare's owner has no way to trigger the ~1-in-330 twin event on demand otherwise). Follows the
 * `required`-checkbox confirm pattern from the world-clock page above rather than a JS confirm().
 */
export function renderBreedingAdminPage(params: { world: WorldRow; config: Config; notice?: string }): SafeHtml {
  const v = params.config.values;
  const forceTwinsPending = params.config.flags.force_next_twins === true;

  const knotRows = (knots: [number, number][]) =>
    html`${knots.map((k) => html`<tr><td>${String(k[0])}</td><td>${(k[1] * 100).toFixed(0)}%</td></tr>`)}`;

  const body = html`
    <h1>Breeding</h1>
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Conception</h2>
      <p><strong>Base chance:</strong> ${(v.conception_base * 100).toFixed(0)}% (clamped to ${(v.conception_min * 100).toFixed(0)}%-${(v.conception_max * 100).toFixed(0)}%)</p>
      <p><strong>Inbreeding penalty:</strong> conception factor = 1 - ${String(v.inbreeding_fertility_penalty)} &times; foal COI</p>
      <p><strong>Fertility gene range:</strong> ${String(v.fertility_gene_min)}-${String(v.fertility_gene_max)}</p>
    </div>
    <div class="card">
      <h2>Mare fertility by age</h2>
      <table><thead><tr><th>Age</th><th>Factor</th></tr></thead><tbody>${knotRows(v.mare_fertility_age_knots)}</tbody></table>
    </div>
    <div class="card">
      <h2>Stallion fertility by age</h2>
      <table><thead><tr><th>Age</th><th>Factor</th></tr></thead><tbody>${knotRows(v.stallion_fertility_age_knots)}</tbody></table>
    </div>
    <div class="card">
      <h2>Cycle and season</h2>
      <p><strong>Oestrous cycle:</strong> ${String(v.estrous_cycle_ticks)} ticks, in season for ${String(v.estrus_ticks)}</p>
      <p><strong>Breeding season:</strong> game day ${String(v.breeding_season_start_game_day)} for ${String(v.breeding_season_length_game_days)} days</p>
      <p><strong>Gestation:</strong> ${String(v.gestation_days_mean)} game days (sd ${String(v.gestation_days_sd)})</p>
    </div>
    <div class="card">
      <h2>Twins</h2>
      <p><strong>Double ovulation:</strong> ${(v.twin_double_ovulation_rate * 100).toFixed(0)}%</p>
      <p><strong>Both continue:</strong> ${(v.twin_both_continue_rate * 100).toFixed(0)}%</p>
      <p class="muted">Net: about 1 in ${String(Math.round(1 / (v.twin_double_ovulation_rate * v.twin_both_continue_rate)))} foalings.</p>
      ${forceTwinsPending ? html`<p class="notice">Twins are forced for the next covering to conceive.</p>` : raw('')}
      <form method="post" action="/admin/breeding">
        <input type="hidden" name="action" value="force_twins">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, force the next covering that conceives to be twins.
        </label>
        <button type="submit" class="secondary">Force next twins</button>
      </form>
    </div>
  `;
  return shell(params.world, body, 'Breeding', 'breeding');
}
