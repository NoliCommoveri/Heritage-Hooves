import { html, raw, SafeHtml } from '../lib/html';
import type { WorldRow } from '../db/world';

export interface ShellParams {
  title: string;
  world: WorldRow;
  loggedIn: boolean;
  isAdmin: boolean;
  body: SafeHtml;
}

export function pageShell(params: ShellParams): SafeHtml {
  const pausedBanner = params.world.paused ? html`<div class="banner banner-paused">The world is paused.</div>` : raw('');

  const nav = params.loggedIn
    ? html`<nav class="nav">
        <a href="/stables">Stables</a>
        ${params.isAdmin ? html`<a href="/admin">Admin</a>` : raw('')}
        <form method="post" action="/logout" class="nav-logout"><button type="submit">Log out</button></form>
      </nav>`
    : raw('');

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${params.title} · Heritage Hooves</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <div class="game-day">Game day <strong>${params.world.game_day}</strong></div>
  ${nav}
</header>
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
