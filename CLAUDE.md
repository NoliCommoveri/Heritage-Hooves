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
| Genetics core | not started | |
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
