# Slice 0013 — Care: shoes, wellness, feed, and the modifier that decides a close class

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts of them this
slice depends on are quoted or summarised below.**

The design record calls this stage **"care and tack"** and treats it as one thing. It is being built
as two: **care now, tack later** (`CLAUDE.md` §10 carries tack as its own row, further down the
list, after the market). The reason is in §3.1 below.

Where this comes from:

- `docs/horse-game-overview.md` §8a — care state as a performance modifier, the ±5% band, the
  failure mode if care outweighs breeding, and "neglect should degrade gradually and recover, not
  produce cliff edges".
- `docs/horse-game-overview.md` §8c — the hard requirement that **care must never be blocked by a
  player provider being absent, asleep, or out of stock.** This slice satisfies it the easy way: no
  player providers exist yet, so every call goes to the NPC provider.
- `docs/horse-game-schema.md` §4.1 ("Care state") and §8.4 (`service_calls`). This slice departs
  from both, with reasons in §5.6.
- `docs/slices/0010-health-first-pass.md` §3.2, which promised `conditions.management_options` and
  `horse_conditions.management_state` would arrive "with the care and tack stage". They arrive here,
  in Part B (§4.5).

What already exists and must not be re-implemented:

- `src/engines/showing/score.ts`'s `scoreEntry` and `src/engines/showing/abilityScore.ts`'s
  `scoreAbilityEntry` **already take `careModifier` and `tackModifier` parameters, pinned at 1.0**.
  This slice's whole scoring integration is passing a real number into `careModifier`. Nothing about
  either formula changes.
- `src/engines/conformation/model.ts`'s `realization()` also carries a `careFactor` parameter,
  defaulted to 1.0. **This slice deliberately leaves it at 1.0 forever** — see §2.3.
- `src/db/upkeep.ts` / `src/lib/upkeep.ts` already charge board per horse per game day. Feed level
  multiplies that existing charge; no second recurring charge is created.
- `src/db/ledger.ts`'s `buildLedgerStatements` is the only function allowed to write
  `stables.balance`. Every purchase here goes through it.

---

## 1. What "done" looks like

A child opens a horse's page and sees a **Care** card in plain English: when it was last shod, when
it is next due, when the vet last saw it, and what the barn is currently feeding. Three short lines,
each with a status word a nine-year-old reads without help — *Fresh*, *Due soon*, *Due*, *Overdue*.

They click **Call the farrier** on the horse, or **Farrier round** on the barn page to do every
horse that needs it at once. Money leaves the stable, the ledger records it, the dates reset, the
status words go back to *Fresh*. It costs no turns.

They change the barn's feed from Standard to Premium and the board charge on the next tick goes up;
they drop it to Poor when money is tight and it goes down, and every horse in the barn drifts
slightly worse at shows.

A horse that has been ignored for a long time places a little lower than it should. A horse whose
owner keeps on top of it places a little higher. **Not much either way** — at most five percent of
the raw score, against show noise that is worth about twice that. The show result page already
explains itself trait by trait; it now has one more line: "Care: 0.97 — shoes were 80 days overdue."

And once a tick, a stable whose horses have gone overdue gets one line in its events feed: *"3
horses in Willow Creek are due for the farrier."* One line for the whole barn, not one per horse.

---

## 2. Decisions taken for this slice

These are decisions, not suggestions. If one looks wrong, say so before building — but don't quietly
build something else (`CLAUDE.md` §2).

### 2.1 Care is three plain columns on the horse, not a JSON blob

`docs/horse-game-schema.md` §4.1 sketches `horses.care` as JSON holding "shoeing currency, feed
quality, condition score, workload", plus a cached `care_modifier` REAL recomputed on the tick.

**Built instead: two integer game-day columns on `horses` (`last_farrier_game_day`,
`last_vet_game_day`), one text column on `stables` (`feed_level`), and no cache at all.**

Three reasons:

- **JSON is the right answer for a genotype and the wrong answer for two dates.** `horses.genotype`
  is JSON because its shape genuinely varies (loci come and go). Two integers whose meaning is fixed
  forever get columns, which the database can index and a future session can read in a `SELECT`
  without `json_extract`.
- **Nothing in the blob's list survives contact with what exists.** "Workload" needs training, which
  is not built. "Condition score" is a slow function of feed level, which is a per-stable setting —
  storing it per horse would be storing a derivation. `CLAUDE.md` §7 and slice 0010 §3.2 both say
  the same thing: a column nothing writes is a promise nobody has kept.
- **The cache is worse than the computation.** The care modifier is a pure function of three stored
  values and `game_day`. Caching it on the tick means every horse row is written every tick, and a
  horse's displayed care goes stale the moment the operator retunes a config value. The schema
  document itself makes exactly this argument about `phenotype_cache` ("computed on read rather than
  stored... treated as disposable"), and care is a far smaller computation than a phenotype.

**Where the modifier *is* stored is the show entry**, at scoring time, in the existing
`show_entries.care_modifier_applied` column — which is the one place a stored copy is load-bearing,
because a result must still explain itself months later after the horse has been shod twenty times
(overview §9, "snapshot how a result was reached").

### 2.2 Care calls cost money, never a turn — and one click does the whole barn

Booking a covering, entering a show and buying a genotype test each cost one turn. A farrier call
does not, and neither does anything else in this slice.

The action budget exists to make a player choose between *interesting* things (slice 0009 §5).
Charging a turn per horse per farrier visit would mean a ten-horse barn spends most of a day's
eighteen turns on maintenance, and the child with the most horses — who is by definition the most
invested — is punished hardest for it. That inverts what the budget is for.

More importantly it recreates, inside one family, exactly the failure overview §8c names about
providers: **a horse's welfare must not hinge on somebody remembering a chore.** Money is a fine
gate on care. Attention is not, when the person whose attention it is might be seven.

So: **a barn-wide "Farrier round" and "Wellness round" button on the stable's barn page**, charging
per horse that actually needs it and skipping the rest, plus a per-horse button on the horse page
for anyone who wants to be precise. Both free of turns.

### 2.3 Care modifies the show score. It never touches the displayed conformation numbers.

`realization()` in `src/engines/conformation/model.ts` carries a `careFactor` parameter. **Leave it
at 1.0. Do not wire care into it.** Two reasons, the second decisive:

- **Double counting.** Realization feeds expressed trait values, which feed `rawScore`, which the
  care modifier then multiplies. Putting care in both places squares it, and the ±5% band silently
  becomes something else.
- **It would be nonsense on screen.** Conformation traits are *measurements* — neck length, shoulder
  angle, back length, hock set (slice 0006 §2.1). A horse's neck does not get longer because the
  farrier came. Watching the number on the bar move because a stable switched feed brands would
  teach a child something false about horses, which is the opposite of the point.

Care belongs to **performance**, not to **conformation**. It multiplies the score a judge arrives
at, and it is shown as its own line in the result explanation rather than hidden inside the trait
numbers.

If a future stage wants care to genuinely affect a horse's *body* — weight, muscling, coat — that is
a real and different idea, and it belongs to whatever slice adds `horses.weight` and a body-condition
model. It is not this one. Leave `careFactor` in the signature, unused, exactly as it is: slice 0006
put it there for a reason and this slice is not that reason.

### 2.4 The band is ±5%, and the clamp — not the components — is what guarantees it

Overview §8a: "a tight band, somewhere near ±5%", because "if care and equipment swing results more
than genetics does, breeding stops being the game."

The modifier is a sum of small deltas, **then clamped to `[care_modifier_min, care_modifier_max]` =
`[0.95, 1.05]`**. The components as tuned in §4.3 reach +0.04 at best and −0.07 at worst, so the
clamp is doing real work at the bottom and none at the top. That is deliberate:

- **The floor is a promise.** A neglected horse can never fall further than 5%, no matter how many
  penalty components a future slice adds (tack is coming, and unmanaged conditions arrive in Part B
  of this one). Whoever adds the next component does not have to re-derive the total band; the clamp
  already holds it.
- **The ceiling has headroom on purpose.** Tack, when it lands, gets its own separate modifier with
  its own separate band. Care alone should not be able to reach the top of its own range, or there
  is nothing left for anything else to give.

The clamp lives inside the pure engine, applied last, and is the single line a future session should
change if the band is ever retuned.

### 2.5 Feed is a per-stable setting that scales board, not a per-horse choice

One `feed_level` on `stables`, three values: `poor`, `standard`, `premium`. It multiplies the
existing per-horse upkeep charge and shifts every horse in the barn's care modifier by the same
amount. Changing it is free, costs no turn, and takes effect from the next tick.

Per-horse feed was considered and rejected. It is ten decisions instead of one, it is the sort of
screen a child opens once and never again, and — the real objection — it makes the optimal play
"premium for the show horses, poor for everything else", which is a spreadsheet, not a stable. A
barn-wide setting makes feed what it should be: **a standing trade between money and performance,
decided once and revisited when the economy changes.**

It also gives the economy something it currently lacks: a lever a stable in trouble can actually
pull. See §2.7.

### 2.6 NPC-owned horses are kept current by the tick, not exempted at the scorer

The NPC show barn's horses need care state too, or every player horse quietly gains 5% on them (or
loses it, depending on which way the default falls), and the show fields stop meaning what they
appear to mean.

`CLAUDE.md` §13 is blunt about this: **no parallel scoring path for NPC horses.** So the fix does
not go in the scorer. The tick's care stage stamps `last_farrier_game_day` and `last_vet_game_day`
forward for every horse owned by a stable with `is_npc = 1`, in one `UPDATE`. Their horses then flow
through the identical modifier function, at the identical `standard` feed default, and come out at
1.00 with no special case anywhere near the scoring code.

One `UPDATE` in one tick stage is a special case that a future session can find. A branch in the
scorer is one that will eventually be missed by whoever adds the third class type.

### 2.7 The debt rule applies to care purchases, and poor feed is the way out

`canTakeOnCost` (`src/lib/money.ts`) blocks a stable with a negative balance from taking on new
costs. It already blocks booking a covering and buying a genotype test, and deliberately never
blocks entering a show, because shows are how a stable in debt earns its way back out (slice 0009
§4.6).

**Care calls are purchases and are blocked the same way.** That is not cruel, because dropping feed
to `poor` is always available, always free, and immediately reduces the board charge — a stable in
debt can cut its own running costs by roughly 40% with one click, at a cost of 2% on the show score
of every horse it owns.

That is a genuinely good decision to hand a player: *the horses eat cheaper for a while and place a
little worse, until the money comes back.* It is the first place in this game where the honest,
slightly uncomfortable trade a real stable makes is a button.

---

## 3. Not built here

### 3.1 No tack — it is its own stage now, after the market

Overview §8b wants tiers with diminishing returns, wear with use, discipline specificity, and
repair-or-replace. Every one of those is real, and none of them is care.

Tack was split off for three reasons:

- **It needs more than one discipline to mean anything.** Discipline specificity ("a jumping saddle
  does nothing in a gaited class") is most of tack's design, and exactly one discipline is currently
  seeded (Barrel Racing, slice 0012). Building tack now means building the interesting half against
  a game where it cannot be exercised.
- **It needs prices that have been watched.** Tack is a purchase economy — tiers, wear rates,
  repair costs. Every one of those numbers is set against a market that does not exist yet.
- **It is the pay-to-win risk, and overview §8b says so.** "A wealthy player equipping everything at
  top tier widens gaps that breeding alone would not." That risk is worth taking deliberately, after
  the money in this game has been observed for a while, not on the same afternoon as the farrier.

Care and tack share nothing structurally. They are two independent multipliers on one score line,
and `scoreEntry` already takes them as two separate parameters. Splitting them costs nothing later.

**`tackModifier` stays pinned at 1.0 in both scorers. Do not touch it in this slice.**

### 3.2 No player providers, no professions, no pricing, no inventory, no `service_calls` table

Every call in this slice goes to the NPC provider at a config price. There is no provider column, no
`provider_state`, no `provider_inventory`, and — see §5.6 — no `service_calls` table.

Overview §8c's requirement is satisfied trivially by there being nothing to be absent. When
professions land, the NPC provider becomes *the null provider* (schema §8.4's nullable
`provider_stable_id`), and this slice's calls are exactly the rows that already have it null.

### 3.3 No training

`realization()`'s `trainingFactor` and `scoreAbilityEntry`'s `trainingFactor` both stay at 1.0.
Training is its own stage with its own action-economy question (overview §14, "does hired training
route around the action budget"), and nothing here depends on it.

### 3.4 No workload, no injury, no lameness

Overview §8a lists workload as part of care state. Workload is a function of how hard a horse is
being campaigned, which needs training and a fuller show calendar to mean anything, and it is the
input to injury — which is a whole design conversation about whether a child's best horse can be
taken away by a die roll. Not opened here.

A horse that has never been shod is **slower to place**, not lame. Overview §8a asks for exactly
this: "a child who forgets the farrier for a week should see a small penalty rather than a lame
horse."

### 3.5 No screening, no polygenic risk scores

Slice 0010 §3.1's line still holds: genotype tests are permanent results; screening is an
observation that goes stale. The vet wellness visit in this slice is **not** screening — it returns
no information at all, it just resets a timer. Screening arrives with the polygenic health stage.

### 3.6 No care history, no per-call record

When the farrier is called, two things happen: a date column moves, and a ledger row is written. The
ledger *is* the history — it already has `game_day`, an amount, a description and a reference. A
separate `service_calls` table storing the same facts a second time is two sources of truth for one
event, and the one that isn't the ledger will be the one that drifts.

### 3.7 No per-horse feed, no supplements, no farrier quality tiers

All three are the same shape of idea (spend more per horse for a slightly better number), all three
belong to the professions stage where a player provider's `effectiveness_tier` is what varies, and
all three would widen the band §2.4 exists to hold narrow.

---

## 4. The model

### 4.1 Three components, one shape

Each of the three components produces a small signed delta. Two of them (farrier, wellness) are
**timers** and share one shape; the third (feed) is a **lookup**.

The timer shape, as one piecewise-linear ramp over `daysSince`:

```
daysSince = game_day - (last_call_game_day ?? care_start_game_day)

daysSince <= 0            -> +bonus                      (just done)
0 < daysSince < interval  -> +bonus * (1 - daysSince/interval)   (decaying to zero)
daysSince == interval     ->  0                          (due, no penalty yet)
interval < daysSince < overdue -> -penalty * (daysSince - interval) / (overdue - interval)
daysSince >= overdue      -> -penalty                    (floored, never worse)
```

Read in plain English: **being current is neutral. Being prompt is a small bonus that fades as the
next visit comes due. Being late is a penalty that grows gradually and then stops growing.**

That shape is chosen against overview §8a's exact sentence — "neglect should degrade gradually and
recover, not produce cliff edges." There is no discontinuity anywhere in it, the penalty has a
floor, and one call restores the horse to the top of the ramp instantly. Recovery is immediate
because in life it is: new shoes fix a horse's feet that afternoon.

`care_start_game_day` is `born_game_day + care_start_age_game_days` — see §4.2.

### 4.2 Youngsters are not on the clock

`care_start_age_game_days` is 1080 (three game years, the same as `show_conformation_min_age_game_days`).

Below that age a horse's timers do not run: `daysSince` is computed from `care_start_game_day` when
no call has ever been made, so a foal reads as *Not yet* rather than *Overdue*, contributes no
penalty, is never counted in an overdue notice, and is skipped by the barn round.

This is both true to life (foals are not shod, and a youngster's veterinary needs are not the same
appointment) and load-bearing for the events feed: without it, every foal born generates a nag
inside four ticks, and the feed becomes something children learn to ignore.

### 4.3 The numbers, and why these

All live tunables (`CLAUDE.md` §5.5) — they affect future computation only, so nothing is
snapshotted onto a horse.

| Key | Value | Why |
|---|---|---|
| `care_start_age_game_days` | 1080 | Three game years. Matches the conformation show minimum age — care starts when a horse can start work. |
| `farrier_interval_game_days` | 45 | Six real-world weeks, the actual shoeing cycle. At 30 game days per real day, roughly every 36 hours of real time. |
| `farrier_overdue_game_days` | 135 | Three intervals. Full penalty at about four and a half real days of neglect. |
| `farrier_bonus` | 0.01 | +1% freshly shod, decaying to 0 at the interval. |
| `farrier_penalty` | 0.03 | −3% at full neglect. The largest single component: feet are what actually stops a horse. |
| `farrier_cost` | 30 | Per horse. |
| `vet_wellness_interval_game_days` | 180 | Twice a game year — teeth, vaccinations, worming. |
| `vet_wellness_overdue_game_days` | 540 | Three intervals again. |
| `vet_wellness_bonus` | 0.01 | +1% current. |
| `vet_wellness_penalty` | 0.02 | −2% at full neglect. Smaller than the farrier's: slower to bite, slower to matter. |
| `vet_wellness_cost` | 90 | Per horse. |
| `feed_levels` | JSON, below | Multiplier on board, delta on the modifier. |
| `care_modifier_min` | 0.95 | §2.4's floor. |
| `care_modifier_max` | 1.05 | §2.4's ceiling. |

`feed_levels`, one JSON object so a level can be retuned or a fourth added without a code change:

```json
{ "v": 1, "levels": {
  "poor":     { "name": "Poor",     "upkeep_multiplier": 0.6, "care_delta": -0.02 },
  "standard": { "name": "Standard", "upkeep_multiplier": 1.0, "care_delta":  0.00 },
  "premium":  { "name": "Premium",  "upkeep_multiplier": 2.0, "care_delta":  0.02 }
} }
```

**What this costs a stable.** Board is currently 2 per horse per game day, and the world advances 30
game days per real day, so one horse costs 60 a real day at standard feed. On top of that, care at
full maintenance is 30 every 45 days plus 90 every 180 days — about 1.17 per game day, **roughly 58%
on top of board.** A three-horse founding stable goes from about 180 a real day to about 285.

That is a large change to the economy and it is intended: care should be the second-biggest sink
after board, and the first one a player consciously trades against. But it wants watching — see
§13.1.

**What it buys at a show.** Conformation raw scores land around 70–85; ability scores around 40–70.
Five percent of a raw score of 78 is about 3.9 points, against `show_noise_sd` of 5. So **the full
width of the care band is a little under one standard deviation of the judge's noise.** That is
overview §8a's target exactly: "the thing that decides a close class rather than the thing that
beats better breeding."

### 4.4 The engine

New directory, `src/engines/care/`, one file, `modifier.ts`. Pure — no database access
(`CLAUDE.md` §5.1).

```ts
export type CareStatus = 'not_yet' | 'fresh' | 'due_soon' | 'due' | 'overdue';

export interface TimerState {
  /** null = never called; the ramp then runs from careStartGameDay. */
  lastCallGameDay: number | null;
  careStartGameDay: number;
}

export interface TimerConfig {
  intervalGameDays: number;
  overdueGameDays: number;
  bonus: number;
  penalty: number;
}

export interface TimerResult {
  status: CareStatus;
  delta: number;
  /** Negative when overdue. Rendered as "due in 12 days" / "overdue by 30 days". */
  daysUntilDue: number;
  /** True when a round should include this horse and a notice should count it. */
  needsCall: boolean;
}

export function timerState(state: TimerState, cfg: TimerConfig, gameDay: number): TimerResult;

export interface CareModifierResult {
  modifier: number;              // clamped
  unclampedModifier: number;     // for the admin screen and for tests of the clamp itself
  farrier: TimerResult;
  wellness: TimerResult;
  feedDelta: number;
  /** Part B only; 0 when Part B is not built. */
  conditionDelta: number;
}

export function careModifier(...): CareModifierResult;
```

Everything on screen and everything in the scorer reads these two functions. There is no second
place that decides whether a horse is overdue.

`needsCall` is true for `due` and `overdue`, false for `not_yet`, `fresh` and `due_soon` — so a barn
round does not burn money re-shoeing a horse that was done four days ago. `due_soon` is a display
state only, set at 80% of the interval.

### 4.5 Part B: managing a condition that can be managed

**Built 3 Aug 2026, in `docs/slices/0014-before-the-children-play.md` §5, exactly as specified below**
— with one rename: `conditions.management_options` (JSON) shipped as `conditions.management_text`
(plain text) instead, because nothing in slice 0014 reads a structure and an unread column is a
promise nobody keeps (`CLAUDE.md` §7). Everything else below — the −0.03 penalty, the 150/180 shape,
the knowledge boundary, the three "does not" bullets — landed as written.

Slice 0010 built four conditions and deliberately built no management: HYPP and PSSM1 are marked
`manageable` in `conditions.severity_class`, but with nothing to do about them "manageable" has so
far meant "diagnosed". Both are, in life, managed by **diet and exercise** — which is precisely what
this slice is about, and why slice 0010 §3.2 pointed here.

The shape:

- An **affected** horse (per `horse_conditions`, the truth table) whose condition is `manageable`
  and which has **no current management plan** carries `unmanaged_condition_penalty` = −0.03 on its
  care modifier.
- A **management plan** is bought from the vet for `condition_management_cost` (150) and lasts
  `condition_management_interval_game_days` (180) — the same shape as a wellness visit, a timer that
  runs out and is renewed.
- While the plan is current, the penalty is zero. The horse performs normally.

Three things this deliberately does **not** do:

- **It does not hide the condition.** An affected horse with a plan still shows as affected on its
  page, still teaches what the condition is, still passes the allele on. Management is not a cure
  and must never read as one.
- **It does not apply to the lethal or degenerative classes.** GBED kills a foal regardless; HERDA
  still bars a horse from showing. Only `severity_class = 'manageable'` rows are affected. This is
  read from the condition row, never hardcoded to HYPP and PSSM1.
- **It does not apply to a condition the owner has not learned about.** A stable that has never
  tested and whose horse's condition has no visible signs cannot be penalised for failing to manage
  something the game has not told them about. **The penalty applies only when the owner is entitled
  to know** — reuse `ownerVisibleStatus` from `src/engines/health/status.ts`, which already encodes
  exactly that entitlement, rather than writing a second version of the rule. This is the single
  most important sentence in Part B: it is the truth-versus-knowledge boundary (`CLAUDE.md` §12) and
  it is invisible on screen the moment it is crossed by accident.

Data: `horse_conditions` gains `management_state` (`unmanaged` / `managed`, the schema document's
own value names) and `management_until_game_day`; `conditions` gains `management_text` (plain text,
not the `management_options` JSON originally sketched here — see the rename note above; `NULL` for
anything not manageable) plus `manageable` behaviour driven off the existing `severity_class`. Both
were named in slice 0010 §3.2 as arriving here, and both did.

**Part B was the half sanctioned to drop if the session ran long (§12) — it did not; it landed in
slice 0014.**

---

## 5. Data

Migration numbers are claimed at build time, not reserved by this document — check `migrations/` for
the next free number (`CLAUDE.md` §8, and the build log's 2026-08-03 numbering entry). This slice
expects **six** migrations for Part A and **two** for Part B. Every one of them also needs
registering in `src/db/migrations.ts`.

### 5.1 `horses` gains two columns

```sql
-- Care timers (slice 0013 §4.1). Game-day columns, per CLAUDE.md §7's *_game_day suffix rule.
-- NULL means "never called" - the modifier's ramp then runs from the horse's care start age
-- (born_game_day + care_start_age_game_days), not from birth, so a foal is never overdue.
ALTER TABLE horses ADD COLUMN last_farrier_game_day INTEGER;
ALTER TABLE horses ADD COLUMN last_vet_game_day INTEGER;
```

No index. The tick's overdue query scans living horses, which is the same scan `chargeUpkeep`
already does per stable; add an index when a screen is actually slow, not before (`CLAUDE.md` §7).

### 5.2 A separate migration backfilling every existing horse

One logical change per file (`CLAUDE.md` §8), and this one matters:

```sql
-- Everything alive when care ships starts current, not neglected. Without this, every horse in the
-- game reads as never-shod on the first tick after deploy and takes the full penalty for a
-- mechanic that did not exist yesterday.
UPDATE horses
   SET last_farrier_game_day = (SELECT game_day FROM world WHERE id = 1),
       last_vet_game_day     = (SELECT game_day FROM world WHERE id = 1)
 WHERE status = 'alive';
```

Dead and retired horses are left NULL on purpose: nothing reads care for a horse that has ended, and
writing to them would be writing history that did not happen.

### 5.3 `stables` gains `feed_level`

```sql
-- Slice 0013 §2.5. Barn-wide, not per horse. The value is a key into config.values.feed_levels;
-- an unrecognised value reads as 'standard' in the engine rather than throwing, so retiring a feed
-- level from config can never break a page.
ALTER TABLE stables ADD COLUMN feed_level TEXT NOT NULL DEFAULT 'standard';
```

### 5.4 `ledger.kind` gains `farrier`

A table rebuild, exactly as `migrations/0057_ledger_add_vet_kind.sql` does it — copy that file's
structure and its comment about why nothing has a foreign key pointing into `ledger`. New kind list:

```
'opening', 'upkeep', 'prize', 'adjustment', 'vet', 'farrier'
```

**Wellness visits and Part B's management plans use the existing `vet` kind**, not new ones. They
are vet calls; the description column says which. Feed rides on the existing `upkeep` kind, because
feed *is* board — it changes the amount of an existing charge and creates no second row.

### 5.5 Config

One migration, `json_set` against the config row in the established pattern (see
`migrations/0060_config_ageing.sql` for the shape). Every key in §4.3's table, plus:

- `care_notice_enabled` — 0/1, whether the tick writes the overdue event at all. On by default. This
  exists because a nag in a children's game is the one mechanic most likely to need turning off
  after a week, and turning it off should not be a deploy.

Part B adds `unmanaged_condition_penalty` (0.03), `condition_management_cost` (150),
`condition_management_interval_game_days` (180).

### 5.6 What is *not* added, and where this departs from the schema document

| Schema document says | Built here | Why |
|---|---|---|
| `horses.care` — JSON blob | Two integer columns | §2.1 |
| `horses.care_modifier` — cached REAL, recomputed on the tick | Nothing; computed on read | §2.1 |
| `service_calls` table | Nothing; the ledger row is the record | §3.6 |
| `services` reference table | Nothing; two config prices | §3.2 — a reference table with two rows and no provider to vary them is a table pretending to be a decision |
| `provider_state`, `provider_inventory` | Nothing | §3.2 |
| `tack_types`, `tack_items` | Nothing | §3.1 |

The `service_calls` omission is the one worth being deliberate about, because schema §8.4 makes a
real argument for it: its nullable `provider_stable_id` is how overview §8c's "care is never
blocked" requirement is expressed as a column. That argument is sound and the table should be built
— **when there is a provider to be null instead of.** Today every call has the same provider, the
same price and no outcome, and the row would carry no information the ledger row does not.

Whoever builds professions: the ledger rows this slice writes are the historical service calls, and
`reference_type` is `'horse'` with `reference_id` the horse id, so they can be found.

---

## 6. Calling the farrier, precisely

### 6.1 Routes

| Route | Method | What it does |
|---|---|---|
| `/horses/:id/care` | POST | One horse, one service. Body: `service=farrier\|wellness`. Owner only. |
| `/stables/:id/care` | POST | The barn round. Body: `service=farrier\|wellness`. Owner only. |
| `/stables/:id/feed` | POST | Sets `feed_level`. Owner only. |

All three are POST-only and redirect back with a query flag, the same pattern every existing form
route uses (`/horses/:id/test`, `/stables/:id/breed`). No new GET pages — the Care card on the horse
page and the barn page carry the buttons.

Register them in `src/router.ts` beside the existing `HORSE_ROUTE` / `STABLE_ROUTE` sub-paths.

### 6.2 The one-horse call

1. Re-read the horse from the database and confirm the logged-in account owns the stable that owns
   it. Never trust the stable cookie (build log, 2026-08-02 sessions entry).
2. Refuse if the horse's `status` is not `alive`.
3. Refuse if the horse is below `care_start_age_game_days` — the button is not rendered for a
   youngster, and the route re-checks anyway.
4. Compute the price: `farrier_cost` or `vet_wellness_cost`, read live from config.
5. `canTakeOnCost(stable.balance)` — refuse with a plain message if the balance is negative (§2.7),
   naming the feed setting as the way out.
6. One `env.DB.batch([...])`: `buildLedgerStatements` for the charge, plus the `UPDATE horses SET
   last_farrier_game_day = ?` (or `last_vet_game_day`). One batch is one implicit transaction, so
   money and date move together or not at all.
7. **No turn is spent.** Do not call `spendAction`.

Calling the farrier for a horse that is already `fresh` is allowed from the horse page — it wastes
money and resets the timer, which is the player's business. The barn round skips it (§4.4).

### 6.3 The barn round

Same checks, over every alive horse in the stable at or past care start age with `needsCall === true`
for the chosen service. Then:

- Compute `total = price × count`.
- If the stable cannot afford the whole round, **do as many as it can afford, oldest-due first**,
  and say so on the redirect: *"Shod 4 of 7 — not enough money for the rest."* Refusing the whole
  round because it is 30 short is the kind of all-or-nothing that makes a child think the button is
  broken.
- One ledger row for the round, not one per horse: `kind = 'farrier'`, `reference_type = 'stable'`,
  description *"Farrier round, 4 horses."* One event, one charge, one line in the money page.
- All the `UPDATE`s plus the ledger statements in one `env.DB.batch`.

If nothing needs doing, change nothing and redirect with *"Nothing due."*

### 6.4 Double submission

A child on a phone will double-tap. Both requests will pass their checks and both will charge. The
existing forms have the same exposure and it has not bitten yet, so this slice does not build a
token scheme for it — but the barn round is the first place where a double-tap costs real money,
so: **the round's `UPDATE` is guarded** (`WHERE last_farrier_game_day IS NULL OR
last_farrier_game_day < ?`) and the charge is computed from the rows that actually changed, not from
the count read a moment earlier. A second identical request finds nothing to update and charges
nothing. This is the same idempotency discipline the tick uses (`CLAUDE.md` §5.4), applied to a
button.

---

## 7. The tick

### 7.1 Feed multiplies the existing upkeep charge

`src/lib/upkeep.ts`'s `computeUpkeep` gains one parameter, `feedMultiplier`, and the arithmetic
becomes:

```ts
const owed = Math.round(aliveHorses * daysOwed * ratePerHorsePerGameDay * feedMultiplier);
```

`Math.round`, because money is integers and always has been (`CLAUDE.md` §7). `src/db/upkeep.ts`
selects `feed_level` alongside `last_upkeep_game_day` in the query it already runs, and looks the
multiplier up from config. An unrecognised value reads as `standard`.

The idempotency story is unchanged: the charge is still derived from
`newGameDay - last_upkeep_game_day`, so a re-fired tick still finds zero days owed. The description
gains the feed level: *"Board for 3 horses, 10 days (premium feed)."*

### 7.2 One new stage: `noticeCareDue`

In a new file, `src/db/care.ts`.

**What it does, in one pass:**

1. **Stamps NPC horses current.** One `UPDATE horses SET last_farrier_game_day = ?,
   last_vet_game_day = ? WHERE status = 'alive' AND owner_stable_id IN (SELECT id FROM stables WHERE
   is_npc = 1)`. §2.6. Idempotent by construction — it writes the same value every tick.
2. **Finds newly-overdue player horses.** Every alive horse in an account-owned stable, at or past
   care start age, whose farrier or wellness timer has crossed into `overdue`, **and which has not
   already been counted**.
3. **Writes one `care_due` event per stable**, with the counts, and marks those horses counted.

**Idempotency (`CLAUDE.md` §5.4).** A per-horse marker column, `care_notice_game_day`, added by the
same migration as §5.1's columns:

- A horse is counted only when `care_notice_game_day IS NULL` and it is overdue.
- When counted, `care_notice_game_day` is set to the current `game_day`.
- **A care call clears it back to `NULL`** — so the next time that horse falls overdue, months later,
  it is noticed again.

A re-fired tick finds every candidate already marked and writes nothing. A missed tick finds the
same horses still overdue and notices them once. Neither double-notifies.

### 7.3 Where it goes in the tick order

In `src/db/tick.ts`, **after `chargeUpkeep` and before `deleteOldEvents`**:

```
resolveDueCoverings
foalDuePregnancies
killDueLethalFoals
assignLifespansAndNoticeFrailty
killDueOldHorses
createDueShows
judgeDueShowClasses
chargeUpkeep
noticeCareDue          <- new
deleteOldEvents
```

After the deaths, so a horse that died this tick is never nagged about. After judging, so a class
scored this tick uses the care state the horse actually had all period rather than one the notice
stage touched. After upkeep, because both are money/maintenance bookkeeping and keeping them
adjacent means a future session reading either finds the other. Before `deleteOldEvents` for the
same reason every other event-writing stage is: an event written this tick should be subject to the
same retention pass as any other.

### 7.4 One new event kind

`care_due`, per `migrations/0048_events.sql`'s free-text `kind` convention (no migration needed):

```
care_due -> {"v":1,"farrier_count":3,"wellness_count":1}
```

`subject_horse_id` is `NULL` — this is a stable-level event, and the column is nullable.

Only stables with an `account_id` get events, per 0048's own rule. The NPC barn is stamped current
and never notified, which is consistent.

### 7.5 The wording, drafted now rather than at the point of failure

The same discipline slices 0010 §5.6 and 0011 §7.7 applied — write the sentence a child reads while
calm, not while shipping.

> **3 horses are due for the farrier.**
> Comet, Willow and Juniper have gone past their shoeing date. They can still be shown, and they are
> not hurt — they will just be at a slight disadvantage until the farrier has been. You can do the
> whole barn at once from your barn page.

> **Juniper is due for a wellness visit.**
> It has been a while since the vet last checked Juniper over — teeth, vaccinations, the ordinary
> things. Nothing is wrong. Booking a visit keeps her at her best.

Both are deliberately unalarming. The farrier being late is not an emergency and should never read
as one; a child who thinks their horse is suffering because they had school that week has been badly
served by a game about caring for animals.

---

## 8. Where else it appears

### 8.1 The horse page — a Care card

Between the Health card and the Show record card. Three lines:

```
Care
  Shoes      Fresh — next due in 31 days          [ Call the farrier — 30 ]
  Wellness   Due — last visit 182 days ago        [ Book a visit — 90 ]
  Feed       Standard (set for the whole barn)

  Currently placing at 1.00 of normal.
```

The last line only appears when the modifier is not 1.00, phrased as *"Currently placing slightly
above normal (1.02)"* or *"slightly below normal (0.96) — shoes are 60 days overdue"*. Never a bare
number without the sentence that explains it.

For a horse below care start age, the whole card is one line: *"Too young to need the farrier yet —
care starts at three."*

Buttons are shown to the owner only, and hidden entirely for a horse that has ended.

### 8.2 The barn list (`/stables/:id/horses`)

- A small badge on any horse that is `due` or `overdue`, the same visual weight as the existing
  health and failing badges — not louder.
- Above the list: the two round buttons, the feed selector, and a one-line summary
  (*"3 due for the farrier · 1 due for a wellness visit"*), or nothing at all when the barn is
  current.

### 8.3 The money page (`/stables/:id/money`)

Nothing new to build — farrier rounds and vet visits appear as ledger rows automatically. Check that
the kind labels render in plain English (*"Farrier"*, *"Vet"*) rather than raw kind codes.

### 8.4 The show result explanation (`/shows/:id/entries/:entryId`)

This page already explains a placing trait by trait. Add one line to the modifier section:

```
Care applied: 0.97  (shoes 80 days overdue at the time of the class)
```

Read from `show_entries.care_modifier_applied`, **not** recomputed — the horse may have been shod
since, and the whole point of the snapshot is that the explanation does not change afterwards. If
the stored value is 1.00, say *"Care: normal"* rather than hiding the line: a child comparing two
results should be able to see that care was accounted for in both.

`src/db/shows.ts` must write the real modifier into `care_modifier_applied` when it scores an entry,
computed from the horse's care state at judging time, and pass it into `scoreEntry` /
`scoreAbilityEntry` as `careModifier`. **That is the entire scoring integration.**

### 8.5 `/admin/care`

A new admin subpage, in the pattern of `/admin/health` and `/admin/ageing` — read-only except for
one testing control:

- Counts across every living player-owned horse: how many are fresh / due soon / due / overdue, for
  each of the two timers.
- The distribution of care modifiers in ten buckets, so the operator can see at a glance whether
  the band is being used or everyone is sitting at 1.00.
- Each stable's current feed level and what it is paying in board.
- **One control:** "Make every horse overdue" — moves every player horse's care dates back far
  enough to trigger the full penalty, so the mechanic can be seen working without waiting four real
  days. Behind a confirm checkbox, the same shape as `/admin/ageing`'s bring-forward control.

Add it to the admin nav in `src/render/layout.ts` alongside the others.

### 8.6 `src/db/reset.ts`

No change. Care lives in columns on `horses` and `stables`, both already cleared, and in ledger and
event rows already handled by the existing scopes. **Confirm this rather than assuming it** — read
the file, check the comment block, and if you add any table this slice did not anticipate, add it to
`HORSE_TABLES` in the right position and extend the comment, as slices 0008, 0009 and 0010 each did.

---

## 9. Seeds and reproducibility

**Nothing in this slice is random.** There are no draws, no seeds, no calls into `src/lib/rng.ts`.

This is worth stating rather than leaving as an absence, because `CLAUDE.md` §5.2 is absolute about
seeded randomness and a future session reading a care slice with no `deriveSeed` call in it should
be able to tell that this was a fact about the design rather than an oversight. Care is a
deterministic function of stored dates, a stored feed level and `game_day`. Two horses with the same
care state produce the same modifier, always.

The *randomness that care touches* is the judge's noise, which is already seeded from the show
(`shows.rng_seed`) and is unaffected by anything here. The care modifier multiplies the raw score
before that noise is added — see `scoreEntry`'s existing final line — so re-judging a show with a
different care state changes the result deterministically, which is exactly what makes the admin
"make everything overdue" control useful for testing.

---

## 10. Tests

`test/` — the existing pattern, no database.

**The engine (`src/engines/care/modifier.ts`), which is where the real risk is:**

1. `timerState` returns exactly `+bonus` at `daysSince = 0`, exactly `0` at `daysSince = interval`,
   and exactly `-penalty` at `daysSince = overdue`. The three anchor points of §4.1's ramp.
2. It is **continuous** — no jump greater than `bonus/interval` (or `penalty/(overdue-interval)`)
   between any two consecutive days from 0 to `overdue + 50`. This is the cliff-edge test, and it is
   the one that catches a future retune that accidentally reintroduces one.
3. It is **monotonic** — never improves as days pass without a call.
4. Past `overdue`, the delta is flat forever. A horse neglected for ten game years is no worse off
   than one neglected for two.
5. A horse below care start age with `lastCallGameDay = null` returns `not_yet`, delta 0,
   `needsCall = false`.
6. `careModifier` **clamps**: hand it every component at maximum penalty and assert the result is
   exactly `care_modifier_min`, and that `unclampedModifier` is below it. This is §2.4's guarantee,
   and it is the test that will still be here when tack adds a fourth component.
7. An unknown `feed_level` string reads as `standard`, delta 0, rather than throwing.

**Upkeep:**

8. `computeUpkeep` with `feedMultiplier = 2.0` charges exactly double; with `0.6`, exactly 60%
   rounded to an integer; with `1.0`, byte-for-byte what it charged before this slice.
9. The zero-horses case still returns `amount: 0, advanceMarker: true` — the `-0` guard in that
   function must survive the multiplication.

**Scoring:**

10. `scoreEntry` and `scoreAbilityEntry` with `careModifier: 0.95` produce exactly `rawScore * 0.95 +
    noise`. These functions do not change, so this is a regression test that nobody has "helpfully"
    moved the modifier to the wrong side of the noise addition.

**Part B:**

11. An affected horse with a `manageable` condition and no plan carries the penalty; with a current
    plan, it does not; with an expired plan, it does again.
12. **The knowledge boundary**: an affected horse whose owner has neither tested nor been shown
    visible signs carries **no** penalty. Assert this against `ownerVisibleStatus` directly. Slice
    0010 §14 calls the equivalent test the one most worth having, for the same reason: the boundary
    is invisible on screen the moment it is crossed.
13. A `lethal` or `degenerative` condition never produces a management penalty regardless of state.

---

## 11. Verifying it by hand

Against `wrangler dev --local`, after applying migrations:

1. Open a horse three or older. The Care card reads *Fresh* on both lines (the backfill in §5.2 set
   them current). The modifier line is absent.
2. `/admin/care` → "Make every horse overdue". Reload the horse: both lines read *Overdue*, and the
   card says it is placing at 0.95 of normal.
3. `/admin/world` → advance a tick. The stable's events feed carries one `care_due` line naming the
   count. Advance again: **no second event.** That is §7.2's idempotency, and it is the thing most
   likely to be subtly wrong.
4. Call the farrier on one horse. The money page shows a `farrier` row for 30, the balance drops by
   exactly 30, the Care card reads *Fresh* on the shoes line and *Overdue* on wellness, and the
   modifier moves from 0.95 to about 0.98.
5. Barn page → **Farrier round**. Every remaining overdue horse is shod, one ledger row, correct
   total. Press it again immediately: *"Nothing due,"* and the balance is unchanged.
6. Set feed to Premium, advance a tick, check the board charge on the money page is exactly double
   what the previous tick charged and its description says premium. Set it to Poor and check it is
   60%.
7. `/admin/shows` → judge a show with one overdue horse and one fresh one in the same class. Open the
   result explanation for each: the care line reads 0.95 and 1.01 respectively, and the raw scores
   differ from the final scores by exactly that factor plus noise.
8. Take a stable's balance negative via `/admin/money`, then try to call the farrier: refused, with
   the message naming poor feed as the way out. Set feed to poor and confirm the next tick's charge
   drops.
9. Open a foal's page: *"Too young to need the farrier yet."* No buttons, no badge in the barn list,
   and it is not counted in a round.

---

## 12. If this is too large for one session

Split at §4.5. Both halves ship something playable on their own.

**Part A — care as a modifier.** Everything except §4.5, §5.6's Part B rows, and tests 11–13. The
timers, feed, the calls, the rounds, the tick stage, the scoring integration, the screens. This is
the slice; it stands alone completely, and nothing in Part B changes anything it built.

**Part B — condition management.** §4.5 and its data, plus tests 11–13. Depends on Part A's engine
existing (it adds one delta to `careModifier`) and on slice 0010, which is built. It is the smaller
half by a wide margin and it is the half with the sharpest correctness risk — the knowledge boundary
in §4.5 — so it is better done deliberately than tacked onto the end of a long session.

If Part B is deferred, say so in the summary and leave `conditionDelta` in `CareModifierResult`
returning a constant 0, with a comment naming this document's §4.5. Do **not** add the
`management_state` column until something writes it (`CLAUDE.md` §7, slice 0010 §3.2).

---

## 13. Balance risks to watch

### 13.1 Running costs rise by about half, all at once

§4.3's arithmetic: a horse goes from 60 a real day to about 95. A three-horse founding stable goes
from 180 to 285 against a starting balance of 10,000 and a show win paying 600.

That is intended — care should be a real sink — but it is the largest single change to the economy
since upkeep was introduced, and it lands on **existing** stables that budgeted without it. Two
things to do about it, in order:

- **Watch `/stables/:id/money` for the first few real days after deploy.** If balances trend down
  across every stable at once, the prices are wrong, not the players.
- The correction is `farrier_cost` and `vet_wellness_cost`, both live tunables on `/admin/config`,
  no deploy required. Halving both restores roughly the pre-slice cost of a horse.

If it goes badly the other way — nobody notices the cost at all — the interval, not the price, is
the better lever: care should be a rhythm, not a rounding error.

### 13.2 Poor feed may simply be optimal

Poor feed costs 2% of a show score and saves 40% of board. For a stable whose horses do not win
anyway, that is not a trade, it is free money — and if every player settles on poor feed within a
week, the feed setting has failed as a decision.

The number that governs this is the ratio of `feed_levels.poor.upkeep_multiplier` to its
`care_delta`. If poor feed becomes universal, make it cheaper in performance terms rather than more
expensive in money: −0.03 rather than −0.02. **Do not fix it by removing the option** — §2.7 needs
poor feed to exist as a real escape from debt.

The reverse failure is quieter: premium feed at double board may be worth it only for a stable that
is already winning, which widens the gap between the child who is doing well and the child who is
not. That is the same pay-to-win shape overview §8b flags about tack, arriving early. Watch it, and
if it bites, the fix is to lower `premium.upkeep_multiplier` rather than to raise its care delta.

### 13.3 The nag is the mechanic most likely to be resented

One event per stable per crossing is already the restrained version. If it still grates,
`care_notice_enabled` turns it off without a deploy (§5.5), and the barn-list badge continues to say
the same thing quietly for anyone who looks.

### 13.4 Care compounding with the failing state

A veteran horse in its failing window (slice 0011) that is also neglected is down 5% on a body that
is already at the end of its career. Slice 0011 §2.1 was explicit that the failing state carries
**no mechanical penalty**, precisely so a last season is a real choice. Care is not a violation of
that — it is the owner's decision, not the horse's age — but the two will be felt together, and the
result explanation should make it obvious which is which. It does, because care has its own line and
age has none.

---

## 14. Documents to correct when this is built

- **`CLAUDE.md` §10** — replace the "Care and tack" row with "Care" (built), and confirm the "Tack"
  row further down the table still reads correctly.
- **`docs/horse-game-overview.md` §8a** — record what landed: the three components, the ramp shape,
  the tuned numbers, and §2.3's decision that care never touches displayed conformation.
- **`docs/horse-game-overview.md` §13** — the build-order bullet is already split; mark the care half
  built and name this document.
- **`docs/horse-game-schema.md` §4.1** — the `care` JSON blob and cached `care_modifier` were not
  built; say so plainly and point at §2.1 here, the way §4.2 already points at slice 0011 §5.5.
- **`docs/horse-game-schema.md` §8.4 and §12** — `service_calls` was not built either; record why
  (§5.6) and what a professions session should do about it. §12's "Care and tack" row splits into
  a Care row (`horses.last_farrier_game_day`, `horses.last_vet_game_day`,
  `horses.care_notice_game_day`, `stables.feed_level`) and a Tack row (`tack_types`, `tack_items`).
- **`docs/build-log.md`** — a dated entry: the `src/engines/care/` directory, the ramp-and-clamp
  convention, the fact that `careFactor` in `realization()` is deliberately left unused forever, and
  the `care_notice_game_day` marker pattern for once-per-crossing notices, which is the reusable
  part.
- **`docs/slices/0010-health-first-pass.md` §3.2** — if Part B is built, that section's promise has
  been kept; note where.

---

## 15. What to raise rather than decide

Stop and ask if you hit these; don't pick one (`CLAUDE.md` §2).

- **If the operator wants care to be something a child does daily**, this design is wrong for them —
  it is deliberately low-attention (§2.2), and making it a daily ritual is a different game about
  chores. That is a conversation about what the family actually wants, not a tuning change.
- **If a horse should ever be *unable* to compete because of neglect** — a lameness state, a vet
  hold. §3.4 says no, and overview §8a's "a small penalty rather than a lame horse" says no, but it
  is the kind of thing that reads differently once a child has actually ignored a horse for a week.
  Ask before building it.
- **Whether the barn round should ask for confirmation** before spending several hundred at once.
  This document says no — one click is the whole point — but a child accidentally spending a stable's
  balance is a real complaint waiting to happen, and the answer may depend on the youngest player.
- **Part B's penalty size** (0.03) against the fact that a manageable condition is already a real
  cost in the market and in breeding decisions. If it feels like double punishment for a horse the
  child loves, say so rather than quietly halving it.
