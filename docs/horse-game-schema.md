# Horse Breeding & Showing Game — Data Model

**Status:** Design. Nothing here is built. Companion to `horse-game-overview.md`, which this defers to on intent.

**How to read this document.** Same convention as the overview: everything is a recommendation with reasoning attached. Alternatives are recorded where a different answer is defensible. A future session should feel free to argue with any of it, and should not treat a table as settled because it is written down. Where a decision was made in conversation rather than derived, that is marked **Decided in session** so a later reader can tell the difference between a preference and a conclusion.

Target platform is Cloudflare D1 (SQLite). Consequences that shape everything below: no native boolean (integers 0/1), no native JSON type (text columns, queried with SQLite's JSON functions where needed), and joins are cheap but row counts across many tables per request are not.

---

## 0. Six principles the tables are built around

1. **Time is an integer.** Every date is a game-day integer counted from world start. Nothing stores a wall-clock date except audit trails. This is §10g's world clock taken literally, and it makes pausing free. The one *decision* taken against the real clock instead is the PIN lockout window (§2.5), because what it defends against happens in real minutes at a kitchen table.
2. **Genotype is one versioned blob per horse.** It is the input to the genetics engine, the health model, and eventually the image generator. All three want the whole thing at once.
3. **Truth and knowledge are separate tables.** What a horse carries is one thing; what a given player has paid to learn is another. This is §2c, and it cannot be retrofitted.
4. **Durations are snapshotted onto the entity.** §12.1's rule. Gestation length lives on the pregnancy, not in config.
5. **Every random draw has a stored seed.** §11b. Seeds live on the entity the draw belongs to.
6. **Data, not constants.** Breeds, loci, conditions, disciplines, services and tack are rows. This is what makes §12.2's per-condition toggles possible without a deploy.
7. **An account is a person; a stable is a business.** One person may run several stables. Anything that should be scarce *per human* — actions, tokens — belongs to the account. Anything that makes stables independent of each other — money, capacity, stock — belongs to the stable.

---

## 1. World, config, and the tick

### 1.1 `world` — single row

The spine. Read by nearly everything.

- `id` (always 1)
- `game_day` — integer, elapsed game days since world start
- `paused` — 0/1
- `tick_seq` — integer, increments every tick regardless of pause
- `last_tick_real_ts` — wall clock, for operational sanity only
- `season_index` — derived from `game_day`, stored for cheap querying of stud book caps

Ages, gestation, show dates, upkeep and condition onset all derive from `game_day`. A pause is `paused = 1` and the tick declining to advance the counter. A deliberate jump (§6b) is advancing it by more than usual. Neither needs code beyond the tick itself.

**Decided in session:** the tick may fire several times per real day, with the game-days-per-tick figure reduced to compensate, so that a lunchtime tick gives the children a second moment in the day worth arriving for.

Two things follow, and they are the reason `tick_seq` exists separately from `game_day`:

- **Action budgets reset per tick, not per day.** Three ticks a day at N actions each is 3N actions per day. If the intent is that the daily total stays where §6c put it, the per-tick budget needs dividing. Keeping these as two independent config values — `game_days_per_tick` and `actions_per_tick` — means the schedule can change without silently changing how much play a day contains.
- **Show cadence should be expressed in game-days, not in ticks.** A show scheduled "every 30 game-days" survives a change to tick frequency. A show scheduled "every tick" does not.

### 1.2 Time zones — the rule that stops "next day" happening at 7pm

**The principle: store instants in UTC, decide and display in `America/Chicago`, and never store a local time as a naked string.**

That sounds like it contradicts the request, so here is why it does not. The confusion you have hit before comes from *deciding* in UTC — computing which day it is, or firing a tick, against a clock whose midnight lands at 6 or 7pm your evening. That is the bug. Storing a timestamp in UTC is unrelated to it: a UTC epoch is just an instant, and it renders as 8:15pm Central whenever you ask it to. Storing local times instead is the thing that actually breaks, because on the November changeover 1:30am happens twice and the two rows become indistinguishable.

So the schema changes very little, and the discipline lands almost entirely on two places.

**This game is unusually well insulated to begin with.** Almost nothing in the design asks what day it is in the real world — ages, gestation, upkeep, shows, condition onset and NPC breeding all derive from `world.game_day`, which is an integer that only moves when the tick moves it. Get the tick firing at the right local moment and everything downstream is right by construction. There is no second place where a date boundary is computed.

**Changes to `world`:**
- `tick_times_local` — JSON, e.g. `["07:00", "12:30", "19:00"]`, expressed in Central
- `tick_timezone` — text, `America/Chicago`

**Changes to `config.values`:**
- `display_timezone` — `America/Chicago`, read by every renderer, so there is exactly one place to change it

**Changes to `tick_run`:**
- `intended_local_time` — which scheduled slot this run was meant to be
- `fired_local_time` — what it actually was

Those last two are how you diagnose a tick that fired at the wrong hour, which is otherwise very hard to see in a table full of UTC.

**The Cloudflare constraint, stated plainly: Cron Triggers are UTC-only and have no timezone setting.** There is no configuration that makes this go away, so it has to be handled in the handler. The recommended shape:

1. Schedule the cron more often than the tick actually needs to fire — hourly, or at the small set of UTC hours that could correspond to your local slots across the year.
2. On each invocation, compute the current time in `America/Chicago` and compare it against `tick_times_local`.
3. If it does not match a slot that has not yet run, return immediately without touching anything.

The date arithmetic uses the platform's own zone database rather than a hardcoded offset — `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'` is available in Workers and knows about DST without being told.

**Worth deciding: true CST, or Central time with DST?** Fixed CST (UTC−6 year-round) is simpler and never shifts, but from March to November the tick fires an hour earlier by the wall clock in your kitchen, which is a milder version of the same confusion you are trying to escape. `America/Chicago` follows DST and always fires at the hour the children expect, at the cost of the handler needing the zone lookup above. **Lean: follow DST**, because the whole point of the change is that the tick lands at a moment that makes sense to a person looking at a clock. If a lunchtime tick is meant to motivate finishing schoolwork, it needs to be at lunchtime all year.

The one real edge case: on the spring-forward morning, 2:00am–3:00am local does not exist. Any tick slot in that hour will not fire that day. Keep the slots away from the small hours and it never comes up.

**Everything else stays UTC.** `real_ts` on the ledger, the audit trail, `pin_attempts`, `last_login_real_ts` — all stored as UTC epochs and rendered through `display_timezone`. These are records of when something happened, not decisions about which day it is, and storing them locally buys nothing while making the November ambiguity permanent. `pin_attempts.real_ts` is the one of these that is also *read* to decide something (§2.5), and it is a comparison of two instants rather than a question about which day it is — so the rule above holds unchanged: store the epoch, compare epochs, never a local string.

### 1.3 `config` — single row

- `id` (always 1)
- `version` — integer, bumped on every write, used for cache invalidation
- `values` — JSON blob of all live tunables
- `flags` — JSON blob of feature toggles

**Recommendation: one blob rather than a key-value table.** A key-value config table is more flexible and is the usual answer, but it turns every read into a multi-row query and makes typo'd keys silently return null. At this scale a single JSON blob read once per request and cached against `version` is simpler and safer. The cost is that editing requires editing JSON, which §12.4 already accepts.

Per §12.1, `values` holds only things safe to change at any moment — prices, upkeep, action budget, care and tack bands, NPC ceiling, show noise, training rates. Anything with a duration is copied onto the entity at creation instead.

### 1.4 `config_audit`

Append-only, per §12.4.

- `id`, `changed_by_account_id`, `real_ts`, `game_day`, `path` (which key), `old_value`, `new_value`

### 1.5 `tick_run`

Idempotency and diagnosis, per §11a's warning that cron does not retry.

- `id`, `tick_seq`, `stage` (age / health / breed / market / shows), `started_real_ts`, `completed_real_ts`, `rows_touched`, `status`, `error_text`

Combined with `last_processed_tick_seq` columns on `stables` and `pregnancies`, a re-fired tick skips work already done rather than double-advancing a barn.

---

## 2. Accounts and stables

**Decided in session:** one account may own several independent stables, and the app presents a stable picker at launch. This makes `accounts → stables` one-to-many and changes what belongs where.

### 2.1 `stables`

The stable owns horses, money, capacity and stock. NPC stables are rows here with no account attached, which is what lets §10b's "NPC stables run through the same code paths" be literally true.

- `id`, `account_id` (**nullable — null means NPC**), `name`
- `prefix` — the breeding prefix, unique across the game
- `prefix_set_game_day`
- `is_npc` — 0/1
- `npc_personality` — JSON weights vector (§10c); null for players
- `npc_tier` — local / regional / national, used for show field matching (§10e)
- `balance` — integer, denormalized from the ledger
- `capacity` — integer, stall limit
- `profession_code` (nullable) — see the note below
- `last_processed_tick_seq`
- `last_upkeep_game_day` — **added in slice 0009.** Upkeep is charged per horse per game day, from the world clock, not from `tick_seq` — a paused world must not accrue board (`CLAUDE.md` §5.3). `last_processed_tick_seq` above is left in place and unused for this purpose; a later stage may still want a genuine per-tick marker.
- `created_game_day`, `active`

**Prefix uniqueness should be enforced at the database level**, since a prefix is the permanent mark of origin stamped onto every horse the stable breeds. Two stables sharing one makes pedigrees ambiguous forever.

### 2.2 `stable_prefix_history`

- `stable_id`, `prefix`, `from_game_day`, `to_game_day` (nullable)

Cheap, and it means an old prefix appearing on a twelve-year-old horse can still be resolved to the stable that bred it after a rename. Without it, renaming orphans history.

### 2.3 `accounts`

- `id`, `username`, `password_hash`, `is_admin`
- `actions_remaining`, `actions_reset_tick_seq`
- `token_balance` — denormalized from `token_ledger` (§2.6); arrives with the tokens stage, not before
- `pin_hash` (nullable) — admin accounts only, §2.5. Arrives with the founding stock generator, which is the PIN's first use
- `last_active_stable_id` — convenience for the picker
- `last_login_real_ts`

Unused actions do not bank: at tick time, set `actions_remaining` to the config value rather than adding to it. §6c. **Built in slice 0009 Part B, and built differently from this section's literal wording:** the tick never touches `accounts` at all. The budget is derived at read time instead (`src/lib/actions.ts`'s `actionsRemaining`) — an account whose `actions_reset_tick_seq` is behind the current `world.tick_seq` reads as full, one whose `actions_reset_tick_seq` matches it reads its stored `actions_remaining`. This is idempotent by construction (no reset to double-apply), never banks (a new tick discards whatever was left), and refills during a pause (`tick_seq` increments on a paused tick too — `CLAUDE.md` §5.3). Spending is one atomic conditional `UPDATE` (`src/db/accounts.ts`'s `spendAction`), never a separate check-then-write.

**Recommendation: actions and tokens live on the account, not the stable.** This is the load-bearing consequence of multi-stable ownership. If actions were per-stable, a child would triple their turns by founding two more stables and §6c would stop binding at all. Money, capacity and stock stay per-stable, which is what "independent" actually means in practice — separate books, shared attention.

**Profession is the one that could reasonably go either way.** It is written above as per-stable, which is internally consistent — a stable is a business and a business has a trade. But §8c put "one profession per player" there specifically to spread professions across the family rather than letting one child hold them all, and per-stable professions restore exactly the concentration that rule was written to prevent. **Lean: move `profession_code` to `accounts`** unless you want a child to be able to run a vet practice and a farrier practice side by side. Worth deciding rather than inheriting.

### 2.4 Trading between your own stables

**Decided in session:** stables under one account trade only through the public market. There is no direct transfer function.

This needs no schema of its own — the existing `listings` table already handles it — but it does have a leak worth naming, because "independent economies" is the thing it undermines. A child can list a worthless yearling from stable A at 10,000, buy it with stable B, and has moved money between two books that were meant to be separate. Nothing stops them, and at five players nobody may care.

Two cheap defences, both recommended, neither structural:

- ~~**A minimum listing duration** before any sale completes, from config. A horse sitting on the open market for a real day is one a sibling could have bought, which is what makes the sale genuinely public rather than nominally so.~~ **Declined by the operator, 3 Aug 2026** — see overview §1a for the reasoning and for what would bring it back.
- **A `same_account` flag computed on the ledger row** when buyer and seller share an account. Costs one column, makes the pattern visible in the audit trail, and means the question can be answered by looking rather than by arguing. **Built 3 Aug 2026**, and with the duration rule declined it is now the whole defence rather than half of it — which is why completed sales are also public at `/market/sold` (slice 0017 §2.9): a sale a sibling can no longer notice *before* it happens must at least be one they can see afterwards.

### 2.5 `pin_attempts` and the parent's PIN

**Decided in session:** parental grants are PIN-gated, so that what the game hands out can be redeemed against a rewards system the parent runs outside it.

- `pin_hash` on the admin account, verified server-side and never sent to the client
- `pin_attempts` — `account_id` (nullable, since a failed attempt matches no account), `attempted_by_account_id` (whose session it was typed in), `real_ts`, `success` (0/1), for rate limiting

**These two arrive with the founding stock generator (§10.2), not with tokens.** The PIN's first use is granting a batch of horses directly — no balance, no ledger, no catalogue. The token tables in §2.6–§2.7 are built later over a PIN that already exists and is already rate-limited.

**The PIN authenticates the grant, not the session.** It is typed inside the child's own logged-in session, on the child's own phone, and nothing about that session changes when it verifies. No admin session is created and no other admin capability becomes reachable — which is the shape that stops "PIN verified" ever being reused as a general escalation.

**Rate limiting is not optional here even at this scale.** A four-digit PIN is ten thousand guesses, which is minutes of work for a bored eleven-year-old with a script and considerably less with a sibling's shoulder to look over. Lock after a small number of failures within a window, and log every attempt. This is one of the few places in the whole design where the threat model is real, precisely because the adversary is at the kitchen table.

Two properties of the lockout that follow from who the adversary is:

- **It is global, not per account or per session.** A per-child limit lets a determined eleven-year-old farm attempts across three stables and a sibling's login.
- **Its window is counted in real seconds against `real_ts`, not in game days.** This is the single deliberate exception to §0's first principle. A lockout on the world clock would stop while the world is paused and jump fifteen game days at a tick, neither of which has anything to do with how long a person has been guessing. It is a security control rather than game logic — nothing about a horse, a pregnancy, a show or a balance depends on it — and the exception should be written into the code where the comparison happens, or a later session will correctly read it as a bug.

The grant flow is: the parent enters the PIN on whichever device is in hand — normally the child's, mid-session — names the stable receiving the grant, and the resulting row records both account IDs.

### 2.6 `token_ledger` and `token_grants`

**Tokens are a second currency, on the account, non-transferable.** Built at the tokens stage, over the PIN in §2.5 — by which point the PIN, its rate limiting, its attempt log and one PIN-gated action already exist and have been in use.

`token_grants` — the PIN-gated faucet:
- `id`, `granted_to_account_id`, `granted_by_account_id`, `amount`, `reason`, `real_ts`, `game_day`

`token_ledger` — every movement:
- `id`, `account_id`, `amount` (signed), `kind` (grant / spend / refund / adjustment)
- `product_code` (nullable), `reference_type`, `reference_id`
- `balance_after`, `real_ts`, `game_day`

**Decided in session:** children cannot transfer tokens to each other. This is enforced by the absence of a transfer `kind` rather than by a rule — there is simply no code path that moves tokens between accounts, which is a much stronger guarantee than a check somebody might later forget.

Worth being aware of what that does and does not prevent. It stops tokens being traded, pooled, or extracted under pressure from an older sibling. It does not stop a child spending tokens on an import and then selling the resulting horse to their sibling for game currency, which is a token laundering path that runs through the market. That is probably fine — the horse is real, the price is public, and the transaction is one the market was built for.

### 2.7 `token_products` and `token_purchases`

**The generic sink. This is the part worth getting right, because it is what stops every future premium idea being a code change.**

`token_products`:
- `code`, `name`, `description`, `cost_tokens`
- `category` — access / cosmetic / capacity / advantage
- `handler_key` — what the purchase actually does
- `enabled`, `requires_pin_at_spend` (0/1)
- `per_account_limit`, `per_window_limit`, `limit_window_days` (all nullable)

`token_purchases`:
- `id`, `account_id`, `stable_id`, `product_code`, `tokens_spent`
- `game_day`, `real_ts`, `status`, `outcome_ref_type`, `outcome_ref_id`

An import is one row in `token_products`. So is an extra stall, a reroll, a name change, a recognised-cross unlock, or anything else you invent later.

**The `category` column earns its place as a thinking tool rather than as a mechanism.** Products in *access*, *cosmetic* and *capacity* let a token buy something the game already contains. Products in *advantage* — extra actions, free test results, a thumb on a foal's genetics — buy a shortcut past a constraint the design is resting on. Neither category is forbidden, and a chore-earned advantage is a defensible thing to want. But having the column means the question gets asked once per product instead of never, and it means you can see at a glance how much of the token economy is selling access and how much is selling outcomes.

**`requires_pin_at_spend` is worth having even though most products will not use it.** It covers the case where the tokens are already earned but the purchase itself is one you would rather approve — an irreversible unlock, or something a younger child might regret.

### 2.8 `ledger`

Append-only. Every game-currency movement. Distinct from `token_ledger`, which never converts to or from this one.

- `id`, `stable_id`, `amount` (signed), `kind` (upkeep / entry_fee / prize / sale / stud_fee / service / test / tack / profession_entry / adjustment)
- `counterparty_stable_id` (nullable), `same_account` (0/1, §2.4)
- `reference_type`, `reference_id` — what caused it
- `game_day`, `real_ts`, `description`

**Recommendation: keep both a ledger and a denormalized `balance`.** Balance alone is fast but unanswerable when a child asks where their money went. Ledger alone is honest but requires summing to render every page. Both, with the balance treated as a cache that can be rebuilt from the ledger, costs one column and settles arguments.

**Built in slice 0009, Part A** (`CLAUDE.md` §10/§11), with `kind` narrowed to what actually exists today: `opening` (a stable's founding balance, so the invariant holds with no special case), `upkeep`, `prize`, `adjustment` (`/admin/money`, §7.3 of that slice). The wider list above (`entry_fee`, `sale`, `stud_fee`, `service`, `test`, `tack`, `profession_entry`) arrives kind-by-kind as each of those stages lands — `kind` has a `CHECK` constraint, so adding one is a migration, not a schema rewrite. `src/db/ledger.ts`'s `buildLedgerStatements` is the one function in the whole codebase allowed to write `stables.balance`.

Slice 0017 Part A adds `sale`, `purchase` and `commission` (`migrations/0091_ledger_add_market_kinds.sql`). **Part D (2026-08-04) adds `stud_fee_paid` and `stud_fee_received`** (`migrations/0105_ledger_add_stud_kinds.sql`) rather than this section's single sketched `stud_fee` — two kinds, one per side of the booking, matching `sale`/`purchase`'s own "the ledger is a thing a child reads" reasoning. The commission on a stud booking reuses the existing `commission` kind unchanged; it needed no widening of its own.

---

## 3. Reference data

These are the tables that make §12.2 possible. All are small, all are edited rarely, all are read constantly and should be cached against `config.version` or their own version counter.

### 3.1 `breeds`

- `id`, `code`, `name`, `enabled`
- `is_recognised_cross` — 0/1, so promoting a Quarab to breed status is a data change (§4c)
- `founding_allele_pool` — JSON: per-locus allele frequencies, including disease alleles. This is most of breed identity (§4a) and most of the balance work.
- `ideal_vector` — JSON: per quantitative trait, target value and judging weight
- `height_range`, `weight_range` — JSON
- `eligible_class_types`, `discipline_aptitudes` — JSON
- `gaited_typical` — 0/1, documentation only; actual gait comes from DMRT3
- `colour_display_alias` — JSON (nullable): a phenotype to match and a name to show for it, so Paint is a display alias on the Quarter Horse row rather than a breed of its own (§4). A rule in data, never `if (breed.code === …)` in code.
- `image_count` — INTEGER, default 0: how many library images exist for this breed (§5b). The library is a numbered set named `<breed code>-NN` under the static assets, so the picker derives the whole list from this number rather than from a manifest or a directory listing — Cloudflare's static assets have no listing, and a manifest would be a file the operator has to hand-edit. Adding images is an upload plus one number, which is the point: it is the operator's to grow without a session's help. The cost of deriving rather than listing is that files must never be renumbered or deleted, only replaced in place.

**The row fills in two passes, and the build order decides which columns exist when.** All eight rows exist with `code`, `name`, `enabled`, `is_recognised_cross`, `gaited_typical` and a **`founding_allele_pool` covering every locus the engine knows about** from the founding stock generator onwards — a pool missing a locus is an error rather than a default, so the migration that adds locus six also updates all eight pools in the same change. The remaining columns are each added by the stage that first reads them, filled in for the Quarter Horse at that point, and filled in for the other seven at the later breeds stage (§12). Writing an ideal vector before a scorer exists to read it is guessing.

### 3.2 `loci`

Every Mendelian locus — colour, gait, and single-gene disease. One engine, one table.

- `id`, `code` (E, A, CR, G, TO, LP, PATN1, DMRT3, HYPP, HERDA…), `name`
- `category` — base / dilution / modifier / pattern / appaloosa / gait / disease
- `inheritance` — dominant / recessive / incomplete_dominant / complex
- `alleles` — JSON list of allele symbols
- `epistasis_notes` — JSON hints consumed by the expression engine
- `teaching_text` — the short genetics note shown to players (§3b)
- `enabled` — 0/1
- `sort_order`

**Note on `enabled`:** disabling a locus after horses exist carrying it is a §12.2 residue case. The recommendation is that disabling suppresses *display and consequence* but leaves the alleles in the genotype blob untouched, so re-enabling is lossless.

### 3.3 `conditions`

**Built in slice 0010**, four rows (HYPP, PSSM1, HERDA, GBED — the real Quarter Horse five-panel test minus malignant hyperthermia, which has no surface in a game with no surgery). Columns actually built:

- `id`, `code`, `name`, `category` — single_gene / colour_linked / polygenic (all four seeded rows are single_gene)
- `locus_code` (nullable) — single-gene and colour-linked conditions point at a locus; polygenic ones do not
- `trigger` — JSON describing the genotype that causes it, e.g. `{"v":1,"locus":"GBED","mutant":"Gb","mode":"recessive"}` — read by `src/engines/health/status.ts`'s `conditionStatus`. Deliberately generic enough that a colour-linked condition (Frame Overo, Silver, Grey, white patterning) needs only a new row when its locus exists, no new engine — proving out §3a's "zero new machinery" claim.
- `severity_class` — lethal / manageable / degenerative / latent (§3d)
- `signs_visible` — 0/1, **not in the original sketch** — added because §2c's "genotype vs phenotype" needed a sharper rule than the sketch implied: an *affected* horse (HYPP, PSSM1, HERDA) is visible on its own page with no test, worded as an observation; a *carrier* is never visible without one, for any condition. GBED's `signs_visible` is 0 — a neonatal lethal has no window of visible signs before the death.
- `bars_showing` — 0/1, also not in the original sketch — 1 only for HERDA (degenerative) in this slice; HYPP and PSSM1 affected horses still compete, per §3d.
- `breed_associations` — JSON array of breed codes, display only
- `test_cost_key` — nullable, the config key naming this condition's individual test price (all four point at `genotype_test_cost` today)
- `enabled` — 0/1, per-condition toggle (§12.2)
- `teaching_text`
- `event_text` — **the drafted wording** for what players see when this fires. §14 flags that the lethal notifications are worth writing before one happens rather than at the point of failure; this column is where that draft lives, so it is written calmly and edited without a deploy. The GBED wording is reproduced in full in `docs/slices/0010-health-first-pass.md` §5.6.

**Deliberately not built**, per slice 0010 §3.2/§3.3: `onset_model` (no management system exists yet — HYPP/PSSM1 are "diagnosed", not "managed", until the care and tack stage) and `management_options` (same reason). Neither is a nullable column nothing writes — that would be a promise to a future session nobody has kept. Both arrive with the care and tack stage.

### 3.4 `quantitative_traits`

**Built in slice 0006.** `id`, `code`, `name`, `category` (conformation / ability / hidden - `hidden` added for `fertility`, which is never displayed), `direction` (bidirectional / higher_better - decides the anchor a trait's genetic value realizes towards; forced by slice 0006 §2.2's bidirectional-measurement correction), `low_label`/`high_label` (the two named extremes shown on screen, e.g. "short"/"long"; forced by §2.3's ban on anything that reads as a score), `locus_count` (8–20 per §2b), `teaching_text` (matching `loci`'s precedent), `enabled`, `sort_order`. **`display_unit` is dropped** — these are unitless positions between two labels, and a unit would imply a scale that does not exist.

Breed-specific targets and weights live in `breeds.ideal_vector`, not here — the trait is universal, the ideal is not.

### 3.5 `disciplines`, `judges`, `services`, `tack_types`

Small reference tables. `judges` is detailed in §6.3. `services`/`tack_types` are still design only,
detailed in §8 below where they are used.

**`disciplines` was built in slice 0012**, one row per discipline judged on ability rather than
conformation: `id`, `code`, `name`, `ability_weights` (JSON, a weight per ability trait - `breeds.ideal_vector`'s
counterpart, snapshotted onto `show_classes.ability_weights` at class creation and never re-read),
`requires_gait`, `crosses_eligible`, `min_age_game_days`, `default_noise_sd` (per-discipline,
because an ability composite's population spread depends on its own weight vector), `teaching_text`,
`enabled` (the first lever for keeping a seven-class show week from outrunning the action budget),
`sort_order`. Only Barrel Racing (`barrels`) is seeded so far - the other five disciplines the
design calls for (Flat Racing, Show Jumping, Endurance, Dressage, Gaited Pleasure) are specified in
`docs/slices/0012-discipline-shows.md` §5.1 but not yet built; adding one is a pure-data `INSERT`
into this table, no code change.

---

## 4. Horses

The central table. Everything else hangs off it.

### 4.1 `horses`

**Identity and lineage**
- `id`, `sex` — mare / stallion / gelding
- `registered_name` — assembled at birth, permanent
- `barn_name` — freely editable by the current owner
- `breeder_prefix` — **snapshot** of the breeding stable's prefix at the moment of birth
- `breed_id` (nullable), `is_cross` (0/1), `composition` — JSON breed fractions
- `sire_id`, `dam_id` (nullable for founding stock)
- `generation`, `coi` (computed at birth, stored)
- `owner_stable_id`, `breeder_stable_id`
- `born_game_day`, `ended_game_day` (nullable)
- `status` — alive / dead / removed
- `end_reason` — old_age / condition / sold_away / retired_away
- `natural_death_game_day` (nullable), `frailty_notice_game_day` (nullable) — **built in slice 0011**, see §4.2 below

**Built in slice 0011.** `natural_death_game_day` is the day old age takes this horse — rolled once at birth from `rng_seed` (`deriveSeed(rng_seed, 'lifespan')`) via a clamped normal draw and snapshotted, never a hazard rolled every tick (CLAUDE.md §5.4/§5.5). Null until the tick's backfill stage assigns one to a living horse that lacks it — every horse alive before this slice deployed starts there. **Never rendered to a player, in any form, ever.** `frailty_notice_game_day` is null until the "failing" event has fired for this horse — its own idempotency marker, also never rendered. A partial index on `(natural_death_game_day) WHERE status = 'alive'` backs both of the tick's ageing queries.

**Recommendation: two names, one permanent and one not.** `registered_name` is built once at birth from `breeder_prefix` plus the name the breeder chooses, and never changes hands or wording again. `barn_name` is whatever the current owner calls the horse day to day, editable freely and cleared on transfer along with `notes`.

The reason the prefix is snapshotted rather than joined to the breeder's live record: if a horse's registered name were rendered from the breeder's *current* prefix, then renaming a stable would silently rewrite the name of every horse it ever bred, including ones sold to other players years earlier. A prefix is supposed to be a permanent mark of where a horse came from, and a permanent mark that changes retroactively is not one. `breeder_stable_id` still points at the live stable, so "who bred this, and what are they called now" remains answerable.

**This is also what makes the breeder credit survive a sale.** Ownership moves with `owner_stable_id`; origin does not move at all. A horse sold three times still carries the prefix of the stable that bred it, on its name, visibly, forever — which is most of what makes building a bloodline feel like building something.

**Genetics**
- `genotype` — JSON: every Mendelian locus, colour and disease alike, as allele pairs
- `polygenic` — JSON: per trait, the array of small-effect allele values (§2b step 1)
- `environmental_noise` — JSON: the birth roll per trait (§2b step 2)
- `rng_seed` — integer; drives markings, procedural art detail, and per-horse onset rolls
- `genetics_version` — integer

**Decided in session:** genotype is a single blob rather than normalized `horse_locus` rows, because the eventual image generator wants the whole structured phenotype at once and so does every other consumer. `genetics_version` is the hedge: if a later session changes the engine or adds loci, horses stamped with an older version are identifiable and can be migrated or grandfathered deliberately.

**The cost, stated plainly.** SQL cannot cheaply answer "show me every horse in the game carrying frame." SQLite's JSON functions can do it with a full scan, which at a few thousand horses is acceptable but not free.

**This matters less than it first appears, because of the knowledge model.** A buyer browsing the market cannot filter on carrier status anyway — they only know what they have paid to learn (§4.4). Filtering therefore runs over the *knowledge* table, which is small and properly indexed, not over genotypes. A seller filtering their own horses is a scan over one stable's stock, which is tiny.

**Revisit if:** an admin or NPC-selection use case needs frequent whole-population genotype queries. The fix is extracted flag columns for the handful of loci actually queried, maintained at birth — additive, and cheap to add later precisely because the blob remains the source of truth.

**Expression and appearance**
- `phenotype_cache` — JSON (nullable), `phenotype_cache_game_day`
- `image_url`, `image_source` — library / custom / generated (§5b)
- `height`, `weight` — expressed values

**Decided in session:** phenotype is computed on read rather than stored. The cache column exists as an optional optimisation for list views, invalidated whenever `game_day` moves or training or care changes. It should be treated as disposable; nothing should ever read it without being willing to recompute.

**Care state (§8a)**
- `care` — JSON: shoeing currency, feed quality, condition score, workload
- `last_farrier_game_day`, `last_vet_game_day`
- `care_modifier` — cached REAL, the ±5% figure, recomputed on the tick

**Recommendation: care lives on the horse rather than in a separate 1:1 table.** It is read on every horse page and written every tick; splitting it buys nothing.

**The "lives on the horse" half of that is adopted; the JSON blob and the cache are not.** `docs/slices/0013-care-and-condition.md` §2.1 specifies two plain integer columns (`last_farrier_game_day`, `last_vet_game_day`) plus `stables.feed_level`, and **no `care_modifier` column at all** — the modifier is a pure function of three stored values and `game_day`, computed on read by `src/engines/care/`, which is the same argument this section already makes for `phenotype_cache` two paragraphs up. Where the modifier *is* stored is `show_entries.care_modifier_applied`, at scoring time, because that is the one place a stale copy is the point. A future session should not build `horses.care` or `horses.care_modifier` in good faith without reading that slice's §2.1 and §5.6 first.

**Breeding and status**
- `is_retired`, `fertility_state`, `last_foaled_game_day`
- `notes` — free text, cleared on transfer

### 4.2 Death and removal (§7a)

**Recommendation: dead and removed horses stay in `horses` under `status`, with heavy columns cleared rather than being moved to an archive table.** Pedigree display and COI both need to traverse them, and a second table means every ancestor walk unions two sources forever.

On death or removal: clear `care`, `phenotype_cache`, `notes`, `image_url`; delete the horse's rows in `horse_training`, `horse_tack`, `service_calls`, `show_entries`. Keep identity, sex, breed, dates, parents, `genotype`, `coi`, `composition`. §7a's list, plus genotype, which is small and worth tracing for carrier status in the ancestry.

**The registry settles the question I raised earlier about show records.** §7a says results go on death, which is defensible on storage grounds — but a hall of fame whose members' achievements have been deleted is not a hall of fame. **Recommendation: keep a `horse_show_summary` row per horse** — starts, wins, placings, best result, total earnings — maintained incrementally as results land, retained permanently, and never deleted. Individual `show_entries` rows can still be pruned on death. One small row per horse, and it is what the registry, the market and the pedigree page all actually want to display anyway.

**This section's pruning recommendation was not carried out in slice 0011, and a future session should not implement it in good faith without re-reading that slice's §5.5 first.** Of the columns and tables listed above: `care`, `phenotype_cache` and `notes` do not exist as columns on `horses` (no care system has been built), and `horse_training`, `horse_tack` and `service_calls` do not exist as tables (no training, tack or service system has been built) — nothing was added just to clear it. Of the two that do exist:

- **`image_url` is kept, not cleared.** It is a short root-relative path into the static image library, a few dozen bytes. The storage argument for clearing it does not survive contact with a column this small, and what it would cost is the picture of a child's horse the week it died.
- **`show_entries` are kept, not pruned.** Deleting a dead horse's entries would retroactively falsify every show it competed in — a class judged eight-strong would render six-strong, placings would gap, and the show's own results page would 404 for a result that genuinely happened. `horse_show_summary` (above) is retained regardless and is still the right home for a future hall of fame; this section's argument for it stands unchanged. What slice 0011 establishes is that pruning `show_entries` is not needed yet at this game's scale, and should be a deliberate, discussed retention job when it is, rather than a side effect of a horse dying.

Both `pregnancies` and `coverings` gained `cancelled_game_day`/`cancelled_reason` columns in the same slice (an additive pair, not a widened `status` — SQLite cannot cheaply `ALTER` a `CHECK` constraint) so that a horse's death or voluntary removal ends its own in-progress pregnancy and booked covering without rewriting either table's `status` values. See §5.1/§5.2 below.

### 4.3 `horse_ancestors` — materialised pedigree

Written once at birth, never updated.

- `descendant_id`, `ancestor_id`, `depth` (1–6), `path_count`

Built by unioning both parents' rows with `depth + 1`, capped at the six generations §2d specifies. Six generations is at most 126 ancestors per horse, so the table stays small and the walk stays fast.

**Decided in session:** COI is previewable before committing to a pairing, which is why this table exists at all. Without preview, parent IDs alone would suffice and COI could be computed once at birth. With preview, a hypothetical A×B kinship must be computable on demand from indexed rows rather than by recursive queries at request time.

~~The exact coefficient formula — Wright's path method against the tabular method, and how `path_count` feeds it — belongs to the genetics specification session, not here. The schema supports either.~~ **Decided 2 Aug 2026, in slice 0002:** the **tabular method** — `f(X,X) = ½(1+F_X)`, `f(X,Y) = ½[f(X, sire_Y) + f(X, dam_Y)]`, memoised, with `F_foal = f(sire, dam)`. Wright's path method was rejected because it requires enumerating paths in which no individual repeats, and that constraint cannot be checked against an aggregated `path_count` — the counts have already discarded which individuals were on which path. **So `path_count` does not feed the COI at all.** It is retained for display ("this horse appears four times in the pedigree"). The table still earns its place: it lets a COI preview fetch the whole relevant subgraph in two queries and run the recursion in memory, which is what makes preview possible without recursive queries at request time.

Also decided there: the primary key is `(descendant_id, ancestor_id, depth)` rather than `(descendant_id, ancestor_id)`. The same ancestor can reach a horse by paths of different lengths, and collapsing those loses what the pedigree display wants.

### 4.4 `horse_knowledge` — what a player has learned

**Decided in session:** knowledge is per-player, and transfers to the buyer on sale.

**Built in slice 0010**, per-stable rather than per-player (CLAUDE.md §12's account-versus-stable rule — knowledge belongs to the business that paid for it), which is the important structural decision and is unchanged from the sketch below:

- `id`, `stable_id`, `horse_id`
- `kind` — genotype / screening. **Only `'genotype'` is written by slice 0010** — the screening kind, and the going-stale behaviour that makes it distinct, arrive with the polygenic predispositions (§3a's third category).
- `subject_code` — a locus code or a condition code. **Built 3 Aug 2026** (amendment 0017a §4.1): a colour/gait locus row is namespaced `locus:<code>` (e.g. `locus:CR`), never a bare code, so the two families never collide even though nothing currently stops a bare condition code from being a single letter. `result` for a locus row is the stored pair as text, in `LOCI`'s own canonical order (e.g. `"Cr/cr"`), not a clear/carrier/affected label — a colour locus has no severity. Every reader of this table that assumes a `kind = 'genotype'` row is a disease result must filter on the `locus:` prefix (`src/db/health.ts`'s `knowledgeMap` does).
- `result` — clear / carrier / affected, or a screening observation
- `tested_game_day`, `expires_game_day` (nullable — always NULL for a genotype row, since permanence is the point), `cost_paid`

Genotype rows are permanent and have no expiry. Screening rows carry an observation date and go stale, per §3c — which is the whole educational point of keeping the two kinds distinct.

**Not built**: `service_call_id`. There is no vet profession yet, so a test is a direct purchase (`/horses/:id/test`) with instant results, not a service call with a turnaround time. Arrives with that profession, the same reasoning as `conditions.onset_model`/`management_options` above.

**What this buys, and what it costs.** It makes "tested clear" a genuine premium rather than a public fact, it makes §3e's market price signal real, and it means a horse's history of being tested travels with it. It also means a child can sell a carrier without disclosing, which will eventually produce an argument. That is arguably the lesson, but it is worth being ready for rather than surprised by. A per-stable "disclosed" flag on listings, or an admin view showing all knowledge, are both available mitigations that do not change the schema. **Nothing about disclosure is built in slice 0010** — there is no market yet to disclose on (§3.7 of that slice's own document).

**On transfer:** copy the seller's knowledge rows to the buyer rather than reassigning them. The seller remembers what they knew about a horse they no longer own, which is both realistic and useful for their own breeding records. **Built 3 Aug 2026** (slice 0017 §7.2 step 4): the sale batch runs `INSERT OR IGNORE INTO horse_knowledge ... SELECT <buyer>, ... FROM horse_knowledge WHERE stable_id = <seller>`, with `cost_paid` set to 0 — the buyer did not pay for these — and `OR IGNORE` against the existing unique index handling a buyer who already tested this horse during a previous ownership. The seller's own rows are untouched. The table being per-stable from its first row is what made this a five-line statement rather than a rewrite.

The "a child can sell a carrier without disclosing" worry above is **also closed, in the opposite direction to what this paragraph anticipated**: disclosure is compulsory, not optional (§7.1, slice 0017 §2.3). A listing shows every condition the game tests for, each marked with the seller's result or "not tested", so silence cannot be made to read as clear. What a seller can still do is decline to *buy* a test — which leaves the row reading "not tested" to everyone including themselves, and is exactly the gamble the testing economy is meant to create.

### 4.5 `horse_conditions` — what is actually true

Distinct from knowledge. This is the horse's real state.

**Built in slice 0010.** A row is written only when a horse's genotype makes it read as *affected* for a single-gene condition — never for carriers, never for clear horses (carriers are a fact about a genotype, not a condition a horse has). What a player sees on screen is always computed fresh from the genotype directly, never read from this table — this table exists for the tick (an indexed set of affected foals, rather than a full scan parsing every living horse's genotype JSON) and for a later stage's `management_state`, not for display. Columns actually built:

- `id`, `horse_id`, `condition_code`
- `state` — **`onset`** for manageable/degenerative (HYPP, PSSM1, HERDA) or **`terminal`** for lethal (GBED), in this slice. The `at_risk`/`managed`/`resolved` values below arrive with the polygenic and care stages.
- `onset_game_day` — the horse's `born_game_day`, since every condition in this slice is single-gene and present from conception, with no onset model built yet
- `terminal_game_day` (nullable) — set only on lethal rows, to `born_game_day + lethal_foal_death_game_days` **as that config value stood at the moment of birth** (CLAUDE.md §5.5's snapshotting rule) — retuning the window later never moves a foal's death date once it has one
- `last_evaluated_game_day`

**`management_state` and `management_until_game_day` are built (slice 0014, 3 Aug 2026)** — `management_state` (`unmanaged`/`managed`) and `management_until_game_day` (nullable, currency derived at read time against `game_day`, nothing sweeps it). Applies only to `severity_class = 'manageable'` rows (HYPP, PSSM1 today); lethal and degenerative rows never read these columns.

**Still not built**: `risk_score` and `severity` — no polygenic conditions exist yet (§3.4 above still holds; slice 0014 built the three heritable robustness traits' *substrate* but no condition maps to one). Both arrive together with the consequence stage the polygenic predispositions still need.

Polygenic predispositions get a row at birth with `state = at_risk` and a heritable risk score. Single-gene conditions get a row only when the genotype triggers them.

### 4.6 `horse_training`

**Decided in session:** per discipline, no permanent commitment, no decay in the first pass.

- `horse_id`, `discipline_code`, `level`, `last_trained_game_day`, `total_sessions`

Decay is a later config flag reading `last_trained_game_day`, which already exists. No schema change needed to add it.

**Specified 2026-08-06 in `docs/slices/0027-training.md`, not yet built.** That document widens the key from `discipline_code` to `programme_code` — either a `disciplines.code` or the reserved string `'conformation'` — because the operator's decision that training counts in conformation classes as well as discipline ones cannot be expressed by a discipline-only key. Its §2.1 states the departure and the reasoning. Everything else here stands: one row per horse per code, upserted, no permanent commitment, and no decay in the first pass, with `last_trained_game_day` stored anyway against the flag that does not exist yet. The slice adds a second table alongside it, `training_programmes`, for the in-progress enrolment — the level is permanent and the programme is not, and §12.1's snapshot rule applies to the programme's length, which is why they are not one row.

---

## 5. Breeding

### 5.1 `pregnancies`

- `id`, `dam_id`, `sire_id`, `stud_booking_id` (nullable)
- `conceived_game_day`, `gestation_days` (**snapshot**, per §12.1), `due_game_day`
- `status` — in_progress / foaled / lost
- `outcome_code` — nullable; e.g. `lethal_white`, for the §3b cases
- `rolled_genotype`, `rolled_polygenic`, `rolled_noise` — JSON
- `rng_seed`
- `foal_id` — nullable until birth
- `last_processed_tick_seq`

**Recommendation: roll the foal's genetics at conception, not at foaling.** Three reasons. It makes the draw reproducible from a stored seed, which §11b wants for testing exactly these outcomes. It lets a lethal homozygote be detected immediately, so §3b's softening — presenting the loss as an early-term pregnancy that does not continue rather than as a foaling — is available without special-casing. And it keeps the foaling tick cheap, since it becomes a row insert rather than a genetics run.

**Alternative:** roll at foaling. Marginally simpler, and it avoids storing a genotype for a horse that may never exist. The cost is that early-term loss becomes awkward and the interesting outcomes are harder to test.

**Recommendation: the `horses` row is created at foaling, not at conception.** An unborn horse in the horses table shows up in capacity counts, pedigree walks and market queries unless every one of them remembers to exclude it, and one of them eventually will not.

**Built in slice 0011:** `cancelled_game_day` (nullable), `cancelled_reason` (nullable, e.g. `dam_died`/`sire_died`/`dam_removed`/`sire_removed`). A pregnancy is "live" when `status = 'in_progress'` **and** `cancelled_game_day IS NULL` — both halves, every time, at every call site. Written by the shared exit path both a horse's natural death and its voluntary removal go through, so a mare's in-progress pregnancy ends the moment she (or the sire) does, rather than foaling weeks later against a mother who is gone.

**No `stud_booking_id` was ever added here** (slice 0017 Part D, built 2026-08-04). A pregnancy already carries `covering_id` (see the built shape under §5.2 below), and a stud booking carries the same `covering_id` - the join is one hop through `coverings` rather than a second foreign key duplicating it on `pregnancies` too.

### 5.2 `stud_bookings`

- `id`, `stallion_id`, `mare_id`, `stallion_stable_id`, `mare_stable_id`
- `season_index`, `fee`, `booked_game_day`, `status`

The stallion book cap (§6d) is a count of active bookings for a stallion within a `season_index`.

**Built in slice 0003 as `coverings`** (the mating event, separate from `pregnancies` since one covering can produce zero, one or two rows — twins), not under this name or exactly this shape; see that slice's own document. **Slice 0011 adds the same `cancelled_game_day`/`cancelled_reason` pair** described above for `pregnancies`, with the same two-part liveness rule (`status = 'booked' AND cancelled_game_day IS NULL`) — a still-booked covering is cancelled the moment either horse involved dies or is retired away.

**A second, real `stud_bookings` table was also built, in slice 0017 Part D (2026-08-04, `migrations/0104_stud_bookings.sql`)** — this section's name was already taken by `coverings`' own history above, so the two coexist rather than one being renamed. The built shape: `id`, `stud_listing_id` (→ `stud_listings`, see §7.3), `covering_id` (→ the `coverings` row this booking created), `stallion_id`, `stallion_stable_id`, `mare_id`, `mare_stable_id`, `fee`, `commission_paid` (snapshotted, same reasoning as `listings.commission_paid`), `season_index` (copied from `world.season_index` at booking time), `booked_game_day`, `created_real_ts`. Append-only — nothing ever updates a row after the insert, and the season cap (§7.3) is a live `COUNT(*)` against it rather than a running counter, so it can never drift out of sync with the rows it counts. No `status` column: unlike a sale listing, a booking itself has nothing that later changes — whether it took is a property of the `coverings` row it points at, one join away.

---

## 6. Shows

**Decided in session:** shows resolve on the tick.

### 6.1 `shows`

- `id`, `name`, `tier` (local / regional / national), `scheduled_game_day`, `entry_deadline_game_day`, `status`, `rng_seed`

Scheduling in game-days rather than ticks is what keeps the calendar stable when tick frequency changes.

### 6.2 `show_classes`

**As built (slice 0008, widened by slice 0012):** `class_type` has exactly two real values, not the
four this section originally sketched - `breed_conformation` (scored by `scoreEntry` against a
breed's `ideal_vector`) and `discipline` (scored by `scoreAbilityEntry` against a discipline's
`ability_weights`). A `CHECK` constraint enforces the pairing: a `breed_conformation` row has
`ideal_vector` and `breed_id` set, `ability_weights` null, and `discipline_code` null; a `discipline`
row has `ability_weights` and `discipline_code` set, `ideal_vector` null, and `breed_id` null.
`discipline_code` matches a `disciplines.code` by value, not by foreign key - the same convention
`horse_conditions.condition_code` already uses for `conditions.code`.

- `id`, `show_id`, `name`, `class_type` (`breed_conformation` / `discipline`)
- `breed_id` (nullable - null for a discipline class), `discipline_code` (nullable - null for a
  breed_conformation class, matches `disciplines.code` otherwise)
- `min_age_game_days`, `max_age_game_days` (nullable), `sex_restriction` (nullable)
- `crosses_eligible` — 0/1. Always 1 for a discipline class (slice 0012 §2.1: no breed gating on
  ability classes)
- `requires_gait` — 0/1, checked against DMRT3 (only Gaited Pleasure sets this, and it is not built
  yet - see §3.5)
- `target_field_size`, `max_entries_per_stable`, `prize_schedule` (JSON, snapshotted from
  `config.values.show_prize_schedule` at creation)
- `ideal_vector` (nullable - a copy of `breeds.ideal_vector` at creation, for a breed_conformation
  class only), `ability_weights` (nullable - a copy of `disciplines.ability_weights` at creation, for
  a discipline class only), `ideal_falloff`, `noise_sd`
- `judge_id`, `rng_seed`, `status`, `judged_game_day`

`entry_fee` was never built - shows have never charged one (slice 0009 §2.4/§4.6 makes this a
deliberate decision: shows are the only way a stable in debt earns its way back out, so an entry
fee would defeat that).

### 6.3 `judges`

- `id`, `name`, `trait_weights` (JSON), `active`

§9's judge variance. A rotating pool of judges weighting traits differently is what stops one horse winning everything, and it is a data table rather than a mechanism.

### 6.4 `show_entries`

- `id`, `class_id`, `horse_id`, `entered_by_stable_id`, `is_npc`
- `entered_game_day`
- `phenotype_snapshot` — JSON, **stored** (§3 of the questions above)
- `care_modifier_applied`, `tack_modifier_applied`, `training_level_applied`
- `raw_score`, `noise_applied`, `final_score`, `placing`, `prize_awarded`

Snapshotting the phenotype and each modifier at scoring time means a result can be explained months later — which matters when a child asks why their horse placed fourth. It also means a change to the expression engine does not retroactively alter history.

### 6.5 `horse_show_summary`

- `horse_id`, `starts`, `wins`, `placings` (JSON by position), `best_result`, `total_earnings`, `last_shown_game_day`
- Optionally per discipline: `horse_discipline_summary` with the same shape

Updated incrementally when a class resolves. Permanent — survives the horse. This is the table the registry evaluates against, and it means a hall-of-fame check is a read of one indexed row rather than an aggregate over every entry the horse ever made.

### 6.6 `registries` — the Circle of Excellence

**Recommendation: criteria as data, honours as permanent rows.**

`registries`:
- `id`, `code`, `name`, `description`
- `scope` — breed / discipline / open
- `breed_id` (nullable), `discipline_code` (nullable)
- `criteria` — JSON: thresholds over wins, show tier, conformation score, health status, progeny record, age
- `capacity` (nullable) — null for open-ended standards, an integer for a genuine top-N circle
- `evaluation` — automatic / nominated
- `enabled`, `sort_order`

`registry_inductees`:
- `id`, `registry_id`, `horse_id`, `inducted_game_day`, `rank` (nullable)
- `breeder_stable_id`, `breeder_prefix`, `owner_stable_id_at_induction`
- `qualifying_summary` — JSON snapshot of what earned it
- `retired_from_registry_game_day` (nullable), for capacity-limited circles

**Two design forks worth naming.**

*Standard versus circle.* A registry with no capacity is a **standard**: any horse meeting the bar is admitted, and admission is permanent. A registry with a capacity is a **circle**: only the best N hold places, and a new inductee displaces the weakest. Standards are kinder and accumulate; circles stay prestigious but mean a child can watch their horse get pushed out by someone else's. Both are supported by the same tables, and the difference is one nullable integer — but they feel completely different to play, and with siblings involved the displacement version is worth thinking about before enabling.

*Automatic versus nominated.* Automatic evaluation on the tick after each show is the low-maintenance answer and the one the `criteria` column is built for. A `nominated` mode, where a parent inducts a horse manually, is worth keeping available for the honours that are about story rather than score — the first foal born, the mare who founded a line. That is a category of recognition no threshold can compute.

**Snapshotting the breeder prefix onto the inductee row** means the honour records who bred the horse at the time, independently of any later rename, and independently of the horse row still existing in full. A registry entry should be readable on its own.

---

## 7. Market

### 7.1 `listings`

**Built 3 Aug 2026** (`migrations/0090_listings.sql`, slice 0017 Part A). The built shape, against the sketch this section used to carry:

- `id`, `horse_id`, `seller_stable_id`, `price`, `listed_game_day`, `expires_game_day` (**snapshot**), `status`, `buyer_stable_id`, `sold_game_day` — all as sketched.
- Added while building: `guide_value` (the appraisal at listing time, snapshotted, shown to the seller only), `commission_paid` (what the seller actually lost to commission, snapshotted at sale, for the same reason `horse_knowledge.cost_paid` is), and `closed_game_day` (set for withdrawn and expired too, so "when did this stop being open" is one column rather than three).
- `status` is `open` / `sold` / `withdrawn` / `expired`, with a partial unique index on `horse_id WHERE status = 'open'` — that index, not a check somebody forgets, is what makes "a horse is on the market once at a time" true.
- **No `sold_price`.** Buy-now means the sale price is the asking price. An auction, if one ever arrives, is a second listing type on this same table (`listings.kind`) and it is what would need one.
- **`disclosed_knowledge` is deliberately not built.** §11's disclosure question is closed: disclosure is always compulsory, so there is no per-listing choice for the column to record, and a column nothing writes is a column a future session has to work out the meaning of. A listing renders one row per condition the game tests for, showing the seller's `horse_knowledge` result or "not tested". See §4.4 — the truth-versus-knowledge separation is what the whole decision rests on.

### 7.2 `buy_offers`

**Built 3 Aug 2026** (`migrations/0099_buy_offers.sql`, slice 0017 §12, Part C). NPC standing demand, per §10f. The built shape against the sketch:

- `id`, `stable_id`, `criteria` (JSON), `max_price`, `active`, `created_game_day`, `created_real_ts` — as sketched, plus `created_real_ts` (every other table in the game keeps one).
- `criteria` is `{"v":1,"breedId":number|null,"minAgeGameDays":number|null,"maxAgeGameDays":number|null,"minQuality":number}`. A null `breedId` means the offer isn't breed-restricted (true for a discipline barn's offer — `scoreAbilityEntry` doesn't need a breed match). Geldings are excluded from every offer in code, not in this JSON — the whole reason NPC buying exists is outcross breeding stock (§10f), and a gelding can never be bred.
- **One active offer per stable**, enforced by a partial unique index on `stable_id WHERE active = 1` — the same "one open thing per owner" shape `idx_listings_one_open_per_horse` already establishes. `src/db/npcBuying.ts`'s `refreshNpcBuyOffers` (a new tick stage, run every tick alongside Part B's `runNpcMarketListings`) updates that row in place rather than closing and reopening one each cycle, so a link a player is looking at does not go dead the moment nothing about the offer actually changed.
- **No player-facing "post an offer" path.** The board is NPC demand only — players sell into an existing offer, they never create one.
- **Selling into an offer reuses Part A's sale path unchanged.** `src/db/buyOffers.ts`'s `sellIntoOffer` creates an ordinary `listings` row at the offer's own price and immediately calls `sellListing` on it — the exact commission, knowledge-copy, covering- and entry-reassignment and ledger-writing code a fixed-price sale already runs, so `/market/sold` shows the result exactly as it shows any other sale. There is no second sale batch anywhere in this file.
- **The other buying route — an NPC shopping the open market itself** — needed no new table at all: `src/db/npcBuying.ts`'s `runNpcMarketPurchases` (a second new tick stage) reads `listings` directly and buys fits through `sellListing`, same as above. Both routes only ever buy from a real player (`seller_account_id IS NOT NULL` on the listing — an NPC's own `account_id` is always null), so neither can trigger NPC-to-NPC trading.
- **The named risk, carried over from §12 of the slice document rather than resolved:** NPC balances are real and never topped up automatically. A stable that overspends on either route simply stops buying until it earns more (Part B is its income) or an operator adjusts it by hand from `/admin/money`. `/admin/npc` shows each NPC stable's balance next to what it has spent buying and earned selling since the current game year began, read live from the ledger's own `purchase`/`sale` kinds — the mitigation the slice document names, so the market drying up is visible before the children feel it.

### 7.3 `stud_listings`

- `id`, `stallion_id`, `stable_id`, `fee`, `season_cap`, `bookings_this_season`, `active`

§10f flags NPC stallions at stud as the cheapest and best-targeted outcross mechanism available. This table is what makes that possible without the player giving up a stall.

**Built in slice 0017 Part D** (`migrations/0103_stud_listings.sql`, 2026-08-04). The built shape against the sketch: `id`, `stallion_id`, `stable_id`, `fee`, `season_cap`, `active`, `created_game_day`, `closed_game_day`, `created_real_ts` — as sketched, minus `bookings_this_season`. **No running counter column** - the same reasoning `listings` never got a `sold_count`: a live `COUNT(*)` against `stud_bookings` (§5.2's built shape) can never drift, and "boring implementation" (`CLAUDE.md` §9) means not maintaining a second number that has to be kept in step with the first. A partial unique index (`WHERE active = 1`) makes "a stallion stands at stud once at a time" true, the same pattern `idx_listings_one_open_per_horse` already establishes for a sale listing.

Decided by the operator when this part was commissioned (2026-08-04): **no live-foal guarantee** (a stud fee pays for the covering, not the outcome — the same as breeding two horses in one barn today, where a missed conception is not refunded), and **the market's commission applies to a stud fee exactly as it applies to a sale**. NPC stallions stand at stud too (`src/db/npcStud.ts`), reusing every function a player-to-player booking uses — the one addition is a hard filter on the NPC quality ceiling (slice 0015 §2.4): a stud booking *combines* a stallion's genetics with a player's own stock (unlike buying an NPC horse outright, which only ever hands over that horse's own ceiling-bound quality), so an NPC stallion is withdrawn from stud the moment his realised quality crosses the ceiling, not only excluded from what `selectBreedingPairs` picks to breed.

---

## 8. Professions, services, and tack

### 8.1 `services` — reference

- `code`, `name`, `profession_code`, `npc_base_price`, `inventory_item_code`, `inventory_units_per_call`, `effect` (JSON)

### 8.2 `provider_state`

- `stable_id`, `profession_code`, `prices` (JSON per service), `effectiveness_tier`, `active`

**Per §8c:** effectiveness is a purchased tier rather than accumulated experience, so a later entrant can catch up by spending rather than being permanently locked out by whichever child started first.

### 8.3 `provider_inventory`

- `stable_id`, `item_code`, `quantity`, `last_restocked_game_day`

### 8.4 `service_calls`

- `id`, `client_stable_id`, `provider_stable_id` (**nullable — null means the NPC provider**), `horse_id`, `service_code`
- `price_paid`, `game_day`, `outcome` (JSON), `knowledge_row_id` (nullable, for tests)

The nullable provider is §8c's hard requirement expressed as a column: care can never be blocked by a player provider being absent, asleep, or out of stock, because the NPC path is the absence of a provider rather than a special provider row.

### 8.5 Tack

**Recommendation: individual instances, not stack counts**, because §8b wants tack to wear.

`tack_types` (reference): `code`, `name`, `discipline_code`, `tier`, `base_price`, `wear_rate`, `modifier`

`tack_items` (instances): `id`, `stable_id`, `type_code`, `condition`, `equipped_horse_id` (nullable), `acquired_game_day`

Equipping is a nullable pointer rather than a join table, since a horse wears at most one of each slot.

---

## 9. NPC stables

Per §10b, NPC stables are rows in `stables` with `is_npc = 1`, and their horses are rows in `horses`. There is no parallel structure and no second scoring path. **Both tables below are built, and both halves of the slice have landed** (`docs/slices/0015-npc-stables.md`, Part A and Part B both as of 2026-08-03 — see `CLAUDE.md` §10's NPC stables row). Built shape departs from this section's sketch in three ways, all decided in the slice document rather than here:

### 9.1 `npc_policy`

- `stable_id`, `personality_code`, `breeding_interval_game_days`, `selection_noise_sd`, `retention_bias`, `max_pairs_per_cycle`, `last_bred_game_day`
- **`target_kind` (`conformation`/`ability`) + `target_breed_id` + `target_discipline_code`, not a free `selection_weights` JSON.** The weights already exist on `breeds.ideal_vector`/`disciplines.ability_weights`; a second copy would drift the moment either is retuned (slice 0015 §2.2/§5.5).
- **No `quality_ceiling` column.** The active ceiling is read live from `npc_ceiling_schedule` every breeding cycle, never cached on the policy row — the ceiling is meant to move under a stable that never changes anything about itself (slice 0015 §2.4).
- No `last_processed_tick_seq` — idempotency is `last_bred_game_day` against `world.game_day`, the same pattern `stables.last_upkeep_game_day` already uses.

### 9.2 `npc_ceiling_schedule`

§10d's escalation control, as data rather than code.

- `game_day_from`, **`conformation_ceiling` and `ability_ceiling` (two REAL columns, not one `ceiling_value`)** — a conformation trait's quality is closeness-to-target and an ability trait's is the expressed value itself, and the two sit on different observed scales (slice 0015 §2.4).
- **No `tier` column.** Regional/national shows aren't gameplay yet (`shows.tier` exists but `createDueShows` only ever creates `local`), so a tier-matched ceiling would be tuning a lever nothing reads. Add the column when tiered shows are real (slice 0015 §2.8).

The single most important thing in this document to keep adjustable, because §10d is the failure mode most likely to kill the project and the one least visible while building.

---

## 10. Events, imports, and the player-facing log

### 10.1 `events`

- `id`, `stable_id`, `game_day`, `kind`, `subject_horse_id` (nullable), `payload` (JSON), `read_at_real_ts` (nullable) — built as `read_at_real_ts`, not `read_at` as sketched above: `CLAUDE.md` §7 requires a wall-clock column to carry the `_real_ts` suffix so a reader can tell which clock it belongs to.

Foalings, show results, condition onsets, deaths, sales, service completions. With a tick advancing the world while nobody is watching, this is how a child finds out what happened — and it is where the drafted `event_text` from `conditions` gets rendered. **Built in slice 0009 Part B** for four kinds only (`foaled`, `covering_conceived`, `covering_missed`, `show_result`); later kinds (condition onset, death, a sale, a service call) attach with no migration, since `kind` is free text with no `CHECK`.

**Worth noting:** this table grows faster than any other. **Decided in slice 0009 Part B:** one tick stage deletes every event — read or not — older than `events_retention_game_days` (config, default 720 game days). A single threshold rather than separate read/unread rules, because a child who hasn't logged in for weeks has lost the moment either way, and every durable record (the horse, its pedigree, its show results, the ledger) survives regardless.

### 10.2 Imports and founding stock

**Decided in session:** founding stock and imports roll a batch of candidates the player picks from; the horses arrive untested; and one generator produces both. **Founding batches are free**, granted by an admin or by a parent typing the PIN (§2.5); token-priced imports are the same two tables later, distinguished by `source` and a nullable `token_purchase_id`.

That single generator is the point that saves the most work. Founding stock and new blood are the same problem — an unrelated horse of a given quality band drawn from a breed's allele pool — so there is one generator, one band parameter, one set of batch-and-claim screens, and a `source` marker distinguishing where the batch came from.

`import_offers` — a rolled batch:
- `id`, `stable_id`, `account_id` (denormalised from the stable, so a later per-account limit is one query)
- `source` — founding / chore_grant / admin_grant / token_import
- `granted_by_account_id` (nullable) — which admin minted it, whether from the admin page or the PIN
- `token_purchase_id` (nullable — null for everything but a token import)
- `status` — pending / open / claimed / expired
- `breed_id` — **nullable, filled when the player chooses their breed**, not at mint
- `quality_band` (the name, for display) and `polygenic_one_chance` (the number the generator uses) — both **snapshot**
- `mare_candidates`, `mare_claims`, `stallion_candidates`, `stallion_claims` — **snapshot**
- `age_min_game_days`, `age_max_game_days` — **snapshot**
- `granted_game_day`, `generated_game_day` (nullable), `claimed_game_day` (nullable)
- `expires_game_day` — **nullable; null means never**
- `rng_seed` — minted at offer creation; every candidate derives from it

**Everything the generator reads is snapshotted onto the offer when the offer is minted**, §0's fourth principle applied to its full extent. Retuning batch sizes, the age range or the quality bands must not change the candidates in a batch a child has not opened yet.

**The three states are the reason `breed_id` is nullable.** An offer is minted `pending` with no breed and no candidates. The player opens it, picks a breed, and the candidates are generated at that moment from the offer's already-stored seed; the offer becomes `open`. Claiming makes it `claimed`. The breed choice is committed before the candidates are visible — otherwise switching breeds is a free reroll of the same seed against a different pool.

**On expiry: default to never.** A chore reward that silently evaporates because a child had a busy week is a family argument rather than a game mechanic. The column exists because token imports will genuinely want it, and it is cheapest to check at claim time against `world.game_day` rather than to sweep on the tick.

`import_candidates`:
- `id`, `offer_id`, `slot_index` (0-based; the sub-seed label derives from it)
- `sex`, `age_game_days`
- `genotype` — JSON, the same versioned blob shape `horses.genotype` uses, Mendelian and polygenic together
- `origin_prefix`, `name_part` — the two halves of the registered name
- `rng_seed` — **becomes `horses.rng_seed` unchanged on claim**
- `chosen` (0/1), `horse_id` (nullable, set on claim)

The seed passing through untouched mirrors `pregnancies.foal_rng_seed` → `horses.rng_seed`: a claimed horse's entire genetic history stays reconstructible from the offer seed alone.

On claim, each chosen candidate becomes a `horses` row: `sire_id` and `dam_id` null, `generation` 0, `coi` 0, no `horse_ancestors` rows, and — importantly — **no `horse_knowledge` rows at all**. The unchosen candidates are simply left unclaimed.

**A founding horse carries a synthetic origin prefix, not the claiming stable's.** A prefix means *bred by*, so stamping a child's prefix on a horse they did not breed would corrupt the one thing the prefix scheme records. Each candidate arrives fully named from a stable that does not exist in this game: `breeder_prefix` holds the origin prefix, `registered_name` is that prefix plus the generated name, and `breeder_stable_id` stays null.

**Untested arrival is what keeps imports from undercutting the rest of the design.** A token-bought horse that arrived with a full clean panel would let the rewards system buy certainty, which is the one thing §2c is built to withhold. Arriving unknown means the token buys *access to new genetics*, and finding out what you actually got still runs through the vet, the testing economy, and the same decision every other horse presents. It also means an import can turn out to be a carrier, which is both true to life and considerably more interesting than a guaranteed prize.

**The rolled-batch structure is worth the extra table.** A blind draw is cheapest but gives the player nothing to think about; a standing pool lets everyone see and compete for the same stock, which at five players means the fastest child gets the best horse every time. A private batch of N gives a real decision — the flashy chestnut or the plainer mare with better conformation — without a race, and the candidates not chosen simply expire.

The parameters to expose in config are the candidate and claim counts, the age range, and the quality bands as a named set — a band being one number, the probability that a given polygenic allele is a `1`, with the bands overlapping heavily so a low-band horse can still be excellent at one trait. **Founding batches sit at mid**, because founding stock is the baseline everything afterwards is measured against. **Token imports sit low-to-mid, and that is worth defending**, because imports that outclass bred stock would make breeding pointless and turn tokens into the real progression system. An import should be a source of alleles you do not have, not a shortcut past the work.

`import_windows` remains available as an optional gate — `opens_game_day`, `closes_game_day`, `announced` — for the case where you want imports to be a periodic event rather than always-on. With tokens as the limiter, a permanent window plus a `flags.imports_open` toggle is probably sufficient, and the windows table can wait.

---

## 11. What is deliberately absent

Recorded so a future session knows these were considered rather than forgotten.

- **No `horse_locus` table.** Genotype is a blob. §4.1 states the cost and the escape hatch.
- **No separate archive for dead horses.** §4.2.
- **No chat, no moderation, no reporting.** §1 of the overview removes these from the problem space.
- **No sessions table.** Pre-created accounts with a password each (§11a) can use signed cookies. The stable picker is a selection within an authenticated session, not a second login.
- **No token transfer path.** §2.6. The absence is the enforcement.
- **No token-to-currency conversion**, in either direction. Two economies that never touch are far easier to reason about than an exchange rate you will have to tune.
- **No direct horse transfer between own stables.** §2.4 routes them through the market.
- **No per-player pause.** §10g rejects it.
- **No trainer-specific tables yet.** §8c leaves trainers as an open question about the action budget; `services` and `provider_state` already accommodate them if the answer is yes.

---

## 12. Where each table first appears in the build order

Mapped against §13, so a session can tell what it needs rather than building the whole schema at once.

| §13 stage | Tables |
|---|---|
| Foundation | `world`, `config`, `config_audit`, `tick_run`, `accounts`, `stables`, `stable_prefix_history`, stable picker |
| Genetics core | `loci`, `breeds`, `horses`, `horse_ancestors`, `pregnancies` |
| Founding stock | `import_offers`, `import_candidates` — the generator, without tokens attached; `breeds.founding_allele_pool` for all eight breeds; `accounts.pin_hash` and `pin_attempts` for the parent's grant |
| Image slot | `horses.image_url`, `horses.image_source`; `breeds.image_count` |
| One polygenic trait | `quantitative_traits`; `horses.environmental_noise` |
| One show class | `shows`, `show_classes`, `judges`, `show_entries`, `horse_show_summary`; `breeds.ideal_vector` for the Quarter Horse |
| Turns and tick | `ledger`, `events` |
| Tokens | `token_ledger`, `token_grants`, `token_products`, `token_purchases` — over the PIN and attempt log already in place |
| Health, first pass | `conditions`, `horse_conditions`, `horse_knowledge`, `services`, `service_calls`; the Quarter Horse's panel only |
| Care | `horses.last_farrier_game_day`, `horses.last_vet_game_day`, `horses.care_notice_game_day`, `stables.feed_level`; Part B (built slice 0014) adds `horse_conditions.management_state`/`management_until_game_day` and `conditions.management_text` (plain text, not the `management_options` JSON originally sketched — nothing reads a structure). **Not `horses.care` and not `horses.care_modifier`** — `docs/slices/0013-care-and-condition.md` §2.1 replaces the JSON blob with plain columns and drops the cache, for the reasons §4.1 above already gives about `phenotype_cache`. **Not `service_calls` either** — §5.6 of that slice defers it to the professions stage, where there is a provider to be null instead of |
| Tack (now its own stage, after the market) | `tack_types`, `tack_items` |
| Ageing and death | no new tables — `status` and `ended_game_day` already exist. **Built in slice 0011:** `horses.natural_death_game_day`, `horses.frailty_notice_game_day`; `pregnancies.cancelled_game_day`/`cancelled_reason`, `coverings.cancelled_game_day`/`cancelled_reason` |
| NPC stables | `npc_policy`, `npc_ceiling_schedule` — **built, in full (2026-08-03)**, see §9 above |
| Market | `listings`, `buy_offers` — **built (2026-08-03)**, Parts A-C, see §7.1/§7.2 above. `stud_listings`, `stud_bookings` — **built (2026-08-04)**, Part D, see §7.3/§5.2 above. All four parts of the market are now built. |
| Professions | `provider_state`, `provider_inventory` |
| Registries | `registries`, `registry_inductees` |
| The other seven breeds | no new tables — the remaining `breeds` columns filled in for every breed but the Quarter Horse, plus their `conditions` rows |
| Imports as premium | one `token_products` row over the existing generator |

The tables that must exist correctly from the first migration, because retrofitting them is expensive: `world` (everything derives from it), `horses.genotype` and `rng_seed` (unreproducible otherwise), `horses.composition` (wrong forever for horses already born), `horse_ancestors` (must be written at birth), `horse_knowledge` (a knowledge model added later starts empty and every existing horse is silently untested), and `horses.breeder_prefix` plus `registered_name` (a prefix scheme added after horses exist leaves the first generation permanently unmarked, which is precisely the generation whose origin matters most).

`horse_show_summary` is a near-miss for that list: it can be added later, but only correctly rebuilt if `show_entries` for dead horses have not yet been pruned. Build it with the first show class.

---

## 13. Open questions this document does not settle

- ~~**Migration convention.** §11b flags it; still a spec-session question.~~ **Settled:** `CLAUDE.md` §8 — `NNNN_short_description.sql`, forward-only, one logical change per file. Adopted by slice 0001.
- **Index list.** Deliberately omitted — indexes should follow the queries the first real screens make, not be guessed now.
- ~~**The exact COI formula** and how `path_count` feeds it. Genetics session.~~ **Settled 2 Aug 2026, in slice 0002:** tabular method; `path_count` does not feed it. See §4.3.
- **Is profession per account or per stable?** §2.3. The only place multi-stable ownership meaningfully collides with an existing rule.
- **Standards or circles** for the registry, and whether displacement is acceptable between siblings. §6.6.
- **What else tokens buy**, and how much of it falls in the *advantage* category. §2.7.
- ~~**Whether a stable's prefix can be changed at all** after horses have been bred under it.~~ **Decided 2 Aug 2026, in slice 0001:** changeable until the stable's first horse is bred, then locked by a `prefix_locked` flag. Note that slice 0001 also makes `stable_prefix_history.prefix` globally unique, so the table doubles as the registry of every prefix ever claimed — a retired name cannot be picked up by another stable, which §2.2 as written would have allowed.
- **How many stables one account may hold.** Unlimited invites a child to found a stable per horse; a small cap in config is probably wise.
- **Fixed CST or DST-following Central?** §1.2. Lean is DST-following, so the lunchtime tick stays at lunchtime.
- **Events retention.** §10.1.
- **Per-tick action budget arithmetic** — whether the daily total holds constant across a change in tick frequency, or deliberately rises.
- ~~**Disclosure on listings** — the column exists; whether anything reads it is a family-dynamics decision more than a technical one.~~ **Decided 3 Aug 2026, in `docs/slices/0017-market.md` §2.3:** always disclosed, and therefore **`listings.disclosed_knowledge` is not built** — a column nothing writes is a column a future session has to work out the meaning of. A listing renders one row per condition the game tests for, showing the seller's `horse_knowledge` result or "not tested". It never reads `horse_conditions` or `horses.genotype`; §4.4's truth-versus-knowledge separation is what the whole decision rests on.
- ~~**Founding population generation** — whether founding horses are rows created by a seeding script or by the same NPC generator, and whether players start with stock or buy it.~~ **Settled 2 Aug 2026, in slice 0005:** one generator drawing from `breeds.founding_allele_pool`, shared with imports (§10.2). Each stable gets a free private batch it claims a fixed number from, after choosing its breed; further batches come from the parent's PIN. Nothing is bought.
