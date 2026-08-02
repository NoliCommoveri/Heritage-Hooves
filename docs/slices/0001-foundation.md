# Slice 0001 — Foundation

**Status:** ready to build. Nothing in this slice exists yet.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** If you want context on a specific point, the relevant sections are cited inline — read only those. The design documents describe a game far larger than this slice, and reading them will make you build ahead.

**What this slice is.** The floor everything else stands on: a repository that deploys, a world clock that moves, a seeded random number generator, a config table, accounts, stables, and the stable picker. No horses. No genetics. No money changing hands.

**Why this comes first.** Four things here are expensive or impossible to retrofit — the world clock (every later system derives its dates from it), the seeded RNG (unseeded draws are unreproducible forever), the prefix scheme (a prefix added after horses exist leaves the first generation permanently unmarked), and the config table (constants baked into code get tuned far less often than they should be). Everything else in this slice is ordinary plumbing.

---

## 1. What "done" looks like

The person running this project — who does not write code — should be able to do all of the following on a live URL, on a phone:

1. Open the site for the first time and be asked to create the first account. That account is the admin.
2. Log in and log out.
3. Go to an admin page and create accounts for the children, each with a starting password.
4. Log in as a child, be made to change the starting password, then create a stable — giving it a name and claiming a breeding prefix. Be told clearly if the prefix is already taken.
5. Create a second stable and see both on a picker screen, choose one, and land on that stable's page.
6. See the current game day on screen, and see it change on its own after a tick fires.
7. Pause the world from the admin page and watch the game day stop moving.
8. Press an admin button that advances the world by one tick immediately, without waiting.
9. Change a number in the config from the admin page and see it recorded in an audit list.

If all nine work, the slice is done.

---

## 2. Decisions taken for this slice

These were settled in conversation on 2 August 2026. Treat them as standing decisions, not recommendations. If one looks wrong, say so — but build this.

**2.1 The world clock runs from day one, but does no game work.** The cron fires, works out the local time, decides whether a tick slot has come round, and if so advances `game_day` and `tick_seq` and writes a `tick_run` row. That is all it does. There is nothing to age yet. The reason for building it now rather than at the "Turns and tick" stage is that the timezone handling and the idempotency rules are the parts most likely to be got wrong, and every slice between here and there is easier to test against a clock that already moves.

**2.2 There is also a manual advance button.** An admin-only control that advances the world by exactly one tick immediately. This exists so time-dependent things can be tested without waiting for a real tick, and it is the mechanism behind the deliberate time jump the design describes (overview §6b). It is deliberately additive: pressing it does not disturb the cron's slot bookkeeping, so the next scheduled tick still fires as normal.

**2.3 Accounts are created by an admin, in the app.** Not by a seed migration. The bootstrap is a one-time setup screen: when the `accounts` table is empty, the site shows a form to create the first account, which is automatically the admin. After that the setup screen is permanently unreachable. This keeps passwords out of git and means adding a sixth family member is a form rather than a deploy.

**2.4 A stable's prefix is free to change until that stable breeds its first horse, and permanent after.** A child can fix a typo or change their mind right up to the moment the prefix starts appearing on horses. After that it is fixed forever, because a permanent mark that changes retroactively is not a permanent mark (overview §5d). Slice 1 has no horses, so nothing locks a prefix yet — but build the `prefix_locked` column and the check now, and the breeding slice sets the flag when a stable's first foal is born.

**2.5 The Cloudflare Worker and D1 database do not exist yet.** This slice includes writing the setup instructions for creating them, aimed at someone who has never done it.

---

## 3. Platform setup

You are writing two things here: the project configuration, and an instruction sheet for the operator.

### 3.1 Files at the repository root

**`wrangler.toml`**

```toml
name = "heritage-hooves"
main = "src/index.ts"
compatibility_date = "2026-08-01"

[assets]
directory = "public"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "heritage-hooves"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"

[triggers]
crons = ["*/15 * * * *"]
```

The `database_id` placeholder is deliberate. The operator creates the database and pastes the ID in; say so in the README in exactly those words, and leave the placeholder text obvious enough that a missing value is not mistaken for a real one.

**Why the cron fires every fifteen minutes rather than hourly.** The tick slots are times of day in Central. If the cron fired hourly on the hour and a slot sat on the hour, a few seconds of scheduler jitter could mean the slot is missed and picked up an hour late. Firing four times an hour bounds the lateness at fifteen minutes. Ninety-six invocations a day is nothing against the free tier's allowance, and the vast majority return immediately having done nothing.

**`package.json`** — devDependencies only. Nothing at runtime.

- `wrangler`
- `typescript`
- `@cloudflare/workers-types`
- `vitest`

Scripts: `dev`, `deploy`, `test`, and `migrate:local` / `migrate:remote` wrapping `wrangler d1 migrations apply`.

**On TypeScript.** Wrangler compiles it with no separate build step, it costs nothing at runtime, and it is the cheapest available protection for a codebase written by sessions that cannot ask each other questions — particularly around the shapes of the JSON columns, which nothing else enforces. Declare the shapes as exported types next to the code that reads them.

**On vitest.** The tests in this slice cover pure functions only — the RNG, the time helpers, prefix validation, password encoding. None of them touch D1, so plain vitest is sufficient and the Workers test pool is not needed. Do not add it.

**`.gitignore`** — `node_modules`, `.wrangler`, `dist`, `.dev.vars`.

**`README.md`** — currently empty. Fill it in. This is operator documentation, not developer documentation: what the project is, how to deploy it, how to log in the first time, and what to do if something looks wrong. Plain English, no jargon, numbered steps.

### 3.2 The operator's setup instructions

Write these into the README as a numbered walkthrough. They need to cover, in order:

1. Creating a Worker in the Cloudflare dashboard and connecting it to this GitHub repository, so that pushing to the repo deploys automatically.
2. Creating a D1 database named `heritage-hooves`, and where the database ID appears on screen.
3. Where in `wrangler.toml` that ID goes, and that this change must be committed and pushed.
4. Setting the `SESSION_SECRET` secret in the Worker's settings — what it is for, and that any long random string will do. Say plainly that if this value is ever changed, everybody is logged out, and nothing else breaks.
5. Applying the migrations for the first time.
6. Visiting the URL and creating the first account.
7. A short "if it looks broken" section: where to find the Worker's logs in the dashboard, and what the `/health` page shows.

Assume the reader has a Cloudflare account and has never made a Worker. Describe what they will see on screen, not what the API is called.

---

## 4. Migrations

Follow `CLAUDE.md` §8. Forward-only, one logical change per file, a one-sentence plain-English comment at the top of each, and the shape of any JSON column written out as a comment.

Nine files:

| File | Contents |
|---|---|
| `0001_world.sql` | `world` table |
| `0002_config.sql` | `config` table |
| `0003_config_audit.sql` | `config_audit` table |
| `0004_tick_run.sql` | `tick_run` table |
| `0005_accounts.sql` | `accounts` table |
| `0006_stables.sql` | `stables` table |
| `0007_stable_prefix_history.sql` | `stable_prefix_history` table |
| `0008_seed_world.sql` | the single `world` row |
| `0009_seed_config.sql` | the single `config` row |

Creating a table and populating it are two logical changes, which is why the seeds are separate files.

### 4.1 `world`

Single row, `id` always 1.

- `id` — integer primary key, `CHECK (id = 1)`
- `game_day` — integer, default 0. **The only clock game logic reads.**
- `paused` — 0/1, default 0
- `tick_seq` — integer, default 0. Increments on every tick **including while paused**, because action budgets will reset against it later and a pause should not stop a child's turns coming back.
- `season_index` — integer, default 0. Derived from `game_day`; stored so stud book caps can be queried cheaply later. Maintained by the tick.
- `tick_times_local` — TEXT holding JSON, e.g. `["07:00","12:00","19:00"]`. Times of day in `tick_timezone`, 24-hour, `HH:MM`.
- `tick_timezone` — TEXT, default `America/Chicago`
- `last_tick_local_date` — TEXT, `YYYY-MM-DD` in local time, nullable. Which local day the last tick belonged to.
- `last_tick_slot_local` — TEXT, `HH:MM`, nullable. Which slot the last tick was.
- `last_tick_real_ts` — integer UTC epoch seconds, nullable. Operational only.
- `started_real_ts` — integer UTC epoch seconds. When the world began.

Keep the tick slots out of 02:00–03:00 local; that hour does not exist on the spring-forward morning. Put a comment saying so directly above `tick_times_local`, because the next person to edit that value will be editing it in the database rather than reading this document.

### 4.2 `config`

Single row, `id` always 1.

- `id` — integer primary key, `CHECK (id = 1)`
- `version` — integer, default 1, bumped on every write
- `values` — TEXT holding JSON, the live tunables
- `flags` — TEXT holding JSON, the feature toggles
- `updated_real_ts` — integer, nullable

Seed `values` with exactly these keys, and no others. Later slices add their own.

```json
{
  "display_timezone": "America/Chicago",
  "game_days_per_tick": 10,
  "game_days_per_year": 360,
  "max_stables_per_account": 3,
  "starting_stable_capacity": 10,
  "starting_balance": 10000,
  "min_password_length": 8
}
```

Seed `flags` as `{}`.

Notes on three of those. `game_days_per_tick` of 10, against three slots a day, gives thirty game days per real day — the one-game-month-per-real-day pacing the design assumes (overview §6a). `starting_balance` is a guess with nothing behind it; nothing spends money in this slice, and it will be tuned once there is something to buy. `starting_stable_capacity` is copied onto each stable at creation rather than read live, per `CLAUDE.md` §5.5.

**Do not add config keys nothing reads.** A config table full of unread values is worse than an empty one, because a future session cannot tell which entries are load-bearing.

### 4.3 `config_audit`

Append-only.

- `id` — integer primary key
- `changed_by_account_id` — integer, nullable
- `real_ts` — integer, UTC epoch seconds
- `game_day` — integer
- `path` — TEXT, which key changed, e.g. `values.starting_balance`
- `old_value` — TEXT, nullable
- `new_value` — TEXT

One row per key changed, not one per save. If the operator edits three numbers in one submission, that is three rows.

### 4.4 `tick_run`

- `id` — integer primary key
- `tick_seq` — integer
- `stage` — TEXT. Only `clock` exists in this slice; later slices add `age`, `health`, `breed`, `market`, `shows`.
- `trigger_source` — TEXT, `cron` or `manual`
- `intended_local_time` — TEXT, the slot this run was meant to be (null for manual runs)
- `fired_local_time` — TEXT, what the local time actually was
- `local_date` — TEXT, `YYYY-MM-DD`
- `started_real_ts`, `completed_real_ts` — integer, nullable
- `game_day_before`, `game_day_after` — integer
- `rows_touched` — integer, default 0
- `status` — TEXT: `ok`, `error`, `skipped_paused`
- `error_text` — TEXT, nullable

`intended_local_time` and `fired_local_time` are how a tick firing at the wrong hour gets diagnosed, which is otherwise close to impossible in a table full of UTC. They earn their place.

Invocations that decide no slot has come round write **no row at all**. Ninety-six invocations a day, almost all of which do nothing, would otherwise bury the real ones.

Index on `tick_seq` — the admin page lists recent runs newest first.

### 4.5 `accounts`

An account is a person.

- `id` — integer primary key
- `username` — TEXT, `NOT NULL UNIQUE COLLATE NOCASE`
- `display_name` — TEXT, not null
- `password_hash` — TEXT, not null (format in §6.1)
- `is_admin` — 0/1, default 0
- `must_change_password` — 0/1, default 0
- `active` — 0/1, default 1
- `last_active_stable_id` — integer, nullable
- `last_login_real_ts` — integer, nullable
- `created_real_ts` — integer, not null

`COLLATE NOCASE` on username, so a child typing their name with a capital letter logs in.

`must_change_password` exists because an admin creates accounts with a starting password they choose. It is set to 1 at creation and cleared when the player picks their own. While it is 1, every page except the change-password page redirects there.

**No action budget columns yet.** `actions_remaining` and `actions_reset_tick_seq` belong to the "Turns and tick" slice; nothing in this slice spends an action, and adding a column later is a one-line migration.

### 4.6 `stables`

A stable is a business.

- `id` — integer primary key
- `account_id` — integer, **nullable**, foreign key to `accounts`. Null means an NPC stable.
- `name` — TEXT, not null
- `prefix` — TEXT, `NOT NULL UNIQUE COLLATE NOCASE`
- `prefix_set_game_day` — integer, not null
- `prefix_locked` — 0/1, default 0. Set to 1 the first time this stable breeds a horse. See §2.4.
- `is_npc` — 0/1, default 0
- `balance` — integer, not null. Snapshotted from `starting_balance` at creation.
- `capacity` — integer, not null. Snapshotted from `starting_stable_capacity` at creation.
- `last_processed_tick_seq` — integer, default 0. Unused in this slice; the tick's idempotency marker (`CLAUDE.md` §5.4) and cheaper to create now than to add later.
- `created_game_day` — integer, not null
- `created_real_ts` — integer, not null
- `active` — 0/1, default 1

Add a check constraint tying the two representations of NPC-ness together, so they cannot disagree:

```sql
CHECK ((is_npc = 1 AND account_id IS NULL) OR (is_npc = 0 AND account_id IS NOT NULL))
```

Nothing creates an NPC stable in this slice. The column and the constraint exist because NPC stables are rows in this same table, deliberately, and there is no second structure coming (overview §10b).

Index on `account_id` — the picker's only query.

Money as an integer, never a float. `CLAUDE.md` §7.

### 4.7 `stable_prefix_history`

**Read this section carefully — it does something the schema document does not, for a reason.**

- `id` — integer primary key
- `stable_id` — integer, not null, foreign key to `stables`
- `prefix` — TEXT, **`NOT NULL UNIQUE COLLATE NOCASE`**
- `from_game_day` — integer, not null
- `to_game_day` — integer, nullable. Null means this is the stable's current prefix.
- `claimed_by_account_id` — integer, nullable
- `created_real_ts` — integer, not null

This table is not a log. It is **the registry of every prefix ever claimed by anybody**, and the unique index on `prefix` is what enforces that a retired prefix is never reissued.

The problem it solves: if Willow Creek Stables renames itself to Birchwood, and a different stable then claims "Willow Creek", every horse bred under the original name becomes ambiguous — two stables, one prefix, permanently. A unique index on `stables.prefix` alone does not prevent this, because the old prefix is no longer in `stables`. Putting one row here for every prefix ever claimed, with a unique index, makes the database enforce it.

So the flow for claiming a prefix is: insert into `stable_prefix_history` first, and if that insert fails on the unique constraint, the prefix is taken — by a live stable or a retired name, and the player does not need to know which. Only if it succeeds do you write `stables.prefix`.

The flow for a rename is: set `to_game_day` on the current row, insert a new row (which may fail if taken), and update `stables.prefix`. Both in one transaction.

Index on `stable_id`.

---

## 5. Shared libraries

Four small modules in `src/lib/`. These are the pieces later slices will use constantly, so they are worth more care than their size suggests.

### 5.1 `src/lib/rng.ts` — seeded randomness

`CLAUDE.md` §5.2 is absolute: no `Math.random()` anywhere in this codebase, ever. This module is what makes that possible, and everything from foal genotypes to show noise will run through it.

**Algorithm: xoshiro128\*\*, seeded through splitmix32.** Small, well-characterised, four 32-bit words of state, no dependencies. Do not substitute something else because it is shorter.

Exports:

- `makeRng(seed: number): Rng` — creates a generator. `Rng` has:
  - `next(): number` — a float in `[0, 1)`, computed as `(x >>> 0) / 4294967296`
  - `int(maxExclusive: number): number`
  - `pick<T>(items: T[]): T`
  - `shuffle<T>(items: T[]): T[]` — returns a new array, Fisher-Yates
  - `normal(mean: number, sd: number): number` — Box-Muller. Environmental noise at birth and show noise both want a bell curve, and a session that needs one and does not find one here will write its own badly.
- `deriveSeed(parentSeed: number, label: string): number` — deterministic sub-seeding. Hash `label` with FNV-1a, mix with `parentSeed` through splitmix32. This is how one stored seed produces many independent streams: a pregnancy's seed derives `"genotype"`, `"polygenic"`, `"noise"` and so on. **Derive sub-seeds; never create a second independent generator.**
- `randomSeed(): number` — mints a new seed using `crypto.getRandomValues`.

**That last function needs saying out loud, because it looks like a violation and is not.** Seeds have to come from somewhere. When a new horse or pregnancy is created, its seed is drawn unpredictably once and then stored on the row, and every draw that entity ever makes derives from it. The ban in §5.2 is on unrecorded randomness in game logic, not on minting a seed. `crypto.getRandomValues` is the only acceptable source, it is called only by this function, and every call site stores the result immediately. Put that paragraph in the file as a comment.

Tests, in `test/rng.test.ts`:

- The same seed produces the same sequence.
- Different seeds produce different sequences.
- `int(n)` stays in range and, over 100,000 draws, lands roughly evenly across buckets.
- `normal(0, 1)` has a mean near 0 and a standard deviation near 1 over 100,000 draws.
- `shuffle` returns a permutation and does not mutate its input.
- **A golden-value test.** Assert that `makeRng(12345)` produces a specific hardcoded list of the first ten outputs, and that `deriveSeed(12345, "genotype")` equals a specific hardcoded number. Write the literals down once and never change them.

That last test is the important one and it is worth explaining in a comment. If a future session changes the RNG algorithm, every stored seed in the game reproduces different values than it did before — every horse's markings shift, every recorded show result stops being explicable, and the genetics tests start asserting things that were never true. The golden test makes that change fail loudly at the point it is made rather than silently at the point somebody notices their horse looks different.

### 5.2 `src/lib/time.ts` — the wall clock, kept in its box

The rule from `CLAUDE.md` §6: store instants in UTC, decide and display in `America/Chicago`, never store a local time as a bare string, and never hardcode an offset.

Exports:

- `nowUtcSeconds(): number`
- `localParts(utcSeconds: number, timeZone: string)` — returns `{ year, month, day, hour, minute, dateKey, minutesOfDay }`, where `dateKey` is `YYYY-MM-DD` and `minutesOfDay` is `hour * 60 + minute`. Built on `Intl.DateTimeFormat` with `hourCycle: 'h23'`.
- `formatLocal(utcSeconds: number, timeZone: string): string` — for display.
- `parseSlot(slot: string): number` — `"07:00"` to minutes since local midnight.

No offset arithmetic anywhere in this file or any other. `Intl` is available in Workers and knows about daylight saving without being told.

Tests, in `test/time.test.ts`: pick specific UTC epoch values on either side of both 2026 changeovers and assert the Central date and hour that come back. Node has full ICU, so these run without any Workers machinery.

### 5.3 `src/lib/config-cache.ts`

Reads the single `config` row and caches it in module scope for 60 seconds. Exposes `getConfig(env)` returning `{ version, values, flags }`, and `writeConfig(env, accountId, changes)` which applies changes, bumps `version`, writes one `config_audit` row per changed key, and clears the local cache.

**Be honest about the delay in a comment.** Worker isolates do not share memory, so clearing the cache after a write clears it in one isolate only. A config change can take up to a minute to appear everywhere. That is fine for tuning numbers and would not be fine for anything a request depends on being current — nothing in this slice does. The `version` column is there so a later slice can switch to checking the version on each request if the delay becomes annoying; do not build that now.

### 5.4 `src/lib/html.ts`

A tiny tagged-template helper that escapes interpolated values by default, with an explicit opt-out for pre-rendered fragments. Everything user-typed — stable names, prefixes, display names — goes through it.

No template engine, no client framework, no build step for the front end. Server-rendered HTML and one stylesheet.

---

## 6. Accounts, sessions, and the first run

### 6.1 Passwords

`crypto.subtle` PBKDF2-HMAC-SHA256. 16 random salt bytes from `crypto.getRandomValues`, 32-byte derived key. Store as a single self-describing string so the parameters can change later without a migration:

```
pbkdf2$sha256$<iterations>$<salt-base64>$<hash-base64>
```

Verify by parsing the stored string for its parameters, deriving, and comparing in constant time. Never compare with `===`.

**Iteration count, and a real constraint to check.** Start at 100,000. The Workers free tier allows 10ms of CPU per invocation, and key derivation is genuine CPU rather than waiting on the database, so a login may exceed it. **Measure this after the first deploy** — log in on the deployed Worker and look at the CPU time in the dashboard. If login is being killed, the options in order are (a) turn on the $5 Workers paid plan, which the design already anticipates needing when the tick grows, or (b) reduce iterations to 50,000. Whichever you do, **write the measured number and the decision into `CLAUDE.md` §11**, because the next session will otherwise re-derive this from scratch.

### 6.2 Sessions

No sessions table, by design (overview §13). A signed cookie:

- Name `hh_session`, value `<account_id>.<issued_utc_seconds>.<hmac>`
- HMAC-SHA256 over the payload using `env.SESSION_SECRET`, compared in constant time
- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age` of 30 days
- Reject if the signature fails, if the account no longer exists, or if `active` is 0
- Re-issue when the cookie is more than a day old, so an active player is not logged out mid-season

A second signed cookie, `hh_stable`, holds the currently selected stable. **Never trust it on its own.** Every stable-scoped route re-reads the stable and confirms it belongs to the logged-in account. The cookie is a convenience, not an authorisation.

### 6.3 First run

When `SELECT COUNT(*) FROM accounts` is 0, `/` shows a setup form: username, display name, password, confirm password. Submitting it creates the account with `is_admin = 1` and `must_change_password = 0`, logs them in, and redirects to the admin page.

Once any account exists, `/setup` returns 404. Guard the insert itself against the table being non-empty as well as the page — belt and braces, and it costs one line.

### 6.4 Password rules

Minimum length from `config.values.min_password_length`, and nothing else. No character-class requirements, no expiry, no strength meter. Five family members on a private site; a rule that makes a nine-year-old's password hard to remember costs more than it buys.

---

## 7. Screens

Server-rendered HTML, mobile first. The children will be on phones. One stylesheet at `public/style.css`. Large tap targets, readable type, no horizontal scrolling. Keep it plain — this is a text game and the visual design is a later, separate concern.

Every page shows the current game day and, when paused, a clearly visible "the world is paused" banner. All times rendered anywhere go through `config.values.display_timezone`.

| Route | Method | What it does |
|---|---|---|
| `/setup` | GET, POST | First-run account creation. 404 once any account exists. |
| `/login` | GET, POST | |
| `/logout` | POST | POST only, so a stray link cannot log someone out. |
| `/` | GET | Redirects: to `/setup`, `/login`, `/account/password`, or `/stables` as appropriate. |
| `/account/password` | GET, POST | Change own password. Forced while `must_change_password` is 1. |
| `/stables` | GET | The picker. Lists this account's stables with a "create new" option. |
| `/stables/new` | GET, POST | Name and prefix. Validation per §7.1. |
| `/stables/:id` | GET | Stable home: name, prefix, balance, capacity, founded date. Mostly empty, and that is correct — horses arrive in a later slice. |
| `/stables/:id/select` | POST | Sets the active stable cookie and `accounts.last_active_stable_id`. |
| `/stables/:id/prefix` | GET, POST | Rename the prefix. Refuses when `prefix_locked` is 1, with an explanation of why. |
| `/admin` | GET | Admin home. |
| `/admin/accounts` | GET, POST | List accounts; create one with a starting password; reset a password; deactivate. |
| `/admin/config` | GET, POST | Edit the config values and flags. Show the current values in a form, not as raw JSON, where the type allows. |
| `/admin/config/history` | GET | The `config_audit` list, newest first. |
| `/admin/world` | GET, POST | Pause and unpause; advance one tick manually; list recent `tick_run` rows. |
| `/health` | GET | Plain text. Game day, tick sequence, paused state, last tick time in local, current local time, migration state. No authentication needed and no secrets in it — this is what the operator looks at when something seems wrong. |

Every `/admin` route checks `is_admin` on the account, server side, on every request.

### 7.1 Prefix validation

Rules, applied in this order, with a specific error message for each:

1. After trimming, between 2 and 20 characters.
2. Letters, spaces, apostrophes and hyphens only. No digits, no other punctuation.
3. Starts and ends with a letter.
4. No consecutive spaces.
5. Not already claimed — checked by attempting the insert into `stable_prefix_history` and catching the unique-constraint failure, not by a prior `SELECT`. A prior select has a race in it, and doing it properly costs nothing.

Store the prefix exactly as typed, capitals and all. Compare case-insensitively. "Willow Creek" is how it displays; "willow creek" cannot be claimed by anybody else.

When a prefix is rejected as taken, say so plainly and do not say which stable holds it — the honest reason is that it may be a retired name belonging to nobody, and explaining that is more confusing than the rejection.

### 7.2 The stables-per-account cap

`config.values.max_stables_per_account`, default 3. Counts only `active` stables. When a player is at the cap, the create option is absent rather than present-and-failing, and the picker says why in one sentence.

---

## 8. The tick

`src/tick/index.ts`, called from the `scheduled` handler in `src/index.ts`.

### 8.1 What happens on each cron invocation

1. Read the `world` row.
2. Compute the current local time in `world.tick_timezone` using `src/lib/time.ts`. Keep both `dateKey` and `minutesOfDay`.
3. Work out the **next unrun slot**, as follows. If `last_tick_local_date` is null, the next unrun slot is the earliest slot on today's local date. Otherwise, walk forward from `(last_tick_local_date, last_tick_slot_local)` through the sorted slot list, rolling over to the next local date at the end of each day, and take the next pair.
4. If that slot is still in the future, **return immediately, writing nothing.** This is the outcome for the large majority of invocations.
5. If the next unrun slot is more than two local days behind the current date, skip forward to the most recent slot that has already elapsed today and run that one instead. This is the "the world was down for a week" case, and draining a week of backlog fifteen minutes at a time is not a useful thing to do.
6. Otherwise, run the tick for that slot.

### 8.2 Running a tick

In one transaction:

- Insert a `tick_run` row with `status` unset, `started_real_ts`, `intended_local_time`, `fired_local_time`, `local_date`, `trigger_source = 'cron'`, `game_day_before`.
- Increment `world.tick_seq` by 1 — **always, including while paused.**
- If `world.paused` is 0, increase `world.game_day` by `config.values.game_days_per_tick` and recompute `season_index` as `floor(game_day / game_days_per_year)`.
- Set `last_tick_local_date`, `last_tick_slot_local` and `last_tick_real_ts` to the slot that just ran — **whether or not the world is paused.** A paused world must still consume its slots, or unpausing after a week would drain a backlog of them.
- Complete the `tick_run` row: `completed_real_ts`, `game_day_after`, and `status` of `ok` or `skipped_paused`.

Wrap the whole thing so that a thrown error still records `status = 'error'` with the message in `error_text`. Cron triggers do not retry and a failure is otherwise completely silent (`CLAUDE.md` §3).

### 8.3 Only one slot per invocation

If several slots have been missed, this runs one and the next cron fifteen minutes later runs the next. A backlog drains at four slots an hour, which for a three-slot day means any realistic backlog clears within the hour.

The alternative — advancing several slots' worth of game days in one go — is more code and it interacts badly with things that are not built yet, because a later slice's per-tick work is not necessarily correct when run for a multiple. One slot per invocation keeps the tick's meaning simple: it is what happens at a slot, and it happens once per slot.

### 8.4 Idempotency

The whole design of §8.1 is the idempotency guarantee. A double-fired cron finds that the slot it would run has already been recorded on the `world` row and returns having done nothing. A missed cron finds an unrun slot in the past and runs it. Neither needs intervention, which is what `CLAUDE.md` §5.4 asks for.

### 8.5 Manual advance

`POST /admin/world` with the advance action. Admin only, and behind a confirmation the operator has to actively agree to — not a bare button that can be pressed by accident.

It runs §8.2's transaction with `trigger_source = 'manual'` and `intended_local_time` null, and **does not touch `last_tick_local_date` or `last_tick_slot_local`.** A manual advance is a deliberate extra tick, not a substitute for a scheduled one, so the next cron tick still fires when it was always going to.

It advances by exactly one tick's worth. If more is wanted, press it again — a text box asking how many days to jump is a way to type an extra zero and move the world forward four years.

---

## 9. Testing

Tests in `test/`, run with `vitest`, covering pure functions only:

- `test/rng.test.ts` — §5.1
- `test/time.test.ts` — §5.2
- `test/prefix.test.ts` — every rule in §7.1, accepted and rejected cases
- `test/password.test.ts` — a hash verifies against its own password and fails against a different one; the encoded format round-trips
- `test/tick-slots.test.ts` — the slot-selection logic from §8.1, extracted as a **pure function** taking the world's slot state and the current local time and returning which slot to run, if any. Cover: nothing due; one slot due; a slot already run; a missed slot from yesterday; the more-than-two-days-behind skip.

That last one matters most, and it is why the slot logic must be a pure function that takes its inputs rather than reading the database itself. It is the piece most likely to be subtly wrong and the hardest to notice in production, because being wrong looks like the game being a bit slow.

There is no test coverage of the routes or the database in this slice. That is a deliberate limit, not an oversight: at this scale the acceptance checklist in §11 is a better use of the effort than a test harness for D1.

---

## 10. What this slice does not include

Named so a future session knows these were left out on purpose:

- No horses, genetics, breeds or loci.
- No money moving. `balance` exists and stays where it was set.
- No `ledger`, no `events`, no action budgets. The tick does no game work at all.
- No tokens, no PIN, no admin token grants.
- No NPC stables. The column and the constraint exist; nothing creates one.
- No image handling.
- No indexes beyond the four named above. Add them when a real query needs one, and say why in the migration (`CLAUDE.md` §7).

---

## 11. Acceptance checklist for the operator

Write this into the README as well, as a numbered list the operator can walk through after the first deploy. Each step should say what to click and what they should see.

1. Open the site. You are asked to make the first account. Make it.
2. You land on an admin page. It shows a game day, a tick sequence number, and whether the world is paused.
3. Go to the accounts page and make an account for one of the children with a starting password.
4. Log out. Log in as that child. You are asked to choose a new password before anything else.
5. Make a stable. Give it a name and a prefix.
6. Try to make a second stable with the same prefix. It is refused, and the message tells you why.
7. Make a second stable with a different prefix. Both appear on the picker.
8. Choose one. You land on that stable's page and it shows the name, prefix, balance and capacity.
9. Change the prefix of one stable. It works, because no horses have been bred yet.
10. Log back in as the admin. Press "advance one tick". The game day goes up by ten.
11. Pause the world. Press advance again. The tick sequence goes up; the game day does not.
12. Unpause.
13. Change `starting_balance` in the config. Check the history page shows the old and new value and who changed it.
14. Wait for a real tick slot to come round. Check that the game day moved on its own, and that the recent-ticks list shows it at roughly the local time you expected.

Step 14 is the one worth actually waiting for. Everything else can be checked in five minutes; the tick firing at the right local hour is the thing that has to be seen to be believed.

---

## 12. Questions this slice does not answer

Do not guess at these. They belong to later slices or later conversations.

- Whether a profession belongs to the account or the stable. The `profession_code` column is deliberately absent from both tables in this slice.
- How the action budget arithmetic works when tick frequency changes. Nothing spends an action yet.
- Whether the founding horses are given to players or bought by them. That is the founding stock slice.
- Events retention. There is no `events` table yet.

---

## 13. When you are finished

Per `CLAUDE.md` §9:

- Summarise what you built in plain English, for someone who does not code. Assume they will read your summary and then try to follow §11 with no other help.
- State anything you decided that this document did not specify.
- State anything here you disagreed with, and what you did about it.
- **Update `CLAUDE.md` §10**, marking Foundation as built with a one-line note.
- **Update `CLAUDE.md` §11** with the conventions this slice establishes and the next session will need: the `src/lib/rng.ts` interface and the golden-test rule, the `src/lib/time.ts` interface, the tagged-template escaping helper, the signed-cookie pattern, the prefix registry in `stable_prefix_history`, and the measured PBKDF2 iteration count from §6.1. Date the entries.

Keep those entries short. That section is a reference for a stranger, not a changelog.
