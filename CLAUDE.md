# Build Record

**Read this file before writing code. Then read the slice document you were given — not the full design documents, unless the slice tells you to.**

This is the *build* record: conventions and behavior across sessions. It is not the design record — that's `docs/horse-game-overview.md` and `docs/horse-game-schema.md`, which deliberately leave things undecided.

---

## 1. What this project is

A text-based horse breeding and showing game for one family — roughly five accounts, private, not public. Players breed horses on a genetics engine modeled on real equine genetics, manage care and training, and compete in shows judged against breed standards.

Three things shape every decision below:

- **The operator doesn't write code and has no terminal access.** They can read plain English, follow instructions, click deploy, and describe what looks wrong — no `npm`, `wrangler`, or `git` on a command line. Their tools are the Cloudflare dashboard, GitHub's web file editor, and the deployed site itself. Never leave the repo non-deploying, never hand back a step that assumes a terminal, and explain changes in language that assumes no programming knowledge.
  - Migrations can be applied from the browser at `/admin/migrations` (see `docs/build-log.md` for how it works). The `migrate:local`/`migrate:remote` npm scripts remain as a CLI alternative; both paths share one tracking table.
- **Cost target is as close to zero as possible.** Cloudflare free tier, moving to the $5/month Workers tier only when the tick genuinely needs it. No paid services, no third-party APIs that bill, no dependency with a hosted component.
- **This codebase is written by many separate sessions with no memory of each other.** You are one of them. The next session knows only what's written down — the reason for most conventions in §4-5, and the reason §9 asks you to keep this file current.

---

## 2. How to read the design documents

- **"Recommendation" / "Lean"** mean a defensible answer with reasoning attached, not an instruction — do it unless you have grounds to disagree.
- **"Decided in session"** means an actual decision was made. Treat it as standing. If it looks wrong, say so — don't quietly build something else.
- **"Open question"** means nobody has decided.

**When an open question your slice depends on comes up: stop and ask.** Don't pick the easy option, don't pick the first one mentioned, don't build both behind a flag.

**When you disagree with a design doc:** say so plainly, give the reasoning, propose the alternative. They ask to be argued with — but don't silently depart from them either.

Everything in *this* file (naming, layout, migrations, RNG) is settled — follow it without asking. Everything in the *design* docs about how the game works stays open to discussion. If a convention here would produce something clearly wrong, raise it rather than working around it.

---

## 3. Platform and hard constraints

**Cloudflare Workers + D1 + static assets + Cron Triggers, one git-connected project.** Push to the repo, Workers Builds deploys.

- **Not Pages.** Cron Triggers don't work with Pages, and the world tick is the spine of the design.
- **D1 is SQLite.** No native boolean — `INTEGER` 0/1. No native JSON type — `TEXT`, queried with SQLite's JSON functions where genuinely needed.
- **Cron Triggers are UTC-only, no timezone setting.** The tick handler works out local time for itself — see §6.
- **CPU ceiling.** Free tier is 10ms CPU/invocation, paid is 5 minutes. DB waiting doesn't count, only our own logic. Ordinary requests are nowhere near the limit; the world tick may approach it — move to the paid tier when it outgrows it rather than contorting the design around 10ms.
- **Cron Triggers do not retry.** A scheduled invocation that throws or times out is skipped silently until the next fire — this is why the tick must be idempotent (§5.4).

**Dependencies.** Prefer the standard library and the Workers runtime. Every dependency is something a future session has to understand and something that can break a deploy the operator can't fix — state additions in your summary, don't bury them. No ORM — write SQL.

---

## 4. Code layout

```
/
  CLAUDE.md                  <- this file
  docs/
    horse-game-overview.md   <- design record (vision)
    horse-game-schema.md     <- design record (data model)
    build-log.md             <- dated log of conventions/decisions established while building
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

The genetics engines, the health model, the show scorer and the NPC selection policy are **functions that take data and return data, with no database access inside them.** The caller reads from D1, calls the engine, writes the result. This lets a future session hold one engine entirely in view and change it without understanding the schema, and makes engines testable without a database.

### 5.2 Seeded randomness, everywhere, without exception

**Every random draw runs through a seeded generator. There are no calls to `Math.random()` anywhere in this codebase.**

That covers foal genotypes, environmental noise at birth, condition onset rolls, show noise, NPC selection error, procedural markings, and import candidate generation. The seed lives on the entity the draw belongs to — `horses.rng_seed`, `pregnancies.rng_seed`, `shows.rng_seed`, and so on.

Two reasons, both serious: genetics can be tested (a carrier × carrier cross should produce the expected proportion of affected foals, not just an eyeballed few), and anything that comes out wrong is reproducible — which matters when an outcome is the death of a child's foal.

Use the shared PRNG in `src/lib/rng`. Derive sub-seeds deterministically rather than creating new independent generators.

### 5.3 The world clock, never the wall clock

**Game logic reads `world.game_day`, an integer. It never calls `Date.now()` to decide anything.**

Ages, gestation, upkeep, show dates, condition onset, NPC breeding, listing expiry, training — all derive from `game_day`. A pause is the tick declining to advance the counter, so every timer stops for free. A deliberate time jump is just advancing it further than usual.

Wall-clock timestamps are stored only on audit trails, the ledger, tick runs and login records — records of when something *happened*, never inputs to a decision about which game-day it is.

### 5.4 The tick is idempotent

A re-fired or double-fired tick must not double-advance anything. Derive state from stored values rather than incrementing blindly — write `x = f(game_day - last_processed)` rather than `x += 1`. Use the `last_processed_tick_seq` columns on `stables` and `pregnancies`, and record each run in `tick_run`.

Assume the tick will occasionally be missed entirely and occasionally fire twice. Both should be survivable without intervention.

### 5.5 Durations are snapshotted onto the entity

Config supplies defaults at creation time; the entity carries its own copy. Gestation length lives on the pregnancy row, not read from config at every tick — same for listing expiry, tack wear rates, training programme lengths and condition progression. Otherwise changing a tunable moves a mare's due date arbitrarily, possibly into the past. Live tunables (prices, upkeep, action budgets, show noise, NPC ceiling) are read from config directly, since they only affect future computation.

---

## 6. Time and time zones

**Store instants in UTC. Decide and display in `America/Chicago`. Never store a local time as a bare string.**

The failure this avoids is *deciding* in UTC — computing which day it is against a clock whose midnight lands at 6 or 7pm Central. A stored UTC epoch is unrelated to that problem: it's just an instant, and renders as whatever local time you ask for. Storing local times is what actually breaks, because on the November changeover 1:30am happens twice and the two rows become indistinguishable.

**The tick handler pattern:**

1. The cron fires more often than the tick needs — hourly, or at the set of UTC hours that could correspond to the local slots across the year.
2. Each invocation computes the current time in `America/Chicago` and compares it against `world.tick_times_local`.
3. If it does not match a slot that has not yet run, return immediately without touching anything.

Use `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'` for the zone arithmetic — it knows about DST. Never hardcode an offset. Keep tick slots out of the 2am-3am window; that hour does not exist on the spring-forward morning. Everything rendered to a player goes through `config.values.display_timezone`.

---

## 7. Data conventions

- **Tables:** `snake_case`, plural (`horses`, `stables`, `show_entries`). Reference tables that read as a set may be singular (`world`, `config`).
- **Columns:** `snake_case`. Foreign keys are `<entity>_id`.
- **Booleans:** `INTEGER` 0/1. Name them so the meaning is obvious: `is_npc`, `enabled`, `paused`.
- **Game time:** `*_game_day` integers. **Wall time:** `*_real_ts`, UTC epoch. The suffix tells you which clock a column belongs to — keep it.
- **JSON:** `TEXT`. Document the shape in a comment in the migration, because nothing else enforces it.
- **Money:** integers. No floats for currency, ever.
- **Append-only tables** (`ledger`, `token_ledger`, `config_audit`, `events`): insert only. Never update or delete a row in these outside an explicit, discussed retention job.

Indexes follow the queries the real screens make. Don't guess a full index list up front; add them when a query needs one, and say why in the migration.

---

## 8. Migrations

- Files in `/migrations`, named `NNNN_short_description.sql`, zero-padded from `0001`.
- **Forward-only. Never edit a migration that has been applied**, including on the local dev database. If something is wrong, write a new migration that corrects it.
- One logical change per file. A migration that adds a table and backfills it is two files.
- Comment the intent at the top in one sentence, in plain English.
- Include the JSON shape as a comment for any `TEXT` column holding JSON.

**Adding a migration file also means registering it in `src/db/migrations.ts`**: add a matching `import mNNNN from '../../migrations/NNNN_description.sql'` and a list entry, in order. This is what lets `/admin/migrations` see and apply it. The file in `/migrations` stays the source of truth for the CLI path (`wrangler d1 migrations apply`); the TS list is a deliberately-duplicated registration for the in-app path, not a separate copy of the SQL.

---

## 9. How a session should work

**At the start:**

1. Read this file.
2. Read the slice document for the stage you are building.
3. Check `migrations/` for what actually exists, rather than assuming the schema document has been built. **Most of the schema document is not built.** It is a design, not a description.

**While working:**

- Build what the slice asks for. Do not build ahead — the build order exists because the tuning that only real play reveals is the binding constraint, not build speed.
- If the slice is ambiguous or depends on an undecided question, ask before choosing.
- Prefer the boring implementation. This codebase will be read by sessions with no context.

**At the end:**

- Summarise what you built in plain English, for a reader who does not code.
- State anything you decided that the slice did not specify.
- State anything you disagreed with and what you did about it.
- **Add an entry to `docs/build-log.md`** if you established a convention a future session needs — a new directory, a shared helper, a pattern worth repeating. Date it.
- Update §10 below with what now exists.

---

## 10. Current state

*Update this section as slices land.*

| Stage | Status | Notes |
|---|---|---|
| Foundation | built (2026-08-02) | Repo deploys via Workers Builds + D1 + Cron. Accounts, stables, the world clock, config, and the stable picker all work. No horses yet — see slice 0001. |
| Genetics core | built (2026-08-02) | Two horses, one breeding, a foal described in words. Five loci (E, A, CR, G, DMRT3), full pedigree + tabular COI. Admin founder form at `/admin/horses/new`; barn at `/stables/:id/horses`; breeding at `/stables/:id/breed`; horse page at `/horses/:id`. See `docs/slices/0002-genetics-core.md`. Its instant-foaling `breedNow` is gone — see the next row. |
| Pregnancy, heat and fertility | built (2026-08-03) | `breedNow`'s instant foaling is replaced by booked coverings, a 4-tick oestrous cycle, a conception roll (age, fertility trait, inbreeding), real gestation, and twins (~1 in 330, both survive). Two new tick stages resolve coverings and foal due pregnancies. Admin tunables + force-twins control at `/admin/breeding`. See `docs/slices/0003-breeding-and-fertility.md` and the build log's 2026-08-03 entry. |
| Cooled and frozen semen | specified, not built | Blocked on 0003 (now built). See `docs/slices/0004-semen-storage.md`. |
| Founding stock generator | built (2026-08-02), PIN gate deferred | The batch-and-claim flow every later import reuses: an admin mints a batch at `/admin/founding` (pick a stable and a quality band), the player chooses a breed and claims 2 mares + 1 stallion from 6 generated candidates at `/stables/:id/founding`. Seven remaining breeds seeded with **colour and gait allele pools** (no ideal vectors, disease panels, or class eligibility yet). The claim form also takes an optional barn name per candidate, filled in at claim time rather than only afterward on the horse page — the generated `registered_name` (the synthetic origin-stable name, slice 0005 §6.5) stays permanent and untouched; only `horses.barn_name` is set. **The parent's PIN (slice §7) is not built** — no `accounts.pin_hash`, no `pin_attempts`, no in-session grant block on a child's phone; granting a batch still requires an admin login. See `docs/slices/0005-founding-stock.md` and the build log's 2026-08-02 entries. |
| Image slot | built (2026-08-02) | The image library and the per-horse picker, per `docs/slices/0007-image-slot.md`. A horse's picture lives at `horses.image_url`/`image_source`; a breed's library size is `breeds.image_count`. `/horses/:id/image` (owner-only) is the picker; `/admin/breeds` is where the operator types the count after uploading through GitHub's web editor. No image is assigned at birth - a horse reads as "waiting for you" (a placeholder card with its real colour in words and a Choose a picture button) until an owner picks one. See the build log's 2026-08-02 image-slot entry for the shared helpers. |
| Conformation (one polygenic trait) | built (2026-08-02) | Expression and display for the four conformation traits (neck length, shoulder angle, back length, hock set) - potential, environmental noise, realization by age and COI, expressed value. Shown as a bar-and-labels card on the horse page, compactly in the barn list, and per-candidate on the founding screen. Ability traits (stamina, jump scope, speed, trainability) and fertility are expressed by the same engine but displayed nowhere, per design. See `docs/slices/0006-conformation.md` and the build log's 2026-08-02 conformation entry. |
| One show class | built (2026-08-02) | The Quarter Horse's ideal vector, three judges, a monthly show circuit and the class that scores it - both halves of `docs/slices/0008-one-show-class.md` in one session. `/shows` lists the circuit; `/shows/:id` is one show; `/shows/:id/entries/:entryId` explains a result trait-by-trait. The horse page's "Enter in a show" button and Show record card, the barn list's win/ribbon badge, and `/admin/shows` (stock the NPC show barn, judge on demand, recent shows) all ship with it. Ribbons only - no money moved anywhere. Other breeds' ideals still come with the breeds stage below. See the build log's 2026-08-02 shows entry for what was decided and one flagged disagreement with the slice document. |
| Turns and tick | built (2026-08-02) | See `docs/slices/0009-turns-upkeep-and-the-ledger.md`, split per that document's own §11. **Part A (money moves):** the `ledger` table and `src/db/ledger.ts`'s `buildLedgerStatements` (the one function allowed to write `stables.balance`), per-horse upkeep charged on the world clock via a new tick stage, **show prize money** to the top six placings (reversing slice 0008 §2.3), the debt rule (`canTakeOnCost`, blocks booking a covering, never entering a show), a stable's Money page (`/stables/:id/money`), and `/admin/money` for adding money by hand. **Part B (turns and the events log), built same day:** `accounts.actions_remaining`/`actions_reset_tick_seq`, a per-account turn budget derived at read time (never written by the tick - `src/lib/actions.ts`'s `actionsRemaining`), spent by `src/db/accounts.ts`'s `spendAction` on booking a covering, entering a show and claiming a founding batch (1 turn each); a turn count in the header on every player page; an `events` table and the "While you were away" panel on `/stables` (unread only, with a Mark all read button) plus a stable home page's own recent-happenings feed (read and unread together); a tick stage deleting events older than `events_retention_game_days`. See the build log's 2026-08-02 entries for what a future session needs to know. |
| Tokens | not started, **deferred past health** | Deferred by the operator on 2026-08-03, in conversation, rather than dropped — health was taken next instead. The account balance, token ledger and product catalogue, built over the PIN, the attempt log and the batch generator that slice 0005 already puts in place. Imports are the catalogue's first entry. Nothing here is a prerequisite for the chore-reward loop, which works from 0005 onwards. |
| Health, first pass | built (2026-08-02) | Both parts of `docs/slices/0010-health-first-pass.md` built in one session. Four disease loci appended after DMRT3 (HYPP and PSSM1 dominant, HERDA and GBED recessive), all eight breeds' founding pools updated, the `conditions` reference table (4 seeded rows), `horse_conditions` (truth, affected-only rows) and `horse_knowledge` (what a stable has paid to learn, permanent genotype results). `src/engines/health/status.ts` is the new pure engine. `/horses/:id/test` sells single tests (250) or a four-condition panel (700, one turn either way) - `/admin/health` shows clear/carrier/affected counts per condition across every living horse. The Health card on the horse page and a barn-list badge show an owner only what they are entitled to (a paid-for result, or a signs-visible condition's affected status for free - never a carrier without a test). The breeding preview at `/stables/:id/breed` gains a health line computed **only** from the booking stable's own knowledge, never a genotype. A GBED-affected foal is born looking healthy and dies 30 game days later (a tick stage, idempotent on `horses.status = 'alive'`), with a drafted four-paragraph explanation in the events feed; HERDA bars a horse from showing (never from breeding). See the build log's 2026-08-02 health entry for what a future session needs to know. |
| Care and tack | not started, **skipped past** | Deferred by the operator on 2026-08-02, in conversation, rather than dropped — ageing and death was taken next instead. Nothing in it blocks ageing, and it is where a decline-with-age performance modifier belongs when one is wanted (see slice 0011 §3.2). |
| Ageing and death | built (2026-08-02) | `docs/slices/0011-ageing-death-and-removal.md`, taken in one session, both Part A and Part B. Horses die of old age on a lifespan **rolled once at birth and snapshotted** onto `horses.natural_death_game_day` (`src/engines/ageing/lifespan.ts`'s `rollLifespanGameDays`, `deriveSeed(rng_seed, 'lifespan')`) - not a hazard rolled every tick, which is what makes it idempotent, tunable and reproducible. Death arrives **announced**: a visible **Failing** marker for ~1.5 game years (`ageState`'s five states: young/adult/veteran/failing/ended), on the horse page, the barn list and a `horse_failing` event, closing `docs/horse-game-overview.md` §14's open question. The tick's new `assignLifespansAndNoticeFrailty` and `killDueOldHorses` stages (`src/db/ageing.ts`) sit between `killDueLethalFoals` and `createDueShows`. Voluntary removal ships alongside it as a free, one-way **retire away** (`/horses/:id/retire`, confirm-checkbox page) costing no turn and no money. Death and removal share one exit path, `buildEndHorseParticipationStatements` - cancels the horse's own in-progress pregnancy and booked covering (whichever table it appears in) and withdraws its entries in classes not yet judged. `/stables/:id/past` lists every horse a stable ever owned that has since ended; the barn list drops one `barn_shows_ended_game_days` after it ends. `/admin/ageing` is the new subpage (oldest living horses, recent deaths, a bring-forward testing control); `/admin/shows` gained the show barn's headcount-vs-target and its five oldest horses. Departs from `docs/horse-game-schema.md` §4.2 on two points, per its §5.5: `image_url` is kept, and `show_entries` are **not** pruned, because deleting them would retroactively falsify judged shows. |
| Discipline shows | framework built, 1 of 6 disciplines built (2026-08-02) | A fifth ability trait, `agility` (appended to `TRAITS`), the `disciplines` reference table, `scoreAbilityEntry`/`abilityValues`, `show_classes` widened to hold a `discipline` class alongside `breed_conformation`, and every screen in slice 0008 (calendar, eligibility, placings, noise, prizes, result explanation) now handles either class type generically — `checkEligibility` needed no change at all. **Only Barrel Racing is seeded** (migration `0063`); the other five (flat racing, show jumping, endurance, dressage, gaited pleasure) are specified in `docs/slices/0012-discipline-shows.md` §5.1 and are a pure-data `INSERT` away, no code change, per this file's own §9 "do not build ahead." **§4.2's world-reset precondition is NOT yet satisfied as of this build session** — the operator confirmed they will run `/admin/reset` (full world scope) before this deploys, but had not done so as of this entry. Whoever deploys this: confirm the reset actually happened first, or every pre-existing horse silently reads `agility ≈ 1` with no error (§4.2's own warning). See the build log's 2026-08-02 discipline-shows entry, including a real correction to the slice document's own migration plan (§6.4's table rebuild needed an extra step against a live foreign key, verified against `wrangler d1 execute --local` before writing it). |
| NPC stables | not started | |
| Market | not started | |
| Professions | not started | |
| Registries | not started | |
| The other seven breeds | not started, **ideal vectors now drafted** | The non-colour half of breed identity for every breed but the Quarter Horse: ideal vectors, eligible class types and aptitudes, height and weight ranges, disease panels. Data entry against machinery already tuned on one breed — which is why it waits. **All eight conformation ideal vectors are written down in `docs/breed-ideal-vectors.md` (2026-08-02)** — the Quarter Horse's is live in `migrations/0035`, the other seven are a data record only and `breeds.ideal_vector` is still `NULL` for them. Seeding them is blocked on the NPC show barn, which is hardcoded Quarter Horse; see that document's §6. |

---

## 11. Build log

A dated log of conventions, decisions, and gotchas established during the build lives in `docs/build-log.md`. It is not required reading at the start of a session — consult it when working in an area it covers, and append to it (not here) when you establish something a future session needs. See §9.

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
