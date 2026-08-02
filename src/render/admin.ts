import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox, type NavLink } from './layout';
import type { WorldRow } from '../db/world';
import type { AccountRow } from '../db/accounts';
import type { StableRow } from '../db/stables';
import type { BreedRow } from '../db/breeds';
import type { Config } from '../lib/config-cache';
import type { TickRunRow } from '../db/tickRuns';
import type { ImportOfferRow } from '../db/founding';
import type { TableCount } from '../db/reset';
import type { AdminShowSummary } from '../db/shows';
import type { StableBalanceForAdmin, AdjustmentRow } from '../db/ledger';
import type { ConditionCensusRow } from '../db/health';
import type { LivingHorseAdminDisplay, RecentDeathAdminDisplay } from '../db/ageing';
import { formatLocal } from '../lib/time';
import { libraryImagePath } from '../lib/images';

type AdminSubnavPage = 'home' | 'accounts' | 'config' | 'world' | 'breeding' | 'founding' | 'breeds' | 'shows' | 'money' | 'health' | 'ageing' | 'migrations' | 'reset';

function adminSubnav(active: AdminSubnavPage): NavLink[] {
  return [
    { label: 'Admin home', href: '/admin', active: active === 'home' },
    { label: 'Accounts', href: '/admin/accounts', active: active === 'accounts' },
    { label: 'Config', href: '/admin/config', active: active === 'config' },
    { label: 'World clock', href: '/admin/world', active: active === 'world' },
    { label: 'Breeding', href: '/admin/breeding', active: active === 'breeding' },
    { label: 'Founding stock', href: '/admin/founding', active: active === 'founding' },
    { label: 'Breeds', href: '/admin/breeds', active: active === 'breeds' },
    { label: 'Shows', href: '/admin/shows', active: active === 'shows' },
    { label: 'Money', href: '/admin/money', active: active === 'money' },
    { label: 'Health', href: '/admin/health', active: active === 'health' },
    { label: 'Ageing', href: '/admin/ageing', active: active === 'ageing' },
    { label: 'Migrations', href: '/admin/migrations', active: active === 'migrations' },
    { label: 'Start over', href: '/admin/reset', active: active === 'reset' },
  ];
}

function shell(world: WorldRow, body: SafeHtml, title: string, active: AdminSubnavPage): SafeHtml {
  return pageShell({
    title,
    world,
    loggedIn: true,
    isAdmin: true,
    section: 'admin',
    subnav: adminSubnav(active),
    // Admin pages never show a turn count - admin actions never spend one, and admin mode is
    // already a visibly separate place (CLAUDE.md §11).
    actionsLeft: null,
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
    <p><a class="button-link" href="/admin/founding">Founding stock</a></p>
    <p><a class="button-link" href="/admin/breeds">Breeds</a></p>
    <p><a class="button-link" href="/admin/shows">Shows</a></p>
    <p><a class="button-link" href="/admin/money">Money</a></p>
    <p><a class="button-link" href="/admin/health">Health (horses)</a></p>
    <p><a class="button-link" href="/admin/ageing">Ageing</a></p>
    <p><a class="button-link" href="/admin/migrations">Migrations</a></p>
    <p><a class="button-link" href="/admin/reset">Start over</a></p>
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
      <h2>Conformation</h2>
      <label>Environmental noise (standard deviation)
        <input type="text" inputmode="numeric" name="conformation_noise_sd" value="${String(v.conformation_noise_sd)}">
      </label>
      <p class="muted">Only affects horses born after this is changed - a horse's own roll is snapshotted at birth.</p>
      <label>Years to reach maturity
        <input type="text" inputmode="numeric" name="conformation_maturity_years" value="${String(v.conformation_maturity_years)}">
      </label>
      <label>Realization at birth (0-1)
        <input type="text" inputmode="decimal" name="conformation_realization_at_birth" value="${String(v.conformation_realization_at_birth)}">
      </label>
      <label>Inbreeding depression factor
        <input type="text" inputmode="decimal" name="inbreeding_depression_factor" value="${String(v.inbreeding_depression_factor)}">
      </label>
      <p class="notice">Changing this one re-scores every already-inbred horse in the game immediately, because conformation is computed fresh on every page view. Best tuned in the first weeks of play, then left alone.</p>
      <h2>Shows</h2>
      <label>Show interval (game days)
        <input type="text" inputmode="numeric" name="show_interval_game_days" value="${String(v.show_interval_game_days)}">
      </label>
      <label>Entry window (game days ahead)
        <input type="text" inputmode="numeric" name="show_entry_window_game_days" value="${String(v.show_entry_window_game_days)}">
      </label>
      <label>Show noise (standard deviation, score points)
        <input type="text" inputmode="decimal" name="show_noise_sd" value="${String(v.show_noise_sd)}">
      </label>
      <label>Ideal falloff (points per point off standard)
        <input type="text" inputmode="decimal" name="show_ideal_falloff" value="${String(v.show_ideal_falloff)}">
      </label>
      <label>Target field size
        <input type="text" inputmode="numeric" name="show_target_field_size" value="${String(v.show_target_field_size)}">
      </label>
      <label>Max entries per stable, per class
        <input type="text" inputmode="numeric" name="show_max_entries_per_stable" value="${String(v.show_max_entries_per_stable)}">
      </label>
      <label>Minimum age to show (game days)
        <input type="text" inputmode="numeric" name="show_conformation_min_age_game_days" value="${String(v.show_conformation_min_age_game_days)}">
      </label>
      <label>NPC show barn target size
        <input type="text" inputmode="numeric" name="npc_show_barn_size" value="${String(v.npc_show_barn_size)}">
      </label>
      <p class="muted">The five class-shaping numbers above (noise, falloff, field size, entry cap, minimum age) are copied onto each class the moment it's created - changing them here only affects shows created afterwards, never one already scheduled or judged.</p>
      <h2>Money</h2>
      <label>Upkeep per horse, per game day
        <input type="text" inputmode="numeric" name="upkeep_per_horse_per_game_day" value="${String(v.upkeep_per_horse_per_game_day)}">
      </label>
      <p class="muted">Kept deliberately gentle - prize money from one show a real day is the only income in the game until the market stage lands. Worth revisiting once selling a horse becomes a second way to earn.</p>
      <h2>Turns and events</h2>
      <label>Turns per tick
        <input type="text" inputmode="numeric" name="actions_per_tick" value="${String(v.actions_per_tick)}">
      </label>
      <p class="muted">Kept separate from the tick schedule (world.tick_times_local) on purpose - changing how often the tick fires should never silently change how much play a day contains. Booking a covering, entering a show, claiming a founding batch and buying a genotype test each spend a turn (a panel is one turn, not four); browsing, renaming and reading are always free.</p>
      <label>Events kept for (game days)
        <input type="text" inputmode="numeric" name="events_retention_game_days" value="${String(v.events_retention_game_days)}">
      </label>
      <p class="muted">The "While you were away" feed is a notice board, not an archive - every event older than this, read or not, is deleted on the tick. The horse, its pedigree, its show results and the ledger all survive regardless.</p>
      <h2>Health</h2>
      <label>Genotype test cost, one condition
        <input type="text" inputmode="numeric" name="genotype_test_cost" value="${String(v.genotype_test_cost)}">
      </label>
      <label>Genotype panel cost, all conditions at once
        <input type="text" inputmode="numeric" name="genotype_panel_cost" value="${String(v.genotype_panel_cost)}">
      </label>
      <p class="muted">Both read live, at the moment a test is bought - a price change affects the next purchase, never re-prices a receipt already written. Too cheap and everyone tests everything; too expensive and children breed blind. Tune by watching /admin/health.</p>
      <label>Lethal foal death window (game days)
        <input type="text" inputmode="numeric" name="lethal_foal_death_game_days" value="${String(v.lethal_foal_death_game_days)}">
      </label>
      <p class="muted">Only affects foals born after this changes - a foal already carrying a lethal condition has its death day snapshotted at birth, so retuning this never moves it.</p>
      <h2>Ageing</h2>
      <label>Lifespan mean (game days)
        <input type="text" inputmode="numeric" name="lifespan_mean_game_days" value="${String(v.lifespan_mean_game_days)}">
      </label>
      <label>Lifespan standard deviation (game days)
        <input type="text" inputmode="numeric" name="lifespan_sd_game_days" value="${String(v.lifespan_sd_game_days)}">
      </label>
      <label>Lifespan minimum (game days)
        <input type="text" inputmode="numeric" name="lifespan_min_game_days" value="${String(v.lifespan_min_game_days)}">
      </label>
      <label>Lifespan maximum (game days)
        <input type="text" inputmode="numeric" name="lifespan_max_game_days" value="${String(v.lifespan_max_game_days)}">
      </label>
      <p class="muted">These four apply only to horses created after the change and never move a death date already assigned - the same note lethal_foal_death_game_days carries above, for the same reason.</p>
      <label>Frailty window (game days)
        <input type="text" inputmode="numeric" name="frailty_window_game_days" value="${String(v.frailty_window_game_days)}">
      </label>
      <label>Veteran age (game days)
        <input type="text" inputmode="numeric" name="veteran_age_game_days" value="${String(v.veteran_age_game_days)}">
      </label>
      <p class="muted">Both live - read fresh on every page view. Changing the frailty window only changes who currently reads as failing and when the notice next fires; it moves no death date. Shortening it can mean a horse already announced as failing stops reading that way, which is odd but harmless.</p>
      <label>Ended horses stay in the barn list for (game days)
        <input type="text" inputmode="numeric" name="barn_shows_ended_game_days" value="${String(v.barn_shows_ended_game_days)}">
      </label>
      <p class="muted">A dead or retired-away horse drops out of the barn list after this many game days, but stays reachable forever from a stable's Past horses page.</p>
      <button type="submit">Save changes</button>
    </form>
    <p class="muted">The show purse (show_prize_schedule) is JSON, not a whole number, so it's edited from D1's console rather than this form - the same way quality_bands already is. It's snapshotted onto each show class at creation, so a change here only affects shows scheduled afterwards.</p>
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

/**
 * Slice 0005 §11/§13: mint a founding-stock batch into any stable, and see recent offers. This is
 * the whole grant path until §7 (the PIN, typed on a child's own phone) lands as a follow-up slice
 * - until then, a chore-reward batch still means an admin logged in and using this form.
 */
export function renderFoundingAdminPage(params: {
  world: WorldRow;
  stables: StableRow[];
  qualityBands: Record<string, number>;
  defaultBand: string;
  recentOffers: (ImportOfferRow & { stableName: string })[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const stableOptions = html`${params.stables.map((s) => html`<option value="${String(s.id)}">${s.name}</option>`)}`;
  const bandOptions = html`${Object.keys(params.qualityBands).map(
    (band) =>
      html`<option value="${band}" ${band === params.defaultBand ? raw('selected') : raw('')}>${band} (${(params.qualityBands[band] * 100).toFixed(0)}% chance per allele)</option>`
  )}`;

  const offerRows = params.recentOffers.map(
    (o) => html`
    <tr>
      <td>${o.stableName}</td>
      <td>${o.source}</td>
      <td>${o.status}</td>
      <td>${o.quality_band}</td>
      <td>${String(o.granted_game_day)}</td>
    </tr>`
  );

  const body = html`
    <h1>Founding stock</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Grant a batch</h2>
      <form method="post" action="/admin/founding">
        <input type="hidden" name="action" value="mint">
        <label>Stable
          <select name="stable_id" required>${stableOptions}</select>
        </label>
        <label>Quality band
          <select name="band" required>${bandOptions}</select>
        </label>
        <button type="submit">Grant batch</button>
      </form>
      <p class="muted">The child opens it from their stable page and picks a breed themselves - the batch says nothing about which breed until they do.</p>
    </div>
    <div class="card">
      <h2>Recent offers</h2>
      <table>
        <thead><tr><th>Stable</th><th>Source</th><th>Status</th><th>Band</th><th>Granted (game day)</th></tr></thead>
        <tbody>${offerRows}</tbody>
      </table>
    </div>
  `;
  return shell(params.world, body, 'Founding stock', 'founding');
}

/**
 * Slice 0007 §6.4: the operator's only way to grow the image library - a table of number inputs,
 * one Save for the lot (CLAUDE.md §13, "no polished admin UI"). The single most useful thing this
 * page can tell the operator is the exact next filename per breed, so it's a column of its own
 * rather than left for them to work out from the current count.
 */
export function renderBreedsAdminPage(params: { world: WorldRow; breeds: BreedRow[]; error?: string; notice?: string }): SafeHtml {
  const rows = params.breeds.map(
    (b) => html`
    <tr>
      <td>${b.code}</td>
      <td>${b.name}</td>
      <td>${String(b.image_count)}</td>
      <td><input type="text" inputmode="numeric" name="count_${String(b.id)}" value="${String(b.image_count)}" style="width:4rem"></td>
      <td class="muted">${libraryImagePath(b.code, b.image_count + 1)}</td>
    </tr>`
  );

  const body = html`
    <h1>Breeds</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <p>In GitHub, go to <code>public/horses</code> &rarr; <strong>Add file</strong> &rarr; <strong>Upload files</strong>. Name each picture for its breed code and the next number in the "Next filename" column below, save as <code>.webp</code>, and commit. Once the deploy finishes, set that breed's count to the new total here and save.</p>
      <p><strong>Files are never renumbered and never deleted - only replaced in place.</strong> Skipping or removing a number shows a broken picture rather than being quietly left out, because the site has no way to know a file is missing without a child finding it. Replacing a picture at its existing number is fine and is how you fix a bad upload.</p>
      <p class="muted">New pictures can take up to a minute to appear everywhere.</p>
    </div>
    <form method="post" action="/admin/breeds">
      <table>
        <thead><tr><th>Code</th><th>Breed</th><th>Current count</th><th>New count</th><th>Next filename</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button type="submit">Save counts</button>
    </form>
  `;
  return shell(params.world, body, 'Breeds', 'breeds');
}

/**
 * Emptying the world so it can be played from the beginning again. Two guards rather than the
 * single `required` checkbox the world-clock page uses, because this one cannot be undone: the
 * checkbox, and the word "reset" typed by hand. Both are re-checked on the server (there is no
 * JavaScript in this codebase - see CLAUDE.md §11's 2026-08-02 entry).
 */
export function renderResetPage(params: {
  world: WorldRow;
  counts: TableCount[];
  accountCount: number;
  error?: string;
  notice?: string;
}): SafeHtml {
  const rows = params.counts.map(
    (c) => html`
    <tr>
      <td>${c.label}</td>
      <td>${String(c.rows)}</td>
      <td class="muted">${c.inHorsesScope ? 'both' : 'full reset only'}</td>
    </tr>`
  );

  const body = html`
    <h1>Start over</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}

    <div class="card">
      <h2>What is in the game right now</h2>
      <table>
        <thead><tr><th>Thing</th><th>How many</th><th>Cleared by</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">Logins are never cleared: ${String(params.accountCount)} accounts will still be there afterwards, with the same usernames and passwords.</p>
    </div>

    <div class="card">
      <h2>What is always kept</h2>
      <p>Everyone's login, the settings on the Config page, the config change history, and the breed, gene and trait lists the game is built from. Pictures in the library are files, not data, so they are untouched too.</p>
      <p>The pause switch is also left exactly as you have it. If the world is paused now, it will still be paused after a reset.</p>
    </div>

    <div class="card">
      <h2>Clear the game</h2>
      <form method="post" action="/admin/reset">
        <input type="hidden" name="action" value="reset">

        <label class="confirm-checkbox">
          <input type="radio" name="scope" value="horses" checked>
          <strong>Horses only.</strong> Deletes every horse, pedigree, covering, pregnancy and founding-stock batch. Stables keep their name, prefix, money and space, and the calendar keeps running from today.
        </label>

        <label class="confirm-checkbox">
          <input type="radio" name="scope" value="world">
          <strong>The whole world.</strong> All of the above, plus every stable and every claimed prefix, and the calendar goes back to day 0. Everyone starts by making a new stable, and old prefixes are free to use again.
        </label>

        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, I understand this cannot be undone.
        </label>

        <label>Type the word <code>reset</code> to confirm
          <input type="text" name="confirm_word" required autocapitalize="off" autocomplete="off">
        </label>

        <button type="submit">Clear the game</button>
      </form>
      <p class="confirm-note">There is no backup and no undo. Anything deleted here is gone for good, including horses the children bred themselves.</p>
    </div>
  `;
  return shell(params.world, body, 'Start over', 'reset');
}

/**
 * Slice 0008 §8.2: stock the NPC show barn, judge the next show now (for testing, without waiting
 * for the tick), and a read-only list of recent shows. No polished admin UI, per CLAUDE.md §13 -
 * one form per action, both behind the `required`-checkbox confirm pattern the world-clock page
 * established.
 */
export function renderShowsAdminPage(params: {
  world: WorldRow;
  barnCount: number;
  barnTarget: number;
  /** Slice 0011 §2.3/§8.2: the barn's five oldest living horses, oldest first, with their own
   * age state - the show barn ages and dies on the same code path as everyone else's horses. */
  oldestBarnHorses: { name: string; ageState: string }[];
  qualityBands: Record<string, number>;
  defaultBand: string;
  recentShows: AdminShowSummary[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const bandOptions = html`${Object.keys(params.qualityBands).map(
    (band) =>
      html`<option value="${band}" ${band === params.defaultBand ? raw('selected') : raw('')}>${band} (${(params.qualityBands[band] * 100).toFixed(0)}% chance per allele)</option>`
  )}`;

  const showRows = params.recentShows.map(
    (s) => html`
    <tr>
      <td><a href="/shows/${String(s.id)}">${s.name}</a></td>
      <td>${String(s.scheduled_game_day)}</td>
      <td>${s.status}</td>
      <td>${s.judgeName ?? raw('&mdash;')}</td>
      <td>${s.winnerName ?? raw('&mdash;')}</td>
    </tr>`
  );

  // Slice 0011 §2.3: what must not happen is show fields quietly shrinking for a reason nobody can
  // see - so a below-target barn gets a visible warning, not just a smaller number.
  const belowTargetWarning =
    params.barnCount < params.barnTarget
      ? html`<p class="notice">Below target by ${String(params.barnTarget - params.barnCount)} - horses in this barn age and die like any other, and nothing restocks it automatically. Use the button below.</p>`
      : raw('');

  const oldestBarnRows = params.oldestBarnHorses.map((h) => html`<tr><td>${h.name}</td><td>${h.ageState}</td></tr>`);

  const body = html`
    <h1>Shows</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>The NPC show barn</h2>
      <p><strong>Fair Meadow Show Barn</strong> currently holds ${String(params.barnCount)} of a target ${String(params.barnTarget)} Quarter Horses. It never breeds or improves, but it does age and die like any other horse - stocking it only ever tops it up to the target, never past it.</p>
      ${belowTargetWarning}
      ${params.oldestBarnHorses.length
        ? html`
          <table>
            <thead><tr><th>Horse</th><th>State</th></tr></thead>
            <tbody>${oldestBarnRows}</tbody>
          </table>`
        : raw('')}
      <form method="post" action="/admin/shows">
        <input type="hidden" name="action" value="stock_barn">
        <label>Quality band
          <select name="band" required>${bandOptions}</select>
        </label>
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, mint however many horses it takes to reach the target size.
        </label>
        <button type="submit">Stock the show barn</button>
      </form>
    </div>
    <div class="card">
      <h2>Judge the next show now</h2>
      <p class="muted">Judges every class whose show date has already arrived, without waiting for the next tick - useful for testing.</p>
      <form method="post" action="/admin/shows">
        <input type="hidden" name="action" value="judge_now">
        <button type="submit" class="secondary">Judge now</button>
      </form>
    </div>
    <div class="card">
      <h2>Recent shows</h2>
      <table>
        <thead><tr><th>Show</th><th>Game day</th><th>Status</th><th>Judge</th><th>Winner</th></tr></thead>
        <tbody>${showRows.length ? showRows : html`<tr><td colspan="5" class="muted">No shows have been created yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  return shell(params.world, body, 'Shows', 'shows');
}

/**
 * §7.3, asked for directly - the relief valve for §2.4's debt rule: adding money to a stable by
 * hand, since nothing in the game itself can get a stable out of the red except winning a show.
 * Negative amounts are allowed too (this both gives and takes, so a mistake can be undone), and a
 * reason is required - it becomes the ledger row's description, so a child reading their Money page
 * sees "Chore reward from Dad" rather than an unexplained number. Guarded the same
 * `required`-checkbox way the world-clock page's advance control is.
 */
export function renderMoneyAdminPage(params: {
  world: WorldRow;
  stables: StableBalanceForAdmin[];
  recentAdjustments: AdjustmentRow[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const stableOptions = html`${params.stables.map(
    (s) =>
      html`<option value="${String(s.id)}">${s.name}${s.is_npc ? ' (NPC)' : s.owner_username ? ` (${s.owner_username})` : ''} - balance ${String(s.balance)}</option>`
  )}`;

  const adjustmentRows = params.recentAdjustments.map(
    (a) => html`
    <tr>
      <td>${a.stable_name}</td>
      <td>${a.amount >= 0 ? '+' : ''}${String(a.amount)}</td>
      <td>${a.description}</td>
      <td>${String(a.game_day)}</td>
    </tr>`
  );

  const body = html`
    <h1>Money</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Add or remove money by hand</h2>
      <p class="muted">This is the way a stable that has gone into the red gets out, until the game itself gives it a second way to earn.</p>
      <form method="post" action="/admin/money">
        <input type="hidden" name="action" value="adjust">
        <label>Stable
          <select name="stable_id" required>${stableOptions}</select>
        </label>
        <label>Amount (negative to take money away)
          <input type="text" inputmode="numeric" name="amount" required>
        </label>
        <label>Reason
          <input type="text" name="reason" required placeholder="e.g. Chore reward from Dad">
        </label>
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, apply this adjustment.
        </label>
        <button type="submit">Apply</button>
      </form>
    </div>
    <div class="card">
      <h2>Recent adjustments</h2>
      <table>
        <thead><tr><th>Stable</th><th>Amount</th><th>Reason</th><th>Game day</th></tr></thead>
        <tbody>${adjustmentRows.length ? adjustmentRows : html`<tr><td colspan="4" class="muted">None yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  return shell(params.world, body, 'Money', 'money');
}

/**
 * /admin/health (slice 0010 §8) - read-only, no editing form (CLAUDE.md §13's "no polished admin
 * UI" rule). Per condition: name, severity, whether enabled, and counts of clear/carrier/affected
 * across every living horse in the game - the number the founding-pool frequencies (§4.3) get tuned
 * against, and the answer to "is the panel doing too much or too little" (§3f/§14).
 */
export function renderHealthAdminPage(params: { world: WorldRow; census: ConditionCensusRow[] }): SafeHtml {
  const rows = params.census.map(
    ({ condition, clear, carrier, affected }) => html`
    <tr>
      <td>${condition.name} (${condition.code})</td>
      <td>${condition.severity_class}</td>
      <td>${condition.enabled ? 'yes' : 'no'}</td>
      <td>${String(clear)}</td>
      <td>${String(carrier)}</td>
      <td>${String(affected)}</td>
    </tr>`
  );

  const body = html`
    <h1>Health</h1>
    <p class="muted">Counts across every living horse in the game, read straight from genotypes - this is the truth, not what any one player knows.</p>
    <div class="card">
      <table>
        <thead><tr><th>Condition</th><th>Severity</th><th>Enabled</th><th>Clear</th><th>Carrier</th><th>Affected</th></tr></thead>
        <tbody>${rows.length ? rows : html`<tr><td colspan="6" class="muted">No conditions seeded yet.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="muted">If a condition is firing too often or almost never, the lever is the breed's founding_allele_pool frequency, not this page - see CLAUDE.md's slice 0010 entry.</p>
  `;
  return shell(params.world, body, 'Health', 'health');
}

/**
 * /admin/ageing (slice 0011 §8.4): the oldest living horses in the game (so the operator can see
 * the population's age structure), deaths in the last window (so they can see the rate rather than
 * infer it), and one control - bring a chosen horse's end forward to today, the same shape as
 * /admin/breeding's force-twins control and for the same reason: §1's verification steps are
 * otherwise four real months away. Labelled here as a testing control, behind the same admin login
 * everything else on this page is behind.
 */
export function renderAgeingAdminPage(params: {
  world: WorldRow;
  livingHorses: LivingHorseAdminDisplay[];
  recentDeaths: RecentDeathAdminDisplay[];
  recentDeathsWindowGameDays: number;
  error?: string;
  notice?: string;
}): SafeHtml {
  const oldestRows = params.livingHorses.slice(0, 20).map(
    (h) => html`
    <tr>
      <td><a href="/horses/${String(h.id)}">${h.name}</a></td>
      <td>${h.stableName}</td>
      <td>${String(h.bornGameDay)}</td>
      <td>${h.ageState}</td>
    </tr>`
  );

  const deathRows = params.recentDeaths.map(
    (d) => html`
    <tr>
      <td><a href="/horses/${String(d.id)}">${d.name}</a></td>
      <td>${d.stableName}</td>
      <td>${String(d.endedGameDay)}</td>
      <td>${d.endReason ?? raw('&mdash;')}</td>
    </tr>`
  );

  const horseOptions = params.livingHorses.map(
    (h) => html`<option value="${String(h.id)}">${h.name} (${h.stableName}, born game day ${String(h.bornGameDay)}, ${h.ageState})</option>`
  );

  const body = html`
    <h1>Ageing</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Oldest living horses</h2>
      <table>
        <thead><tr><th>Horse</th><th>Stable</th><th>Born (game day)</th><th>State</th></tr></thead>
        <tbody>${oldestRows.length ? oldestRows : html`<tr><td colspan="4" class="muted">No living horses yet.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Deaths in the last ${String(params.recentDeathsWindowGameDays)} game days</h2>
      <table>
        <thead><tr><th>Horse</th><th>Stable</th><th>Ended (game day)</th><th>End reason</th></tr></thead>
        <tbody>${deathRows.length ? deathRows : html`<tr><td colspan="4" class="muted">None in this window.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Bring a horse's end forward</h2>
      <p class="muted">Testing control - moves the chosen horse's own death date to today, so it dies old age on the next tick. Never changes its age, pedigree, COI or show eligibility.</p>
      <form method="post" action="/admin/ageing">
        <input type="hidden" name="action" value="force_death">
        <label>Horse
          <select name="horse_id" required>${horseOptions.length ? horseOptions : html`<option value="" disabled selected>No living horses</option>`}</select>
        </label>
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, move this horse's own end to today.
        </label>
        <button type="submit" class="secondary">Bring forward</button>
      </form>
    </div>
  `;
  return shell(params.world, body, 'Ageing', 'ageing');
}
