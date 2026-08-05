# Slice 0025 — Difficulty, foals, shows and evaluation

**Commissioned 2026-08-05, from three days of real play by the operator's five children.** Every decision in this document was made by the operator, in answer to a question, in one sitting. Where a number was not specified it is named as a first guess below.

This is one brief covering six pieces of work, shipped in four stages. **Stages one through three are built. Stage four is specified and not built.** Read the stage you are building; the rest is context.

---

## 1. What the children actually said

Recorded close to verbatim, because the wording matters more than any summary of it:

1. *"sickness and injury is coming too frequently for my youngest two children. a difficulty level selection that controls rate of how often their horses are dying or having career ending issues would be helpful."*
2. *"I have one requesting a time warp on foals. they are absolutely useless for three game years and at ten 'wait six weeks and they'll be grown' isn't working, she's already talking about wanting a different game."*
3. *"they want more shows to choose from. a single show per discipline means they have to pit their own horses against each other. and since we haven't designed shows to be progressive yet, it means their top horses just keep winning and their less stellar ones never get a chance to ribbon."*
4. *"they need a way to 'evaluate' foals. since they can't show, the kids can't tell 'what's good' vs what's not."*
5. *"they still say its too random whether babies born are good or not ... getting 3 subpar foals in a row from a pair that COULD throw a good baby but isnt is frustrating them."*
6. *"my oldest daughter pointed out its ridiculous [that you] can't see anything about conformation on horses at stud. as she rightly points out, in real life, we would be able to look at a stud and get an idea how well they meet a breed standard. we should see a range, or even the labels given from the show evaluate. its not knowing the number or which side of the ideal it falls on, so it isn't cheating; its just giving a realistic way to evaluate before spending money."*

Point 6 is the one to hold onto when in doubt: **a word, never a number, and never which side of the target the horse misses on.** That clause is what makes the whole disclosure fair rather than a cheat, and it constrains every screen this brief adds.

---

## 2. Build order

The operator asked for stud previews and difficulty first, then the rest in the recommended order. Evaluations moved into stage one against that ordering, and deliberately: the breeding preview's foal range reads "Unknown" until a parent is known (§6.4), and that answer is only reachable if there is something to buy.

| Stage | Contents | State |
|---|---|---|
| 1 | Difficulty levels · paid evaluations · conformation words on stud listings · the breeding preview's foal range | **built 2026-08-05** |
| 2 | The per-horse time warp · free foal upkeep | **built 2026-08-05** |
| 3 | Young-horse classes · ability tests | **built 2026-08-05** |
| 4 | Two shows per cycle · the three-rank progression · classes created on demand | specified |

Stage 4 is the largest and the one most likely to need the paid Workers tier — see §7.6. **Its shape changed on 2026-08-05, before any of it was built:** classes are now to be created when a player enters a horse, rather than minted across the whole catalogue on a fixed calendar, which makes "two shows per cycle" and "two entries per stable" fall out of one rule instead of being built separately. See §7.5a, and read it alongside §7.5 rather than instead of it.

---

## 3. Stage 1a — Difficulty (built)

**Decisions.** Per **account** (a person finds the game too harsh, not a barn), set **only by the operator** at `/admin/accounts`, with **three named levels whose numbers the operator can edit**. It scales two things and no others: **how often an acute incident starts**, and **how bad the outcome is when one does**.

**What it deliberately does not touch**, because the operator's answer to "what should it turn down" was "a and b" and nothing else:

- inherited disease and foals born affected by a lethal;
- death from old age and the Failing period.

The reasoning to keep: an inherited disease is a fact about a genotype. Softening it per account would make two children's horses genuinely different animals, and a foal sold from one barn to another would change its own biology on the way across. Incident risk has no such problem — it is a property of how the world treats a horse, and it re-reads the owner's setting on every check.

**What landed.** `accounts.difficulty` (migration `0153`, no `CHECK` — an unrecognised value reads neutral rather than breaking a tick), six flat decimal config keys (`0154`), `src/engines/incidents/difficulty.ts`, and two call sites in `src/db/incidents.ts`: `rollAcuteIncidents` passes `difficultyRateMultiplier` into `onsetProbability`, and `resolveOneIncident` passes `badOutcomeMultiplier` into `rollOutcome`.

Three properties the engine holds and the tests assert:

- **`normal` is exactly 1.0/1.0** — today's game, unchanged. Moving it moves the baseline for the whole family at once.
- **A scaled outcome table always sums to 1.** Slice 0020 shipped two tables that didn't and only its own test caught them; `scaleBadOutcomes` scales the death + degenerative pair, gives what that frees back to resolved and manageable in their existing ratio, and clamps rather than going negative.
- **The rate multiplier is applied before the ceiling clamp**, so `incident_probability_ceiling_per_game_day` still means what it says at every level.
- **An NPC stable always reads neutral.** It has no account, and difficulty must never make NPC horses harder or easier to beat.

Seeded numbers, all first guesses: Gentle 0.35 / 0.3, Normal 1.0 / 1.0, Realistic 1.35 / 1.25.

## 4. Stage 1b — Paid evaluations (built)

**Decisions.** Per-trait labels, **vaguer on a young foal and sharpening as it grows** — *"enough to tell them whether continued investment is a good risk."* **Money only, no turn** (a child evaluating a whole crop of foals should not spend a day's actions looking rather than doing). **Repeatable at full price**, with the price configurable. Buyable **by the owner, and by anyone looking at a horse that is for sale or standing at stud**.

**What landed.** `horse_evaluations` (migration `0155`), three config keys (`0156`), a new ledger kind (`0157`), `src/engines/conformation/evaluation.ts`, `src/db/evaluations.ts`, `POST /horses/:id/evaluate`, a collapsed Evaluation block inside the horse page's Conformation card, and an offer card on both the sale-listing and stud-listing pages.

Three properties, in the order they matter:

1. **It never lies.** The true label is always inside the range returned. A wide answer is vague, never wrong — *"Weak to Outstanding"* on a weanling is honest, and a child learns nothing false from it. The proof is in `verdictFor`: clamping the hedged centre into a range that already contains the truth cannot increase its distance from the truth.
2. **It cannot be averaged away.** The offset is derived once from the horse's own `rng_seed`, not drawn per purchase, so five evaluations on the same foal on the same day return the same words five times. Independent noise per purchase would let a player average it out and read the exact answer off a weanling for the price of a few tests. The pages say so in as many words, so nobody spends the money to find out.
3. **It sharpens smoothly.** The same underlying offset is scaled by a shrinking spread, so successive evaluations close in on the truth rather than jumping around it.

**Deliberately not a `horse_knowledge` row.** That table's unique index exists precisely to stop a permanent result being bought twice, and an evaluation is the opposite.

**The horse is judged at maturity, not at its current age.** A four-month-old's expressed conformation has barely realised, and the question a child is actually asking is what the foal will become.

**Refused rather than sold** when the horse's breed has no `ideal_vector` — an evaluator who cannot judge should not take the money.

## 5. Stage 1c — Conformation on stud listings (built)

**Decision.** *"labels for stud, since we are only buying potential and pregnancy loss is high. but the labels on any horse, stud or own, should be TRUE labels on actual expressed traits, not the noisy ones from judge preferences."* Scope: **stud listings only** — not sale listings, not `/world`. *"they can pay for an 'evaluation' if they want to buy, and they dont need to see others who are not selling or studding."*

**The labels were already true labels** and no change was needed to make them so. `src/engines/conformation/labels.ts` scores a trait against the breed ideal with the judge's weighting deliberately left out — its own comment says "a weight says how much a judge cares, not how good the horse is". What was missing was only that studs did not show them.

**What landed.** `src/db/conformationLabelRowsFor` (`src/db/conformationLabels.ts`) — one shared builder, so an owner's words and a stranger's words cannot drift — rendered on `/market/stud/:id` behind the same gate the owner's own card uses (at least one show start, and a breed with a standard). A stallion who has never shown reads Unknown on every row, with a pointer to the paid evaluation.

**One consequence, taken deliberately:** the Breed page's outside-stud preview now passes `stallionConformationKnown: true`. It used to be false on the reasoning that his conformation was shown nowhere else in the game; that reasoning expired the moment his own stud page started printing the words in full.

## 6. Stage 1d — The foal range in the breeding preview (built)

**Decisions.** Fix the **expectation**, not the maths (*"b"* to "change the maths or change the expectation"). Layout: *"the mare label next to stud label next to 'likely range for foal' (say what they'd get 80% of the time) for each trait."* When a parent's own label is unknown, the foal column reads **Unknown** and says to evaluate the parent — not a wider guess, and never a range computed from values the player has not earned.

**What landed.** `src/engines/genetics/foalPrediction.ts` — an exact calculation, no simulation and no RNG. The foal's potential for a trait is a Poisson-binomial over twenty independent allele draws (ten from each parent), convolved exactly; environmental noise is enumerated over a grid rather than sampled; expression runs through the same `geneticValue → realization → expressedValue` chain the real birth pipeline uses. A test checks the exact distribution against ten thousand simulated foals drawn the way inheritance actually works.

**The subtlety worth not losing:** a trait's label is **not monotonic** in its expressed value — too far above the breed's target is as bad as too far below — so the central 80% of values maps to a *set* of labels, and the honest summary is the best and worst word in that set, not the words at the two ends of the interval.

**A cross-breed pairing reads "No single standard"** rather than quietly picking the dam's breed. A foal has no breed until it exists, and this is a real fact about the game rather than a gap.

**Standing concern, stated when this was commissioned and worth revisiting after real play:** fixing the expectation alone may not fix the complaint. The honest range for a real pairing is often wide, so the preview may confirm the frustration rather than dissolve it. It was still worth building first — a calibrated expectation is worth having either way, and it is the instrument that will say whether the variance is genuinely too high before anybody touches the genetics.

---

## 7. Stages 2-4

### 7.1 The time warp (stage 2) — **built 2026-08-05**

Not a world speed-up and not skipping ahead — *"a time warp on an individual horse ... she will pay to be able to take a month old foal and make it a year or two year old horse immediately."*

- **Buys a fixed chunk of time: six months**, repeatable, rather than jumping to a named age.
- **Costs money and a turn** (both).
- **Capped at maturity.** A horse can be warped up to `min_breeding_age_game_days` and no further — never toward death, and never to rush a mare through her breeding years. **No per-day limit** on how many warps a horse may have; the turn cost is the limit.
- **Warped time counts against the horse's life.** It is genuinely six months older and will die six months sooner. The operator chose this over compensating the lifespan: you bought time, and time costs time.
- **The skipped period is not simulated.** No upkeep charged, no acquired incidents rolled, no care timers advanced. The one exception the operator named explicitly: **a lethal genetic condition that would have killed the foal in that window still kills it.** That is a fact about the horse, not a chance event, and difficulty (§3) does not touch it either.
- The obvious implementation risk: everything that derives from `born_game_day`. Moving that value is the whole mechanism, and every timer keyed off it (care start, conformation realisation, show eligibility, ageing bands) must follow correctly. Prefer moving `born_game_day` backward over inventing an age offset column, and check `last_incident_check_game_day` does not then read as an enormous gap.

**What landed** (migrations `0159`/`0160`, `src/db/timeWarp.ts`, `POST /horses/:id/warp`, a "Grow up" card on the horse's own page). `born_game_day` moves back, and with it every other absolute day anchored to this horse's own birth: `natural_death_game_day` (so it really does die sooner), and `horse_conditions.terminal_game_day` / `signs_game_day` (so a carried lethal still kills on schedule — the operator's one named exception). The care markers and `last_incident_check_game_day` are reset to today, so the horse arrives freshly cared-for rather than instantly overdue for months the warp explicitly did not simulate. **If a future slice adds another column anchored to a horse's birth date, it belongs in `buildTimeWarpStatements`** — nothing can enumerate that for you.

Near the cap the last step is short: `planTimeWarp` clamps it to land exactly on maturity, the button names the real number of days, and the card says so. Full price for a short step is deliberate and stated, not hidden.

### 7.2 Free foal upkeep (stage 2) — **built 2026-08-05**

Raised by the operator mid-conversation: *"foals probably shouldn't cost upkeep. id throw them out in the pasture myself to avoid it since they cant be shown or bred anyways."*

- **Nothing at all** until the horse is **one year old**, then full upkeep.
- One year, not three, because stage 3 lets a yearling show — the cutoff is "old enough to do something", not "old enough to breed".

### 7.3 Young-horse classes (stage 3) — **built 2026-08-05**

- **Conformation in-hand classes**, plus **ability tests** — *"a 'speed test,' 'agility test' etc. not relating to the whole discipline, just getting an idea about its ability traits."*
- **Two age bands: yearling (1-2) and two-year-old (2-3).** Not three bands; smaller fields are the same problem as one show per discipline.
- **Ribbons from these classes do not count toward progression in the adult classes** (§7.4).

**What landed** (migration `0161` rebuilds `show_classes` — SQLite can't `ALTER` a `CHECK`, the same mechanics migration `0064` used to add `discipline` — adding `class_type` values `young_conformation`/`ability_test` and two new columns, `ability_trait_code` and `age_band`; migration `0163` adds the two band-boundary config keys). `createShowIfMissing` (`src/db/shows.ts`) now mints, every cycle: one `young_conformation` class per breed with an `ideal_vector` per age band (16 today, at 8 breeds), and one `ability_test` class per `ABILITY_TRAITS` trait per age band (10 today, at 5 traits) — regardless of which disciplines happen to be enabled, since an ability test measures raw ability, not suitability for a specific discipline. Both reuse everything an adult class already has: `young_conformation` is scored exactly like `breed_conformation` (same `conformationValues`/`scoreEntry`, same conformation-judge pool, same breed `ideal_vector`) and `ability_test` exactly like `discipline` (same `abilityValues`/`scoreAbilityEntry`, same discipline-judge pool), via a single `classUsesAbilityScoring(class_type)` discriminant rather than a second scoring path — the one thing `ability_test` does NOT get is a breed-aptitude modifier, since that multiplier means "how suited is this breed to this *discipline*" and an ability test has no `discipline_code` to mean that against.

The two age bands are derived, not hand-typed twice: `youngHorseAgeBands()` computes yearling as `[young_horse_yearling_min_age_game_days, young_horse_two_year_old_min_age_game_days - 1]` and two-year-old as `[young_horse_two_year_old_min_age_game_days, show_conformation_min_age_game_days - 1]` — the adult class's own min age is the two-year-old band's ceiling, so a horse ages out of "young" on exactly the day it becomes eligible for the class it graduates into, with no gap and no day double-eligible. Seeded at 360/720 game days (one and two game years) against `show_conformation_min_age_game_days`'s existing 1080 (three years).

The `/shows` filter picks up one more tab, "Young Horse", matching `young_conformation` and `ability_test` together (`classMatchesShowsFilter`'s `'young'` case) — one tab, not a breed picker plus five trait tabs, since a horse only ever matches one age band regardless of which of the two class types it entered. The Show record card gives them their own groups too, "Young Horse Conformation" and "`<Trait>` Test", deliberately distinct from the adult "Conformation" group they resemble — visible proof today of the promise in the bullet above, not a claim about code that doesn't exist yet.

**One bug this surfaced, fixed alongside it:** the horse page's "Enter in a show" card and its own entry-refusal message both called `getOpenClasses(ctx.env, 10)` — a hardcoded limit that was already tight against 8 breed + 6 discipline classes, and would have silently dropped every `young_conformation`/`ability_test` class (created last, carrying the highest `id`s, sorted `ORDER BY id ASC LIMIT 10`) off the exact card a young horse's owner needs it on. Raised to 200, the same margin `SHOW_RESULT_FETCH_LIMIT` already uses for the same reason.

### 7.4 Ability tests (stage 3) — **built 2026-08-05**

Agreed shape, after the operator asked for a recommendation:

- **A real class**, entered against other horses, placed and ribboned.
- **And** the result permanently records a word about that ability trait for the owner — the first time anything in the game has ever shown an ability value to anyone.
- **The word describes the horse's own result, not its rank.** "Fast" must mean fast, whether or not a faster horse turned up that day; otherwise a child learns her colt is slow when he is second-fastest in the world.

**What landed.** A new table, `horse_ability_words` (migration `0162`) — one row per (horse, trait), upserted the same way `horse_show_summary` already is, not append-only. At judging time, `judgeOneClass` bands the horse's own true expressed value for that one trait (before noise, care or age modifiers — those describe the judge's day and the horse's upkeep, not its raw ability) into the same Poor/Weak/Acceptable/Good/Outstanding vocabulary the Conformation card already uses (`abilityLabelFor`, reusing `bandForTraitScore` directly — an ability trait has no breed target to measure distance from, so the raw value **is** the band input) and writes it to that row. The horse page's new Ability card (word-only, deliberately no meter and no number — ability has never had one on screen anywhere a player can see it, and this card does not start now) reads that stored word back, never recomputing live from the horse's current age — the word describes what happened in the class it was earned in, the same way a real placing does, not a running re-read that would quietly improve as the horse matures without another test. A trait with no row reads **Untested**. Reuses the same `conformation_label_*` band-edge config keys as the Conformation card — one vocabulary, not a second set of tunables to keep in step.

### 7.5 More shows (stage 4)

- **Two shows per cycle per discipline and per breed conformation class.**
- **Two entries per stable per show**, and **the same horse may not enter both shows** in a cycle.
- **A three-rank progression: Novice / Open / Champion**, tracked **independently per class type** — Open in barrel racing while still Novice in Quarter Horse conformation.
- **Graduation is points-based**, and the operator offered an equivalent compound rule as an alternative: *"at least four ribbons 1-3 place and at least one must be 1st."* Points, tuned so that rule is roughly what it takes, is the implementation to aim at.
- **NPC horses carry ranks and fill the classes properly** — *"let the npcs compete like real players."* The operator's own sizing: three player stables, three breeds, realistically four class types in play per day, nine NPC stables showing.

### 7.5a Classes are created on demand, not on a calendar (stage 4)

**Decided in conversation, 2026-08-05, before stage 4 was built.** The operator's question was *"why not wait to create classes until a user expresses interest in entering one instead of doing them automatically every day like currently?"* — and §7.6 below had already asked for exactly that in one clause. This section is that clause spelled out.

**The decision: a class exists because somebody entered a horse in it.** `createDueShows` stops minting the whole catalogue on a fixed calendar; a class is minted by a player action and is visible to everyone the moment it exists, accepting entries from anyone else until it is judged.

**The flow is "enter this horse", not "find a show".** The operator's follow-up caught a real hole in the first sketch of this — *"how do you know if they want to show in conformation or jumping though?"* A mature horse is eligible for its breed conformation class plus most of the six disciplines, so a picker is genuinely required and the flow does not collapse to one click. What the bundling actually buys is narrower, and still worth having:

- the **rank is decided by the horse's own rank in that class type**, so there is no Novice/Open/Champion menu for a child to understand;
- **creation is rate-limited by whatever the entry already costs** (`ACTION_COSTS.enter_show`), with no separate budget for minting;
- **a double-click cannot mint an empty show**, because there is no way to create one without an entry landing in it.

**The picker is built from the catalogue, not from the rows that exist.** Today the class list on `/shows/:id` *is* the discipline picker; with nothing pre-minted there is no list to pick from, so the horse page's existing "Enter in a show" card (`buildEnterShowInfos`, `src/routes/horses.ts`) becomes the door, built from the `disciplines` rows plus the breeds carrying an `ideal_vector` plus the two young-horse class types. This is an improvement rather than a cost, because the catalogue can be filtered by what *this horse* can do before the list is ever drawn — a three-year-old sees only Flat Racing (`min_age_game_days` 720, against Dressage and Show Jumping at 1440 and Endurance at 1800), a non-gaited horse never sees Gaited Pleasure, a Quarter Horse never sees Arabian Conformation. Today the child scrolls all 40 classes and is refused on most of them after clicking.

Each row states which of the two things pressing it does — joining something live, or starting something new:

```
Show Jumping   3 entered · judged in 6 days                      [Enter]
Dressage       nobody yet · starts a show, judged in 14 days     [Enter]
Endurance      Comet is too young (5 years)
```

**Join before minting.** A request **joins an open class of that type if one exists and the stable has room in it**; it mints only when there is none, or when this stable already holds its `max_entries_per_stable` in the live one. This is the load-bearing rule and the reason to prefer it over minting per request: three children each asking for a dressage show on different days would otherwise get three shows of one entry apiece topped up with NPCs, and the sibling rivalry — which is most of the point — quietly disappears. §1.3's complaint was that *one stable's* horses collide, not that the family should stop meeting. Note that this makes §7.5's first two bullets **emergent rather than separately built**: a second show appears exactly when a stable wants a third entry, which is "two shows per cycle, two entries per stable" without a cycle counter anywhere.

**"Cycle" stops existing, and one rule has to be restated.** Once a deadline is measured from the moment of creation, there is no shared calendar for §7.5's *"the same horse may not enter both shows in a cycle"* to attach to. Restate it as **"a horse may not be in two open classes of the same class type at once"** — cleaner, enforceable at entry time with no calendar, and already close to what `checkHorseEligibilityForClass`'s `alreadyEntered` check does within a single class.

**Order the picker by the horse's record; never filter it.** Once a horse has ribbons, sort its eligible class types by where it has placed well — but show every eligible one regardless. That is the precedent the Breed page's outside-stallion picker already set (CLAUDE.md §10, the Market row: *"ordering only, never filtering"*), and it matters more here: a child discovering that her barrel horse is secretly a dressage horse is the good outcome, and a filter would hide it.

**`disciplines.teaching_text` is already written for this picker.** Every discipline row carries a sentence saying what it rewards (*"Rewards a horse with real scope over a jump, the trainability to read a line…"*). That is the answer for a child who does not know whether her horse is a jumper, and it means the picker teaches rather than just lists. It has never been shown at the point of choosing before.

**NPC stables never request a class.** They stay top-up-only, exactly as `judgeOneClass` already tops up at judging time. §7.5's *"let the npcs compete like real players"* must not be read as letting them mint — nine NPC stables requesting would put the whole catalogue straight back. **The world only creates a class when a person asks.**

**The idempotency guarantee has to be replaced, not dropped.** Today it comes from `UNIQUE(scheduled_game_day, tier)` on `shows`, which is what makes a re-fired tick safe (CLAUDE.md §5.4). A user-triggered `POST` needs its own: a **partial unique index on the open classes** — `(class_type, discipline_code, breed_id, ability_trait_code, age_band, rank) WHERE status = 'entries_open'`. SQLite supports partial unique indexes, and this is the direct replacement for the guarantee being given up.

**Two entry points, one mechanism.** `/shows` stops being the only door, not the only screen: it becomes open classes accepting entries plus recent results, and entering from there still works unchanged for joining something live — same `enterHorseInClass`, exactly the pet home's two-entry-points-one-price shape (CLAUDE.md §10). The horse page is where a class gets **created**; the show page is where one gets **joined**.

**Keep a way back.** A `show_auto_create_enabled` config key, defaulted off, leaving `createDueShows` in place behind it — so the calendar can be switched back on from `/admin/config` without a deploy if an empty show page turns out to read as a broken game to the children. Cheap insurance for an operator with no terminal.

#### 7.5a.1 Fix `buildEnterShowInfos` — required, and do it first

**This is a real defect on a live screen, not a consequence of stage 4, and it should be fixed whether or not the rest of §7.5a is ever built.** It is listed here because §7.5a rebuilds the same function and a session that fixes it in passing will get it right by accident; a session that does not will carry the bug into the new picker.

`buildEnterShowInfos` (`src/routes/horses.ts`) calls `checkHorseEligibilityForClass` **once per open class, every time a horse page is drawn.** That function is four queries deep, so at stage 3's 40 classes a single horse page costs roughly **160 D1 round trips**. It was ~56 before stage 3 tripled the catalogue, and stage 4 would take it past 500. This is the screen the children use most.

The fix is a refactor of the loop, not a change to any rule — **every eligibility answer stays exactly what it is today.** Of the four queries `checkHorseEligibilityForClass` makes, two do not depend on the class at all:

- `isBarredFromShowing(env, horseId, genotype, gameDay)` and `acquiredBarringFlags(env, horseId)` take **only the horse**. Hoist both out of the loop and compute them **once per page**: 80 round trips become 2.
- `getEntryByClassAndHorse` and `countStableEntriesInClass` are genuinely per-class, but both batch trivially across the whole class list — "which of these class ids does this horse already have an entry in" is one query, and "how many entries does this stable hold in each of these classes" is one grouped query: another 80 become 2.

Everything left in `checkEligibility` is already pure — breed, cross, age, sex, gait, availability, and the class's own restrictions — so **the whole card lands at about 4 queries regardless of how large the catalogue grows.** That is what makes stage 4's class count stop mattering to this screen, which is the property worth having, not the constant factor.

Two details not to lose while doing it:

- `checkHorseEligibilityForClass` is also called by `judgeOneClass`'s NPC top-up, where it is the dominant cost of the whole tick (§7.6). **Do not change its signature in a way that leaves that caller behind** — the same hoist-and-batch shape is what the top-up loop needs too, per NPC horse rather than per class. Prefer adding a batched sibling over rewriting the single-horse function, so the two call sites can converge rather than drift into two eligibility paths. CLAUDE.md §13's no-second-scoring-path rule is the same instinct applied to scoring, and it applies here.
- The per-class work is not only queries. `checkHorseEligibilityForClass` also runs `parseGenotype` and `expressPhenotype` on every iteration — and `expressPhenotype` folds all thirteen colour/pattern loci (slice 0021). At 40 classes that is 40 full phenotype expressions per page render against a 10ms CPU budget. Both depend only on the horse, so **they hoist out with the other two.**

**Two things the operator still has to decide:**

1. **How long an on-demand class runs before judging.** The existing 30 days (`show_entry_window_game_days`) exists *because* shows sit on a calendar and everyone needs notice; on demand the creator already knows, so the window can shrink. **Recommendation: 7-14 days.** This is the same child from §1.2 who has already said that waiting six weeks does not work, and "on demand" that takes a game month will not feel on-demand.
2. **Whether the two-shows/three-ranks multiplier applies to young-horse classes at all.** §7.3 already rules their ribbons out of adult progression, which is an argument that it should not.

### 7.6 The thing to watch in stage 4

**The original note, kept because its instruction was right:** two shows × three ranks × fourteen class types is 84 classes a cycle before young-horse classes, and judging happens inside one scheduled invocation against a 10ms CPU ceiling on the free tier. **Create classes only where an entry can actually exist** rather than minting all 84. If that is not enough, this is the stage that justifies the $5/month Workers tier — CLAUDE.md §3 anticipates exactly this, and the instruction there is to move tiers rather than contort the design.

**Stage 3 already sits at 40 classes a cycle** (8 breed + 6 discipline + 16 young_conformation + 10 ability_test), created and judged the same way stage 1's single-class-per-breed always was — no CPU trouble observed building it, but stage 4's own multiplier lands on top of this number, not a smaller one. Adult classes at two shows × three ranks is 84; young-horse classes at two shows is another 52; **the real stage-4 figure is about 136 classes a cycle, not 84.**

**The diagnosis in that first paragraph is wrong about where the cost is, though, and §7.5a should not be justified on it.** Measured against the code as it stands:

- An **empty** class costs **2 D1 round trips** to judge (fetch entries, find none, close it out — `judgeOneClass`'s `allHorseIds.length === 0` branch). At 136 classes with a handful entered, that is roughly 260 wasted round trips a cycle. Real, but the cheap part.
- A **non-empty** class runs the NPC top-up, which calls `checkHorseEligibilityForClass` **once per NPC horse in the game** — and that function is **4 round trips each** (`getEntryByClassAndHorse`, `countStableEntriesInClass`, `isBarredFromShowing`, `acquiredBarringFlags`). With nine NPC stables' stock this dominates everything else in the stage by a wide margin.

A class only becomes non-empty because somebody entered it, and it would be judged either way — so **on-demand creation removes the cheap waste and does not touch the expensive loop.** If stage 4 needs the paid tier, it will need it for the top-up loop, and that loop wants batching (one query for every candidate's barring flags, not four per horse) far more than it wants fewer classes. Build §7.5a for the screen it fixes, not for the milliseconds.

**The same loop is already costing a page view, not just a tick.** `buildEnterShowInfos` calls the same `checkHorseEligibilityForClass` once per open class **every time a horse page is drawn** — ~160 D1 round trips at stage 3's 40 classes, on the screen the children use most, live today. **This is a defect independent of stage 4 and §7.5a.1 specifies the fix**; it is required work, it is small, and it should be done first, because §7.5a rebuilds that same function and would otherwise carry the bug into the new picker. The tick's top-up loop wants the identical hoist-and-batch treatment — see the first bullet at the end of §7.5a.1 for why the two should converge rather than grow a second eligibility path.

**Worth confirming before building stage 4:** Workers' **subrequest** limit (50 on the free tier, 1000 on paid), which D1 binding calls count against. The tick may well hit that ceiling before it hits the 10ms CPU one, and if so it is the number that actually decides the tier question.

---

## 8. Numbers that want checking against real play

Every one of these is a first guess:

| Key | Seeded | What to watch |
|---|---|---|
| `difficulty_gentle_incident_rate` / `_bad_outcome` | 0.35 / 0.3 | Whether the youngest two stop losing horses faster than they can enjoy them. `/admin/incidents` shows the real outcome split. |
| `difficulty_realistic_incident_rate` / `_bad_outcome` | 1.35 / 1.25 | Whether it bites enough to be worth choosing. |
| `evaluation_cost` | 200 | Low on purpose. A full breeding preview needs both parents known, so this is paid twice. |
| `evaluation_max_spread_bands` | 2 | How useless a weanling verdict feels. Drop to 1 if "Weak to Outstanding" reads as no answer at all. |
| `evaluation_certain_age_years` | 3 | Matches the age a horse could have shown for itself and earned the same words free. |
| `upkeep_free_until_age_game_days` | 360 | One game year. Watch whether balances now drift up while a crop of foals is growing. |
| `time_warp_cost` | 400 | The one number the children will push on hardest. Too cheap and nobody ever waits; too dear and the ten-year-old is back where she started. |
| `young_horse_yearling_min_age_game_days` | 360 | Not really a guess about the number itself (it's exactly one game year) - watch whether a one-year-old's conformation has realised enough for the class to feel meaningful rather than noisy (`conformation_realization_at_birth`/`conformation_maturity_years` govern that curve). |
| `young_horse_two_year_old_min_age_game_days` | 720 | Same watch as above, one band up. |
| `time_warp_game_days` | 180 | Six months a purchase, so a newborn is six turns and 2,400 from grown. |
| `show_entry_window_game_days` (stage 4) | 30 today, **undecided** | How long an on-demand class runs before judging (§7.5a). The 30 exists because shows sit on a calendar and need announcing; on demand, 7-14 is the recommendation. The child in §1.2 has already said six weeks of waiting does not work. |
| `show_auto_create_enabled` (stage 4) | off | The way back to the calendar if an empty show page reads as a broken game (§7.5a). Watch whether the children find the "Enter in a show" card on their own, or wait at `/shows` for something to appear. |
