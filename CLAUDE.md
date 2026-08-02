# Build Record

**Read this file completely before writing any code. Then read the slice document you were given. Do not read the full design documents unless the slice document tells you to.**

This is the *build* record: how this codebase is written, what conventions hold across sessions, and how to behave when something is unclear. It is not the design record. The design lives in `docs/horse-game-overview.md` and `docs/horse-game-schema.md`, and those documents deliberately do not decide everything.

---

## 1. What this project is

A text-based horse breeding and showing game for one family — roughly five accounts, private, not public. Players breed horses using a genetics engine modelled on real equine genetics, manage care and training, and compete in shows judged against breed standards.

Three things about the context shape every decision below:

- **The person running this project does not write code, and has no terminal access.** They can read plain English, follow instructions, click deploy, and describe what looks wrong. They cannot debug, and **cannot run CLI commands of any kind** — no `npm`, no `wrangler`, no `git` on the command line. Their only tools are the Cloudflare dashboard (Workers logs, D1's Console tab for pasting SQL, Settings/Variables), the GitHub website's file editor, and whatever the deployed site itself renders in a browser. This means: never leave the repo in a non-deploying state, never hand back a change that requires manual steps not written down, never hand back an instruction that assumes a terminal, and explain what you did in language that assumes no programming knowledge.
  - **Migrations can be applied from the browser**, at `/admin/migrations` — see the dated entry in §11 below for how it works. The `migrate:local` / `migrate:remote` npm scripts still exist as a CLI alternative for whoever does have a terminal; both paths share one tracking table so either is safe to use.
- **Cost target is as close to zero as possible.** Cloudflare free tier, moving to the $5/month paid Workers tier only when the world tick genuinely needs it. No paid services, no third-party APIs that bill, no dependency that has a hosted component.
- **The codebase is written by many separate sessions with no memory of each other.** You are one of them. The next session knows only what is written down. This is the reason for most of the conventions in §4 and §5, and the reason §9 asks you to update this file.

---

## 2. How to read the design documents

The design documents use a deliberate convention, and misreading it is the most likely way a session does damage.

- **"Recommendation" and "Lean" mean a defensible answer with reasoning attached. They are not instructions.** A recommendation is what a future session should probably do *unless it has grounds to disagree*.
- **"Decided in session" means an actual decision was made in conversation.** Treat these as current standing decisions. If one looks wrong to you, say so — but do not quietly build something else.
- **"Open question" means nobody has decided.** These are listed at the end of both documents.

**When you hit an open question that your slice actually depends on: stop and ask.** Do not pick the option that makes your task easiest, do not pick the first one mentioned, and do not build both behind a flag to avoid the conversation. A wrong answer chosen silently becomes a fact of the codebase that nobody remembers choosing.

**When you disagree with something in the design documents:** say so plainly, give the reasoning, and propose the alternative. The documents ask to be argued with. What they ask you not to do is defer to them because they are written down — and equally, not to depart from them without saying you did.

**Distinguish build conventions from design decisions.** Everything in *this* file — naming, file layout, migration handling, RNG discipline — is settled and you should follow it without asking. Everything in the *design* documents about how the game works remains open to discussion. If following a convention in this file would produce something clearly wrong, raise it rather than working around it.

---

## 3. Platform and hard constraints

**Cloudflare Workers + D1 + static assets + Cron Triggers, in one git-connected project.** Push to the repo, Workers Builds deploys.

- **Not Pages.** Cron Triggers do not work with Pages, and the world tick is the spine of the design.
- **D1 is SQLite.** No native boolean — use `INTEGER` 0/1. No native JSON type — use `TEXT`, queried with SQLite's JSON functions where genuinely needed.
- **Cron Triggers are UTC-only and have no timezone setting.** The tick handler works out local time for itself. See §6.
- **CPU ceiling.** Free tier is 10ms CPU per invocation; paid is 5 minutes. Database waiting does not count toward CPU — only our own logic does. Ordinary page requests are nowhere near the limit. The world tick may approach it. Do not contort the design around 10ms; the plan is to move to the paid tier when the tick outgrows it.
- **Cron Triggers do not retry.** A scheduled invocation that throws or times out is skipped silently until the next fire. This is why the tick must be idempotent (§5.4).

**Dependencies.** Prefer the standard library and the Workers runtime. Every dependency added is something a future session has to understand and something that can break a deploy the operator cannot fix. Adding one is a decision worth stating in your summary, not a detail. No ORM — write SQL.

---

## 4. Code layout

```
/
  CLAUDE.md                  <- this file
  docs/
    horse-game-overview.md   <- design record (vision)
    horse-game-schema.md     <- design record (data model)
    slices/                  <- per-stage build briefs
  migrations/                <- numbered .sql, forward-only
  src/
    engines/                 <- pure functions, no DB access
      genetics/
      health/
      showing/
      npc/
    db/                      <- all SQL lives here
    routes/                  <- request handlers
    tick/                    <- scheduled handler and its stages
    render/                  <- HTML/text output
    lib/                     <- rng, time, config cache
  public/                    <- static assets, incl. the horse image library
  test/
```

Adjust if a slice document says otherwise, but say that you did.

---

## 5. Architecture rules

These five are load-bearing. Breaking any of them is expensive to undo later.

### 5.1 Pure engines, thin database layer

The genetics engines, the health model, the show scorer and the NPC selection policy are **functions that take data and return data, with no database access inside them.** They receive plain objects and return plain objects. The caller reads from D1, calls the engine, writes the result.

This is what lets a future session hold one engine entirely in view and change it without understanding the schema. It is also what makes the engines testable without a database.

### 5.2 Seeded randomness, everywhere, without exception

**Every random draw runs through a seeded generator. There are no calls to `Math.random()` anywhere in this codebase.**

That covers foal genotypes, environmental noise at birth, condition onset rolls, show noise, NPC selection error, procedural markings, and import candidate generation. The seed lives on the entity the draw belongs to — `horses.rng_seed`, `pregnancies.rng_seed`, `shows.rng_seed`, and so on.

Two reasons, both serious. Genetics can be tested — a session can assert that a carrier × carrier cross produces the expected proportion of affected foals rather than eyeballing a few. And anything that comes out wrong is reproducible, which matters a great deal when some of these outcomes are the death of a child's foal.

Use one shared PRNG implementation from `src/lib/rng`. Derive sub-seeds deterministically rather than creating new independent generators.

### 5.3 The world clock, never the wall clock

**Game logic reads `world.game_day`, an integer. It never calls `Date.now()` to decide anything.**

Ages, gestation, upkeep, show dates, condition onset, NPC breeding, listing expiry, training — all derive from `game_day`. A pause is the tick declining to advance the counter, and every timer stops for free. A deliberate time jump is advancing it further than usual.

Wall-clock timestamps are stored only on audit trails, the ledger, tick runs and login records — records of when something *happened*, never inputs to a decision about which game-day it is.

### 5.4 The tick is idempotent

A re-fired or double-fired tick must not double-advance anything. Derive state from stored values rather than incrementing blindly — write `x = f(game_day - last_processed)` rather than `x += 1`. Use the `last_processed_tick_seq` columns on `stables` and `pregnancies`, and record each run in `tick_run`.

Assume the tick will occasionally be missed entirely and occasionally fire twice. Both should be survivable without intervention.

### 5.5 Durations are snapshotted onto the entity

Config supplies defaults at creation time; the entity carries its own copy. Gestation length lives on the pregnancy row, not read from config at every tick. The same applies to listing expiry, tack wear rates, training programme lengths and condition progression.

Otherwise changing a tunable moves a mare's due date arbitrarily — possibly into the past. Live tunables (prices, upkeep, action budgets, show noise, NPC ceiling) are read from config directly, because they only affect future computation.

---

## 6. Time and time zones

**Store instants in UTC. Decide and display in `America/Chicago`. Never store a local time as a bare string.**

The failure this avoids is *deciding* in UTC — computing which day it is against a clock whose midnight lands at 6 or 7pm Central. Storing a UTC epoch is unrelated to that problem: an epoch is just an instant and renders as whatever local time you ask for. Storing local times is what actually breaks, because on the November changeover 1:30am happens twice and the two rows become indistinguishable.

**The tick handler pattern:**

1. The cron fires more often than the tick needs — hourly, or at the set of UTC hours that could correspond to the local slots across the year.
2. Each invocation computes the current time in `America/Chicago` and compares it against `world.tick_times_local`.
3. If it does not match a slot that has not yet run, return immediately without touching anything.

Use `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'` for the zone arithmetic. It is available in Workers and knows about DST. Never hardcode an offset.

Keep tick slots out of the 2am–3am window; that hour does not exist on the spring-forward morning.

Everything rendered to a player goes through `config.values.display_timezone`, so there is one place to change it.

---

## 7. Data conventions

- **Tables:** `snake_case`, plural (`horses`, `stables`, `show_entries`). Reference tables that read as a set may be singular where natural (`world`, `config`).
- **Columns:** `snake_case`. Foreign keys are `<entity>_id`.
- **Booleans:** `INTEGER` 0/1. Name them so the meaning is obvious: `is_npc`, `enabled`, `paused`.
- **Game time:** `*_game_day` integers. **Wall time:** `*_real_ts`, UTC epoch. The suffix tells you which clock a column belongs to — keep it.
- **JSON:** `TEXT`. Document the shape in a comment in the migration, because nothing else enforces it.
- **Money:** integers. No floats for currency, ever.
- **Append-only tables** (`ledger`, `token_ledger`, `config_audit`, `events`): insert only. Never update or delete a row in these outside an explicit, discussed retention job.

**Indexes follow the queries the real screens make.** Do not guess a full index list up front; add them when a query needs one, and say why in the migration.

---

## 8. Migrations

**Proposed convention — adopt unless a slice document supersedes it:**

- Files in `/migrations`, named `NNNN_short_description.sql`, zero-padded from `0001`.
- **Forward-only. Never edit a migration that has been applied**, including on the local dev database. If something is wrong, write a new migration that corrects it.
- One logical change per file. A migration that adds a table and backfills it is two files.
- Comment the intent at the top in one sentence, in plain English.
- Include the JSON shape as a comment for any `TEXT` column holding JSON.

This is flagged as an open question in the design documents. It is written here as a working convention so sessions have something consistent to follow; if a better one is decided, update this section and note the date.

**Since 2026-08-02, adding a migration file also means registering it in `src/db/migrations.ts`.** Add a matching `import mNNNN from '../../migrations/NNNN_description.sql'` and a list entry, in order. This is what lets `/admin/migrations` (§11) see and apply it. The file in `/migrations` is still the source of truth for the CLI path (`wrangler d1 migrations apply`); the TS list is a second, deliberately-duplicated registration for the in-app path, not a separate copy of the SQL.

---

## 9. How a session should work

**At the start:**

1. Read this file.
2. Read the slice document for the stage you are building.
3. Check `migrations/` for what actually exists, rather than assuming the schema document has been built. **Most of the schema document is not built.** It is a design, not a description.

**While working:**

- Build what the slice asks for. Do not build ahead. The build order exists because the tuning that only real play reveals is the binding constraint, not build speed.
- If the slice is ambiguous or depends on an undecided question, ask before choosing.
- Prefer the boring implementation. This codebase will be read by sessions with no context.

**At the end:**

- Summarise what you built in plain English, for a reader who does not code.
- State anything you decided that the slice did not specify.
- State anything you disagreed with and what you did about it.
- **Update this file** if you established a convention a future session needs — a new directory, a shared helper, a pattern worth repeating. Add it to §11 with the date.
- Update §10 with what now exists.

---

## 10. Current state

*Update this section as slices land.*

| Stage | Status | Notes |
|---|---|---|
| Foundation | built (2026-08-02) | Repo deploys via Workers Builds + D1 + Cron. Accounts, stables, the world clock, config, and the stable picker all work. No horses yet — see slice 0001. |
| Genetics core | built (2026-08-02) | Two horses, one breeding, a foal described in words. Five loci (E, A, CR, G, DMRT3), full pedigree + tabular COI. Admin founder form at `/admin/horses/new`; barn at `/stables/:id/horses`; breeding at `/stables/:id/breed`; horse page at `/horses/:id`. See `docs/slices/0002-genetics-core.md`. Its instant-foaling `breedNow` is gone — see the next row. |
| Pregnancy, heat and fertility | built (2026-08-03) | `breedNow`'s instant foaling is replaced by booked coverings, a 4-tick oestrous cycle, a conception roll (age, fertility trait, inbreeding), real gestation, and twins (~1 in 330, both survive). Two new tick stages resolve coverings and foal due pregnancies. Admin tunables + force-twins control at `/admin/breeding`. See `docs/slices/0003-breeding-and-fertility.md` and §11's 2026-08-03 entry below. |
| Cooled and frozen semen | specified, not built | Blocked on 0003 (now built). See `docs/slices/0004-semen-storage.md`. |
| Founding stock generator | not started | |
| Image slot | not started | |
| One polygenic trait | not started | |
| One show class | not started | |
| Tokens | not started | |
| Turns and tick | not started | |
| Health, first pass | not started | |
| Care and tack | not started | |
| Ageing and death | not started | |
| NPC stables | not started | |
| Market | not started | |
| Professions | not started | |
| Registries | not started | |

---

## 11. Conventions established during the build

*Append here as sessions establish things. Date each entry. Keep it short — this is a reference, not a changelog.*

**2026-08-02 — No JavaScript anywhere in this codebase, until a slice names a specific case.** Every page is server-rendered HTML from the Worker (`src/render/`, built with the `html` tagged-template helper in `src/lib/html.ts`). Interactivity that would normally reach for `onclick`/`confirm()` or similar is done with plain HTML instead — e.g. the manual tick-advance control (`src/render/admin.ts`) uses a `required` checkbox the operator must tick, not a JS confirm dialog, and the server re-checks that checkbox's value before acting. If a future slice genuinely needs client-side JS (a live-updating widget, a richer form), add it deliberately and say so in that slice's summary and here — don't let it creep in one `onclick` at a time.

**2026-08-02 — `src/lib/rng.ts`: seeded randomness.** `makeRng(seed): Rng` gives `{ next(), int(maxExclusive), pick(items), shuffle(items), normal(mean, sd) }`. `deriveSeed(parentSeed, label)` makes a deterministic sub-seed — call this, never `makeRng` twice from the same stored seed. `randomSeed()` is the *only* place `crypto.getRandomValues` may be called, and only to mint a brand-new seed to store on a new row (horses, pregnancies, shows, …) — never to make a random decision directly. There is a golden-value test in `test/rng.test.ts` asserting exact output for `makeRng(12345)` and `deriveSeed(12345, "genotype")`. If you ever have a reason to touch the RNG algorithm itself, that test will fail — treat that failure as the whole game's stored history becoming unreproducible, not as a test to update.

**2026-08-02 — `src/lib/time.ts`: the wall clock.** `localParts(utcSeconds, timeZone)` returns `{ year, month, day, hour, minute, dateKey, minutesOfDay }` via `Intl.DateTimeFormat`. `formatLocal` for display, `parseSlot("HH:MM")` for minutes-since-midnight, `nowUtcSeconds()` for the current instant. Never compute offsets by hand. `src/tick/slot.ts`'s `decideNextSlot` is the pure function that decides which tick slot (if any) is due — it takes `SlotState` + `CurrentLocal` and returns a decision; it does not touch the database, which is what makes `test/tick-slots.test.ts` possible without one.

**2026-08-02 — `src/lib/html.ts`: the templating helper.** `` html`...` `` escapes every interpolated value by default; wrap already-safe HTML in `raw(...)` to inline it unescaped (used for nesting one `html` result inside another, and only for that). Every route in `src/render/` builds its page through `pageShell()` in `src/render/layout.ts`, which renders the game-day header, the nav, and the paused banner.

**2026-08-02 — signed-cookie sessions (`src/lib/session.ts`, `src/lib/cookies.ts`).** No sessions table, per §13. `hh_session` is `<accountId>.<issuedAt>.<hmac>`, HMAC-SHA256 over `env.SESSION_SECRET`, `HttpOnly; Secure; SameSite=Lax`, re-issued once it's a day old. `hh_stable` is the same pattern holding the selected stable id — it is a UI convenience only; every stable-scoped route (`src/routes/stables.ts`) re-reads the stable from the account_id on the row and 404s if it isn't owned by the logged-in account, never trusting the cookie alone.

**2026-08-02 — the prefix registry (`stable_prefix_history`).** Every prefix ever claimed, current or retired, is a row here, with the unique index living on `prefix`, not `stable_id`. Creating a stable and renaming one both write to this table and `stables.prefix` atomically via a single `env.DB.batch([...])` (D1 batches are one implicit transaction — any statement failing rolls the whole thing back). Creation uses SQLite's `last_insert_rowid()` inside the batch to link the new `stable_prefix_history` row to the just-inserted `stables` row, which is why `stable_id` could stay `NOT NULL` as the schema in the slice document specifies, rather than the insert-history-row-first-with-a-null-stable_id flow the document narrates — same guarantee (a taken prefix, live or retired, rejects the whole operation), true atomicity, no relaxed constraint. See `src/db/stables.ts`.

**2026-08-02 — The operator has no terminal, at all.** Confirmed directly by the person running the project: they cannot run `npm`, `wrangler`, or any other CLI command — console/dashboard/browser only (Cloudflare dashboard, GitHub's web file editor, the deployed site itself). Recorded in §1. This makes the migration workflow in `README.md` §6 (`npx wrangler login`, `npm run migrate:remote`) something they cannot personally do — flagged there and in §1 as unresolved. If you're building a slice that would hand the operator a CLI step, stop and find a dashboard/browser equivalent instead, or say plainly in your summary that someone else with terminal access will need to do it.

**2026-08-02 — `/admin/migrations`: applying migrations from the browser, no terminal.** Built directly in response to the operator hitting exactly the failure mode this exists to fix: a brand-new D1 database with no tables yet, so `/setup` (and every other page) 500'd with "Something went wrong." `src/db/migrations.ts` bundles every file in `/migrations` into the Worker as text — see the `[[rules]]` entry in `wrangler.toml`, which tells the bundler to treat `*.sql` imports as raw strings. **The glob had to be `**/*.sql`, not `migrations/*.sql`** — wrangler's rule matcher (`glob-to-regexp`, no `globstar` option) tests the *literal import specifier text* (`../../migrations/0001_world.sql`), not a resolved path, and without globstar even a single `*` compiles to `.*` — so the glob just needs `*` somewhere before `migrations/`, and `**/*.sql` is the clearest way to write that. Confirmed by actually running `wrangler dev --local` end to end (fresh DB → apply migrations → `/setup` succeeds → the route locks down to admin-only once an account exists), not just by reading the bundler source.

Each migration's SQL is split into individual statements by `src/lib/sql.ts`'s `splitSqlStatements` (strip `--` line comments, split on `;`) rather than passed to D1's `exec()`, which requires newline-separated statements and breaks on our pretty-printed multi-line `CREATE TABLE`s (see the comment in `sql.ts` and the workers-sdk issue it links). Each migration's statements plus its own tracking-row insert run through `env.DB.batch()` — the same atomic-batch pattern `createStableWithPrefix` already uses — so a migration lands completely or not at all.

The tracking table is literally `d1_migrations`, with the exact column schema and bare-filename `name` values that `wrangler d1 migrations apply` itself uses (confirmed by reading `wrangler`'s own source, since the Cloudflare docs site 403's this environment's fetch tool). This was deliberate, not incidental: it means the browser path and the CLI path (`npm run migrate:remote`) share one history and can be freely mixed, in either order, without redoing or fighting each other.

The route (`src/routes/migrations.ts`) bypasses `buildContext` entirely, the same way `/health` does, because `buildContext` loads the `world` and `config` rows and throws if those tables don't exist yet — which is exactly the state this route has to work in. Its own auth check treats "the `accounts` table doesn't exist, or has zero rows" as open-to-anyone, the same trust model `/setup` already uses (whoever gets there first is trusted, because nobody could possibly be logged in yet either way); once a first account exists, it requires a valid admin session like every other `/admin` route.

**2026-08-02 — PBKDF2 iteration count: 100,000, not yet measured on a live deploy.** `src/lib/password.ts` uses 100,000 PBKDF2-HMAC-SHA256 iterations, per the slice document's starting point. This session built and tested the app locally (`wrangler dev` / Miniflare) but has no live Cloudflare account to deploy to, so the CPU-time measurement the slice document asks for (§6.1: log in on the deployed Worker, check the CPU time in the dashboard) has **not** been done. Whoever does the first real deploy: log in once, check the Worker's CPU time in the dashboard, and if it's close to or over the free tier's 10ms ceiling, drop `ITERATIONS` in `src/lib/password.ts` to 50,000 — then update this line with what you measured and what you did.

**2026-08-02 — UI display conventions: admin as a separate mode, nested nav, a real token system.** Built directly in response to operator feedback ahead of phase 2: the admin link sat in the same nav row as gameplay links with no visual distinction, there was no pattern for anything beyond a flat top nav before the site inevitably outgrows one, and the styling was two flat colors with no hierarchy. All in `src/render/layout.ts` and `public/style.css`, no JS added.

- `pageShell()` takes a `section?: 'player' | 'admin'` param. `'admin'` swaps the header to a visually distinct treatment (`--color-admin`, a deep indigo, versus `--color-primary` green) with its own label ("Admin panel") and a "← Back to your stables" link in place of the ordinary nav, so an admin page can't be mistaken for a gameplay page at a glance. On player pages where `isAdmin` is true, `/admin` is no longer inline with `Stables` — it's a separate pill (`.admin-chip`) pushed to the far right, visually set apart rather than sitting as a peer option. See `src/render/admin.ts`'s `shell()` for the pattern every admin route follows.
- `pageShell()` also takes an optional `subnav: NavLink[]` — a second menu bar under the header, section-local (admin's Accounts/Config/World clock/Migrations; a stable's Overview/Change prefix), active page highlighted. This is the pattern for growing a site section instead of cramming everything into the primary nav or one page. Build an `xSubnav(active)` helper next to a render module's page functions, the way `adminSubnav()` and `stableSubnav()` already do.
- Dense, secondary content collapses behind native `<details><summary>` — zero JS, per the no-JS convention above. `.section-collapse` for a page-level block (e.g. "Create an account", "Recent ticks" — default-closed unless there's a reason to default-open, like a validation error that needs to stay visible), `.row-actions` for a table row's per-row actions tucked behind a "Manage" toggle instead of inline forms crowding the row. `<td>`/`<th>` are `vertical-align: top` specifically so an opened `.row-actions` panel doesn't drag a row's other cells to its vertical center.
- `public/style.css` now opens with a `:root` token block (surface/text/brand/semantic colors, radii, a card shadow) and the rest of the file is organized into labeled sections (tokens → base → header/nav → subnav → layout → forms → buttons → tables → cards → badges → collapsibles). Reuse these custom properties rather than hardcoding hex — that's the point of writing them down, since sessions building later slices won't remember this one. New: `.badge`/`.badge-success`/`.badge-warning`/`.badge-danger` for status pills — slice 0002's genetics UI will want these for carrier/clear/affected states rather than inventing its own.
- Deliberately did not add a second typeface or any image asset — visual hierarchy comes from the color tokens, card elevation, and type weight/spacing instead. If a future slice wants a real display font for headings, it should be a self-hosted static file in `/public` (never a Google Fonts / CDN `<link>` — that's a hosted third-party dependency, ruled out by §3), added deliberately and noted here.
- Still one stylesheet, per the file's own long-standing comment.
- Testing note for whoever runs `wrangler dev --local` next: it needs a `.dev.vars` file with `SESSION_SECRET=<anything>` (gitignored, not committed) or every login/setup POST 500s trying to sign a cookie with an empty key. Also, `serializeCookie` in `src/lib/cookies.ts` marks cookies `Secure`, which Chromium will not persist over plain `http://localhost` across a form-submit navigation (fine on the real HTTPS deploy) — if you're driving the app with a browser automation tool locally, log in via curl and inject the resulting `hh_session` cookie into the browser context rather than trusting the form login to stick.

**2026-08-02 — Genetics core (slice 0002): the genotype blob, the missing-locus rule, and one deviation from a literal reading of it.** `horses.genotype` is JSON, shape `{ v: 1, mendelian: { <locus code>: [allele, allele] }, polygenic: { <trait code>: "<20 chars of 0/1>" } }` — see `src/engines/genetics/genotype.ts`. `v` is the blob's own schema version; bump it and handle both shapes if the shape ever changes, rather than migrating every horse's JSON. A **missing** locus or trait key is legal (a horse born before that gene existed) and is read via `getMendelianPair`/`getPolygenicString`, never `genotype.mendelian[code]` directly. **Every iteration over loci goes through `LOCI` in `src/engines/genetics/loci.ts`, in that array's order — never `Object.keys(...)`** — this is load-bearing for reproducibility (CLAUDE.md §5.2): the RNG draws one allele per locus in sequence. `LOCI`'s `alleles` tuple is each locus's canonical storage order (a stored pair is always sorted into it via `sortAllelePair`); its separate `wildType` field is the missing-locus default. **Those two are not always the same allele** — `§4.2` of the slice document describes the default as "the last allele in canonical order," which holds for four of the five loci, but DMRT3's canonical order is fixed by real-world convention as `["C","A"]` even though `A` is the rare (2%) gait mutation and `C` is the common wild type. Defaulting a legacy horse to `alleles[1]` would have silently made it gaited; `wildType` is spelled out per-locus instead. Flagging this because it's a literal disagreement with one sentence of the slice document, resolved in the document's own favor of intent (a missing locus must never grant a trait) rather than its literal mechanism.

Sub-seed labels in use, all via `deriveSeed` (never a second `makeRng` from a stored seed): `mendelian_sire`, `mendelian_dam`, `polygenic_sire`, `polygenic_dam`, `sex` (all derived from a foal's own `rng_seed` in `combine`/`breedNow`), and `founder_polygenic` (derived from a founding horse's own `rng_seed` in `createFoundingHorse`). `birth_noise` is reserved — not drawn anywhere yet — for whichever slice first expresses polygenic potential; see the comment in `src/engines/genetics/polygenic.ts`.

**COI uses the tabular kinship recursion, not Wright's path method** (`src/engines/genetics/pedigree.ts`'s `kinship`/`coefficientOfInbreeding`) — exact, only needs parent pointers and each ancestor's own stored `coi`. `horse_ancestors.path_count` **does not feed the COI at all**; it exists only so "this ancestor appears N times in the pedigree" can be displayed. `db/horses.ts`'s `loadPedigreeContext(env, sireId, damId)` is the two-query load behind both the breeding preview and the actual birth — one query for every ancestor id either parent has, one for those horses' `(id, sire_id, dam_id, coi)` rows — which is what guarantees the number shown before confirming a pairing is the number the foal is actually born with. Reuse it rather than writing a third way to load the same subgraph.

**Referencing a just-inserted row from several dependent inserts in the same D1 batch:** `last_insert_rowid()` (used by `createStableWithPrefix`) only stays correct for a *single* statement immediately after the insert it refers to — it goes stale the moment another insert runs. Inserting a foal needs to write a variable number of `horse_ancestors` rows all pointing at the just-inserted foal, so each one uses `(SELECT id FROM horses ORDER BY id DESC LIMIT 1)` instead — safe because a D1 batch is one transaction and nothing else can insert into `horses` in the middle of it. Reach for this pattern, not `last_insert_rowid()`, whenever more than one dependent statement needs the same freshly-minted id. (Slice 0003 update: this logic now lives in `buildFoalInsertStatements` in `src/db/horses.ts`, not `breedNow` — see the 2026-08-03 entry below. `breedNow` itself is deleted.)

**2026-08-02 — Breeds: the list is now eight, a breed code is effectively permanent, and "Paint" is a display alias rather than a breed.** All three decided in conversation and written up in `docs/horse-game-overview.md` §4/§4c — read those before building any breed work. The build-relevant parts:

- **A breed's `code` is written into every horse's `composition` blob at birth** (`{"QH": 1}` — see `createFoundingHorse` and `breedNow` in `src/db/horses.ts`). Changing a code after horses exist means a migration rewriting every horse's `composition`. Treat a code as permanent once seeded, and get it confirmed rather than inventing one: `QH`, plus `FR` (Friesian) and `NOK` (Nokota) as agreed. There is no Paint code.
- **Nothing in this codebase branches on breed identity, and it should stay that way.** Every breed-aware screen loops over `getBreeds()` rows. When a breed needs behaviour — like Paint's display alias, or an ideal vector — that behaviour is a **column on the `breeds` row**, not a branch in code. If you find yourself typing `if (breed.code === '...')`, the thing you want is a field on the row instead. Design record §12's rule 6 ("breeds, loci, conditions … are rows") is the same point from the other side.
- **Adding a locus later is designed-for and safe.** The missing-locus rule (`getMendelianPair`) means horses born before a gene existed need no backfill, and `inheritance.ts`'s per-parent-per-system RNG streams mean adding a locus does not shift an unrelated system's draws. The five loci that exist are a slicing artifact, not the intended total — the design expects roughly sixteen. So a new breed's colour genetics are usually *already on the roadmap*; the only genes that genuinely scale with breed count are the per-breed disease panels.

**`vitest.config.ts` (new file):** Vitest runs migration files through Vite's module pipeline, which doesn't understand `.sql` imports the way wrangler's own `[[rules]]` bundler does. A small inline plugin exports each `.sql` file's raw text as its default export, test-only — it has no effect on the real Worker build. Needed once `src/db/migrations.ts` (which every session's migration list lives in) became reachable from a test, in `test/genetics/consistency.test.ts`.

**2026-08-03 — Slice 0003 (pregnancy, heat and fertility) built. `breedNow` is deleted; coverings and pregnancies are real tables; two new tick stages.** Followed `docs/slices/0003-breeding-and-fertility.md` closely; nothing in it was disagreed with. What a future session needs to know:

- **`src/engines/breeding/` is new** (`fertility.ts`, `cycle.ts`, `season.ts`, `twins.ts`) — pure functions, no DB access, same pattern as `src/engines/genetics/`. `fertility.ts`'s `fertilityPotential(horse, geneMin, geneMax)` is the one function in the whole codebase allowed to read a horse's genotype for a purpose an NPC or a viewer must never see (slice 0003 §5) — it is called from exactly one place, `src/db/coverings.ts`'s `resolveOneCovering`, and nowhere else. If you ever find yourself wanting to call it from a route or a render function, stop — that's the truth/knowledge line (§12 of this file) and you're about to cross it.
- **The fertility trait's missing-value rule is its own function, not the shared one.** `getPolygenicString` (slice 0002) reads a missing trait as all zeros, which is correct for a conformation trait and would read every horse alive before this slice as almost sterile. `fertilityPotential` checks for the key itself and falls back to `deriveSeed(horse.rng_seed, 'fertility_legacy')` instead — a stable, well-distributed stand-in per horse, never a guess. Do not call `getPolygenicString`/`potential(...)` for `'fertility'` directly anywhere; always go through `fertilityPotential`.
- **The oestrous cycle is measured in ticks (`horses.cycle_anchor_tick_seq`), never game days** — slice 0003 §2 explains why (a real 21-day cycle aliases against a 10-game-day tick). `src/engines/breeding/cycle.ts`'s `cyclePhase`/`isInSeason`/`ticksUntilNextEstrus` are the only place that arithmetic happens. Rolled once per mare, from her own seed via `deriveSeed(seed, 'cycle_slot')`, at creation (`createFoundingHorse`) or at foaling (`db/pregnancies.ts`'s `foalOnePregnancy`) — never re-rolled except at foal heat, when the tick resets a dam's own anchor to `tickSeq + 1` after she foals.
- **A covering (the mating event) and a pregnancy (one row per foal) are different tables**, per slice 0003 §6 — a covering can produce zero, one or two pregnancies (twins). Booking (`db/coverings.ts`'s `bookCovering`) is a plain insert from the breeding route. Resolution is the tick's first breeding stage, `resolveDueCoverings`: finds every booked covering whose mare is in season this tick (done in SQL — `cycle_anchor_tick_seq` is always ≤ `tickSeq`, so a plain `%` is safe), rolls conception, and on success rolls twins and writes one or two pregnancies — covering-status-update and pregnancy-inserts land in one `env.DB.batch()` together, which matters: without that atomicity, a crash between the two either strands a conceived covering with no pregnancy, or (on retry) double-creates the pregnancy, because the covering's `status` column is what makes the whole stage idempotent (CLAUDE.md §5.4).
- **Genetics are rolled at conception, stored on the pregnancy (`rolled_genotype`, `rolled_coi`), and only written into a `horses` row at foaling** (slice 0003 §3.9-§3.10) — `foal_rng_seed` is minted at conception and becomes `horses.rng_seed` unchanged. `src/db/horses.ts`'s `buildFoalInsertStatements` is what `breedNow` used to do inline; it now just writes down genetics that were already decided, and is shared by the tick's foaling stage (`db/pregnancies.ts`'s `foalDuePregnancies`). If a later slice adds a second way to create a foal (e.g. slice 0004's frozen semen), reuse this function rather than inlining another `INSERT INTO horses`.
- **Twins are two independent rolls off the covering's own seed** (`double_ovulation`, `twin_continue` — `src/engines/breeding/twins.ts`'s `rollTwins`), and when they happen, each twin gets its own freshly-minted `foal_rng_seed` and its own independent genotype and gestation-length draw — not identical twins, and not necessarily born on the same day (verified in local testing: one twin foaled 11 game days after the other). The admin "force next twins" control (`/admin/breeding`) is a one-shot `config.flags.force_next_twins` boolean, consumed by whichever covering is the *first to actually conceive* after it's set (not the first to resolve) — if conception fails, the flag stays armed for the next attempt.
- **New sub-seed labels**, all via `deriveSeed`: from `horses.rng_seed` → `cycle_slot`, `fertility_legacy`; from `coverings.rng_seed` → `conception`, `double_ovulation`, `twin_continue`; from `pregnancies.rng_seed` → `gestation`; from `pregnancies.foal_rng_seed` → the slice 0002 labels, unchanged, plus `cycle_slot` (reused for a mare foal's own cycle roll at foaling).
- **The conception estimate shown to a player is not the number rolled**, deliberately (slice 0003 §5). `db/coverings.ts`'s `estimateConceptionChance` calls the same `conceptionChance` engine function the real roll uses, but with both fertility factors fixed at `1.0` — a subfertile mare's owner finds out by missing, not by reading her genotype. Never wire the breeding screen up to `fertilityPotential` directly.
- **Migrations 0017-0021.** 0021's backfill (`cycle_anchor_tick_seq` for mares that predate this slice) uses `rng_seed % estrous_cycle_ticks` rather than the real `deriveSeed('cycle_slot')` algorithm, because a plain-SQL migration has no access to the JS RNG. Deliberate simplification, documented in the migration itself — still deterministic and evenly spread, which is all a one-time backfill needs.
- **`/admin/breeding`** (new admin subpage, in the existing admin subnav pattern) is read-only display of the live tunables plus the force-twins control — no editing form, per CLAUDE.md §13 ("no polished admin UI"). If a later slice wants these tunables editable from the browser, extend `/admin/config` rather than inventing a second config-editing UI.
- Verified end-to-end against a local `wrangler dev` + `d1 migrations apply --local`: booking, both refusal paths (out of season, recovering), conception, forced twins (two independently-gened foals, different due days), foaling, pedigree/COI/prefix on the resulting foal, the in-season barn badge, and the admin breeding page.

---

## 12. Vocabulary

Use these words consistently; the design documents do, and drift here causes real confusion.

- **Account** — a person. Holds the action budget, tokens, and login.
- **Stable** — a business. Holds horses, money, capacity, stock and a breeding prefix. One account may hold several. NPC stables are rows in the same table with no account attached.
- **Prefix** — a stable's permanent mark, stamped onto the registered name of every horse it breeds. Unique across the game, enforced at the database level.
- **Registered name** — assembled once at birth from the breeder's prefix. Never changes. **Barn name** — what the current owner calls the horse; freely editable, cleared on transfer.
- **Tick** — the scheduled job that advances the world. Several per real day.
- **`game_day`** — integer days since world start. The only clock game logic reads.
- **`tick_seq`** — increments every tick regardless of pause. Distinct from `game_day`; action budgets reset against this one.
- **Truth vs knowledge** — what a horse carries (`horse_conditions`, `horses.genotype`) is separate from what a given player has paid to learn (`horse_knowledge`). These are different tables and the distinction is load-bearing for the whole design. Never render truth to a player who has not learned it.
- **Genotype tests** return clear/carrier/affected and are permanent. **Screening** returns an observation at a point in time and goes stale.
- **Live tunable** vs **structural setting** — see §5.5.
- **Standard vs circle** — a registry with no capacity admits anyone meeting the bar, permanently. One with a capacity holds only the best N and displaces.

---

## 13. Things this project deliberately does not have

Recorded so a session knows these were considered rather than forgotten. If you find yourself needing one, that is a conversation, not a task.

- No chat, moderation, or reporting. Five family members removes these from the problem space.
- No sessions table. Pre-created accounts with a password each, signed cookies. The stable picker is a selection inside an authenticated session, not a second login.
- No token-to-currency conversion in either direction.
- No path that transfers tokens between accounts. The absence of the code path *is* the enforcement — do not add one and guard it with a check.
- No direct horse transfer between one owner's own stables; they trade through the market like anyone else.
- No parallel scoring path for NPC horses. NPC stables run through the same code players do. Two scoring paths will drift and one will end up accidentally advantaged.
- No per-player pause. The pause is global.
- No polished admin UI. A form over the config table, or a JSON blob edited directly, is sufficient.

**One thing to hold onto above the rest:** the NPC quality ceiling (§10d of the overview) is the failure mode most likely to kill this project, and it is invisible while you are building. If NPC stables improve without bound, the children eventually cannot win, and the game quietly stops being worth playing. Keep the ceiling and its schedule as data, and keep them easy to change.
