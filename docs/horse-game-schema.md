# Horse Breeding & Showing Game — Data Model

**Status:** Design. Nothing here is built. Companion to `horse-game-overview.md`, which this defers to on intent.

**How to read this document.** Same convention as the overview: everything is a recommendation with reasoning attached. Alternatives are recorded where a different answer is defensible. A future session should feel free to argue with any of it, and should not treat a table as settled because it is written down. Where a decision was made in conversation rather than derived, that is marked **Decided in session** so a later reader can tell the difference between a preference and a conclusion.

Target platform is Cloudflare D1 (SQLite). Consequences that shape everything below: no native boolean (integers 0/1), no native JSON type (text columns, queried with SQLite's JSON functions where needed), and joins are cheap but row counts across many tables per request are not.

---

## 0. Six principles the tables are built around

1. **Time is an integer.** Every date is a game-day integer counted from world start. Nothing stores a wall-clock date except audit trails. This is §10g's world clock taken literally, and it makes pausing free.
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

**Everything else stays UTC.** `real_ts` on the ledger, the audit trail, `pin_attempts`, `last_login_real_ts` — all stored as UTC epochs and rendered through `display_timezone`. These are records of when something happened, not decisions about which day it is, and storing them locally buys nothing while making the November ambiguity permanent.

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
- `created_game_day`, `active`

**Prefix uniqueness should be enforced at the database level**, since a prefix is the permanent mark of origin stamped onto every horse the stable breeds. Two stables sharing one makes pedigrees ambiguous forever.

### 2.2 `stable_prefix_history`

- `stable_id`, `prefix`, `from_game_day`, `to_game_day` (nullable)

Cheap, and it means an old prefix appearing on a twelve-year-old horse can still be resolved to the stable that bred it after a rename. Without it, renaming orphans history.

### 2.3 `accounts`

- `id`, `username`, `password_hash`, `is_admin`
- `actions_remaining`, `actions_reset_tick_seq`
- `token_balance` — denormalized from `token_ledger` (§2.6)
- `pin_hash` (nullable) — admin accounts only, §2.5
- `last_active_stable_id` — convenience for the picker
- `last_login_real_ts`

Unused actions do not bank: at tick time, set `actions_remaining` to the config value rather than adding to it. §6c.

**Recommendation: actions and tokens live on the account, not the stable.** This is the load-bearing consequence of multi-stable ownership. If actions were per-stable, a child would triple their turns by founding two more stables and §6c would stop binding at all. Money, capacity and stock stay per-stable, which is what "independent" actually means in practice — separate books, shared attention.

**Profession is the one that could reasonably go either way.** It is written above as per-stable, which is internally consistent — a stable is a business and a business has a trade. But §8c put "one profession per player" there specifically to spread professions across the family rather than letting one child hold them all, and per-stable professions restore exactly the concentration that rule was written to prevent. **Lean: move `profession_code` to `accounts`** unless you want a child to be able to run a vet practice and a farrier practice side by side. Worth deciding rather than inheriting.

### 2.4 Trading between your own stables

**Decided in session:** stables under one account trade only through the public market. There is no direct transfer function.

This needs no schema of its own — the existing `listings` table already handles it — but it does have a leak worth naming, because "independent economies" is the thing it undermines. A child can list a worthless yearling from stable A at 10,000, buy it with stable B, and has moved money between two books that were meant to be separate. Nothing stops them, and at five players nobody may care.

Two cheap defences, both recommended, neither structural:

- **A minimum listing duration** before any sale completes, from config. A horse sitting on the open market for a real day is one a sibling could have bought, which is what makes the sale genuinely public rather than nominally so.
- **A `same_account` flag computed on the ledger row** when buyer and seller share an account. Costs one column, makes the pattern visible in the audit trail, and means the question can be answered by looking rather than by arguing.

### 2.5 `pin_attempts` and the admin PIN

**Decided in session:** token grants are PIN-gated, so that tokens can be redeemed against a rewards system the parent runs outside the game.

- `pin_hash` on the admin account, verified server-side and never sent to the client
- `pin_attempts` — `account_id`, `real_ts`, `success` (0/1), for rate limiting

**Rate limiting is not optional here even at this scale.** A four-digit PIN is ten thousand guesses, which is minutes of work for a bored eleven-year-old with a script and considerably less with a sibling's shoulder to look over. Lock after a small number of failures within a window, and log every attempt. This is one of the few places in the whole design where the threat model is real, precisely because the adversary is at the kitchen table.

The grant flow is: the parent enters the PIN on whichever device is in hand, names the account receiving tokens, and the grant is written with both account IDs recorded.

### 2.6 `token_ledger` and `token_grants`

**Tokens are a second currency, on the account, non-transferable.**

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

- `id`, `code`, `name`, `category` — single_gene / colour_linked / polygenic
- `locus_code` (nullable) — single-gene and colour-linked conditions point at a locus; polygenic ones do not
- `trigger` — JSON describing the genotype that causes it (`Fr/Fr`, `Z/Z`, heterozygous-affected for the dominants)
- `severity_class` — lethal / manageable / degenerative / latent (§3d)
- `onset_model` — JSON: age curve, workload and weight modifiers, base probability
- `management_options` — JSON: what diet or workload change does, and what it costs
- `breed_associations` — JSON
- `enabled` — 0/1, per-condition toggle (§12.2)
- `teaching_text`
- `event_text` — **the drafted wording** for what players see when this fires. §14 flags that the lethal notifications are worth writing before one happens rather than at the point of failure; this column is where that draft lives, so it is written calmly and edited without a deploy.

### 3.4 `quantitative_traits`

- `id`, `code`, `name`, `category` (conformation / ability), `locus_count` (8–20 per §2b), `display_unit`, `enabled`

Breed-specific targets and weights live in `breeds.ideal_vector`, not here — the trait is universal, the ideal is not.

### 3.5 `disciplines`, `judges`, `services`, `tack_types`

Small reference tables, detailed in §7–§9 below where they are used.

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

**Breeding and status**
- `is_retired`, `fertility_state`, `last_foaled_game_day`
- `notes` — free text, cleared on transfer

### 4.2 Death and removal (§7a)

**Recommendation: dead and removed horses stay in `horses` under `status`, with heavy columns cleared rather than being moved to an archive table.** Pedigree display and COI both need to traverse them, and a second table means every ancestor walk unions two sources forever.

On death or removal: clear `care`, `phenotype_cache`, `notes`, `image_url`; delete the horse's rows in `horse_training`, `horse_tack`, `service_calls`, `show_entries`. Keep identity, sex, breed, dates, parents, `genotype`, `coi`, `composition`. §7a's list, plus genotype, which is small and worth tracing for carrier status in the ancestry.

**The registry settles the question I raised earlier about show records.** §7a says results go on death, which is defensible on storage grounds — but a hall of fame whose members' achievements have been deleted is not a hall of fame. **Recommendation: keep a `horse_show_summary` row per horse** — starts, wins, placings, best result, total earnings — maintained incrementally as results land, retained permanently, and never deleted. Individual `show_entries` rows can still be pruned on death. One small row per horse, and it is what the registry, the market and the pedigree page all actually want to display anyway.

### 4.3 `horse_ancestors` — materialised pedigree

Written once at birth, never updated.

- `descendant_id`, `ancestor_id`, `depth` (1–6), `path_count`

Built by unioning both parents' rows with `depth + 1`, capped at the six generations §2d specifies. Six generations is at most 126 ancestors per horse, so the table stays small and the walk stays fast.

**Decided in session:** COI is previewable before committing to a pairing, which is why this table exists at all. Without preview, parent IDs alone would suffice and COI could be computed once at birth. With preview, a hypothetical A×B kinship must be computable on demand from indexed rows rather than by recursive queries at request time.

~~The exact coefficient formula — Wright's path method against the tabular method, and how `path_count` feeds it — belongs to the genetics specification session, not here. The schema supports either.~~ **Decided 2 Aug 2026, in slice 0002:** the **tabular method** — `f(X,X) = ½(1+F_X)`, `f(X,Y) = ½[f(X, sire_Y) + f(X, dam_Y)]`, memoised, with `F_foal = f(sire, dam)`. Wright's path method was rejected because it requires enumerating paths in which no individual repeats, and that constraint cannot be checked against an aggregated `path_count` — the counts have already discarded which individuals were on which path. **So `path_count` does not feed the COI at all.** It is retained for display ("this horse appears four times in the pedigree"). The table still earns its place: it lets a COI preview fetch the whole relevant subgraph in two queries and run the recursion in memory, which is what makes preview possible without recursive queries at request time.

Also decided there: the primary key is `(descendant_id, ancestor_id, depth)` rather than `(descendant_id, ancestor_id)`. The same ancestor can reach a horse by paths of different lengths, and collapsing those loses what the pedigree display wants.

### 4.4 `horse_knowledge` — what a player has learned

**Decided in session:** knowledge is per-player, and transfers to the buyer on sale.

- `id`, `stable_id`, `horse_id`
- `kind` — genotype / screening
- `subject_code` — a locus code or a condition code
- `result` — clear / carrier / affected, or a screening observation
- `tested_game_day`, `expires_game_day` (nullable), `cost_paid`, `service_call_id`

Genotype rows are permanent and have no expiry. Screening rows carry an observation date and go stale, per §3c — which is the whole educational point of keeping the two kinds distinct.

**What this buys, and what it costs.** It makes "tested clear" a genuine premium rather than a public fact, it makes §3e's market price signal real, and it means a horse's history of being tested travels with it. It also means a child can sell a carrier without disclosing, which will eventually produce an argument. That is arguably the lesson, but it is worth being ready for rather than surprised by. A per-stable "disclosed" flag on listings, or an admin view showing all knowledge, are both available mitigations that do not change the schema.

**On transfer:** copy the seller's knowledge rows to the buyer rather than reassigning them. The seller remembers what they knew about a horse they no longer own, which is both realistic and useful for their own breeding records.

### 4.5 `horse_conditions` — what is actually true

Distinct from knowledge. This is the horse's real state.

- `id`, `horse_id`, `condition_code`
- `state` — at_risk / onset / managed / resolved / terminal
- `risk_score` (polygenic conditions), `onset_game_day`, `severity`
- `management_state` — JSON, what the owner is currently doing about it
- `last_evaluated_game_day`

Polygenic predispositions get a row at birth with `state = at_risk` and a heritable risk score. Single-gene conditions get a row only when the genotype triggers them.

### 4.6 `horse_training`

**Decided in session:** per discipline, no permanent commitment, no decay in the first pass.

- `horse_id`, `discipline_code`, `level`, `last_trained_game_day`, `total_sessions`

Decay is a later config flag reading `last_trained_game_day`, which already exists. No schema change needed to add it.

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

### 5.2 `stud_bookings`

- `id`, `stallion_id`, `mare_id`, `stallion_stable_id`, `mare_stable_id`
- `season_index`, `fee`, `booked_game_day`, `status`

The stallion book cap (§6d) is a count of active bookings for a stallion within a `season_index`.

---

## 6. Shows

**Decided in session:** shows resolve on the tick.

### 6.1 `shows`

- `id`, `name`, `tier` (local / regional / national), `scheduled_game_day`, `entry_deadline_game_day`, `status`, `rng_seed`

Scheduling in game-days rather than ticks is what keeps the calendar stable when tick frequency changes.

### 6.2 `show_classes`

- `id`, `show_id`, `class_type` — breed / conformation / performance / gaited
- `breed_id` (nullable), `discipline_code` (nullable)
- `min_age_days`, `max_age_days`, `sex_restriction`
- `crosses_eligible` — 0/1, derived from `class_type` per §4c but stored so exceptions are possible
- `requires_gait` — 0/1, checked against DMRT3
- `entry_fee`, `prize_structure` (JSON), `target_field_size`
- `judge_id`, `rng_seed`

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

- `id`, `horse_id`, `seller_stable_id`, `price`, `listed_game_day`, `expires_game_day` (**snapshot**), `status`, `buyer_stable_id`, `sold_game_day`
- `disclosed_knowledge` — JSON (optional): which of the seller's knowledge rows are shown on the listing

That last column is the hook for the disclosure question raised in §4.4. Including it now costs one nullable column; adding it after children have been trading for a month is a conversation about fairness rather than a schema change.

### 7.2 `buy_offers`

NPC standing demand, per §10f.

- `id`, `stable_id`, `criteria` (JSON), `max_price`, `active`, `created_game_day`

### 7.3 `stud_listings`

- `id`, `stallion_id`, `stable_id`, `fee`, `season_cap`, `bookings_this_season`, `active`

§10f flags NPC stallions at stud as the cheapest and best-targeted outcross mechanism available. This table is what makes that possible without the player giving up a stall.

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

Per §10b, NPC stables are rows in `stables` with `is_npc = 1`, and their horses are rows in `horses`. There is no parallel structure and no second scoring path. What they need beyond that:

### 9.1 `npc_policy`

- `stable_id`, `selection_weights` (JSON, §10c), `breeding_interval_days`, `selection_noise`, `retention_bias`
- `quality_ceiling` — REAL, the §10d cap
- `last_bred_game_day`, `last_processed_tick_seq`

### 9.2 `npc_ceiling_schedule`

§10d's escalation control, as data rather than code.

- `game_day_from`, `tier`, `ceiling_value`

The single most important thing in this document to keep adjustable, because §10d is the failure mode most likely to kill the project and the one least visible while building.

---

## 10. Events, imports, and the player-facing log

### 10.1 `events`

- `id`, `stable_id`, `game_day`, `kind`, `subject_horse_id` (nullable), `payload` (JSON), `read_at` (nullable)

Foalings, show results, condition onsets, deaths, sales, service completions. With a tick advancing the world while nobody is watching, this is how a child finds out what happened — and it is where the drafted `event_text` from `conditions` gets rendered.

**Worth noting:** this table grows faster than any other. A retention rule — drop read events older than N game-days — is worth deciding early rather than discovering when a query gets slow.

### 10.2 Imports

**Decided in session:** imports cost tokens rather than game currency; they roll a batch of candidates from which the player picks one; the horses arrive untested; and the same generator produces both the founding population and every later import.

That last point is the one that saves the most work. Founding stock and new blood are the same problem — an unrelated horse of moderate quality drawn from a breed's allele pool — so there is one generator, one quality band parameter, and a `source` marker distinguishing them.

`import_offers` — a rolled batch:
- `id`, `stable_id`, `account_id`, `token_purchase_id` (nullable — null for founding stock)
- `source` — founding / token_import / admin_grant
- `generated_game_day`, `expires_game_day`, `status` (open / claimed / expired)
- `breed_id`, `quality_band`, `candidate_count`, `rng_seed`

`import_candidates`:
- `id`, `offer_id`, `sex`, `age_days`, `breed_id`
- `genotype`, `polygenic`, `environmental_noise` — JSON, rolled at generation
- `rng_seed`, `chosen` (0/1)

On claim, the chosen candidate becomes a `horses` row: `sire_id` and `dam_id` null, `generation` 0, `coi` 0, no `horse_ancestors` rows, `breeder_stable_id` null with a synthetic origin label, and — importantly — **no `horse_knowledge` rows at all**.

**Untested arrival is what keeps imports from undercutting the rest of the design.** A token-bought horse that arrived with a full clean panel would let the rewards system buy certainty, which is the one thing §2c is built to withhold. Arriving unknown means the token buys *access to new genetics*, and finding out what you actually got still runs through the vet, the testing economy, and the same decision every other horse presents. It also means an import can turn out to be a carrier, which is both true to life and considerably more interesting than a guaranteed prize.

**The rolled-batch structure is worth the extra table.** A blind draw is cheapest but gives the player nothing to think about; a standing pool lets everyone see and compete for the same stock, which at five players means the fastest child gets the best horse every time. A private batch of N gives a real decision — the flashy chestnut or the plainer mare with better conformation — without a race, and the candidates not chosen simply expire.

Two parameters to expose in config: `candidate_count` and `quality_band`. **Low-to-mid is the right band and worth defending**, because imports that outclass bred stock would make breeding pointless and turn tokens into the real progression system. An import should be a source of alleles you do not have, not a shortcut past the work.

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
| Founding stock | `import_offers`, `import_candidates` — the generator, without tokens attached |
| Image slot | `horses.image_url` only |
| One polygenic trait | `quantitative_traits` |
| One show class | `shows`, `show_classes`, `judges`, `show_entries`, `horse_show_summary` |
| Tokens | `token_ledger`, `token_grants`, `token_products`, `token_purchases`, `pin_attempts` |
| Turns and tick | `ledger`, `events` |
| Health, first pass | `conditions`, `horse_conditions`, `horse_knowledge`, `services`, `service_calls` |
| Care and tack | `tack_types`, `tack_items`, `horses.care` |
| Ageing and death | no new tables — `status` and `ended_game_day` already exist |
| NPC stables | `npc_policy`, `npc_ceiling_schedule` |
| Market | `listings`, `buy_offers`, `stud_listings`, `stud_bookings` |
| Professions | `provider_state`, `provider_inventory` |
| Registries | `registries`, `registry_inductees` |
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
- **Disclosure on listings** — the column exists; whether anything reads it is a family-dynamics decision more than a technical one.
- **Founding population generation** — whether founding horses are rows created by a seeding script or by the same NPC generator, and whether players start with stock or buy it.
