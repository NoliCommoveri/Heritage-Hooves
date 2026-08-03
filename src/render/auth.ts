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
