import { html, SafeHtml } from '../lib/html';
import { pageShell, errorBox } from './layout';
import type { WorldRow } from '../db/world';

export function renderSetupPage(params: { world: WorldRow; gameDaysPerYear: number; error?: string }): SafeHtml {
  const body = html`
    <h1>Welcome to Heritage Hooves</h1>
    <p>Nobody has an account yet. Create the first one - it will be the admin account.</p>
    ${errorBox(params.error)}
    <form method="post" action="/setup">
      <label>Your name (shown in the app)
        <input type="text" name="display_name" required>
      </label>
      <label>Username
        <input type="text" name="username" required autocapitalize="off" autocomplete="username">
      </label>
      <label>Password
        <input type="password" name="password" required autocomplete="new-password">
      </label>
      <label>Confirm password
        <input type="password" name="confirm_password" required autocomplete="new-password">
      </label>
      <button type="submit">Create admin account</button>
    </form>
  `;
  return pageShell({ title: 'Set up', world: params.world, loggedIn: false, isAdmin: false, actionsLeft: null, gameDaysPerYear: params.gameDaysPerYear, body });
}

export function renderLoginPage(params: { world: WorldRow; gameDaysPerYear: number; error?: string }): SafeHtml {
  const body = html`
    <h1>Log in</h1>
    ${errorBox(params.error)}
    <form method="post" action="/login">
      <label>Username
        <input type="text" name="username" required autocapitalize="off" autocomplete="username">
      </label>
      <label>Password
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      <button type="submit">Log in</button>
    </form>
  `;
  return pageShell({ title: 'Log in', world: params.world, loggedIn: false, isAdmin: false, actionsLeft: null, gameDaysPerYear: params.gameDaysPerYear, body });
}

export function renderPasswordChangePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  forced: boolean;
  error?: string;
}): SafeHtml {
  const body = html`
    <h1>Change your password</h1>
    ${params.forced ? html`<p>You're using a starting password. Choose your own before doing anything else.</p>` : html``}
    ${errorBox(params.error)}
    <form method="post" action="/account/password">
      ${params.forced ? html`` : html`<label>Current password
        <input type="password" name="current_password" required autocomplete="current-password">
      </label>`}
      <label>New password
        <input type="password" name="new_password" required autocomplete="new-password">
      </label>
      <label>Confirm new password
        <input type="password" name="confirm_password" required autocomplete="new-password">
      </label>
      <button type="submit">Change password</button>
    </form>
  `;
  return pageShell({
    title: 'Change password',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}

/**
 * Self-service pause. Reached from the nav's "Account" link, and it's the one page router.ts's
 * paused gate always leaves open - so it renders correctly in both states rather than assuming
 * the caller only reaches it while unpaused.
 */
export function renderAccountPausePage(params: {
  world: WorldRow;
  isAdmin: boolean;
  actionsLeft: number | null;
  gameDaysPerYear: number;
  paused: boolean;
}): SafeHtml {
  const body = params.paused
    ? html`
      <h1>This account is paused</h1>
      <p>Your horses keep ageing, any pregnancy still foals, any listing you have on the market still runs to its expiry, and any show entry you've made still gets judged. But nothing else on this account happens while it's paused - no board is charged, no new illness or injury is rolled, and no page lets you do anything except unpause.</p>
      <form method="post" action="/account/pause">
        <input type="hidden" name="action" value="unpause">
        <button type="submit">Unpause my account</button>
      </form>
    `
    : html`
      <h1>Pause your account</h1>
      <p>Use this before time away from the game. While paused: your horses keep ageing, a pregnancy still foals, a market listing still runs to its expiry, and a show entry you've already made still gets judged. But you won't be charged board, no new illness or injury will be rolled for your horses, and every page will send you back here until you unpause - which you can do any time.</p>
      <form method="post" action="/account/pause">
        <input type="hidden" name="action" value="pause">
        <button type="submit" class="secondary">Pause my account</button>
      </form>
      <p><a href="/account/password">Change your password</a></p>
    `;
  return pageShell({
    title: params.paused ? 'Account paused' : 'Pause account',
    world: params.world,
    loggedIn: true,
    isAdmin: params.isAdmin,
    actionsLeft: params.actionsLeft,
    gameDaysPerYear: params.gameDaysPerYear,
    body,
  });
}
