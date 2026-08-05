import { html, raw, SafeHtml } from '../lib/html';
import { pageShell, errorBox, noticeBox, type SubnavItem } from './layout';
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
import type { CareAdminData } from '../db/care';
import type { IncidentAdminRow } from '../db/incidents';
import type { PinAttemptDisplayRow } from '../db/pin';
import type { HorseSearchRow } from '../db/horses';
import { horseDisplayName } from '../db/horses';
import type { NpcStableAdminRow, NpcCeilingScheduleRow } from '../db/npcBreeding';
import type { DisciplineRow } from '../db/disciplines';
import type { ConsignmentInjectionRow } from '../db/consignment';
import { LOCI } from '../engines/genetics/loci';
import { DIFFICULTY_LEVELS, DIFFICULTY_LABEL, DIFFICULTY_BLURB, isDifficultyLevel } from '../engines/incidents/difficulty';
import { formatLocal } from '../lib/time';
import { libraryImagePath } from '../lib/images';

type AdminSubnavPage =
  | 'home'
  | 'accounts'
  | 'horses'
  | 'config'
  | 'world'
  | 'breeding'
  | 'founding'
  | 'breeds'
  | 'shows'
  | 'money'
  | 'health'
  | 'ageing'
  | 'care'
  | 'incidents'
  | 'npc'
  | 'consignment'
  | 'security'
  | 'migrations'
  | 'reset';

/**
 * The admin top nav used to be one flat row of eighteen links, which stopped fitting on a screen
 * as slices kept adding their own admin page. Grouped into hubs (a `<details>` dropdown per hub,
 * see layout.ts's `NavHub` - no JavaScript) with Admin home and World clock left standalone, per
 * the operator's own grouping. Health and Incidents went to Game horses rather than Settings -
 * they're about what's happening to horses, not the game's tuning knobs.
 */
function adminSubnav(active: AdminSubnavPage): SubnavItem[] {
  const gameHorsesPages: AdminSubnavPage[] = ['horses', 'founding', 'ageing', 'care', 'health', 'incidents'];
  const playersAndNpcsPages: AdminSubnavPage[] = ['accounts', 'money', 'npc', 'consignment'];
  const behindTheScenesPages: AdminSubnavPage[] = ['breeds', 'breeding', 'shows'];
  const settingsPages: AdminSubnavPage[] = ['config', 'security', 'migrations', 'reset'];

  return [
    { label: 'Admin home', href: '/admin', active: active === 'home' },
    { label: 'World clock', href: '/admin/world', active: active === 'world' },
    {
      label: 'Game horses',
      active: gameHorsesPages.includes(active),
      children: [
        { label: 'Search horses', href: '/admin/horses', active: active === 'horses' },
        { label: 'Founding stock', href: '/admin/founding', active: active === 'founding' },
        { label: 'Ageing', href: '/admin/ageing', active: active === 'ageing' },
        { label: 'Care', href: '/admin/care', active: active === 'care' },
        { label: 'Health', href: '/admin/health', active: active === 'health' },
        { label: 'Incidents', href: '/admin/incidents', active: active === 'incidents' },
      ],
    },
    {
      label: 'Players and NPCs',
      active: playersAndNpcsPages.includes(active),
      children: [
        { label: 'Accounts', href: '/admin/accounts', active: active === 'accounts' },
        { label: 'Money', href: '/admin/money', active: active === 'money' },
        { label: 'NPC stables', href: '/admin/npc', active: active === 'npc' },
        { label: 'Consignment dealer', href: '/admin/consignment', active: active === 'consignment' },
      ],
    },
    {
      label: 'Behind the scenes',
      active: behindTheScenesPages.includes(active),
      children: [
        { label: 'Breeds', href: '/admin/breeds', active: active === 'breeds' },
        { label: 'Breeding', href: '/admin/breeding', active: active === 'breeding' },
        { label: 'Shows', href: '/admin/shows', active: active === 'shows' },
      ],
    },
    {
      label: 'Settings',
      active: settingsPages.includes(active),
      children: [
        { label: 'Config', href: '/admin/config', active: active === 'config' },
        { label: 'Security', href: '/admin/security', active: active === 'security' },
        { label: 'Migrations', href: '/admin/migrations', active: active === 'migrations' },
        { label: 'Start over', href: '/admin/reset', active: active === 'reset' },
      ],
    },
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
    <p><a class="button-link" href="/admin/horses">Search horses</a></p>
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
    <p><a class="button-link" href="/admin/care">Care</a></p>
    <p><a class="button-link" href="/admin/npc">NPC stables</a></p>
    <p><a class="button-link" href="/admin/consignment">Consignment dealer</a></p>
    <p><a class="button-link" href="/admin/security">Security</a></p>
    <p><a class="button-link" href="/admin/migrations">Migrations</a></p>
    <p><a class="button-link" href="/admin/reset">Start over</a></p>
    <p><a class="button-link" href="/health">Health page</a></p>
  `;
  return shell(w, body, 'Admin', 'home');
}

/**
 * Slice 0016 §8: modify and delete. Stable count and last login are shown so the operator can tell
 * an account with real history from a mistyped one worth deleting. Rename/username-change,
 * admin-flag toggle, and delete each get their own row-level form, all inside the same "Manage"
 * details the deactivate/reset-password forms already used - CLAUDE.md §13's "no polished admin
 * UI", one form per action.
 */
export function renderAccountsPage(params: {
  world: WorldRow;
  accounts: AccountRow[];
  stableCounts: Map<number, number>;
  currentAccountId: number;
  adminCount: number;
  error?: string;
  notice?: string;
}): SafeHtml {
  const rows = params.accounts.map((a) => {
    const stableCount = params.stableCounts.get(a.id) ?? 0;
    const isSelf = a.id === params.currentAccountId;
    const isLastAdmin = a.is_admin === 1 && params.adminCount <= 1;

    const adminToggle =
      isSelf || isLastAdmin
        ? html`<p class="muted">${isSelf ? "Can't remove your own admin flag." : 'The last admin - promote someone else first.'}</p>`
        : html`
          <form method="post" action="/admin/accounts">
            <input type="hidden" name="action" value="set_admin">
            <input type="hidden" name="account_id" value="${String(a.id)}">
            <input type="hidden" name="is_admin" value="${a.is_admin ? '0' : '1'}">
            <button type="submit" class="secondary">${a.is_admin ? 'Remove admin' : 'Make admin'}</button>
          </form>`;

    const deleteOrExplain =
      stableCount > 0
        ? html`<p class="muted">Owns ${String(stableCount)} stable${stableCount === 1 ? '' : 's'} - deactivate instead, or move the stables first.</p>`
        : isSelf
          ? html`<p class="muted">Can't delete your own account.</p>`
          : html`
            <form method="post" action="/admin/accounts">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="account_id" value="${String(a.id)}">
              <label>Type <code>${a.username}</code> to confirm
                <input type="text" name="confirm_word" required autocapitalize="off" autocomplete="off">
              </label>
              <label class="confirm-checkbox">
                <input type="checkbox" name="confirm" value="yes" required>
                Yes, delete this account. This cannot be undone.
              </label>
              <button type="submit" class="secondary">Delete account</button>
            </form>`;

    // 2026-08-05: difficulty, set only here (the operator's decision - a child can't turn their own
    // game down). The blurb under the picker is the whole explanation a non-coding operator gets, so
    // it says what difficulty does NOT touch as plainly as what it does.
    const difficultyLevel = isDifficultyLevel(a.difficulty) ? a.difficulty : 'normal';
    const difficultyForm = html`
      <form method="post" action="/admin/accounts">
        <input type="hidden" name="action" value="set_difficulty">
        <input type="hidden" name="account_id" value="${String(a.id)}">
        <label>Difficulty
          <select name="difficulty">
            ${DIFFICULTY_LEVELS.map(
              (level) => html`<option value="${level}" ${level === difficultyLevel ? raw('selected') : raw('')}>${DIFFICULTY_LABEL[level]}</option>`
            )}
          </select>
        </label>
        <p class="muted">${DIFFICULTY_BLURB[difficultyLevel]}</p>
        <p class="muted">Changes how often this player's horses fall ill or get hurt, and how badly it goes when they do. It does not change inherited disease, foals born affected, or death from old age - those are facts about a horse, and they stay the same for everybody.</p>
        <button type="submit" class="secondary">Save difficulty</button>
      </form>`;

    return html`
    <tr>
      <td>${a.username}</td>
      <td>${a.display_name}</td>
      <td>${a.is_admin ? 'admin' : 'player'}</td>
      <td>${DIFFICULTY_LABEL[difficultyLevel]}</td>
      <td>${a.active ? 'active' : 'deactivated'}</td>
      <td>${String(stableCount)}</td>
      <td>${a.last_login_real_ts !== null ? formatLocal(a.last_login_real_ts, params.world.tick_timezone) : raw('&mdash;')}</td>
      <td>${a.must_change_password ? html`<span class="badge badge-warning">must change password</span>` : ''}</td>
      <td>
        <details class="row-actions">
          <summary>Manage</summary>
          <form method="post" action="/admin/accounts">
            <input type="hidden" name="action" value="edit">
            <input type="hidden" name="account_id" value="${String(a.id)}">
            <label>Name
              <input type="text" name="display_name" value="${a.display_name}" required>
            </label>
            <label>Username
              <input type="text" name="username" value="${a.username}" required autocapitalize="off">
            </label>
            <button type="submit" class="secondary">Save name/username</button>
          </form>
          ${difficultyForm}
          ${adminToggle}
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
          ${deleteOrExplain}
        </details>
      </td>
    </tr>`;
  });

  const body = html`
    <h1>Accounts</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <p class="muted">Deactivate is the normal answer for an account nobody uses anymore. Delete only works for an account that owns nothing - in practice, one created with a typo and never used.</p>
    <table>
      <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Difficulty</th><th>Status</th><th>Stables</th><th>Last login</th><th></th><th></th></tr></thead>
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

/**
 * The config page used to be one long form - every tunable in the game, in authoring order,
 * on one screen. That got unmanageable as slices kept adding their own numbers to the bottom.
 * Now the fields are grouped exactly as the old <h2>/<h3> headers already grouped them (nothing
 * about the fields or their validation changed, only how they're displayed), a handful of
 * originally-header-less fields at the top became their own "Miscellaneous" group, and a plain
 * GET picker (same no-JavaScript pattern as market.ts's breedPicker) shows one group at a time.
 * Each group is its own POST form carrying only its own fields, which is safe because
 * adminConfigRoute already skips any config key missing from the submitted form body.
 */
function configSections(v: Config['values']): { name: string; body: SafeHtml }[] {
  return [
    {
      name: 'Miscellaneous',
      body: html`
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
      `,
    },
    {
      name: 'Conformation',
      body: html`
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
      `,
    },
    {
      name: 'Conformation labels',
      body: html`
      <p class="muted">Slice 0022 §B2: band edges for the plain-word verdict (Poor / Weak / Acceptable / Good / Outstanding) shown once a horse has started at least one show. Each is the minimum traitScore (0-100, the judge's own per-trait formula) that word applies at. Live - the words on an already-shown horse can move if these are retuned.</p>
      <label>Outstanding, minimum traitScore
        <input type="text" inputmode="numeric" name="conformation_label_outstanding_min" value="${String(v.conformation_label_outstanding_min)}">
      </label>
      <label>Good, minimum traitScore
        <input type="text" inputmode="numeric" name="conformation_label_good_min" value="${String(v.conformation_label_good_min)}">
      </label>
      <label>Acceptable, minimum traitScore
        <input type="text" inputmode="numeric" name="conformation_label_acceptable_min" value="${String(v.conformation_label_acceptable_min)}">
      </label>
      <label>Weak, minimum traitScore
        <input type="text" inputmode="numeric" name="conformation_label_weak_min" value="${String(v.conformation_label_weak_min)}">
      </label>
      `,
    },
    {
      name: 'Difficulty',
      body: html`
      <p class="muted">The numbers behind the three levels you set on each player at /admin/accounts. Normal is the game as it is tuned for everyone - leave it at 1.0 unless you want to move the baseline for the whole family at once.</p>
      <p class="muted">Illness rate multiplies how often an incident starts. Bad outcome multiplies the combined chance of death or a permanent, career-marking result; whatever that frees goes back into "recovered" and "manageable". Difficulty never touches inherited disease, foals born affected, or death from old age.</p>
      <label>Gentle - illness rate
        <input type="text" inputmode="decimal" name="difficulty_gentle_incident_rate" value="${String(v.difficulty_gentle_incident_rate)}">
      </label>
      <label>Gentle - bad outcome
        <input type="text" inputmode="decimal" name="difficulty_gentle_bad_outcome" value="${String(v.difficulty_gentle_bad_outcome)}">
      </label>
      <label>Normal - illness rate
        <input type="text" inputmode="decimal" name="difficulty_normal_incident_rate" value="${String(v.difficulty_normal_incident_rate)}">
      </label>
      <label>Normal - bad outcome
        <input type="text" inputmode="decimal" name="difficulty_normal_bad_outcome" value="${String(v.difficulty_normal_bad_outcome)}">
      </label>
      <label>Realistic - illness rate
        <input type="text" inputmode="decimal" name="difficulty_realistic_incident_rate" value="${String(v.difficulty_realistic_incident_rate)}">
      </label>
      <label>Realistic - bad outcome
        <input type="text" inputmode="decimal" name="difficulty_realistic_bad_outcome" value="${String(v.difficulty_realistic_bad_outcome)}">
      </label>
      `,
    },
    {
      name: 'Shows',
      body: html`
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
      <label>Yearling band starts at (game days old)
        <input type="text" inputmode="numeric" name="young_horse_yearling_min_age_game_days" value="${String(v.young_horse_yearling_min_age_game_days)}">
      </label>
      <label>Two-year-old band starts at (game days old)
        <input type="text" inputmode="numeric" name="young_horse_two_year_old_min_age_game_days" value="${String(v.young_horse_two_year_old_min_age_game_days)}">
      </label>
      <p class="muted">Slice 0025 stage 3: the yearling band runs from the first number up to one day short of the second; the two-year-old band runs from the second up to one day short of "Minimum age to show" above, which is also where the adult classes pick up - there is no gap and no day double-eligible for two bands.</p>
      `,
    },
    {
      name: 'Money',
      body: html`
      <label>Upkeep per horse, per game day
        <input type="text" inputmode="numeric" name="upkeep_per_horse_per_game_day" value="${String(v.upkeep_per_horse_per_game_day)}">
      </label>
      <p class="muted">Kept deliberately gentle - prize money from one show a real day is the only income in the game until the market stage lands. Worth revisiting once selling a horse becomes a second way to earn.</p>
      <label>Young horses are free to keep until (game days old)
        <input type="text" inputmode="numeric" name="upkeep_free_until_age_game_days" value="${String(v.upkeep_free_until_age_game_days)}">
      </label>
      <p class="muted">A horse younger than this costs nothing to keep, wherever it is standing. 360 is one game year - old enough to enter a yearling class. Set to 0 to charge board from birth, as the game did before.</p>
      <label>Time warp, cost per six months
        <input type="text" inputmode="numeric" name="time_warp_cost" value="${String(v.time_warp_cost)}">
      </label>
      <p class="muted">Costs one turn as well as the money, cannot be used past the age a horse could be bred, and the horse really is that much older afterwards - it will die that much sooner too.</p>
      `,
    },
    {
      name: 'Turns and events',
      body: html`
      <label>Turns per tick
        <input type="text" inputmode="numeric" name="actions_per_tick" value="${String(v.actions_per_tick)}">
      </label>
      <p class="muted">Kept separate from the tick schedule (world.tick_times_local) on purpose - changing how often the tick fires should never silently change how much play a day contains. Booking a covering, entering a show, claiming a founding batch and buying a genotype test each spend a turn (a panel is one turn, not four); browsing, renaming and reading are always free.</p>
      <label>Events kept for (game days)
        <input type="text" inputmode="numeric" name="events_retention_game_days" value="${String(v.events_retention_game_days)}">
      </label>
      <p class="muted">The "While you were away" feed is a notice board, not an archive - every event older than this, read or not, is deleted on the tick. The horse, its pedigree, its show results and the ledger all survive regardless.</p>
      `,
    },
    {
      name: 'Health',
      body: html`
      <label>Genotype test cost, one condition
        <input type="text" inputmode="numeric" name="genotype_test_cost" value="${String(v.genotype_test_cost)}">
      </label>
      <label>Genotype panel cost, all conditions at once
        <input type="text" inputmode="numeric" name="genotype_panel_cost" value="${String(v.genotype_panel_cost)}">
      </label>
      <p class="muted">Both read live, at the moment a test is bought - a price change affects the next purchase, never re-prices a receipt already written. Too cheap and everyone tests everything; too expensive and children breed blind. Tune by watching /admin/health.</p>
      `,
    },
    {
      name: 'Market',
      body: html`
      <label>Commission on a completed sale (%)
        <input type="text" inputmode="numeric" name="market_commission_percent" value="${String(v.market_commission_percent)}">
      </label>
      <label>How long a listing stays up (game days)
        <input type="text" inputmode="numeric" name="market_listing_game_days" value="${String(v.market_listing_game_days)}">
      </label>
      <label>Highest price the market accepts
        <input type="text" inputmode="numeric" name="market_max_price" value="${String(v.market_max_price)}">
      </label>
      <p class="muted">Commission is the market's only money sink and the only one that scales with the size of a trade - it is never charged on a sale that does not happen. Listing itself is free and costs no turn; buying costs one. How long a listing stays up is copied onto each listing when it is posted, so changing it here only affects listings put up afterwards, never one already on the market.</p>
      <label>Global price multiplier
        <input type="text" inputmode="decimal" name="market_price_multiplier" value="${String(v.market_price_multiplier)}">
      </label>
      <p class="muted">The one lever that moves every guide value at once, because the first pricing model will be wrong. It changes what the game <em>suggests</em> a horse is worth; it never touches a price a player has already typed.</p>
      <label>Base value of an unremarkable adult horse
        <input type="text" inputmode="numeric" name="market_base_value" value="${String(v.market_base_value)}">
      </label>
      <label>Conformation weight
        <input type="text" inputmode="decimal" name="market_quality_weight" value="${String(v.market_quality_weight)}">
      </label>
      <label>Newborn value factor
        <input type="text" inputmode="decimal" name="market_foal_value_factor" value="${String(v.market_foal_value_factor)}">
      </label>
      <label>Failing-horse factor
        <input type="text" inputmode="decimal" name="market_failing_factor" value="${String(v.market_failing_factor)}">
      </label>
      <label>Premium per tested-clear condition
        <input type="text" inputmode="decimal" name="market_clear_premium" value="${String(v.market_clear_premium)}">
      </label>
      <label>Ceiling on the whole tested-clear premium
        <input type="text" inputmode="decimal" name="market_clear_premium_cap" value="${String(v.market_clear_premium_cap)}">
      </label>
      <label>Known-carrier factor
        <input type="text" inputmode="decimal" name="market_carrier_factor" value="${String(v.market_carrier_factor)}">
      </label>
      <label>Known-affected factor
        <input type="text" inputmode="decimal" name="market_affected_factor" value="${String(v.market_affected_factor)}">
      </label>
      <label>Bonus per win
        <input type="text" inputmode="decimal" name="market_win_bonus" value="${String(v.market_win_bonus)}">
      </label>
      <label>Bonus per other top-three placing
        <input type="text" inputmode="decimal" name="market_place_bonus" value="${String(v.market_place_bonus)}">
      </label>
      <label>Ceiling on the show-record bonus
        <input type="text" inputmode="decimal" name="market_record_cap" value="${String(v.market_record_cap)}">
      </label>
      <label>Lowest a guide value ever goes
        <input type="text" inputmode="numeric" name="market_min_value" value="${String(v.market_min_value)}">
      </label>
      <p class="muted">Every number in this block is a guess. They were chosen so an average adult horse is worth somewhere around 800-1,500 against a starting balance of 10,000, which means a child can buy two or three horses from their opening balance and it costs them something. Nobody has watched this economy run yet - expect to retune all of them. A tested-clear horse is worth more only because someone paid for the tests; an untested one is neither penalised nor rewarded, which is what keeps buying an untested horse a real gamble.</p>
      <label>NPC listing buffer (free stalls to keep before selling surplus)
        <input type="text" inputmode="numeric" name="npc_market_capacity_buffer" value="${String(v.npc_market_capacity_buffer)}">
      </label>
      <label>Max NPC listings per stable per tick
        <input type="text" inputmode="numeric" name="npc_market_max_listings_per_tick" value="${String(v.npc_market_max_listings_per_tick)}">
      </label>
      <p class="muted">An NPC stable lists its own worst-scoring horses (against its own personality's target) once its free stalls drop below the buffer above - a per-personality asking-price multiplier and spread live on each stable's own policy row, edited on /admin/npc.</p>
      <label>NPC buying buffer (free stalls to keep before buying more)
        <input type="text" inputmode="numeric" name="npc_buying_capacity_buffer" value="${String(v.npc_buying_capacity_buffer)}">
      </label>
      <label>Max NPC purchases per stable per tick
        <input type="text" inputmode="numeric" name="npc_buying_max_purchases_per_tick" value="${String(v.npc_buying_max_purchases_per_tick)}">
      </label>
      <label>Quality floor for a tick purchase (0-100, against the buyer's own target)
        <input type="text" inputmode="decimal" name="npc_buying_min_quality" value="${String(v.npc_buying_min_quality)}">
      </label>
      <label>Quality floor named on a standing buy offer (0-100)
        <input type="text" inputmode="decimal" name="npc_buy_offer_min_quality" value="${String(v.npc_buy_offer_min_quality)}">
      </label>
      <label>Fraction of balance an NPC will spend on one horse (0-1)
        <input type="text" inputmode="decimal" name="npc_buying_budget_fraction" value="${String(v.npc_buying_budget_fraction)}">
      </label>
      <label>Balance below which an NPC stops buying entirely
        <input type="text" inputmode="numeric" name="npc_buy_offer_min_balance" value="${String(v.npc_buy_offer_min_balance)}">
      </label>
      <p class="muted">Slice 0017 §12 (Part C). An NPC stable only buys - on the standing offers board or by shopping open listings on the tick - once its free stalls are at or above the buying buffer; below that, it stops. Both routes reuse the exact appraisal and sale path a player's own purchase uses. Below the last number here it stops buying altogether and takes its standing offer down, rather than advertising a token amount for a good horse. Watch /admin/npc's buying-power column: NPC balances are real, so a stable that overspends stops buying until it earns more.</p>
      <h3>Keeping NPC stables solvent</h3>
      <label>How often the income floor is applied (game days)
        <input type="text" inputmode="numeric" name="npc_balance_floor_interval_game_days" value="${String(v.npc_balance_floor_interval_game_days)}">
      </label>
      <label>What a pet home pays, as a fraction of the horse's appraised value (0-1)
        <input type="text" inputmode="decimal" name="pet_home_payout_fraction" value="${String(v.pet_home_payout_fraction)}">
      </label>
      <p class="muted">NPC stables only show when one of the children does, and only in the slots the children left, so prize money is no longer something they can live on. Two things make up the difference. Each stable has an income floor (set per stable on the NPC stables page, not here): once every interval above, a stable that has fallen below its floor is topped back up to it - and one that is earning gets nothing. Separately, an NPC horse whose listing runs the whole way to expiry without anybody buying it goes to a pet home, and its stable is paid the fraction above. That second one is where an NPC's money should mostly come from: it only pays for horses good enough to be worth something, and every child had the full listing window to buy the horse first.</p>
      <p class="muted">The same pet-home fraction is what a child gets when they choose to send one of their own horses to a pet home from its horse page - one price for one thing, whoever is selling. It is meant to be a bad deal: well under what a real buyer would pay, so the market is always worth trying first. Raising it makes giving up on a horse more attractive to a child and loosens NPC income at the same time; the two move together on purpose. Shortening the floor interval raises how much money the floor itself can create, so prefer changing this fraction.</p>
      <h3>Stud services (Part D)</h3>
      <label>Highest fee the market accepts
        <input type="text" inputmode="numeric" name="stud_max_fee" value="${String(v.stud_max_fee)}">
      </label>
      <label>Default season cap suggested on the "offer at stud" form
        <input type="text" inputmode="numeric" name="stud_default_season_cap" value="${String(v.stud_default_season_cap)}">
      </label>
      <label>NPC stud fee, as a fraction of guide value
        <input type="text" inputmode="decimal" name="npc_stud_fee_fraction" value="${String(v.npc_stud_fee_fraction)}">
      </label>
      <label>NPC stallion's season cap
        <input type="text" inputmode="numeric" name="npc_stud_season_cap" value="${String(v.npc_stud_season_cap)}">
      </label>
      <p class="muted">A stud booking moves money exactly like a sale does - the mare's owner pays the fee, the stallion's owner receives it minus the same commission a sale takes, and there is no live-foal guarantee (a missed conception is not refunded, the same as breeding two horses in one barn today). Every NPC stable's eligible stallions are offered automatically, at a fee derived from the shared fraction above, and withdrawn again the moment their quality crosses the NPC ceiling below - a stud booking combines a stallion's genetics with a player's own stock, so the ceiling has to apply here too, not only to what an NPC stable chooses to breed.</p>
      <label>Lethal foal death window (game days)
        <input type="text" inputmode="numeric" name="lethal_foal_death_game_days" value="${String(v.lethal_foal_death_game_days)}">
      </label>
      <p class="muted">Only affects foals born after this changes - a foal already carrying a lethal condition has its death day snapshotted at birth, so retuning this never moves it.</p>
      `,
    },
    {
      name: 'Ageing',
      body: html`
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
      `,
    },
    {
      name: 'Care',
      body: html`
      <label>Care starts at age (game days)
        <input type="text" inputmode="numeric" name="care_start_age_game_days" value="${String(v.care_start_age_game_days)}">
      </label>
      <label>Farrier interval (game days)
        <input type="text" inputmode="numeric" name="farrier_interval_game_days" value="${String(v.farrier_interval_game_days)}">
      </label>
      <label>Farrier fully overdue at (game days)
        <input type="text" inputmode="numeric" name="farrier_overdue_game_days" value="${String(v.farrier_overdue_game_days)}">
      </label>
      <label>Farrier bonus (fresh)
        <input type="text" inputmode="decimal" name="farrier_bonus" value="${String(v.farrier_bonus)}">
      </label>
      <label>Farrier penalty (fully overdue)
        <input type="text" inputmode="decimal" name="farrier_penalty" value="${String(v.farrier_penalty)}">
      </label>
      <label>Farrier cost, one visit
        <input type="text" inputmode="numeric" name="farrier_cost" value="${String(v.farrier_cost)}">
      </label>
      <label>Wellness interval (game days)
        <input type="text" inputmode="numeric" name="vet_wellness_interval_game_days" value="${String(v.vet_wellness_interval_game_days)}">
      </label>
      <label>Wellness fully overdue at (game days)
        <input type="text" inputmode="numeric" name="vet_wellness_overdue_game_days" value="${String(v.vet_wellness_overdue_game_days)}">
      </label>
      <label>Wellness bonus (fresh)
        <input type="text" inputmode="decimal" name="vet_wellness_bonus" value="${String(v.vet_wellness_bonus)}">
      </label>
      <label>Wellness penalty (fully overdue)
        <input type="text" inputmode="decimal" name="vet_wellness_penalty" value="${String(v.vet_wellness_penalty)}">
      </label>
      <label>Wellness cost, one visit
        <input type="text" inputmode="numeric" name="vet_wellness_cost" value="${String(v.vet_wellness_cost)}">
      </label>
      <label>Care modifier floor
        <input type="text" inputmode="decimal" name="care_modifier_min" value="${String(v.care_modifier_min)}">
      </label>
      <label>Care modifier ceiling
        <input type="text" inputmode="decimal" name="care_modifier_max" value="${String(v.care_modifier_max)}">
      </label>
      <p class="muted">All ten are live - retuning any of them only changes the modifier computed on the next read, never a horse's own stored dates (last_farrier_game_day, last_vet_game_day). Watch /admin/care after a change.</p>
      `,
    },
    {
      name: 'Consignment dealer',
      body: html`
      <label>Cadence between batches (game days)
        <input type="text" inputmode="numeric" name="consignment_cadence_game_days" value="${String(v.consignment_cadence_game_days)}">
      </label>
      <label>Horses minted per breed, each batch
        <input type="text" inputmode="numeric" name="consignment_horses_per_breed" value="${String(v.consignment_horses_per_breed)}">
      </label>
      <p class="muted">Both live: the cadence change takes effect from whichever batch is most recent right now (see /admin/consignment for the actual next-due day), and the per-breed count applies to the next batch minted, of every breed then in play. Doesn't retroactively change a batch already minted.</p>
      `,
    },
    {
      name: 'Incidents',
      body: html`
      <p class="muted">Colic, laminitis, and the rest - see /admin/incidents for open counts and the real outcome split. Everything here is live, per-day risk (the base rate and weighting live in each incident type's own risk_model row, not here).</p>
      <label>History window shown on a horse's page (game days)
        <input type="text" inputmode="numeric" name="incident_history_game_days" value="${String(v.incident_history_game_days)}">
      </label>
      <p class="muted">Display only - rows are never deleted, and an open or degenerative incident is always shown regardless of this window. 720 = two game years at today's game_days_per_year.</p>
      <label>Workload window (game days)
        <input type="text" inputmode="numeric" name="workload_window_game_days" value="${String(v.workload_window_game_days)}">
      </label>
      <label>Workload ceiling (show entries)
        <input type="text" inputmode="numeric" name="workload_ceiling_entries" value="${String(v.workload_ceiling_entries)}">
      </label>
      <label>Daily onset probability ceiling (0-1)
        <input type="text" inputmode="decimal" name="incident_probability_ceiling_per_game_day" value="${String(v.incident_probability_ceiling_per_game_day)}">
      </label>
      <label>Acute incident care penalty
        <input type="text" inputmode="decimal" name="acute_incident_care_penalty" value="${String(v.acute_incident_care_penalty)}">
      </label>
      <label>Treat colic
        <input type="text" inputmode="numeric" name="acute_treatment_cost_colic" value="${String(v.acute_treatment_cost_colic)}">
      </label>
      <label>Treat choke
        <input type="text" inputmode="numeric" name="acute_treatment_cost_choke" value="${String(v.acute_treatment_cost_choke)}">
      </label>
      <label>Treat gastric ulcers
        <input type="text" inputmode="numeric" name="acute_treatment_cost_ulcers" value="${String(v.acute_treatment_cost_ulcers)}">
      </label>
      <label>Treat sporadic tying-up
        <input type="text" inputmode="numeric" name="acute_treatment_cost_tying_up" value="${String(v.acute_treatment_cost_tying_up)}">
      </label>
      <label>Treat strangles
        <input type="text" inputmode="numeric" name="acute_treatment_cost_strangles" value="${String(v.acute_treatment_cost_strangles)}">
      </label>
      <label>Treat hoof abscess / thrush
        <input type="text" inputmode="numeric" name="acute_treatment_cost_abscess" value="${String(v.acute_treatment_cost_abscess)}">
      </label>
      <label>Treat rain rot / mud fever
        <input type="text" inputmode="numeric" name="acute_treatment_cost_skin" value="${String(v.acute_treatment_cost_skin)}">
      </label>
      <label>Treat eye injury
        <input type="text" inputmode="numeric" name="acute_treatment_cost_eye_injury" value="${String(v.acute_treatment_cost_eye_injury)}">
      </label>
      <label>Treat laminitis
        <input type="text" inputmode="numeric" name="acute_treatment_cost_laminitis" value="${String(v.acute_treatment_cost_laminitis)}">
      </label>
      <label>Treat navicular
        <input type="text" inputmode="numeric" name="acute_treatment_cost_navicular" value="${String(v.acute_treatment_cost_navicular)}">
      </label>
      <label>Treat osteoarthritis
        <input type="text" inputmode="numeric" name="acute_treatment_cost_osteoarthritis" value="${String(v.acute_treatment_cost_osteoarthritis)}">
      </label>
      <label>Treat suspensory injury
        <input type="text" inputmode="numeric" name="acute_treatment_cost_suspensory" value="${String(v.acute_treatment_cost_suspensory)}">
      </label>
      `,
    },
  ];
}

export function renderConfigPage(params: { world: WorldRow; config: Config; error?: string; notice?: string; section?: string }): SafeHtml {
  const v = params.config.values;
  const sections = configSections(v).sort((a, b) => a.name.localeCompare(b.name));
  const active = sections.find((s) => s.name === params.section) ?? sections[0];

  const picker = html`
    <form method="get" action="/admin/config">
      <label>Section
        <select name="section">
          ${sections.map((s) => html`<option value="${s.name}" ${s.name === active.name ? raw('selected') : raw('')}>${s.name}</option>`)}
        </select>
      </label>
      <button type="submit">Show</button>
    </form>`;

  const body = html`
    <h1>Config</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    ${picker}
    <form method="post" action="/admin/config">
      <input type="hidden" name="section" value="${active.name}">
      <h2>${active.name}</h2>
      ${active.body}
      <button type="submit">Save changes</button>
    </form>
    <p class="muted">The show purse (show_prize_schedule) is JSON, not a whole number, so it's edited from D1's console rather than this form - the same way quality_bands already is. It's snapshotted onto each show class at creation, so a change here only affects shows scheduled afterwards.</p>
    <p class="muted">Feed levels (feed_levels) are JSON too, for the same reason - edit them from D1's console. The one on/off feature flag that exists (whether the tick writes an overdue-care notice at all) is a button on /admin/care, not a field here.</p>
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
  // executeTick has always stored the thrown message in tick_run.error_text and nothing has ever
  // shown it, so a failed tick read as the bare word "error" with no way to find out why. A failed
  // run is the one case where the operator needs more than the six columns above, so the message
  // gets its own full-width row directly underneath rather than an extra column that would be
  // empty on every healthy run and push the table wider on a phone.
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
    </tr>
    ${t.status === 'error'
      ? html`<tr><td colspan="7" class="tick-error">${t.error_text ?? 'No message was recorded - the run stopped before it could write one.'}</td></tr>`
      : raw('')}`
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
/** Amendment 0017a §6.3: what the "which of these can I safely turn on?" columns are built from. */
export interface BreedReadiness {
  hasIdealVector: boolean;
  poolOk: boolean;
  aliveCount: number;
}

export function renderBreedsAdminPage(params: {
  world: WorldRow;
  breeds: BreedRow[];
  readiness: Map<number, BreedReadiness>;
  labels: Map<string, string>;
  error?: string;
  notice?: string;
}): SafeHtml {
  const rows = params.breeds.map((b) => {
    const r = params.readiness.get(b.id);
    return html`
    <tr>
      <td>${b.code}</td>
      <td>${b.name}</td>
      <td>
        <form method="post" action="/admin/breeds" style="display:inline">
          <input type="hidden" name="action" value="set_enabled">
          <input type="hidden" name="breed_id" value="${String(b.id)}">
          <input type="hidden" name="enabled" value="${b.enabled === 1 ? '0' : '1'}">
          <button type="submit">${b.enabled === 1 ? 'In play - take out' : 'Out of play - bring in'}</button>
        </form>
        ${b.enabled === 1
          ? raw('')
          : html`<p class="muted">Bringing this in gets it a show-barn field within a tick - press "Restock show barn to plan" at /admin/shows to mint it immediately instead.</p>`}
      </td>
      <td>${r?.hasIdealVector ? 'Yes' : html`<span class="muted">No - no breed show class yet</span>`}</td>
      <td>${r?.poolOk ? 'Yes' : html`<span class="notice">No - missing a locus</span>`}</td>
      <td>${String(b.image_count)}</td>
      <td>${String(r?.aliveCount ?? 0)}</td>
      <td><input type="text" inputmode="numeric" name="count_${String(b.id)}" value="${String(b.image_count)}" style="width:4rem" form="breed-counts"></td>
      <td class="muted">${libraryImagePath(b.code, b.image_count + 1)}</td>
    </tr>`;
  });

  // One row per breed that has at least one picture, with a text box per numbered picture so the
  // operator can caption "qh-03.webp" as e.g. "flashy chestnut, jumping" without touching the file
  // itself. Purely a memory aid for picking through the grid on /horses/:id/image - never asserted
  // as true of whichever horse ends up wearing the picture (slice 0007 §2.1/§4.2).
  const labelSections = params.breeds
    .filter((b) => b.image_count > 0)
    .map((b) => {
      const fields = [];
      for (let i = 1; i <= b.image_count; i++) {
        const value = params.labels.get(`${String(b.id)}_${String(i)}`) ?? '';
        fields.push(html`
          <label class="image-label-field">
            <span class="muted">${libraryImagePath(b.code, i)}</span>
            <input type="text" name="label_${String(b.id)}_${String(i)}" value="${value}" maxlength="80" placeholder="no label" form="breed-counts">
          </label>`);
      }
      return html`
        <div class="card">
          <h3>${b.name}</h3>
          <div class="image-label-grid">${fields}</div>
        </div>`;
    });

  const body = html`
    <h1>Breeds</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <p><strong>Taking a breed out of play only closes it to NEW arrivals</strong> - founding offers, the consignment dealer, and this admin's own "create a horse" form. It never touches a horse, class, pedigree or listing that already exists: existing horses of that breed live, age, train, show, sell and die exactly as before, and two existing horses of a disabled breed can still be bred together, producing a foal of that same breed. It is not reversible in spirit - a breed code is written permanently into every horse born of it - but the switch itself can be flipped back at any time.</p>
    </div>
    <div class="card">
      <p>In GitHub, go to <code>public/horses</code> &rarr; <strong>Add file</strong> &rarr; <strong>Upload files</strong>. Name each picture for its breed code and the next number in the "Next filename" column below, save as <code>.webp</code>, and commit. Once the deploy finishes, set that breed's count to the new total here and save.</p>
      <p><strong>Files are never renumbered and never deleted - only replaced in place.</strong> Skipping or removing a number shows a broken picture rather than being quietly left out, because the site has no way to know a file is missing without a child finding it. Replacing a picture at its existing number is fine and is how you fix a bad upload.</p>
      <p class="muted">New pictures can take up to a minute to appear everywhere.</p>
    </div>
    <form id="breed-counts" method="post" action="/admin/breeds"></form>
    <table>
      <thead><tr><th>Code</th><th>Breed</th><th>In play</th><th>Ideal vector?</th><th>Allele pool?</th><th>Images</th><th>Horses alive</th><th>New count</th><th>Next filename</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Picture labels</h2>
    <p class="muted">Optional. Type a short note for a picture so you can tell them apart when picking - it's just for your own reference here, it never changes what the picker shows the kids beyond the note itself. Leave a box blank to remove its label.</p>
    ${labelSections.length ? labelSections : html`<p class="muted">No pictures uploaded yet.</p>`}
    <button type="submit" form="breed-counts">Save</button>
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
/** Slice 0026 stage 4 §4.3: the barn's stock, one row per (breed, rank) - a single blended count per
 * breed stopped meaning anything once the barn started seeding three ranks per breed rather than
 * minting one flat band, since a full Novice tier could otherwise hide an empty Champion one. */
export interface AdminBarnPlanRow {
  breedName: string;
  enabled: boolean;
  rank: 'novice' | 'open' | 'champion';
  has: number;
  target: number;
}

export interface AdminConformationCriteria {
  breedName: string;
  enabled: boolean;
  traits: { name: string; target: number; weight: number }[];
}

export interface AdminDisciplineCriteria {
  disciplineName: string;
  enabled: boolean;
  traits: { name: string; weight: number }[];
}

export function renderShowsAdminPage(params: {
  world: WorldRow;
  barnPlanRows: AdminBarnPlanRow[];
  /** Slice 0011 §2.3/§8.2: the barn's five oldest living horses, oldest first, with their own
   * age state - the show barn ages and dies on the same code path as everyone else's horses. Slice
   * 0026 stage 4 §4.10: naturalDeathGameDay is now deterministic for these horses, worth showing
   * alongside the age state it explains. */
  oldestBarnHorses: { name: string; ageState: string; naturalDeathGameDay: number | null }[];
  recentShows: AdminShowSummary[];
  /** Asked for directly: what each breed's conformation class actually scores against, one dropdown
   * per breed - only breeds with an ideal vector at all appear (§4.2's "no ideal vector means no
   * class"), enabled or not. */
  conformationCriteria: AdminConformationCriteria[];
  /** The discipline counterpart - one dropdown per discipline, enabled or not. */
  disciplineCriteria: AdminDisciplineCriteria[];
  error?: string;
  notice?: string;
}): SafeHtml {
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

  // Slice 0011 §2.3, extended by slice 0026 stage 4 §4.3/§4.7: what must not happen is a show field
  // quietly shrinking for a reason nobody can see - so a below-target (breed, rank) gets a visible
  // warning, not just a smaller number. The tick tops the barn up to plan automatically every tick
  // now, so this is mostly a way to notice a breed just enabled at /admin/breeds before its own next
  // tick catches up, or a rank plan pointing at a quality band that no longer exists.
  const belowTargetRows = params.barnPlanRows.filter((r) => r.enabled && r.has < r.target);
  const belowTargetWarning = belowTargetRows.length
    ? html`<p class="notice">Below target: ${belowTargetRows.map((r) => `${r.breedName} ${r.rank} (${String(r.has)}/${String(r.target)})`).join(', ')} - the tick tops these up automatically before it next judges a show; press the button below to do it immediately.</p>`
    : raw('');

  const totalBarnCount = params.barnPlanRows.reduce((sum, r) => sum + r.has, 0);
  const barnBreedCount = new Set(params.barnPlanRows.map((r) => r.breedName)).size;
  const RANK_LABEL: Record<string, string> = { novice: 'Novice', open: 'Open', champion: 'Champion' };
  const barnPlanTableRows = params.barnPlanRows.map(
    (r) => html`
    <tr>
      <td>${r.breedName}${r.enabled ? raw('') : html` <span class="muted">(not in play)</span>`}</td>
      <td>${RANK_LABEL[r.rank] ?? r.rank}</td>
      <td>${String(r.has)}</td>
      <td>${String(r.target)}</td>
    </tr>`
  );

  const oldestBarnRows = params.oldestBarnHorses.map(
    (h) => html`<tr><td>${h.name}</td><td>${h.ageState}</td><td>${h.naturalDeathGameDay === null ? raw('&mdash;') : String(h.naturalDeathGameDay)}</td></tr>`
  );

  // Asked for directly: the standards each class is actually judged against, one <details> dropdown
  // per breed/discipline rather than a form or a JSON blob - reading them needs no editing control,
  // and CLAUDE.md §13 wants the simplest thing that shows the data, not a polished UI.
  const conformationDropdowns = params.conformationCriteria.map(
    (c) => html`
    <details class="section-collapse">
      <summary>${c.breedName}${c.enabled ? raw('') : html` <span class="muted">(not in play)</span>`}</summary>
      <table>
        <thead><tr><th>Trait</th><th>Target</th><th>Weight</th></tr></thead>
        <tbody>
          ${c.traits.map((t) => html`<tr><td>${t.name}</td><td>${String(t.target)}</td><td>${t.weight.toFixed(2)}</td></tr>`)}
        </tbody>
      </table>
    </details>`
  );

  const disciplineDropdowns = params.disciplineCriteria.map(
    (d) => html`
    <details class="section-collapse">
      <summary>${d.disciplineName}${d.enabled ? raw('') : html` <span class="muted">(disabled)</span>`}</summary>
      <table>
        <thead><tr><th>Trait</th><th>Weight</th></tr></thead>
        <tbody>
          ${d.traits.map((t) => html`<tr><td>${t.name}</td><td>${t.weight.toFixed(2)}</td></tr>`)}
        </tbody>
      </table>
    </details>`
  );

  const body = html`
    <h1>Shows</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>The NPC show barn</h2>
      <p><strong>Fair Meadow Show Barn</strong> currently holds ${String(totalBarnCount)} horses across ${String(barnBreedCount)} breeds, seeded Novice/Open/Champion per the rank plan below. It never breeds or improves and never earns a rank by competing (its ranks are fixed at mint) - the tick tops it up to plan automatically, every tick, before judging.</p>
      ${params.barnPlanRows.length
        ? html`
          <table>
            <thead><tr><th>Breed</th><th>Rank</th><th>Has</th><th>Target</th></tr></thead>
            <tbody>${barnPlanTableRows}</tbody>
          </table>`
        : raw('')}
      ${belowTargetWarning}
      ${params.oldestBarnHorses.length
        ? html`
          <table>
            <thead><tr><th>Horse</th><th>State</th><th>Dies (game day)</th></tr></thead>
            <tbody>${oldestBarnRows}</tbody>
          </table>`
        : raw('')}
      <form method="post" action="/admin/shows">
        <input type="hidden" name="action" value="restock_barn_to_plan">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, mint whatever the plan is short right now.
        </label>
        <button type="submit">Restock show barn to plan</button>
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
      <h2>Recompute rank progress from history</h2>
      <p class="muted">The Novice/Open/Champion progression started tracking from an empty table, so ribbons a horse won before it existed were not yet counted. This re-reads every horse's full show history and works out where its rank in each breed/discipline would actually be - safe to press more than once.</p>
      <form method="post" action="/admin/shows">
        <input type="hidden" name="action" value="backfill_ranks">
        <button type="submit" class="secondary">Recompute rank progress</button>
      </form>
    </div>
    <div class="card">
      <h2>Conformation criteria, by breed</h2>
      <p class="muted">What each breed's conformation class scores a horse against - target value and weight per trait, exactly as the judge applies them.</p>
      ${conformationDropdowns.length ? conformationDropdowns : html`<p class="muted">No breed has a conformation standard set yet.</p>`}
    </div>
    <div class="card">
      <h2>Discipline criteria, by discipline</h2>
      <p class="muted">What each discipline class scores a horse against - weight per ability trait. A discipline has no target, only how much that ability counts.</p>
      ${disciplineDropdowns.length ? disciplineDropdowns : html`<p class="muted">No discipline is seeded yet.</p>`}
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
    ({ condition, clear, carrier, affected, unmanaged }) => html`
    <tr>
      <td>${condition.name} (${condition.code})</td>
      <td>${condition.severity_class}</td>
      <td>${condition.enabled ? 'yes' : 'no'}</td>
      <td>${String(clear)}</td>
      <td>${String(carrier)}</td>
      <td>${String(affected)}</td>
      <td>${condition.severity_class === 'manageable' ? String(unmanaged) : raw('&mdash;')}</td>
    </tr>`
  );

  const body = html`
    <h1>Health</h1>
    <p class="muted">Counts across every living horse in the game, read straight from genotypes - this is the truth, not what any one player knows.</p>
    <div class="card">
      <table>
        <thead><tr><th>Condition</th><th>Severity</th><th>Enabled</th><th>Clear</th><th>Carrier</th><th>Affected</th><th>Unmanaged</th></tr></thead>
        <tbody>${rows.length ? rows : html`<tr><td colspan="7" class="muted">No conditions seeded yet.</td></tr>`}</tbody>
      </table>
      <p class="muted">Unmanaged (slice 0014 §5): affected horses of a manageable condition with no current plan, from truth - not from what any one stable knows. The number a child complaining "my horse keeps losing" is really asking about.</p>
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
  /** Slice 0014 §8.5. */
  ageModifierDistribution: { prime: number; pastPeak: number; floor: number };
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
      <td>${h.ageModifier.modifier.toFixed(3)}</td>
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
        <thead><tr><th>Horse</th><th>Stable</th><th>Born (game day)</th><th>State</th><th>Age modifier</th></tr></thead>
        <tbody>${oldestRows.length ? oldestRows : html`<tr><td colspan="5" class="muted">No living horses yet.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Age modifier distribution (slice 0014 §2.1)</h2>
      <p class="muted">Watch this if the children complain either way: nobody ever showing a horse over eighteen means the floor may be too harsh; a twenty-four-year-old still routinely winning means the start day is too late.</p>
      <table>
        <thead><tr><th>Phase</th><th>Living horses</th></tr></thead>
        <tbody>
          <tr><td>Prime (1.000)</td><td>${String(params.ageModifierDistribution.prime)}</td></tr>
          <tr><td>Past peak (between)</td><td>${String(params.ageModifierDistribution.pastPeak)}</td></tr>
          <tr><td>At the floor</td><td>${String(params.ageModifierDistribution.floor)}</td></tr>
        </tbody>
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

/**
 * /admin/care (slice 0013 §8.5) - read-only except for one testing control. Counts across every
 * living player-owned horse for each timer, the distribution of care modifiers in ten buckets (so
 * the operator can see at a glance whether the band is being used or everyone sits at 1.00), each
 * stable's feed level and what it is paying in board, and "Make every horse overdue" - the same
 * bring-forward-for-testing shape /admin/ageing's own control uses, for the same reason: §11's
 * verification steps are otherwise several real days away.
 */
export function renderCareAdminPage(params: { world: WorldRow; data: CareAdminData; noticeEnabled: boolean; error?: string; notice?: string }): SafeHtml {
  const d = params.data;
  const timerRows = (rows: { status: string; count: number }[]) => rows.map((r) => html`<tr><td>${r.status}</td><td>${String(r.count)}</td></tr>`);

  const bucketRows = d.modifierBuckets.map((b) => html`<tr><td>${b.rangeLabel}</td><td>${String(b.count)}</td></tr>`);

  const stableRows = d.stables.map(
    (s) => html`
    <tr>
      <td>${s.name}</td>
      <td>${s.feedLevelName}</td>
      <td>${String(s.boardPerDay)}</td>
    </tr>`
  );

  const body = html`
    <h1>Care</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Farrier</h2>
      <table><thead><tr><th>Status</th><th>Horses</th></tr></thead><tbody>${timerRows(d.farrier)}</tbody></table>
    </div>
    <div class="card">
      <h2>Wellness</h2>
      <table><thead><tr><th>Status</th><th>Horses</th></tr></thead><tbody>${timerRows(d.wellness)}</tbody></table>
    </div>
    <div class="card">
      <h2>Care modifier distribution</h2>
      <p class="muted">Ten buckets spanning the whole band - if everyone sits in the middle bucket, the mechanic isn't doing anything yet.</p>
      <table><thead><tr><th>Range</th><th>Horses</th></tr></thead><tbody>${bucketRows}</tbody></table>
    </div>
    <div class="card">
      <h2>Where the horses are</h2>
      <p class="muted">The location flag. Horses at pasture cost no board and run no care timers, and neither they nor a horse still settling in can be bred or shown - so these two numbers are the first thing to check when a show field looks unexpectedly thin.</p>
      <p><strong>At pasture:</strong> ${String(d.atPasture)} &middot; <strong>Settling in:</strong> ${String(d.settlingIn)}</p>
    </div>
    <div class="card">
      <h2>Feed by stable</h2>
      <table><thead><tr><th>Stable</th><th>Feed</th><th>Board per game day</th></tr></thead><tbody>${stableRows.length ? stableRows : html`<tr><td colspan="3" class="muted">No player stables yet.</td></tr>`}</tbody></table>
    </div>
    <div class="card">
      <h2>Overdue notices</h2>
      <p class="muted">Whether the tick writes a "N horses are due for the farrier" event when a horse newly crosses into overdue. On by default - this is the one mechanic most likely to need turning off after a week, per CLAUDE.md's own care entry.</p>
      <p><strong>Currently:</strong> ${params.noticeEnabled ? 'on' : 'off'}</p>
      <form method="post" action="/admin/care">
        <input type="hidden" name="action" value="toggle_notice">
        <button type="submit" class="secondary">Turn notices ${params.noticeEnabled ? 'off' : 'on'}</button>
      </form>
    </div>
    <div class="card">
      <h2>Make every horse overdue</h2>
      <p class="muted">Testing control - moves every player-owned, care-eligible horse's farrier and wellness dates back far enough to trigger the full penalty on both, so the mechanic can be seen working without waiting several real days. A horse too young for care yet is left untouched.</p>
      <form method="post" action="/admin/care">
        <input type="hidden" name="action" value="make_overdue">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, move every eligible horse's care dates back to fully overdue.
        </label>
        <button type="submit" class="secondary">Make every horse overdue</button>
      </form>
    </div>
  `;
  return shell(params.world, body, 'Care', 'care');
}

/**
 * /admin/incidents (slice 0020 §8.4): per condition, how many are currently open, and the real
 * outcome split across everything resolved so far - the tuning instrument §12 says to watch closely
 * once this ships, the same role /admin/health already plays for the single-gene panel. One testing
 * control: force an incident onto a chosen horse, bypassing the roll.
 */
export function renderIncidentsAdminPage(params: {
  world: WorldRow;
  census: (IncidentAdminRow & { cost: number })[];
  horses: { id: number; name: string; stableName: string }[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const rows = params.census.map((row) => {
    const totalResolved = row.resolved + row.manageable + row.degenerative + row.death;
    const deathRate = totalResolved > 0 ? `${((row.death / totalResolved) * 100).toFixed(1)}%` : raw('&mdash;');
    return html`
    <tr>
      <td>${row.incidentType.name} (${row.incidentType.code})</td>
      <td>${String(row.openCount)}</td>
      <td>${String(row.resolved)}</td>
      <td>${String(row.manageable)}</td>
      <td>${String(row.degenerative)}</td>
      <td>${String(row.death)}</td>
      <td>${deathRate}</td>
      <td>${String(row.cost)}</td>
    </tr>`;
  });

  const horseOptions = params.horses.map((h) => html`<option value="${String(h.id)}">${h.name} (${h.stableName})</option>`);
  const conditionOptions = params.census.map((row) => html`<option value="${row.incidentType.code}">${row.incidentType.name}</option>`);

  const body = html`
    <h1>Incidents</h1>
    <p class="muted">The twelve acquired conditions - colic, laminitis, and the rest. Open counts and the real outcome split across everything that has ever resolved, the instrument these numbers should be checked against after real play (CLAUDE.md's slice 0020 entry).</p>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <table>
        <thead><tr><th>Condition</th><th>Open</th><th>Resolved</th><th>Manageable</th><th>Degenerative</th><th>Death</th><th>Death rate (of resolved)</th><th>Treatment cost</th></tr></thead>
        <tbody>${rows.length ? rows : html`<tr><td colspan="8" class="muted">No conditions seeded yet.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Force an incident</h2>
      <p class="muted">Testing control - writes the acute row directly onto the chosen horse, bypassing the roll, so the full lifecycle (onset, treatment, resolution) can be watched without waiting on real probabilities.</p>
      <form method="post" action="/admin/incidents">
        <input type="hidden" name="action" value="force_incident">
        <label>Horse
          <select name="horse_id" required>
            <option value="">Choose a horse</option>
            ${horseOptions}
          </select>
        </label>
        <label>Condition
          <select name="condition_code" required>
            <option value="">Choose a condition</option>
            ${conditionOptions}
          </select>
        </label>
        <button type="submit" class="secondary">Force incident</button>
      </form>
    </div>
  `;
  return shell(params.world, body, 'Incidents', 'incidents');
}

/**
 * /admin/npc (slice 0015 §7.3): every NPC stable's roster, personality and breeding cycle, the
 * externally-scheduled quality ceiling, and the three controls that let the operator move any of
 * it from the browser - editing the ceiling schedule, founding a new personality stable, and adding
 * an outcross batch by hand (the only way genetic material enters an NPC stable's closed
 * population, §3.3). Otherwise read-only, per CLAUDE.md §13's "no polished admin UI".
 */
export function renderNpcAdminPage(params: {
  world: WorldRow;
  stables: NpcStableAdminRow[];
  ceilingSchedule: NpcCeilingScheduleRow[];
  breeds: BreedRow[];
  disciplines: DisciplineRow[];
  qualityBands: Record<string, number>;
  defaultBand: string;
  error?: string;
  notice?: string;
}): SafeHtml {
  const stableRows = params.stables.map(
    (s) => html`
    <tr>
      <td>${s.stableName}</td>
      <td>${s.personalityCode}</td>
      <td>${s.targetLabel}</td>
      <td>${String(s.aliveCount)} / ${String(s.capacity)}</td>
      <td>${String(s.balance)}</td>
      <td>${s.lastBredGameDay === null ? raw('&mdash; (not yet)') : String(s.lastBredGameDay)}</td>
      <td>${s.nextCycleDueGameDay === null ? raw('&mdash;') : String(s.nextCycleDueGameDay)}</td>
      <td>${String(s.pairsLastCycle)}</td>
      <td>${s.marketPriceMultiplier.toFixed(2)}x</td>
      <td>${String(s.spentBuyingThisSeason)}</td>
      <td>${String(s.earnedSellingThisSeason)}</td>
      <td>${s.balanceFloor <= 0 ? raw('&mdash; (off)') : String(s.balanceFloor)}</td>
      <td>${s.balanceFloor <= 0 ? raw('&mdash;') : s.nextFloorTopupGameDay === null ? 'Due next tick' : String(s.nextFloorTopupGameDay)}</td>
    </tr>`
  );

  // Read-only display; the edit form below is the one place these numbers change (a <form> cannot
  // legally wrap a single <tr>, so this stays a plain table rather than one form per row).
  const sortedCeilings = [...params.ceilingSchedule].sort((a, b) => a.game_day_from - b.game_day_from);
  const activeRow = [...sortedCeilings].reverse().find((r) => r.game_day_from <= params.world.game_day);
  const ceilingRows = sortedCeilings.map(
    (row) => html`
    <tr class="${row.id === activeRow?.id ? 'active-row' : ''}">
      <td>${String(row.game_day_from)}</td>
      <td>${String(row.conformation_ceiling)}</td>
      <td>${String(row.ability_ceiling)}</td>
      <td>${row.id === activeRow?.id ? 'Active now' : ''}</td>
    </tr>`
  );
  const ceilingRowOptions = html`${sortedCeilings.map(
    (row) => html`<option value="${String(row.id)}">From day ${String(row.game_day_from)} (currently ${String(row.conformation_ceiling)} / ${String(row.ability_ceiling)})</option>`
  )}`;

  const breedOptions = html`${params.breeds
    .filter((b) => b.ideal_vector !== null)
    .map((b) => html`<option value="${String(b.id)}">${b.name}</option>`)}`;
  // Slice 0026 stage 4 §4.8: the outcross form's own breed picker, generalised with an "all breeds
  // in play" option - founding a new personality stable still wants exactly one breed, so breedOptions
  // above (used there) is untouched.
  const outcrossBreedOptions = html`<option value="all">All breeds in play</option>${breedOptions}`;
  const disciplineOptions = html`${params.disciplines.map((d) => html`<option value="${d.code}">${d.name}</option>`)}`;
  const npcStableOptions = html`${params.stables.map((s) => html`<option value="${String(s.stableId)}">${s.stableName}</option>`)}`;
  const bandOptions = html`${Object.keys(params.qualityBands).map(
    (band) =>
      html`<option value="${band}" ${band === params.defaultBand ? raw('selected') : raw('')}>${band} (${(params.qualityBands[band] * 100).toFixed(0)}% chance per allele)</option>`
  )}`;

  const body = html`
    <h1>NPC stables</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Every NPC stable</h2>
      <p class="muted">Each breeds on its own schedule (a tick stage, not a button) - "Next cycle due" is a projection from its last cycle, not a guarantee, since a stable in debt or at capacity is skipped and its marker still advances (it waits for the cycle after). "Spent buying" and "earned selling" are slice 0017 §12's buying-power figure: what this stable has spent and earned since the current game year began, read from its own ledger rows - watch these against its balance.</p>
      <p class="muted">The last two columns are its safety net. These stables can only show when one of the children does, and only in the slots the children left, so prize money is not something they can live on. A stable that has fallen below its floor is topped back up to it when the floor next falls due; a stable earning enough to stay above its floor is given nothing. Most of an NPC's money should come from the other mechanism, which needs no column here: an NPC horse whose listing runs all the way to expiry unsold is bought by somebody outside the area, and leaves. If a stable's balance keeps sitting at its floor, it is living on charity rather than earning - either it is breeding horses nobody wants, or the clearance fraction on the config page is set too low.</p>
      <table>
        <thead><tr><th>Stable</th><th>Personality</th><th>Targets</th><th>Horses / capacity</th><th>Balance</th><th>Last bred (game day)</th><th>Next cycle due</th><th>Pairs last cycle</th><th>Market multiplier</th><th>Spent buying (this year)</th><th>Earned selling (this year)</th><th>Income floor</th><th>Floor next due</th></tr></thead>
        <tbody>${stableRows.length ? stableRows : html`<tr><td colspan="13" class="muted">No NPC stables yet.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>The quality ceiling schedule</h2>
      <p class="muted">The applicable row at any game day is the one with the largest "From game day" that has already arrived. Overview §10d calls keeping this adjustable the single most important thing about it - change a row's numbers and save, no deploy needed.</p>
      <table>
        <thead><tr><th>From game day</th><th>Conformation ceiling</th><th>Ability ceiling</th><th></th></tr></thead>
        <tbody>${ceilingRows}</tbody>
      </table>
      <h3>Add a row, or edit an existing one</h3>
      <p class="muted">Choose "Add a new row" to add one, or pick an existing row to overwrite its three numbers (retype all three - this replaces the row, it doesn't merge).</p>
      <form method="post" action="/admin/npc">
        <input type="hidden" name="action" value="edit_ceiling">
        <label>Row
          <select name="id">
            <option value="">Add a new row</option>
            ${ceilingRowOptions}
          </select>
        </label>
        <label>From game day <input type="text" inputmode="numeric" name="game_day_from" required></label>
        <label>Conformation ceiling <input type="text" inputmode="decimal" name="conformation_ceiling" required></label>
        <label>Ability ceiling <input type="text" inputmode="decimal" name="ability_ceiling" required></label>
        <button type="submit">Save</button>
      </form>
    </div>
    <div class="card">
      <h2>Found a new NPC stable</h2>
      <p class="muted">The admin equivalent of the migrations that seeded Bronco Valley, Horseshoe Bay, and the six Paso Fino/German Warmblood personalities - a new personality doesn't need a deploy. A prefix is permanent once horses are bred under it, and cannot be changed later.</p>
      <form method="post" action="/admin/npc">
        <input type="hidden" name="action" value="found_stable">
        <label>Stable name <input type="text" name="name" required></label>
        <label>Prefix (stamped on every horse it breeds) <input type="text" name="prefix" required></label>
        <label>Personality label (for this page only, e.g. "colour_barn") <input type="text" name="personality_code" required></label>
        <label>Targets
          <select name="target_kind" required>
            <option value="conformation">A breed's conformation ideal</option>
            <option value="ability">A discipline's ability weights</option>
          </select>
        </label>
        <label>Breed (if targeting conformation) <select name="target_breed_id">${breedOptions}</select></label>
        <label>Discipline (if targeting a discipline) <select name="target_discipline_code">${disciplineOptions}</select></label>
        <label>Selection noise (standard deviation) <input type="text" inputmode="decimal" name="selection_noise_sd" required></label>
        <label>Retention bias (0-1, chance to skip a horse this cycle) <input type="text" inputmode="decimal" name="retention_bias" required></label>
        <label>Breeding interval (game days) <input type="text" inputmode="numeric" name="breeding_interval_game_days" required></label>
        <label>Max pairs per cycle <input type="text" inputmode="numeric" name="max_pairs_per_cycle" required></label>
        <label>Capacity <input type="text" inputmode="numeric" name="capacity" required></label>
        <label>Market price multiplier (1.0 = asks the plain guide value; higher asks more for its culls) <input type="text" inputmode="decimal" name="market_price_multiplier" value="1.0" required></label>
        <label>Market price spread (0-1, +/- fraction randomised per listing) <input type="text" inputmode="decimal" name="market_price_spread" value="0.1" required></label>
        <label>Income floor (the balance it is topped back up to when it falls below; 0 switches this off) <input type="text" inputmode="numeric" name="balance_floor" value="5000" required></label>
        <button type="submit">Found stable</button>
      </form>
    </div>
    <div class="card">
      <h2>Add an outcross batch</h2>
      <p class="muted">The only way genetic material enters an NPC stable's closed population - each one breeds only with itself, so its own inbreeding will otherwise climb the way an unmixed player pool's would (§3.3). Mints new horses; does not remove any.</p>
      <form method="post" action="/admin/npc">
        <input type="hidden" name="action" value="outcross">
        <label>NPC stable <select name="stable_id" required>${npcStableOptions}</select></label>
        <label>Breed <select name="breed_id" required>${outcrossBreedOptions}</select></label>
        <label>Quality band <select name="band" required>${bandOptions}</select></label>
        <label>How many to add, per breed if "all breeds in play" <input type="text" inputmode="numeric" name="count" required></label>
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, mint this many horses straight into that stable.
        </label>
        <button type="submit">Add batch</button>
      </form>
    </div>
  `;
  return shell(params.world, body, 'NPC stables', 'npc');
}

const CONSIGNMENT_INJECTABLE_LOCI = LOCI.filter((l) => ['E', 'A', 'CR', 'G', 'DMRT3'].includes(l.code));
const CONSIGNMENT_LOCUS_LABEL: Record<string, string> = { E: 'Extension', A: 'Agouti', CR: 'Cream', G: 'Grey', DMRT3: 'Gait' };

function injectionStatusLabel(row: ConsignmentInjectionRow): string {
  if (row.status === 'queued') return 'Queued';
  if (row.status === 'cancelled') return 'Cancelled';
  return `Applied${row.applied_horse_id !== null ? ` (horse #${String(row.applied_horse_id)})` : ''}`;
}

/**
 * /admin/consignment (amendment 0017a §5.5). A form and a table, not a polished UI (CLAUDE.md §13) -
 * the queue with a cancel link per row, the injection history (§8's risk: "look at that screen
 * before queueing anything"), and what's currently standing on the market.
 */
export function renderConsignmentAdminPage(params: {
  world: WorldRow;
  nextCycleGameDay: number;
  cadenceGameDays: number;
  horsesPerBreed: number;
  breedsInPlayCount: number;
  standingListings: { horseName: string; price: number; expiresGameDay: number }[];
  queued: ConsignmentInjectionRow[];
  history: ConsignmentInjectionRow[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const standingRows = params.standingListings.map(
    (l) => html`<tr><td>${l.horseName}</td><td>${String(l.price)}</td><td>${String(l.expiresGameDay)}</td></tr>`
  );

  const queuedRows = params.queued.map(
    (row) => html`
    <tr>
      <td>${row.locus_code}</td>
      <td>${row.allele}</td>
      <td>${row.zygosity}</td>
      <td>${row.applies_to}</td>
      <td>${row.sex_preference}</td>
      <td class="muted">${row.note ?? ''}</td>
      <td>
        <form method="post" action="/admin/consignment" style="display:inline">
          <input type="hidden" name="action" value="cancel">
          <input type="hidden" name="id" value="${String(row.id)}">
          <button type="submit">Cancel</button>
        </form>
      </td>
    </tr>`
  );

  const historyRows = params.history.map(
    (row) => html`
    <tr>
      <td>${String(row.queued_game_day)}</td>
      <td>${row.locus_code}</td>
      <td>${row.allele}</td>
      <td>${row.zygosity}</td>
      <td>${injectionStatusLabel(row)}</td>
      <td class="muted">${row.note ?? ''}</td>
    </tr>`
  );

  // No JavaScript in this codebase (CLAUDE.md), so a locus-then-allele two-step form isn't
  // available - one combined dropdown instead, which still makes a typo impossible (§5.5's own
  // rule: "never free text - a typo becomes a horse").
  const localeAlleleOptions = html`${CONSIGNMENT_INJECTABLE_LOCI.flatMap((l) =>
    l.alleles.map((allele) => html`<option value="${l.code}:${allele}">${CONSIGNMENT_LOCUS_LABEL[l.code] ?? l.code} (${l.code}) - ${allele}</option>`)
  )}`;

  const body = html`
    <h1>Consignment dealer</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <p><strong>Next batch due:</strong> game day ${String(params.nextCycleGameDay)}.</p>
      <p class="muted">Every ${String(params.cadenceGameDays)} game days the dealer offers ${String(params.horsesPerBreed)} horse${params.horsesPerBreed === 1 ? '' : 's'} of each breed currently in play (${String(params.breedsInPlayCount)} breed${params.breedsInPlayCount === 1 ? '' : 's'} right now, ${String(params.horsesPerBreed * params.breedsInPlayCount)} horses total), generated like founding stock at the mid quality band - colour and gait alleles only, never a shortcut past breeding for conformation. Both the cadence and the count per breed are config-driven (<code>consignment_cadence_game_days</code>, <code>consignment_horses_per_breed</code>) - change them from <a href="/admin/config">Config</a>, not here.</p>
      <form method="post" action="/admin/consignment">
        <input type="hidden" name="action" value="mint_now">
        <button type="submit">Mint a batch now</button>
      </form>
      <p class="muted">Mints immediately, today, instead of waiting for the next scheduled batch - useful right after queueing an allele below. Doesn't reset the regular cadence: the next scheduled batch is still ${String(params.cadenceGameDays)} game days after whichever batch is now most recent.</p>
    </div>
    <div class="card">
      <h2>Currently standing</h2>
      ${params.standingListings.length
        ? html`<table><thead><tr><th>Horse</th><th>Price</th><th>Expires (game day)</th></tr></thead><tbody>${standingRows}</tbody></table>`
        : html`<p class="muted">Nothing on the market from the dealer right now.</p>`}
    </div>
    <div class="card">
      <h2>Queue an allele</h2>
      <p class="muted">Consumed by the next batch that mints a matching horse. If a batch is already due right now, this allele waits for the one after that, rather than the imminent batch - so it's never surprised into a batch that was already about to happen. When it lands, that locus is pre-tested for the dealer automatically - untested, an injected allele is invisible and nobody ever pays for it. "Mint a batch now" above ignores this deferral and always includes whatever's queued.</p>
      <form method="post" action="/admin/consignment">
        <input type="hidden" name="action" value="queue">
        <label>Locus and allele <select name="locus_allele" required>${localeAlleleOptions}</select></label>
        <label>Zygosity
          <select name="zygosity" required>
            <option value="het">One copy (het)</option>
            <option value="hom">Two copies (hom)</option>
          </select>
        </label>
        <label>Applies to
          <select name="applies_to" required>
            <option value="one">One horse</option>
            <option value="all">Every matching horse in the batch</option>
          </select>
        </label>
        <label>Sex preference
          <select name="sex_preference" required>
            <option value="stallion">Stallion (spreads fastest)</option>
            <option value="mare">Mare</option>
            <option value="any">Either</option>
          </select>
        </label>
        <label>Note <input type="text" name="note" placeholder="why - this breaks breed purity on purpose, say why"></label>
        <button type="submit">Queue</button>
      </form>
    </div>
    <div class="card">
      <h2>Queued</h2>
      ${params.queued.length
        ? html`<table><thead><tr><th>Locus</th><th>Allele</th><th>Zygosity</th><th>Applies to</th><th>Sex</th><th>Note</th><th></th></tr></thead><tbody>${queuedRows}</tbody></table>`
        : html`<p class="muted">Nothing queued.</p>`}
    </div>
    <div class="card">
      <h2>Injection history</h2>
      <p class="muted">Every allele ever introduced - the only place to see the gene pool this has been building (§8's risk: it is a one-way ratchet).</p>
      ${params.history.length
        ? html`<table><thead><tr><th>Queued (game day)</th><th>Locus</th><th>Allele</th><th>Zygosity</th><th>Status</th><th>Note</th></tr></thead><tbody>${historyRows}</tbody></table>`
        : html`<p class="muted">No injections yet.</p>`}
    </div>
  `;
  return shell(params.world, body, 'Consignment dealer', 'consignment');
}

/**
 * /admin/security (slice 0016 §9.2): set or change the admin PIN for the logged-in admin's own
 * account - never another admin's - and see recent attempts against the door (§9.3). Changing the
 * PIN requires typing the account's own login password, re-checked server-side.
 */
export function renderAdminSecurityPage(params: {
  world: WorldRow;
  hasPinSet: boolean;
  attempts: PinAttemptDisplayRow[];
  error?: string;
  notice?: string;
}): SafeHtml {
  const attemptRows = params.attempts.map(
    (a) => html`
    <tr>
      <td>${formatLocal(a.real_ts, params.world.tick_timezone)}</td>
      <td>${a.attempted_by_username ?? raw('&mdash;')}</td>
      <td>${a.success ? 'correct' : 'wrong'}</td>
    </tr>`
  );

  const body = html`
    <h1>Security</h1>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <div class="card">
      <h2>Admin door PIN</h2>
      <p class="muted">A lock on the admin pages for a child holding an unlocked phone that is already logged in as a grown-up. It is not protection against somebody who knows the account password - the "forgotten PIN" link on the unlock page hands admin back to anyone who does, by design.</p>
      <p><strong>Currently:</strong> ${params.hasPinSet ? 'a PIN is set' : 'no PIN is set - anyone holding this phone can reach these pages'}</p>
      <form method="post" action="/admin/security">
        <label>New 4-digit PIN
          <input type="text" inputmode="numeric" name="pin" maxlength="4" required autocomplete="off">
        </label>
        <label>Your account password, to confirm
          <input type="password" name="password" required>
        </label>
        <button type="submit">${params.hasPinSet ? 'Change PIN' : 'Set PIN'}</button>
      </form>
    </div>
    <div class="card">
      <h2>Recent attempts</h2>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Result</th></tr></thead>
        <tbody>${attemptRows.length ? attemptRows : html`<tr><td colspan="3" class="muted">None yet.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  return shell(params.world, body, 'Security', 'security');
}

/**
 * /admin/unlock (slice 0016 §9.5/§9.7): the gate itself. Deliberately not wrapped in shell() - an
 * unlocked admin has not proven they belong on an admin page yet, so this page carries no subnav
 * and no link back into the admin area except by unlocking. `forgot` switches to the password-based
 * reset form (§9.7); both forms carry the same hidden redirect target.
 */
export function renderAdminUnlockPage(params: { world: WorldRow; redirectTo: string; forgot: boolean; error?: string }): SafeHtml {
  const body = params.forgot
    ? html`
      <h1>Forgotten PIN</h1>
      ${errorBox(params.error)}
      <p>Typing your account password clears the PIN, so you can set a new one from Security. This grants nothing new - knowing the password already means being this admin.</p>
      <form method="post" action="/admin/unlock">
        <input type="hidden" name="action" value="forgot">
        <input type="hidden" name="redirect" value="${params.redirectTo}">
        <label>Account password
          <input type="password" name="password" required>
        </label>
        <button type="submit">Clear the PIN</button>
      </form>
      <p><a href="/admin/unlock?redirect=${encodeURIComponent(params.redirectTo)}">Back to the PIN</a></p>`
    : html`
      <h1>Admin PIN</h1>
      ${errorBox(params.error)}
      <p>Enter the admin PIN to continue.</p>
      <form method="post" action="/admin/unlock">
        <input type="hidden" name="redirect" value="${params.redirectTo}">
        <label>4-digit PIN
          <input type="text" inputmode="numeric" name="pin" maxlength="4" required autocomplete="off" autofocus>
        </label>
        <button type="submit">Unlock</button>
      </form>
      <p><a href="/admin/unlock?redirect=${encodeURIComponent(params.redirectTo)}&forgot=1">I've forgotten the PIN</a></p>`;

  return pageShell({ title: 'Admin PIN', world: params.world, loggedIn: true, isAdmin: true, section: 'admin', actionsLeft: null, body });
}

/**
 * /admin/horses: find any horse by name and jump to its full page. `/horses/:id` already shows an
 * admin everything an owner sees, plus true health status computed straight from the genotype -
 * this is just the way in, since going stable by stable to find one horse isn't practical once a
 * family has more than a handful.
 */
export function renderAdminHorseSearchPage(params: { world: WorldRow; query: string; results: HorseSearchRow[]; notice?: string }): SafeHtml {
  const rows = params.results.map(
    (h) => html`
    <tr>
      <td><a href="/horses/${String(h.id)}">${horseDisplayName(h)}</a></td>
      <td>${h.stable_name}</td>
      <td>${h.breed_name ?? raw('&mdash;')}</td>
      <td>${h.sex}</td>
      <td>${h.status}</td>
      <td>${String(h.born_game_day)}</td>
    </tr>`
  );

  const noResults =
    params.query.length === 0
      ? raw('')
      : params.results.length === 0
        ? html`<p class="muted">No horse's registered or barn name matches "${params.query}".</p>`
        : raw('');

  const body = html`
    <h1>Search horses</h1>
    ${params.notice ? html`<p class="notice">${params.notice}</p>` : raw('')}
    <p class="muted">Finds a horse by registered or barn name, from any stable - the horse's own page shows everything an owner sees, and (as an admin) the true health result straight from its genotype.</p>
    <form method="get" action="/admin/horses">
      <label>Name
        <input type="text" name="q" value="${params.query}" autocomplete="off" autofocus>
      </label>
      <button type="submit">Search</button>
    </form>
    ${noResults}
    ${rows.length
      ? html`
        <table>
          <thead><tr><th>Name</th><th>Stable</th><th>Breed</th><th>Sex</th><th>Status</th><th>Born (game day)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : raw('')}
  `;
  return shell(params.world, body, 'Search horses', 'horses');
}
