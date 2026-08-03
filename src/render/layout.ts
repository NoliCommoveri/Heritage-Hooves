import { html, raw, SafeHtml } from '../lib/html';
import type { WorldRow } from '../db/world';
import { formatCalendarDate } from '../lib/calendar';

/** One link in a subnav bar. `active` marks the current page for styling. */
export interface NavLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface ShellParams {
  title: string;
  world: WorldRow;
  loggedIn: boolean;
  isAdmin: boolean;
  /**
   * Which header treatment to use. 'player' (the default) is the normal green gameplay header.
   * 'admin' switches to a visibly different header so an admin page never looks like a gameplay
   * page - see CLAUDE.md §11, "admin mode is a visibly different place, not an extra nav link".
   */
  section?: 'player' | 'admin';
  /** A row of section-local links rendered as a menu bar under the header, e.g. the admin subpages. */
  subnav?: NavLink[];
  /**
   * Slice 0009 Part B §5.4: how many turns the logged-in account has left, shown next to the game
   * day on every player page. Null when logged out. Not shown on admin pages - admin actions never
   * spend a turn (CLAUDE.md §11's admin-mode entry: admin is a visibly separate place already).
   */
  actionsLeft: number | null;
  /**
   * docs/fixes/season-month-display.md: config's game_days_per_year, used to put a calendar-style
   * label ("April, Year 2") beside the raw game day in the header. Every player-facing page passes
   * this. Optional only because admin screens deliberately never do (that doc's §2/§3 - the
   * operator wants the exact integer, not a label) and section === 'admin' ignores it either way.
   */
  gameDaysPerYear?: number;
  body: SafeHtml;
}

function subnavBar(links: NavLink[] | undefined): SafeHtml {
  if (!links || links.length === 0) return raw('');
  const items = links.map(
    (l) => html`<a href="${l.href}" class="${l.active ? 'subnav-link is-active' : 'subnav-link'}">${l.label}</a>`
  );
  return html`<nav class="subnav">${items}</nav>`;
}

export function pageShell(params: ShellParams): SafeHtml {
  const section = params.section ?? 'player';
  const pausedBanner = params.world.paused ? html`<div class="banner banner-paused">The world is paused.</div>` : raw('');

  const nav = params.loggedIn
    ? section === 'admin'
      ? html`<nav class="nav">
          <a href="/stables" class="nav-back">&larr; Back to your stables</a>
          <form method="post" action="/logout" class="nav-logout"><button type="submit">Log out</button></form>
        </nav>`
      : html`<nav class="nav">
          <a href="/stables">Stables</a>
          <a href="/shows">Shows</a>
          <a href="/world">Everyone</a>
          <span class="nav-spacer"></span>
          ${params.isAdmin ? html`<a href="/admin" class="admin-chip">Admin</a>` : raw('')}
          <form method="post" action="/logout" class="nav-logout"><button type="submit">Log out</button></form>
        </nav>`
    : raw('');

  const turnsLabel =
    section === 'player' && params.actionsLeft !== null
      ? html` <span class="muted turns-left">&middot; ${String(params.actionsLeft)} turn${params.actionsLeft === 1 ? '' : 's'} left</span>`
      : raw('');

  const headerLabel =
    section === 'admin'
      ? html`<div class="game-day">Admin panel <span class="muted">&middot; game day ${params.world.game_day}</span></div>`
      : params.gameDaysPerYear
        ? html`<div class="game-day"><strong>${formatCalendarDate(params.world.game_day, params.gameDaysPerYear)}</strong> <span class="muted">&middot; game day ${params.world.game_day}</span>${turnsLabel}</div>`
        : html`<div class="game-day">Game day <strong>${params.world.game_day}</strong>${turnsLabel}</div>`;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${params.title} · Heritage Hooves</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header ${section === 'admin' ? 'site-header--admin' : ''}">
  ${headerLabel}
  ${nav}
</header>
${subnavBar(params.subnav)}
${pausedBanner}
<main>
${params.body}
</main>
</body>
</html>`;
}

export function errorBox(message: string | undefined): SafeHtml {
  return message ? html`<p class="error">${message}</p>` : raw('');
}

export function noticeBox(message: string | undefined): SafeHtml {
  return message ? html`<p class="notice">${message}</p>` : raw('');
}
