// This page must render even when nobody is logged in and no tables exist at all yet - that's the
// state a brand new database is in before any migration has run. So unlike every other page, it
// does not go through pageShell (which needs a `world` row that may not exist), and it is reached
// before buildContext runs at all - see the special-cased line near the top of router.ts.
import { html, SafeHtml } from '../lib/html';
import { errorBox, noticeBox } from './layout';
import type { MigrationStatus } from '../db/migrations';

export function renderMigrationsPage(params: {
  status: MigrationStatus[];
  preSetup: boolean;
  notice?: string;
  error?: string;
}): SafeHtml {
  const pending = params.status.filter((m) => !m.applied);
  const rows = params.status.map(
    (m) => html`<tr><td>${m.name}</td><td>${m.applied ? 'applied' : 'pending'}</td></tr>`
  );

  const footerLink = params.preSetup
    ? html`<p><a href="/setup">Continue to create the first account</a></p>`
    : html`<p><a href="/admin">Back to admin home</a></p>`;

  const body = html`
    <h1>Database migrations</h1>
    <p>This builds the empty tables the game needs. If the site shows "Something went wrong" on
    every page, this is usually why - apply the pending migrations below, then try again.</p>
    ${errorBox(params.error)}
    ${noticeBox(params.notice)}
    <table>
      <thead><tr><th>Migration</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${
      pending.length > 0
        ? html`
      <form method="post" action="/admin/migrations">
        <label class="confirm-checkbox">
          <input type="checkbox" name="confirm" value="yes" required>
          Yes, apply the ${String(pending.length)} pending migration(s) now.
        </label>
        <button type="submit">Apply pending migrations</button>
      </form>
      <p class="confirm-note">Applies each pending file in order. If one fails partway, the ones
      before it stay applied - the message will say exactly which file failed. Come back and ask
      for help with that exact message rather than pressing the button again.</p>`
        : html`<p>Everything is applied. Nothing to do.</p>`
    }
    ${footerLink}
  `;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Migrations · Heritage Hooves</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}
