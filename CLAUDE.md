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

**The one deliberate exception:** the admin PIN gate's lockout (slice 0016 §9.4) compares `nowUtcSeconds()` against `pin_attempts.real_ts` directly, never `game_day` — it is a security control measured in real minutes, not game logic, and no horse, pregnancy, show or balance depends on it.

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
| Foundation | built (2026-08-02) | Repo deploys via Workers Builds + D1 + Cron. Accounts, stables, the world clock, config, and the stable picker all work. No horses yet. |
| Genetics core | built (2026-08-02) | Two horses, one breeding, a foal described in words. Five loci, full pedigree + COI. See `docs/slices/0002-genetics-core.md`. |
| Pregnancy, heat and fertility | built (2026-08-03) | Booked coverings, an oestrous cycle, a conception roll, real gestation, and twins. See `docs/slices/0003-breeding-and-fertility.md`. |
| Cooled and frozen semen | specified, not built | Blocked on 0003 (now built). See `docs/slices/0004-semen-storage.md`. |
| Founding stock generator | built (2026-08-02), PIN gate deferred | Batch-and-claim flow for starting stock. Seven of eight breeds have colour/gait pools only. Parent PIN gate not built. See `docs/slices/0005-founding-stock.md`. |
| Image slot | built (2026-08-02) | Image library and per-horse picker; no image assigned at birth. See `docs/slices/0007-image-slot.md`. |
| Conformation (one polygenic trait) | built (2026-08-02) | Four conformation traits expressed and displayed; ability traits and fertility expressed but shown nowhere. See `docs/slices/0006-conformation.md`. |
| One show class | built (2026-08-02) | Quarter Horse ideal vector, judges, a monthly circuit, and scoring. Ribbons only, no prize money yet. See `docs/slices/0008-one-show-class.md`. |
| Turns and tick | built (2026-08-02) | Ledger, per-horse upkeep and prize money (Part A); per-account turn budget and the events feed (Part B). See `docs/slices/0009-turns-upkeep-and-the-ledger.md`. |
| Tokens | not started, **deferred past health** | Deferred by the operator on 2026-08-03; not a prerequisite for the chore-reward loop. |
| Health, first pass | built (2026-08-02) | Four disease loci, `conditions`/`horse_conditions`/`horse_knowledge`, paid testing, a health line on the breeding preview. See `docs/slices/0010-health-first-pass.md`. |
| Care | built, in full (2026-08-03) | Farrier/vet timers and a care show-score modifier (Part A); condition management for HYPP/PSSM1 (Part B). See `docs/slices/0013-care-and-condition.md` and `docs/slices/0014-before-the-children-play.md` §5. |
| Location: barn vs pasture | built (2026-08-03) | Turnout freezes care timers and cost but bars breeding/showing, with a settling period on return. Specified in conversation, not a slice document. |
| Ageing and death | built (2026-08-02), decline curve added 2026-08-03 | Lifespan rolled at birth, an announced Failing period, and voluntary retirement. Age-based performance decline added 2026-08-03. See `docs/slices/0011-ageing-death-and-removal.md` and `docs/slices/0014-before-the-children-play.md` §4. |
| Discipline shows | **framework and all 6 disciplines built (2026-08-04)** | Barrel Racing (2026-08-02) plus Flat Racing, Show Jumping, Endurance, Dressage and Gaited Pleasure (2026-08-04, migration `0108`) - a pure-data `INSERT`, no code change, exactly as this row long promised. `show_discipline_classes_per_show` (6) now exactly covers all six. See `docs/slices/0012-discipline-shows.md`. |
| NPC stables | built, in full (2026-08-03) | NPC policy/ceiling data and a selection engine reusing the judge's own scorer (Part A); a tick stage driving NPC breeding decisions (Part B). `/admin/npc` manages it. See `docs/slices/0015-npc-stables.md`. |
| Market | **All four parts built (Parts A-C 2026-08-03, Part D 2026-08-04)** | Players can list, browse, withdraw and buy; everything travels with the horse, health is always disclosed, and the ledger's `counterparty_stable_id`/`same_account` columns finally have a writer. NPC stables list their own surplus when near capacity (Part B), and buy too (Part C): a standing offers board (`buy_offers`, one active offer per NPC stable, updated in place each tick by `refreshNpcBuyOffers`) that a player sells into instantly from `/market`'s Offers tab, and a tick stage (`runNpcMarketPurchases`) where each NPC stable shops the open market itself within its own target, budget and free-stall buffer. Both routes reuse the exact appraisal, target-scoring and sale batch the rest of the market already uses — no second sale path anywhere. NPC balances are real and never topped up automatically; `/admin/npc` shows each stable's balance next to what it has spent buying and earned selling this game year, so a stable going quiet is visible before the children notice. **Stud services (Part D) are now built**: `stud_listings`/`stud_bookings` (`src/db/stud.ts`), a `/market/stud` browse-and-book flow reached from the horse page's "Offer at stud" card, and the first cross-stable breeding in the game — a mare's owner books to another stable's stallion without either side giving up a horse or a stall. Operator decisions taken when this part was commissioned: no live-foal guarantee (a missed conception is not refunded, same as an ordinary same-stable booking), and the market's commission applies to a stud fee exactly as it applies to a sale (two new ledger kinds, `stud_fee_paid`/`stud_fee_received`, alongside the existing `commission`). NPC stallions stand at stud too (`src/db/npcStud.ts`), reusing `bookStud` unchanged — the one new mechanism is that an NPC stallion is withdrawn from stud the moment his quality crosses the NPC ceiling (slice 0015 §2.4), since a booking combines his genetics with a player's own stock in a way an outright NPC purchase never does. See `docs/slices/0017-market.md` §13. |
| Colour testing | built (2026-08-03) | A player can pay to test a horse's colour/gait loci, the same mechanism as a disease test (`horse_knowledge.subject_code = 'locus:<code>'`). `inferFromPhenotype` and `foalColourPossibilities` (`src/engines/genetics/`) compute what looking alone tells you and what a pairing could produce, from knowledge only, never the genotype. Smoky black displays as "black" until tested (`src/render/colour.ts`). Colour is now a term in `appraise()` — visible colour and tested-carried alleles both carry value, kept modest next to conformation on purpose. See `docs/slices/0017a-amendment-colour-testing-and-the-consignment-dealer.md` §4. |
| Consignment dealer (Part E) | built (2026-08-03), operator controls added (2026-08-04), **breed-aware (2026-08-04)** | A dedicated NPC stable (`Consignment Yard`, no `npc_policy` row, no real balance) mints one or two horses onto the market every cadence period, at the mid quality band, via the tick's `runConsignments` stage. Each candidate's breed is drawn uniformly from whatever breeds are currently in play (`getBreedsInPlay`) — the dealer no longer intersects that with a separate `consignment_breed_codes` allowlist, which is how it stayed Quarter-Horse-only after every other breed got an `ideal_vector`; migration `0109` removes the stale config key. The operator can queue an allele from `/admin/consignment` to be seeded into the next batch (`consignment_injections`) — the only mechanism that introduces an allele nobody already owns. An injected locus is always pre-tested for the dealer. **2026-08-04:** `/admin/consignment` gained a "Mint a batch now" button (`forceConsignmentBatchNow`) that mints immediately, bypassing the cadence check, for when the operator wants a queued allele to feed the market the same day rather than waiting for the next scheduled batch. Separately, a queued injection now carries `eligible_from_game_day`: if a batch is already due/overdue at the moment of queuing (about to mint on the very next tick regardless), the injection is deferred to the batch *after* that one, so it's never swept into a batch the operator didn't mean to seed — "mint now" ignores this deferral on purpose, since it's an explicit override. See `docs/slices/0017a-amendment-colour-testing-and-the-consignment-dealer.md` §5. |
| Breeds in play | built (2026-08-03) | `breeds.enabled` (seeded since `0010_breeds.sql`, never read until now) gates admission of NEW horses of a breed only — founding offers, the consignment dealer, admin horse creation, new `npc_policy` targets, new show classes — and nothing about a horse, class or listing that already exists. `getBreedsInPlay()` (`src/db/breeds.ts`) is the one helper every gated call site reads. `/admin/breeds` toggles it, refusing to disable the last breed in play or enable one whose allele pool is missing a locus. See `docs/slices/0017a-amendment-colour-testing-and-the-consignment-dealer.md` §6. |
| Tack | not started, **not yet specified** | Deliberately placed after the market — tack pricing and discipline specificity both depend on stages not yet built. See `docs/horse-game-overview.md` §8b. |
| Professions | not started | |
| Registries | not started | |
| The other seven breeds | **ideal vectors seeded, NPC show barn breed-aware (2026-08-04); disease panels drafted, not built** | Migration `0107` seeds all seven remaining `ideal_vector`s from `docs/breed-ideal-vectors.md` §3, so every show now carries eight breed classes. `stockShowBarn` (`src/db/npc.ts`) no longer hardcodes Quarter Horses - it tops every breed in play up to target independently, closing `docs/breed-ideal-vectors.md` §6.2's blocker. Still unbuilt for all eight: `eligible_class_types`/`discipline_aptitudes`, `height_range`/`weight_range`. **Disease panels drafted the same day, in `docs/breed-disease-panels.md`** — six new single-gene conditions (SCID, cerebellar abiotrophy and lavender foal syndrome for Arabian; WFFS for German Warmblood; dwarfism and hydrocephalus for Friesian), with Thoroughbred, Paso Fino, Icelandic and Nokota deliberately getting none this pass (their real signature problems are polygenic, colour-linked-but-locus-missing, or — Nokota — genuinely absent). This half never had a show-barn blocker to begin with (disease panels create no classes) and is still unseeded; nothing in `conditions`, `loci` or any `founding_allele_pool` has actually changed for it yet. |
| Screens, the public world, and the admin door | built (2026-08-03) | Barn/show filters, a read-only `/world` public section, account admin, and a PIN gate in front of `/admin`. See `docs/slices/0016-admin-and-ui-improvements.md`. |
| Robustness genes (polygenic health substrate) | built, substrate only, deliberately (2026-08-03) | Three hidden soundness traits added ahead of use, since `TRAITS` is append-only and a horse's genotype is fixed at birth. Nothing reads them yet. See `docs/slices/0014-before-the-children-play.md` §6. |
| Founding specialists (a breed winnable in 6-8 months) | **built (2026-08-04)** | Every founding horse arrives genuinely good at one conformation trait (near its breed's target, ±1 allele) and one ability trait (potential 15/20, ±1) — overwritten after the existing genotype draw, from fresh RNG streams, never resampled. Consignment cadence dropped 90→60 game days (Part C). Measured with `docs/analysis/stable-timeline.mjs`: casual-child median to 6 good horses is 199 days (194/200) on the conformation line and 221 days (200/200) on the discipline line, both inside the operator's 6-8 month brief. Operator chose: ±1/15 tuning defaults, one conformation + one ability specialist per horse (not two conformation), batch coverage left to chance, and the other seven breeds' `ideal_vector`s left for a follow-up. Only changes what NEW horses look like — no migration touches an existing horse. **The seven-breeds blocker named here was closed later the same day** — migration `0107` seeds the remaining `ideal_vector`s (see the "The other seven breeds" row above), so Part A now applies to all eight without any change to this slice's own code. See `docs/slices/0019-founding-specialists.md` and the 2026-08-04 build-log entries (incl. a prose-vs-code discrepancy in §4.2's eligible ability traits, resolved in favour of the measured/code definition — `stamina` is eligible, only `jump_scope` is excluded). |
| Genetic progress and inbreeding | **specified, not built (2026-08-03); §10's open questions need the operator before anyone builds** | Overview §10a (gene pool collapse) coming due. Measured with `docs/analysis/population-sim.mjs`: selection plateaus at generation ~15 (about two real years) and generations 15-50 add nothing; COI reaches ~60%, at which point a correct Quarter Horse shoulder needs 20 of 20 alleles. The fix is to move inbreeding depression off conformation expression and onto fitness, make zygosity visible, and build stud services. See `docs/slices/0018-genetic-progress-and-inbreeding.md`. |
| Colour/pattern loci and `head_profile` | **Parts A-F built (2026-08-04); Part G (the world reset) is the operator's own step, not yet run** | Ten new Mendelian loci (dun, silver, champagne, roan, tobiano, frame overo, splash, sabino1, leopard complex + PATN1) and a fifth conformation trait, `head_profile`, judged by all eight breeds. `expressPhenotype` turns those loci into a real displayed colour and an ordered `patterns[]` list. **Part D** extends `inferFromPhenotype` to all ten new loci (silver stays fully open on a chestnut, frame overo collapses to certain `O/n` when visibly framed since `O/O` never survives, Sabino1 always resolves completely, leopard complex reads LP/PATN1 together) and rewrites `foalColourPossibilities` to fold all thirteen colour/pattern loci without the CPU blowup a naive genotype cross would cause — it splits into an independent dilution fold (the five loci that change the colour NAME, named with the real engine at most a few dozen times) and a pattern fold (six loci, pure string/array bookkeeping, no engine calls), crossed at the end; a worst-case fully-heterozygous pairing across all thirteen loci completes in low single-digit milliseconds. `appraise()` gained a `market_pattern_factor` term (flat, applied once if any pattern shows, never stacked) and `market_visible_colour_factors` picked up the new named dilutions. **Part E** (migration `0117`) adds lethal white overo as an ordinary `conditions` row (`LWO`, locus `O`, recessive+lethal) — no new code, reusing the GBED death path unchanged; the breeding preview's existing recessive-risk health line covers it for free once a stable has bought the `LWO` genotype test (a separate purchase from the colour-panel `locus:O` test, same as GBED's own health-vs-colour split). **Part F** collapses the testing page's colour/gait section into four `<details class="section-collapse">` groups (Base colour, Dilutions — including Grey, which the slice's own §7.2 didn't say where to put — Patterns, Gait), each closed by default with an unknown-count summary; the horse page's own Colour and gait card is likewise collapsed behind a summary line showing the horse's actual visible colour and pattern words. **Part G has not been run** — no existing horse has a `head_profile` genotype or any of the ten new loci until the operator triggers a full `world`-scope reset from `/admin`, per slice §8. See `docs/slices/0021-colour-loci-and-head-profile.md` and `docs/build-log.md` for what's landed so far. |
| Acquired conditions (colic, laminitis, and the rest) | **built (2026-08-04)** | A dozen breed-agnostic, non-genetic conditions — colic, choke, gastric ulcers, sporadic tying-up, strangles, hoof abscess/thrush, rain rot/mud fever, eye injury, laminitis, navicular, osteoarthritis, suspensory ligament injury — driven by care state (derived from the existing farrier/wellness timers' own deltas, not a second ramp), a workload proxy (recent show-entry frequency), location, feed level (laminitis reads `feed_level`'s upkeep multiplier directly, giving Premium feed the real downside slice 0013 §13.2 flagged as missing), and a heritable robustness score for four of the twelve (`foot_robustness`/`joint_robustness`/`ligament_robustness`, the substrate slice 0014 built ahead of use and nothing had read until now). One onset-risk engine (`src/engines/health/acquired.ts`) and one resolution engine drive all twelve rows from data in `conditions.trigger`; the tick's `rollAcuteIncidents`/`resolveAcuteIncidents` (`src/db/acquiredConditions.ts`) sit right after `noticeCareDue`. A `manageable` outcome reuses slice 0014's management machinery unchanged; a `death` outcome reuses `buildEndHorseParticipationStatements` (the fuller adult-horse exit path, not `killDueLethalFoals`'s neonatal one — an acquired-condition death can hit a horse with live coverings/pregnancies/show entries, which a 30-day-old GBED foal never has) and deliberately does **not** also write a `horse_died` event, since that event's render is worded for a newborn foal and would misrender at any other age; `incident_resolved`'s own death-outcome sentence carries the narrative instead. Two new show-eligibility reasons (`acute_incident`, `degenerative_incident`) and a second contributor to `careModifier`'s `conditionDelta` slot (a flat penalty while any incident is open, §2.9). New card on the horse page (Incidents, between Health and Care), a barn-list badge, `/horses/:id/treat`, and `/admin/incidents` (open counts, outcome distribution, a force-incident testing control). **Operator decided, before this was written: an ignored acute condition carries real death risk (colic above all — 40% untreated vs 5% treated); only 4 of the 12 conditions carry any death risk at all**, the rest top out at a barred career or an ongoing management cost. **Two of the slice document's own outcome tables didn't sum to 1.0** (Strangles: 0.85/0.95; Eye injury: 0.95) — caught by the test the slice itself specified (§10 test 4) and corrected by raising each `resolved` share to close the gap; see `docs/build-log.md`. See `docs/slices/0020-acquired-conditions.md` for the full design and the numbers in §4 that most need real-play tuning at `/admin/incidents`. |

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
