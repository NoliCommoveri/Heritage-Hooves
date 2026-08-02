# Slice 0011 — Ageing, death, and removal: horses get old, and horses leave

**Read `CLAUDE.md` completely first. Then read this document. Do not read the full design documents unless a section below tells you to.**

The sections you *are* asked to read, because this slice depends on them and paraphrasing them here would lose the reasoning:

- `docs/horse-game-overview.md` **§7a** (death and removal — the whole section, it is short), and **§6** (the time scale, because every number in this document is meaningless without it).
- `docs/horse-game-schema.md` **§4.2** (death and removal). This slice **departs from two of its recommendations**, and §5.5 below says why. Read it so you can judge the argument rather than take it.

Everything else you need is below.

Slice 0010 already kills horses — a GBED foal is born, lives thirty game days, and dies. That machinery is the pattern this slice generalises: a death day snapshotted onto the horse, a tick stage that compares it against the world clock, and a status column that is its own idempotency marker. **Read `src/db/health.ts`'s `killDueLethalFoals` before writing anything.** What is new here is that death now has an ordinary cause, arrives announced, and has a voluntary counterpart.

The reason to build this now rather than later, in the overview's own words: *a herd that has never lost anything is a herd whose owners will experience the first loss as a bug.*

---

## 1. What "done" looks like

Ten things a person can do in a browser, in order. If all ten work, the slice is built.

1. Open any horse's page and see its age as it always was — nothing changes for a four-year-old. Open the oldest horse in the game and see a quiet **Veteran** marker beside its age, with a sentence explaining that it is past eighteen and in the last part of its working life.
2. From `/admin/ageing`, bring one horse's end forward. Tick once. That horse's page now carries a **Failing** marker and a plain-English paragraph: it is nearing the end, it can still be shown and still be bred, and there is no treatment. The barn list shows the same marker.
3. `/stables` shows a new "While you were away" entry saying so, in the same voice as the foaling notices. The child did not have to be looking at the barn to find out.
4. Enter that horse in a show anyway. It is accepted, it competes, it scores no differently than it did last month. A last season is a real option.
5. Tick until its day arrives. The horse dies. A second event explains it kindly, names how many foals it leaves behind, and does not read like a punishment.
6. The barn list still shows it, marked **Died**, for a few days of play. Its page still works: pedigree, show record, genotype, picture, everything. It is gone from the breeding screen, from show entry, and from the upkeep bill.
7. A week of play later it has dropped out of the barn list. `/stables/:id/past` — a new page linked from the barn — still lists it, with the day it was born and the day it ended.
8. Take a healthy horse you do not want and press **Retire away**. A confirmation page names the horse, says plainly that this cannot be undone, warns you if she is in foal, and tells you her pedigree survives for her foals. Confirm. She leaves the barn, the stable is one under capacity, and no turn was spent.
9. Retire away a mare who is in foal, or let one die in foal. The pregnancy ends with her — the tick does not later produce a foal from a mare who is gone.
10. Open `/admin/shows` and see the NPC show barn's headcount, its oldest horses, and a warning when it has aged below its target size. Restocking it is the same button it always was.

---

## 2. Decisions taken for this slice

Four, taken in conversation on 2 Aug 2026 while writing this document. The first closes a question `docs/horse-game-overview.md` §14 explicitly left open and asks the implementing session not to assume.

### 2.1 Death arrives announced

**Decided.** §14 asked whether visible decline should precede death, or whether an unannounced end is truer. Announced, with a visible late phase.

Past a threshold on its own remaining life — not on its age — a horse enters a **Failing** state, shown on its page, in the barn list, and **in the events feed**. It stays there for roughly a game year and a half before it dies. The child can plan a last show season and retire the horse deliberately rather than finding it gone.

Three things decided the argument:

- **§7a asks for exactly this** and calls it kinder and closer to true: *an ageing horse showing signs gives a child the chance to plan a last season and retire deliberately.*
- **The GBED foal is already the unannounced case.** Slice 0010 §2.2 arranged deliberately for that death to arrive with no warning, because the silence is the biology and the lesson. If ordinary old age were also silent, silence would be the game's only mode of loss, and the GBED foal's silence would stop meaning anything.
- **The notice has to reach the feed, not just the page.** A warning that only exists on a screen nobody opened is not a warning. This is why §7.2 below makes it an event, and why the event fires once and is marked as fired.

**The failing state has no mechanical effect in this slice.** It does not lower show scores, does not lower fertility, does not raise upkeep. See §3.2.

### 2.2 Voluntary removal is built here, alongside death

**Decided.** §7a calls removal the pruning mechanism, and it is right: without a voluntary exit, stable capacity is a wall rather than a decision, and the tables grow without bound. It also shares every line of the exit path with death — the same status column, the same pregnancy cancellation, the same disappearance from the breeding screen — so building it here costs almost nothing and bolting it on later would mean touching all of it twice.

**It is called "retire away"**, not "sell", not "cull", not "delete". The horse goes to a home elsewhere. §7a: *whatever it is called, it should not be grim, and it should read as a normal part of running a stable rather than a punishment.*

**No money changes hands** (§3.3), **no turn is spent** (§6.4), and **it cannot be undone** (§6.3).

### 2.3 NPC show-barn horses age and die on the same code path

**Decided.** CLAUDE.md §13 holds this line firmly and this slice does not bend it: *no parallel scoring path for NPC horses.* The same applies to ageing. A barn horse gets a lifespan at creation like any other horse, ages like any other horse, and dies on the same tick stage.

**The cost is real and the slice pays it visibly rather than quietly.** The show barn is stocked at a fixed size and will thin out on its own over months of play, and thin show fields are exactly the failure the barn exists to prevent. So `/admin/shows` gains a headcount, the barn's oldest horses, and a warning when it drops below `npc_show_barn_size` (§8.2). The operator restocks with the button that already exists. What must not happen is show fields quietly shrinking for a reason nobody can see.

### 2.4 Lifespan is mildly compressed, and is rolled once at birth

**Decided.** Risk begins around eighteen game years and few horses pass twenty-seven — close enough to real that nothing reads as wrong, and consistent with the fertility curves already built (`mare_fertility_age_knots` has mares at 0.30 by twenty-five, which would be strange if mares routinely lived to thirty-five).

At the current settings — 10 game days a tick, three slots a day, 360 game days a year — **one game year is about twelve real days**, and the oldest founding horse is eight. So the first old-age death lands roughly four to five real months into play. That is long enough that loss is not a drumbeat and soon enough that the rules get tested under actual play rather than a year later.

**The mechanism is a lifespan rolled once and stored, not a hazard roll every tick.** This is §4.1, and it is the single most important implementation decision in the slice.

---

## 3. Not built here

Say so plainly in the summary if you build any of these anyway.

### 3.1 No death from anything but old age and the existing lethal condition
No injury, no colic, no illness, no accident, no foaling death for the mare. Every one of those wants a care state or a veterinary system to sit against, and neither exists. `horses.end_reason` gains exactly one new value in this slice (`old_age`) plus removal's (`retired_away`), and the condition codes slice 0010 already writes are untouched.

### 3.2 No performance decline, no fertility penalty, and no upkeep change from age
A failing horse scores exactly what it would have scored the month before. This is deliberate scope control, not an oversight:

- **Fertility already declines with age**, through `mare_fertility_age_knots` / `stallion_fertility_age_knots` built in slice 0003. Adding a second, overlapping age penalty would double-count the one thing that is already modelled, and it would be invisible which of the two was doing the work.
- **Conformation realization already tops out at maturity**, and the show scorer is tuned against that curve. A decline multiplier would retune every class in the game as a side effect of a slice that is supposed to be about death.
- **§7a's ask is visibility, not penalty.** A last season is only a meaningful choice if the horse can still win it.

A decline multiplier is the natural first addition at the care and tack stage, where there is already a ±5% band for it to live in and something to tune it against. Not before.

**Slice 0012 confirms this rather than complicating it.** Discipline classes (barrel racing and, later, the other five) follow the same rule explicitly - a Failing horse enters and competes at full expression there too (slice 0012 §5.4). Both scorers finish with the same multiplicative modifier line (`careModifier`/`tackModifier`/`trainingFactor`, all pinned at 1.0 today), so a decline-with-age multiplier built here would apply to conformation and discipline classes alike through that one shared line, with no change to either scorer's formula. Worth building once, not twice.

### 3.3 No money on removal, and no sale
"Placed with a distant buyer" is flavour; a payout would be a money faucet with no market behind it to price it, and pruning a herd for cash is not the decision §7a wants players making. Selling a horse to another stable belongs to the market stage, which owns pricing, listings and transfer. This slice's exit is free and one-way.

### 3.4 No gelding, no retirement-from-breeding flag
`horses.is_retired` and `fertility_state` from the schema sketch stay unbuilt. Retiring a mare from breeding is a decision with no consequence yet — nothing forces a mare to be bred — and gelding is a care/vet action. The fertility curve is the only retirement the game has, and it is enough for now.

### 3.5 No memorial page beyond the plain one
`/stables/:id/past` is a list. A horse that has died keeps its ordinary horse page, unchanged. Do not build a special layout, a tribute card, or a "remembered" section. The horse page already shows a pedigree, a show record and a picture, which is what a memorial would have contained anyway.

### 3.6 No hall of fame, no registries
`horse_show_summary` is retained permanently and is already the table a registry would read (slice 0008 §5.6). Nothing in this slice reads it beyond the horse page's existing card. The registries stage owns that.

### 3.7 No pruning of heavy columns, because there are none yet
Schema §4.2 lists `care`, `phenotype_cache` and `notes` as columns to clear on death. **None of those three columns exists.** Do not add them in order to clear them. What §5.5 below actually does about §4.2 is a shorter list than the schema document expects, and deliberately so.

---

## 4. The model

### 4.1 A lifespan rolled once and snapshotted, not a hazard rolled every tick

**Every horse carries `natural_death_game_day`: the day old age takes it, decided once and stored.** The tick kills every living horse whose day has arrived.

This is the same shape as slice 0010's lethal foal — `horse_conditions.terminal_game_day`, compared with `<=` against the world clock — and it is chosen for the same reasons, which are worth stating because the alternative is more obvious and worse:

- **CLAUDE.md §5.4, idempotency.** A stored day compared with `<=` cannot double-advance. A re-fired tick finds the horse already dead and the `status = 'alive'` guard makes the update a no-op; a *missed* tick catches up on the next one, because the comparison is against a day rather than an increment. A per-tick hazard roll has neither property: re-firing rolls again, and a missed tick silently spares every horse in the game for one tick.
- **CLAUDE.md §5.5, snapshotting.** Retuning the lifespan numbers must never move the death date of a horse already alive. With a stored day that is automatic. With live config in a per-tick roll it is impossible.
- **CLAUDE.md §5.2, reproducibility.** The draw comes from the horse's own `rng_seed`, once. Anything that goes wrong is reproducible from a stored value — and this matters more here than anywhere else in the game, because the outcome is the death of a child's horse.
- **The announcement falls out for free.** "Failing" is `game_day >= natural_death_game_day - frailty_window`. No second column, no state machine, no onset roll. §2.1's whole feature is one comparison.

**The cost, stated plainly:** the day is fixed at birth, so nothing a player does can extend a horse's life. That is a real limitation and a future care system will want to lift it. **It is liftable** — `natural_death_game_day` is an ordinary nullable column, and a care stage that wants excellent management to buy a horse another year adds days to it. What it must never do is re-roll it from scratch, which would make a horse's death date depend on when you last looked at it.

### 4.2 The draw

`src/engines/ageing/lifespan.ts` — a pure function, no DB access, per CLAUDE.md §5.1:

```
rollLifespanGameDays(rng, config) -> integer
```

A normal draw (`rng.normal`, which already exists) around `lifespan_mean_game_days`, spread by `lifespan_sd_game_days`, clamped to `[lifespan_min_game_days, lifespan_max_game_days]`, rounded to a whole day.

Starting numbers, in game days, with their meaning in game years beside them:

| Config value | Days | Years |
|---|---|---|
| `lifespan_mean_game_days` | 8280 | 23 |
| `lifespan_sd_game_days` | 1260 | 3.5 |
| `lifespan_min_game_days` | 5040 | 14 |
| `lifespan_max_game_days` | 11880 | 33 |

Which produces, roughly: about one horse in thirteen dies before eighteen, about one in eight passes twenty-seven, about one in forty passes thirty. Most horses die somewhere in their early to mid twenties. That is §2.4's shape.

**The clamps are not decoration.** A normal draw has tails, and without a floor an unlucky roll produces a foal that dies at four, which is not old age and would read as a bug. Fourteen is the youngest the game will call "old age", and if that ever needs to happen for another reason it needs its own `end_reason`, not this one.

The seed: `deriveSeed(horse.rng_seed, 'lifespan')`. A new label, so it is independent of every stream that already exists and disturbs none of them (§9).

### 4.3 The age states

Also in `src/engines/ageing/lifespan.ts`, pure:

```
ageState({ bornGameDay, naturalDeathGameDay, status }, gameDay, config) -> 'young' | 'adult' | 'veteran' | 'failing' | 'ended'
```

- **`ended`** — `status` is not `'alive'`. Checked first; a dead horse is never described as failing.
- **`failing`** — `natural_death_game_day - gameDay <= frailty_window_game_days`. About its own remaining life, not its age. A horse that drew a short lifespan starts failing young, and that is correct and true.
- **`veteran`** — age at least `veteran_age_game_days`. About its age, not its remaining life. Honest and impersonal: this horse is old, which everyone can see, as distinct from this horse is going, which is the other thing.
- **`young`** — below `min_breeding_age_game_days`, the threshold the game already uses for "not yet grown". Reuse it rather than inventing a second one.
- **`adult`** — everything else.

`veteran` and `failing` are the only two that render anything new. `young` and `adult` exist so the function is total and so a later slice has somewhere to hang a care modifier.

**A null `natural_death_game_day` never reads as `failing`.** Until the tick has assigned one (§7.1) the horse is `adult` or `veteran` on age alone. Every horse alive today is in that state until the first tick after this slice deploys, and nothing about that should look broken on screen.

### 4.4 The numbers, and why these

| Config value | Days | Meaning |
|---|---|---|
| `frailty_window_game_days` | 540 | 1.5 game years ≈ 18 real days ≈ 18 monthly shows |
| `veteran_age_game_days` | 6480 | 18 game years |
| `barn_shows_ended_game_days` | 180 | 6 real days a dead horse stays in the barn list |

**The frailty window is set by the same reasoning slice 0010 §2.2 used for the thirty-day GBED window, and it is worth reading that passage before changing this number.** The window has to be long enough that the announcement spans a login gap and leaves room for an actual last season. Shows run every thirty game days, so 540 is eighteen more chances to compete — generous, and generous is right the first time, because a window that turns out too long is a tuning note and a window that turns out too short means a child was told and then it was over.

**Eighteen for veteran** is a plain fact about the horse rather than a prediction, which is why it is a fixed age and not a fraction of the lifespan. It sits below the shortest lifespan the clamp allows minus the frailty window (14 − 1.5 = 12.5), so a horse can in principle be failing before it is a veteran. That reads fine — "old" and "going" are different statements and this game is willing to make the second without the first.

---

## 5. Data

Three migrations. Next free number is **0058** — check `migrations/` yourself rather than trusting this line (CLAUDE.md §9), and remember each file also needs registering in `src/db/migrations.ts` (§8).

### 5.1 `horses` gains two columns and one index

```sql
ALTER TABLE horses ADD COLUMN natural_death_game_day INTEGER;
ALTER TABLE horses ADD COLUMN frailty_notice_game_day INTEGER;
CREATE INDEX idx_horses_natural_death ON horses (natural_death_game_day) WHERE status = 'alive';
```

- **`natural_death_game_day`** — the day old age takes this horse. Null means not yet assigned (§7.1 assigns it). **Never rendered to a player, in any form, ever.** Not as a date, not as "about two years left", not on an admin page a child could reach. The failing marker is the only thing a player learns from it, and it is deliberately vague.
- **`frailty_notice_game_day`** — the day the failing notice fired, null until it has. This is the notice's idempotency marker and its only purpose (§7.2). Not rendered anywhere.
- **The partial index** is what makes the tick's two selection queries cheap, and it is partial because both only ever ask about living horses. Say that in the migration comment — CLAUDE.md §7 asks for the reason an index exists to be written down where the index is.

### 5.2 `coverings` and `pregnancies` gain cancellation

One migration, because cancelling a breeding record is one logical change even though it touches two tables (CLAUDE.md §8 — the rule is one logical change per file, not one table per file).

```sql
ALTER TABLE coverings   ADD COLUMN cancelled_game_day INTEGER;
ALTER TABLE coverings   ADD COLUMN cancelled_reason TEXT;
ALTER TABLE pregnancies ADD COLUMN cancelled_game_day INTEGER;
ALTER TABLE pregnancies ADD COLUMN cancelled_reason TEXT;
```

**A row is live when its `status` says so AND `cancelled_game_day IS NULL`.** Both halves, every time. Write that sentence in the migration comment and again beside each query it governs, because it is a two-part condition and the second part is easy to forget.

`cancelled_reason` is a short code: `'dam_died'`, `'sire_died'`, `'dam_removed'`, `'sire_removed'`.

**Why a column and not a new `status` value.** SQLite cannot alter a `CHECK` constraint; widening `status` means rebuilding both tables (create, copy, drop, rename). That is a real risk in front of an operator who cannot recover from a bad migration, for a rare event, and it buys only tidiness. An additive column is boring and safe, which is the standing preference. A future slice that rebuilds either table for its own reasons is welcome to fold the state in properly then.

**Both due-queries must gain `AND cancelled_game_day IS NULL`**: `resolveDueCoverings` in `src/db/coverings.ts` and `foalDuePregnancies` in `src/db/pregnancies.ts`. This is the single easiest thing in the slice to miss, and missing it means a dead mare's foal is born weeks after she is gone. Both have partial indexes on `status`; those still apply, and the extra condition is a filter on a handful of rows.

### 5.3 Config

Seven new values in the existing single-row config, in one migration, following the `json_set` pattern the other config migrations use.

| Value | Default | Live or snapshotted |
|---|---|---|
| `lifespan_mean_game_days` | 8280 | Read once, at creation. Snapshotted onto `horses.natural_death_game_day` |
| `lifespan_sd_game_days` | 1260 | Same |
| `lifespan_min_game_days` | 5040 | Same |
| `lifespan_max_game_days` | 11880 | Same |
| `frailty_window_game_days` | 540 | **Live** |
| `veteran_age_game_days` | 6480 | **Live** |
| `barn_shows_ended_game_days` | 180 | **Live** |

**The four lifespan values are snapshotted and the three display values are live, and the split is the point of CLAUDE.md §5.5.** Changing a lifespan number must never move the death date of a horse already alive — hence the snapshot. Changing the frailty window only changes who currently reads as failing and when the notice fires next; it moves no death date, so live is correct and simpler. Note the one visible consequence, in the migration comment: shortening the frailty window can mean a horse that has already been announced as failing stops reading that way. That is odd but harmless, and it is not worth a column to prevent.

`/admin/config` gets all seven, with the split noted beside them (§8.3).

### 5.4 What is *not* added

- **No new table.** Schema §12's build-order table says *Ageing and death — no new tables*, and that holds. Two columns on `horses`, four on the breeding tables.
- **No `horses.is_retired`, no `fertility_state`** (§3.4).
- **No `care`, `phenotype_cache` or `notes`** (§3.7). Do not add a column in order to clear it.

### 5.5 What is kept on death — and where this departs from the schema document

Schema §4.2 says: *on death or removal, clear `care`, `phenotype_cache`, `notes`, `image_url`; delete the horse's rows in `horse_training`, `horse_tack`, `service_calls`, `show_entries`.*

**Of that list, this slice clears nothing and deletes nothing.** Three of the columns and three of the tables do not exist. The two items that do exist are both declined, with reasons:

**`image_url` is kept.** It is a short root-relative path, a few dozen bytes, and clearing it saves nothing measurable. What it costs is the picture of a child's horse the week it died. The schema document's argument for clearing is storage, and the storage argument does not survive contact with the actual column. **State this in your summary** and correct schema §4.2 (§12).

**`show_entries` are kept, and this one matters more than it looks.** Deleting a dead horse's entries would retroactively falsify every show it ever competed in: a class judged eight-strong would render six-strong, placings would have gaps, and `/shows/:id/entries/:entryId` — the screen slice 0008 built specifically so a child can ask why their horse placed fourth — would 404 for a result that did happen. A game's own history rewriting itself when an unrelated horse dies is a worse outcome than the storage it saves, at a scale of five players and a few thousand rows.

**This does not make `horse_show_summary` pointless.** Migration 0039's comment explains why it exists — a show record that vanished with the horse would make a future hall of fame meaningless — and that reasoning still stands for any *later* stage that does prune. What this slice establishes is that pruning is not needed yet, and should be a deliberate, discussed retention job when it is, rather than a side effect of a horse dying (CLAUDE.md §7's rule about append-only tables is the same instinct).

**What is kept, then, is everything.** Identity, sex, breed, dates, parents, genotype, COI, composition, picture, pedigree rows, show entries, show summary, knowledge rows, condition rows. A dead horse is a horse that stopped, not a horse that was partly erased.

**What is ended** is the horse's participation: pregnancies and coverings cancelled (§5.2), future show entries withdrawn (§7.4), out of the breeding screen, out of the upkeep bill, out of the barn list after a while.

---

## 6. Removal, precisely

### 6.1 The route

`/horses/:id/retire` — GET renders the confirmation, POST performs it. Owner-only, exactly as `/horses/:id/image` and `/horses/:id/test` already are; reuse whatever ownership check those use rather than writing a third one. A horse that is already dead or removed 404s or redirects back to its page — do not render a retire button for it.

### 6.2 The confirmation page

A confirmation page, not a JavaScript dialogue. It must contain, in this order:

1. The horse's name, its age, and its picture if it has one. The player must see which horse this is.
2. **"This cannot be undone."** In those words or close to them.
3. What survives: *Her pedigree stays. Any foals she has had keep their family tree, and her show record stays on her page.* This is the sentence that makes removal feel like pruning rather than deletion, and it is true.
4. **If she is in foal, or has a booked covering: a warning naming it.** *Juniper is in foal, due in about forty days. Retiring her away ends the pregnancy.* A child should never discover this afterwards.
5. **If she is entered in a show that has not been judged: a warning naming it**, and the entry is withdrawn on confirm (§7.4).
6. A button that says what it does — **Retire Juniper away** — and a Cancel link back to the horse page.

### 6.3 It is one-way

`status = 'removed'`, `end_reason = 'retired_away'`, `ended_game_day = ` the current game day. There is no un-retire, no admin undo, and no grace period. Do not build one. A reversible removal is not a decision, and the whole point of §7a's exit is that it is a decision. If a child retires a horse in error, that is a conversation with a parent and an admin who can create a horse, not a feature.

### 6.4 No turn, no money

**No turn.** Turns ration commitments — booking a covering, entering a show, claiming a batch. Charging a turn to reduce your own herd would put a price on the one action that relieves capacity pressure, which is backwards. `src/lib/actions.ts`'s comment listing future spends should not gain this one.

**No money** (§3.3).

### 6.5 Removal and death are the same exit

One function, in `src/db/ageing.ts`, taking the horse, the game day, the status and the reason, returning the statements that end a horse's participation: the `horses` update, the pregnancy and covering cancellations, the show-entry withdrawals. Death calls it from the tick; removal calls it from the route. **Do not write the pregnancy cancellation twice.** If you find yourself doing so, that is the signal the function has not been extracted properly.

---

## 7. The tick

### 7.1 Assigning lifespans

**New horses get a lifespan when they are created**, in every path that creates one: foaling, the founding claim, the admin founder form, the NPC show barn stocking, and import candidates if they materialise into horses. Roll it with `deriveSeed(rng_seed, 'lifespan')` and write `natural_death_game_day = born_game_day + rollLifespanGameDays(...)` in the same insert.

**Existing horses are backfilled by a tick stage, not by a migration.** The stage's first job each run: select living horses with a null `natural_death_game_day`, roll each one, write it. Idempotent by the null check — a horse that has one is never touched again.

**Why not a SQL backfill migration**, given `0021_backfill_cycle_anchor.sql` set that precedent: 0021 could compromise, because a cycle slot only needs to be deterministic and evenly spread, and `rng_seed % cycle_length` gives that. A lifespan needs a *distribution* — the whole of §2.4 is the shape of that curve — and SQLite has no normal draw. A uniform backfill would give the founding population a materially different curve from every horse born afterwards, in the one population where the first deaths will actually be observed. The tick stage is ten lines and gets it right.

**It also self-heals.** If a creation path is added later and forgets, the next tick assigns one. Say that in the function's comment so a future session does not "clean up" the redundancy.

### 7.2 The failing notice

Second job of the same stage. Select living horses where `frailty_notice_game_day IS NULL` and `natural_death_game_day - game_day <= frailty_window_game_days`, belonging to a stable with an `account_id` (the show barn's horses notify nobody — the events table has only ever had rows for player stables). For each: write a `horse_failing` event and set `frailty_notice_game_day`.

**The null check is the idempotency marker**, exactly as `horses.status` is for the death stage. A re-fired tick finds nothing; a missed tick catches up. No separate marker table, no counting of existing events.

**A horse whose window has already passed when this first runs still gets its notice**, because the condition is `<=` rather than an equality. That is right for the deploy day and right after any missed tick.

### 7.3 The death stage

Third job, or its own function — your call, but keep the ordering.

```
SELECT ... FROM horses WHERE status = 'alive' AND natural_death_game_day <= ?
```

For each: the shared exit path (§6.5) with `status = 'dead'`, `end_reason = 'old_age'`, and a `horse_died_old_age` event.

**Guarded by `status = 'alive'` on the update, as `killDueLethalFoals` already is.** Idempotency comes free from that guard and needs no marker column. Copy that function's comment on the point rather than re-deriving it.

### 7.4 Withdrawing future show entries

Part of the shared exit path. Delete the horse's `show_entries` rows **for classes that have not been judged yet**, and only those. A judged class is history and §5.5 keeps it.

Identify unjudged by the class's own status column, the same one `judgeDueShowClasses` reads — not by comparing dates. If the entry deletion drops a field below viability, nothing special happens: the field-filling stage tops it back up on the next tick, which is what it is for.

### 7.5 Where all of this goes in the tick order

In `src/db/tick.ts`, inside the existing `world.paused === 0` branch, **immediately after `killDueLethalFoals` and before `createDueShows`**:

```
resolveDueCoverings
foalDuePregnancies
killDueLethalFoals
assignLifespansAndNoticeFrailty   <- new
killDueOldHorses                  <- new
createDueShows
judgeDueShowClasses
chargeUpkeep
deleteOldEvents
```

Three orderings matter and each needs its comment:

- **After `foalDuePregnancies`.** A mare due to foal on the same tick she is due to die **foals first, and then dies.** The foal lives. This is deliberate and kind and it is not an accident of ordering — say so in the comment, so that a future session tidying the tick does not reverse it.
- **After `killDueLethalFoals`.** Both stages guard on `status = 'alive'`, so whichever runs first wins and the other is a no-op. A foal that is both GBED-terminal and at its natural end dies of GBED, which is the more specific and more useful `end_reason`.
- **Before `chargeUpkeep`.** A horse that dies this tick is not billed for board over a period it did not live. Slice 0010 already established this reasoning for the lethal stage; this is the same sentence.

### 7.6 Two new event kinds

`kind` is free text with no `CHECK` (migration 0048), so no migration is needed. Both payloads carry `"v":1` like every other kind.

```
horse_failing        -> {"v":1,"horse_name":"...","age_years":19,"sex":"mare"}
horse_died_old_age   -> {"v":1,"horse_name":"...","age_years":24,"sex":"mare","foals":6}
```

**`horse_died` stays as it is and keeps meaning "died of a condition".** Do not fold old age into it and branch on the payload — its render arm in `src/render/stables.ts` is written in the voice of a foal dying and would have to become a conditional to serve both. Two kinds, two wordings, no branch.

`foals` is a count of the horse's living and dead offspring, from `horses` by `sire_id`/`dam_id`. It is the sentence that makes the notice land: what the horse leaves behind.

### 7.7 The wording, drafted now rather than at the point of failure

Slice 0010 §5.6 drafted the GBED wording before one could fire, for the reason that wording written in a hurry after a child is already upset is worse wording. Same here. Draft these, tune them, and put them where the other event wordings live in `src/render/stables.ts`.

**`horse_failing`** — informative, unhurried, and specific about what is still possible:

> Juniper is nineteen now, and she is starting to slow down. She can still be shown and still be bred, and there is nothing that needs treating — this is just what getting old looks like. If there is a show you wanted her to have, this is the season for it.

**`horse_died_old_age`** — short, warm, no euphemism and no drama:

> Juniper died peacefully in her paddock at twenty-four, after a long life. She leaves six foals, and every one of them carries her line. Her page is still there whenever you want to look.

Both must survive an unnamed horse (`horseDisplayName` already handles that), a horse with no foals (drop the sentence rather than saying "she leaves zero foals"), and a gelding or stallion (the pronoun is on the payload's `sex` — the codebase already does this for foaling).

---

## 8. Where else it appears

### 8.1 Player screens

**The horse page** gains, beside the existing Sex / Age line, a **Veteran** or **Failing** marker for the two states that have one, using the existing `.badge-*` pills rather than a new vocabulary. `Failing` gets a short paragraph below it — the same content as the event, worded for a page rather than a feed. **Never a number of days, never a date.**

**The barn list** gains the same marker in the compact row, beside the existing Died badge. One word, no paragraph — that row is already crowded (slice 0010 §8 made the same point about not putting four test results in it).

**A dead or removed horse's page** hides every action: no Breed, no Enter in a show, no Test, no Choose a picture, no Retire away. It keeps everything that reads: pedigree, conformation, health, show record, picture. The status badge says Died or Retired away with the game day.

**The barn list drops a horse `barn_shows_ended_game_days` after it ended.** Extend `listStableHorsesWithDead` — which slice 0010 added for exactly this purpose — to take the cutoff, and note in its comment that removed horses are included on the same terms as dead ones. Every other caller still wants alive-only and must stay that way; that function's existing comment already warns about this and the warning is still correct.

**`/stables/:id/past`** — new, linked from the barn list ("Past horses"). Every ended horse the stable owned, newest first: name, sex, breed, born and ended game days, how it ended in plain words, and a link to its page. No pagination until there is something to paginate.

**The breeding screen, the show entry screen, and the image picker** need no change — all three call `listStableHorses`, which is alive-only, and all three re-check server-side.

### 8.2 `/admin/shows`

Per §2.3, the NPC show barn's ageing has to be visible or it is a mystery. Add to the existing page: the barn's living headcount against `npc_show_barn_size`, a warning line when it is below, and the barn's five oldest horses with their age states. The restock button is unchanged.

### 8.3 `/admin/config`

The seven values from §5.3, with a note beside the four lifespan ones saying they apply to horses created after the change and never move a death date already assigned — the same note `lethal_foal_death_game_days` already carries, for the same reason.

### 8.4 `/admin/ageing`

A new admin subpage in the existing subnav pattern. Read-only except for one control:

- **The oldest living horses in the game** — name, stable, age, state. This is how the operator sees the population's age structure, which is what tells them whether §2.4's numbers are producing the intended shape.
- **Deaths in the last N game days**, so the operator can see the rate rather than infer it.
- **One control: bring a chosen horse's end forward** to the current game day. This exists because §1's verification steps are otherwise four real months away, and because the precedent is already set — `/admin/breeding`'s force-twins control was added for exactly this reason.

**Flag this control's shape in your summary.** Overview §6b warns specifically about advancing an individual horse, and it is right to. This is narrower than that warning: it moves one horse's death date, not its age, so pedigree, COI, show eligibility and every age-derived number are untouched. It is still the one thing in this slice a future session might reasonably object to. Label it on the page as a testing control, and put it behind the same admin login everything else is behind.

### 8.5 `src/db/reset.ts`

**No change.** No new tables, so `HORSE_TABLES` and `WORLD_TABLES` are both correct as they stand. Check that this is still true when you are done — if you added a table after all, it needs a line there and a matching line in `test/reset.test.ts`'s `REFERENCES` map, which is the only thing standing between a wrong delete order and a failed reset in front of the children.

---

## 9. Seeds and reproducibility

**One new sub-seed label: `'lifespan'`.** Derived from the horse's own `rng_seed` via `deriveSeed`, which mixes the label in and is independent of every other label already in use. No new top-level seeds are minted and no existing stream changes shape.

`test/rng.test.ts`'s golden values must be untouched. If they fail, something changed the generator itself, and per CLAUDE.md §11 that is the game's stored history becoming unreproducible rather than a test to update.

**One thing to check by hand:** a horse created before and after this change, from the same seed, must produce the same genotype, the same environmental noise and the same cycle anchor. Adding a new `deriveSeed` label cannot disturb those — it is a separate derivation, not another draw from a shared stream — but confirm it rather than assuming it, because the failure would be silent and permanent.

---

## 10. Tests

`npm test` and `npx tsc --noEmit` both clean, plus:

**`test/ageing/lifespan.test.ts`**
- Many draws from the default config land inside the clamps, always.
- The mean and standard deviation of a large sample are within tolerance of the configured ones.
- The proportion under eighteen years and over twenty-seven years match §2.4's stated shape within tolerance. **This is the test that stops a future retune from silently changing the game's generational feel** — if someone changes the numbers, this test tells them what they changed.
- The same seed produces the same lifespan, twice.
- A configuration with `min == max` produces exactly that value and does not loop or throw.

**`test/ageing/state.test.ts`**
- Each of the five states, at its boundaries, both sides.
- A null `natural_death_game_day` never returns `failing`, at any age.
- A dead horse returns `ended` even when its numbers would otherwise say `failing`.
- A short-lifespan horse reads `failing` before it reads `veteran` (§4.4's accepted oddity — asserted so it is a decision rather than a surprise).

**`test/ageing/tick.test.ts`**
- The death query, run twice against the same game day, kills a horse once.
- A horse whose day passed several ticks ago dies on the next tick that runs (a missed tick catches up).
- The frailty notice fires once per horse, and running the stage again writes no second event.
- A mare due to foal and due to die on the same tick foals first, and the foal is alive afterwards. **This is the ordering test §7.5 exists for.**
- A dead mare's in-progress pregnancy does not foal on the next tick.
- A cancelled covering does not resolve.

**`test/ageing/removal.test.ts`**
- Retiring a horse away sets status, reason and ended day, and removes it from `listStableHorses` and from the alive count.
- Retiring a pregnant mare cancels the pregnancy, and the tick then produces no foal.
- Retiring a horse withdraws its entry in an unjudged class and **leaves its entries in judged classes untouched** (§5.5 — the one that would rewrite history if it were wrong).
- A non-owner cannot retire a horse, by route, not just by the button being absent.
- Retiring spends no turn.

---

## 11. Verifying it by hand

The ten steps in §1, against a live `wrangler dev --local` with every migration applied through `/admin/migrations` — not the CLI, because `/admin/migrations` is the path the operator has.

Steps 2 through 7 depend on `/admin/ageing`'s bring-forward control (§8.4); without it they are four real months away. Build that control first and use it, rather than editing the database by hand, because the operator has no way to edit the database by hand and the control is what they will be verifying with.

**Read the two event wordings out loud** before you consider the slice done. They will be read by a child about a horse they bred, and that is a different bar than the rest of the copy in this game has to clear.

---

## 12. Documents to correct when this is built

- **`CLAUDE.md` §10** — the Ageing and death row moves to built, with what actually landed. Note that tack was skipped and this stage was taken first.
- **`CLAUDE.md` §11** — a dated entry in `docs/build-log.md`. At minimum: the `src/engines/ageing/` engine, the snapshotted-lifespan pattern and why it is not a hazard roll, the shared exit path in `src/db/ageing.ts` that death and removal both call, the "live means status AND `cancelled_game_day IS NULL`" two-part rule, the two new event kinds, and the decision not to prune `show_entries`.
- **`docs/horse-game-overview.md` §14** — strike through *Does death arrive announced?* and record the decision, in the format the other struck questions use: announced, with a visible late phase, decided 2 Aug 2026 in conversation while specifying this slice, with §2.1's reasoning kept.
- **`docs/horse-game-overview.md` §7a** — record the lifespan shape, the frailty window, and that removal is "retire away", free, one-way and costs no turn.
- **`docs/horse-game-schema.md` §4.1** — the two new `horses` columns, and the four on the breeding tables.
- **`docs/horse-game-schema.md` §4.2** — this is the important one. Record that the pruning list was **not** carried out, and why: three columns and three tables do not exist, `image_url` is kept because the storage argument does not survive contact with the column, and `show_entries` are kept because deleting them falsifies past shows. A future session reading §4.2 must not implement it in good faith after this slice deliberately declined it.
- **`docs/horse-game-schema.md` §12** — the build-order table's *Ageing and death — no new tables* line is still right, but should now name the columns.

---

## 13. If this is too large for one session

Split it in two. The seam is clean and Part A is independently playable.

**Part A — ageing and death.** The engine, the two `horses` columns, the config, the lifespan assignment, the frailty notice, the death stage, the two event kinds and their wording, the horse-page and barn-list markers, `/admin/ageing`, `/admin/shows`'s headcount. Ends at §1 step 7, minus the pregnancy cancellation.

**Part B — removal and the exit path.** The breeding-table cancellation columns, the shared exit path both callers use, the retire-away route and confirmation, the show-entry withdrawal, `/stables/:id/past`. Ends at §1 step 10.

**If you split it, Part A must still cancel pregnancies**, or a mare who dies in foal produces a foal weeks later and the game tells a child about it. The cheapest correct version in Part A alone is the two columns from §5.2 and the two query conditions, with the shared exit path extracted properly in Part B. Do not skip it and plan to catch it later.

---

## 14. What to raise rather than decide

- **If the lifespan numbers produce a first death much sooner or later than §2.4's four to five real months** — that is tuning, they are config, change them and say what you changed them to. Do not change the mechanism.
- **If the frailty window reads badly in play** — say so. It was set against a specific failure (§4.4) by analogy to a window that has not been observed either, and a session that watches one happen knows something this document does not.
- **If you find yourself wanting to make failing horses score worse** — stop and raise it. §3.2 declined it for reasons about the show scorer's tuning, and if those reasons are wrong that is a conversation, not a quiet multiplier.
- **If the schema document's §4.2 pruning list looks like it should be honoured after all** — raise it rather than implementing it. §5.5 is an argument and arguments can be wrong, but reversing it silently means a show that has already been judged renders differently afterwards, and nobody will connect that to a horse dying.
- **If `/admin/ageing`'s bring-forward control feels like it crosses overview §6b's warning about advancing individual horses** — say so in your summary. §8.4 argues it does not, and it is the one place in this slice reasonable people could differ.
- **If a child asks how long their horse has left** — that is a design question about §2.1's deliberate vagueness, not a bug, and it is worth bringing back rather than answering with a number on a page.
