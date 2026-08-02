# Heritage Hooves

A text-based horse breeding and showing game for one family. This is not a public product — it's
built for about five people, running as cheaply as possible.

This document is for the person running the project, not a programmer. It assumes you have a free
Cloudflare account and have never created a "Worker" before. Follow the numbered steps in order.

---

## 1. What you're setting up

Three pieces, all free on Cloudflare's free tier to start:

- **A Worker** — this runs the game's code.
- **A D1 database** — this stores everything: accounts, stables, horses (later), the game clock.
- **A GitHub connection** — so that whenever code is pushed to this repository, the site updates
  itself automatically. You will not need to manually upload anything after this initial setup.

## 2. Create the Worker and connect it to GitHub

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. In the left sidebar, click **Workers & Pages**.
3. Click **Create**, then choose **Workers**, then look for an option like **Import a
   repository** or **Connect to Git**. (Cloudflare's screens change from time to time — look for
   anything that says "connect a GitHub repository".)
4. Authorize Cloudflare to access your GitHub account if asked, then pick this repository
   (`Heritage-Hooves`) and the branch you want it to deploy from.
5. When it asks for a project name, `heritage-hooves` is fine.
6. It may try to run a build immediately. That's expected — it may fail the first time, because
   the database isn't connected yet. That's fine, continue to the next step.

From now on, every time new code is pushed to the connected branch, Cloudflare rebuilds and
redeploys the site automatically. You never need to click "deploy" by hand.

## 3. Create the database

1. Still in the Cloudflare dashboard, find **D1** in the sidebar (it may be under **Storage &
   Databases**).
2. Click **Create database**.
3. Name it exactly `heritage-hooves`.
4. Once it's created, you'll see a **Database ID** on the screen — a long string of letters and
   numbers. Copy it.

## 4. Put the database ID into the project

1. Open the file `wrangler.toml` in this repository (you can edit it directly on GitHub's website
   — click the file, then the pencil/edit icon).
2. Find the line that says:
   ```
   database_id = "PASTE_YOUR_DATABASE_ID_HERE"
   ```
3. Replace `PASTE_YOUR_DATABASE_ID_HERE` with the ID you copied, keeping the quote marks.
4. Commit/save the change directly to the branch the Worker deploys from. This triggers a new
   deploy automatically.

## 5. Set the session secret

This is a password the site uses internally to keep people logged in securely. You never type it
in yourself — you just need to set it once.

1. In the Cloudflare dashboard, open your Worker (`heritage-hooves`).
2. Go to **Settings** → **Variables and Secrets** (wording may vary slightly).
3. Add a new **secret** (not a plain variable) named `SESSION_SECRET`.
4. For the value, type any long random string — 40 or more random letters and numbers is plenty.
   It doesn't need to mean anything.
5. Save it.

**If you ever change this value later, everyone will be logged out at once.** Nothing else
breaks — they just need to log in again.

## 6. Apply the database migrations

"Migrations" are the instructions that build the empty tables the database needs. You do this
entirely in the browser — no terminal needed.

1. Visit your Worker's URL and go to `/admin/migrations` (for example
   `https://your-site.workers.dev/admin/migrations`).
2. You'll see a list of migration files, all marked "pending" the first time.
3. Tick the confirmation box and press **Apply pending migrations**. The list should flip to
   "applied" for everything.
4. Continue to the next step (creating the first account).

You only need to do this once for a brand new database. If this document later adds new
migration files, come back to the same page — it only applies the ones that haven't run yet, and
it's safe to press the button again even if nothing is pending.

**If you're comfortable with a terminal, there's also a command-line option** — `npm run
migrate:remote` (see "For developers" below). Both paths keep track of what's been applied in the
same place, so it's safe to use either one, or switch between them.

## 7. Visit the site and create the first account

1. Find your Worker's URL in the Cloudflare dashboard (something like
   `heritage-hooves.<your-subdomain>.workers.dev`), or your own domain if you connected one.
2. Open it in a browser. You should see a form asking you to create the first account.
3. Fill it in. This first account is automatically the admin account — keep its password safe.
4. Once it's created, this setup form disappears forever. Nobody can create a second "first"
   account.

## 8. If something looks wrong

- **Check the Worker's logs.** In the Cloudflare dashboard, open the Worker, then look for
  **Logs** (sometimes under **Observability**). Recent errors show up there in real time.
- **Visit `/health`** on your site (e.g. `https://your-site.workers.dev/health`). This is a plain
  text page, no login needed, that shows the current game day, whether the world is paused, when
  the last tick ran, and whether the database migrations look like they've been applied. If this
  page itself shows an error, the database connection or migrations are the first thing to check.
- **A page says 500 / "Something went wrong."** This usually means either the database ID in
  `wrangler.toml` is wrong, or the migrations haven't been applied yet (step 6).
- **Everyone is logged out at once.** Expected if the `SESSION_SECRET` was changed. Nothing else
  is affected — just log back in.

---

## Acceptance checklist

Walk through this after the first deploy to confirm everything works. Each step says what to
click and what you should see.

1. Open the site. You are asked to make the first account. Make it.
2. You land on an admin page. It shows a game day, a tick sequence number, and whether the world
   is paused.
3. Go to the accounts page (**Admin → Accounts**) and make an account for one of the children,
   with a starting password you choose.
4. Log out. Log in as that child. You are asked to choose a new password before anything else.
5. Make a stable. Give it a name and a prefix (a short mark, like "Willow Creek", that gets
   stamped on every horse this stable ever breeds).
6. Try to make a second stable with the same prefix. It is refused, and the message tells you why.
7. Make a second stable with a different prefix. Both appear on the picker screen.
8. Choose one. You land on that stable's page and it shows the name, prefix, balance and
   capacity.
9. Change the prefix of one stable. It works, because no horses have been bred yet (that comes in
   a later stage of the project).
10. Log back in as the admin. Go to **Admin → World clock**, tick the confirmation box, and press
    "Advance one tick now". The game day goes up by ten.
11. Pause the world. Press advance again (ticking the confirmation box each time). The tick
    sequence goes up; the game day does not.
12. Unpause.
13. Go to **Admin → Config**, change `starting_balance` to a different number, and save. Check the
    **change history** link shows the old and new value and who changed it.
14. Wait for a real tick to come round (the world advances itself three times a day). Check that
    the game day moved on its own, and that the recent-ticks list on the World clock page shows it
    fired at roughly the local time (Central time) you expected.

Step 14 is the one worth actually waiting for — it's the only thing that can't be checked in five
minutes, and it's the piece most worth trusting before relying on the site.

---

## For developers

- `npm install` — install dependencies.
- `npm run dev` — run the site locally (`wrangler dev`).
- `npm test` — run the test suite (pure functions only — RNG, time zone handling, prefix
  validation, password hashing, tick slot selection).
- `npm run migrate:local` / `npm run migrate:remote` — apply database migrations to your local
  dev database or the real one.
- `npm run deploy` — deploy by hand (not normally needed; pushing to the connected branch does
  this automatically).

See `CLAUDE.md` for how this codebase is organised and the conventions it follows.
