# Slice 0027 — Training

Commissioned 2026-08-06, from a review of every commitment made about training across ten earlier
documents. Nothing is built; what exists is a set of hooks placed deliberately and a set of promises
made in passing. This document collects them, resolves the four forks the operator had to decide,
and specifies the whole stage.

Every decision below is settled. Where a number is a first guess it says so (§11).

Next free migration number is `0176`. Every migration also needs registering in
`src/db/migrations.ts` (CLAUDE.md §8).

---

## 0. What already exists

Read this before anything else — most of the design was already written down, scattered.

| Where | What it says |
|---|---|
| `src/engines/conformation/model.ts` | `realization(age, coi, config, trainingFactor = 1.0, careFactor = 1.0)` — carried since slice 0006, never set |
| `src/engines/showing/abilityScore.ts` | `trainingFactor` in the multiplier line, pinned 1.0 |
| `src/engines/showing/score.ts` | the conformation scorer's matching line — care, tack and age wired, training not |
| `src/lib/actions.ts` | `'start_training'` named in the comment as a future `ActionKind`, never added |
| `docs/horse-game-schema.md` §4.6 | `horse_training(horse_id, discipline_code, level, last_trained_game_day, total_sessions)`. "Per discipline, no permanent commitment, no decay in the first pass." |
| `docs/horse-game-schema.md` §6.4 | `training_level_applied` on `show_entries` |
| Slice 0012 §2.4 | **do not add that column until this slice.** The modifier line was built as a line of multipliers precisely so training enters as a factor and not a rewrite |
| Slice 0013 §3.4, overview §8a | care deliberately never touches displayed conformation numbers — a horse's neck does not get longer because the farrier came |
| Slice 0020 §5.2, build-log 2026-08-04 | workload is a stand-in (show entries in a trailing 90-day window) and is **flagged for replacement by real training load** the day training exists |
| Slice 0009 §5.3/§3.4 | training joins the list of things that cost a turn, and the list of things debt blocks |
| Overview §8c | a trainer for hire converts money into training throughput, partially routing around the action budget. Recommendation: leave trainers out of the first pass |
| Overview §12.1, CLAUDE.md §5.5 | training *rates* are a live tunable; programme *lengths* are snapshotted onto the entity |

**Three things have changed since most of those were written**, and they move the design:

1. **Six disciplines exist, not one.** "Per discipline" now means a real per-horse cost and interacts
   with `breeds.discipline_aptitudes`.
2. **Ability tests exist** (slice 0025 stage 3) and write a *permanent word* into
   `horse_ability_words` from the horse's true expressed value. Training multiplying that word would
   make it a record of spending rather than of breeding.
3. **Novice / Open / Champion ranks exist** (slice 0026, migration 0165). Training is now the obvious
   lever for climbing them, which raises how hard it is allowed to bite.

**Also found: training is missing from the build order entirely** (overview §13). It sits between
Market and Tack in dependency terms — it prices against a market that now exists, and tack is the
other multiplier on the same line. Add it there when this lands.

---

## 1. The four decisions

Taken by the operator, 2026-08-06, before this document was written.

1. **Training counts in every class type except ability tests.** Conformation, young conformation
   and discipline classes all read it. An ability test measures what a horse inherited and leaves a
   permanent word behind; a trained horse must not leave a word its genetics did not earn.
2. **A programme, with optional sessions inside it.** Enrol once and the horse improves on its own;
   turn up during the programme and it improves faster. Not one or the other.
3. **Money and one turn to start.** `start_training` finally joins `ACTION_COSTS`. Sessions inside a
   running programme are free of both.
4. **NPC horses carry a fixed middling training level**, set in config, with no per-horse simulation
   and no tick cost. Training is how a player gets *ahead of* the field, not how they catch up to it.

---

## 2. The model

### 2.1 What training is keyed on

One table, one row per `(horse_id, programme_code)`, where `programme_code` is either the reserved
string `'conformation'` or a `disciplines.code`.

**One function owns the mapping from a class to the programme that trains for it**, and nothing else
may restate it — `src/engines/training/programmes.ts`, pure:

```
trainingProgrammeForClass(classType, disciplineCode): string | null
  'breed_conformation'  -> 'conformation'
  'young_conformation'  -> 'conformation'
  'discipline'          -> disciplineCode
  'ability_test'        -> null          // §1 decision 1 — no training, ever
```

A `null` means the scorer passes `1.0`. That single return is the whole of decision 1's enforcement:
there is no second place where ability tests have to remember to exclude themselves, the way six call
sites once had to remember `category !== 'acquired'` before slice 0022 deleted them all.

Conformation is one programme, not one per breed. A horse has one breed, and both conformation class
types judge against it.

**This widens schema §4.6's standing decision, and says so rather than quietly building something
else** (CLAUDE.md §2). That decision — "per discipline" — was taken when one discipline existed and
conformation was the only other class type; decision 1 above puts training into conformation classes,
so a discipline-only key cannot express it. The column is `programme_code`, not `discipline_code`,
because a column named for disciplines that also holds `'conformation'` is a lie a future session has
to discover. Everything else in §4.6 stands unchanged: one row per horse per code, no permanent
commitment, no decay in the first pass, and `last_trained_game_day` stored against a decay flag that
does not exist yet.

### 2.2 Levels and the factor

Five levels, each with a word. **Words only on screen — no number, no meter, ever**, matching the
conformation labels and the ability words.

| Level | Word | Factor |
|---|---|---|
| 0 | Untrained | 1.000 |
| 1 | Started | 1.020 |
| 2 | Working | 1.035 |
| 3 | Schooled | 1.050 |
| 4 | Polished | 1.060 |

Stored as one config blob, `training_level_factors`, in the same shape `feed_levels` uses — array
index is the level, so a sixth level is a config edit and not a code change, and an out-of-range
stored level clamps to the last entry rather than throwing (`feedLevelDefinition`'s own forgiveness).

Three properties, all deliberate:

- **Diminishing returns.** +2.0, +1.5, +1.5, +1.0 percentage points. Overview §8b's rule for tack,
  applied here for the same reason: early purchases matter, late ones do not run away.
- **There is no training penalty.** Untrained is 1.000, not below it. A child who never opens the
  Training card is not punished — they miss an edge. This is the same principle as care's no-cliff-
  edges rule and the free-foals decision.
- **The top of the band is +6%**, against care's ±5%, age's −15% and show noise at 10–15%. Training is
  allowed to be slightly the largest of the modifiers a player *chooses*, and still much smaller than
  genetics. Overview §8a's failure mode — care and equipment swinging results more than breeding does
  — is the thing this number exists to stay under.

The engine is `src/engines/training/factor.ts`: `trainingFactorFor(level, config)`. Pure, no database
access (CLAUDE.md §5.1) and **no randomness at all** — like care, every value here is a deterministic
function of stored integers. There is nothing for §5.2 to seed.

### 2.3 Where it enters the score, and where it must not

**Into the scorers' existing multiplier line, and nowhere else.**

```
scoreEntry:        finalScore = rawScore × careModifier × tackModifier × trainingFactor × ageModifier + noise
scoreAbilityEntry: finalScore = rawScore × careModifier × tackModifier × trainingFactor × ageModifier × aptitudeModifier + noise
```

Both functions already take `trainingFactor` as a defaulted parameter. **Neither signature changes.**
The only work is in `judgeOneClass` (`src/db/shows.ts`), which computes the programme code from the
class (§2.1), looks up each horse's level, and passes a real number instead of the default — exactly
the shape slice 0013 §8.4 used to wire care in.

Batch the lookup. One query per class fetching every entered horse's row for that one programme code,
not one query per horse — slice 0026 §7.5a.1 had to go back and fix precisely that pattern.

### 2.4 Do not wire `realization()` — and delete its dead parameters

`realization()` carries `trainingFactor` and `careFactor` from slice 0006, both unset. **Leave
training out of it, and remove both parameters.**

Three reasons:

1. **Care already decided this** (slice 0013 §3.4): a modifier that moves displayed conformation
   numbers double-counts, because realization already feeds the raw score the modifier then
   multiplies again. The argument does not change when the modifier is called training.
2. **`realization()` is shared by `conformationValues` and `abilityValues`.** Wiring training there
   would raise a horse's ability values — and the ability values are exactly what `judgeOneClass`
   bands into the permanent word in `horse_ability_words`. Decision 1 would be broken by a side door
   that nothing in the ability-test code would show.
3. **A defaulted parameter nobody sets is a trap** for the session that finds it. Both stages that
   would have used these have now decided against them. Removing them is a two-line change with no
   behavioural effect, and it closes the trap.

This is a deliberate departure from slice 0006 §107's plan for those parameters. Record it in the
build log with the reasoning above.

---

## 3. The programme

### 3.1 Starting one

`POST /horses/:id/train` with `action=start` and a `programme` field.

**Costs** `training_programme_cost` and one turn — `start_training` joins `ActionKind` and
`ACTION_COSTS`, following the check-act-spend order every existing call site uses (build-log
2026-08-02: a child charged for something that did not happen has no way to get it back, so the rare
failure is a free turn, never an unexplained charge).

**Refused** (the confirmation card names the reason; no button drawn) when:

- not the owner, or the horse is dead / removed / retired
- younger than `training_min_age_game_days`
- the stable is in debt — slice 0009 §3.4 names training in that rule explicitly
- a programme is already in progress for this horse, in any code. **One at a time.**
- the horse already holds the top level in that programme code
- the horse is at pasture or settling in, or has an open incident (§3.4)
- the programme code is a discipline that is not enabled (`getEnabledDisciplines`). Existing levels in
  a discipline later disabled are untouched — gating admits new things, it never rewrites old ones
  (slice 0017a §6's rule)

**Writes**, in one batch: a `training_programmes` row, a `ledger` row of the new kind `training`, and
a `training_started` event.

**Length is snapshotted.** `length_game_days` and `due_game_day` are computed once from
`training_programme_game_days` and stored on the row. CLAUDE.md §5.5 names training programme lengths
as an example of exactly this; retuning the config must not move a horse already in work.

### 3.2 Sessions inside it

`POST /horses/:id/train` with `action=session`. **Free — no money, no turn.**

**At most one session per horse per tick**, enforced by comparing `last_session_tick_seq` on the
programme row against `world.tick_seq`.

That cap is the point, and it is worth stating plainly: **checking back more often than the tick
fires gains a child nothing.** Overview §6c names continuous energy regeneration as engineered to
drive compulsive re-checking and asks that this game not do it. Three ticks a day means at most three
sessions a day, and the button says so when it is spent.

**Barred** — button drawn but disabled, with the reason — while the horse is at pasture or settling
in, or has an open incident. A horse in the field is not in work; an injured horse in work is wrong,
and slice 0020's own risk model reads workload.

**The gain.** A completed programme awards **one level** — the money and the turn bought that much,
and a parent who enrols a horse and forgets about it still gets somewhere. Bank
`training_sessions_for_bonus_level` sessions during the programme and it awards **two**.

At 90 game days and 10 game days per tick, a programme spans about nine ticks, so five sessions means
turning up for a little over half of them. Missing them costs the bonus, never the programme.

`sessions_done` lives on the programme row, not on the horse: sessions earned in a finished
programme do not carry into the next one.

### 3.3 Completion, on the tick

New stage `completeDueTrainingProgrammes(env, gameDay)` in `src/db/training.ts`, placed immediately
after `noticeCareDue` in `executeTick`.

For every row with `status = 'in_progress' AND due_game_day <= game_day`, in one batch per row: upsert
`horse_training` to `MIN(top_level, level + gain)`, flip the programme to `status = 'completed'`, and
write a `training_completed` event naming the new word.

**Idempotent by the status flip** (CLAUDE.md §5.4): the gain is computed from the row that was read
and the row is no longer `in_progress` afterwards, so a re-fired or double-fired tick finds nothing to
do. The level is never blindly incremented outside that guard.

`horse_training` is upserted, not appended — the same shape `horse_ability_words` and
`horse_show_summary` already use.

### 3.4 Pasture, incidents, pause, sale, death

**At pasture — the programme pauses.** Mirror care exactly: `bringInFromPasture` (`src/db/care.ts`)
already credits days out of work back onto the care timers, and the same statement extends an
in-progress programme's `due_game_day` by the same number of days. One extra statement in a function
that already does this job; the programme never has to know about location.

**An open incident — the clock runs, sessions stop.** You lose the bonus, not the programme. This is
the design, not an oversight: it gives a colic in week two a real cost that is not cruel.

**A paused account** — a programme in progress completes on schedule. Slice 0026's pause principle
holds: pausing stops new bad luck, not what is already in motion, the same way an in-progress
pregnancy still foals. No sessions can be done, because every page is gated anyway.

**On sale — everything travels with the horse**, levels and an in-progress programme alike (slice
0017's rule). No cancel path, no refund question, one less special case. A buyer finishing a
programme the seller paid for is the same deal as buying a horse mid-pregnancy.

**Buying out of an NPC stable writes real rows.** Without this, a horse bought from an NPC stable
would silently get *worse* the moment it changed hands, because the NPC's level is derived from
ownership (§4) and the horse has no rows of its own. In the one shared sale batch, when the seller is
an NPC stable, insert a `horse_training` row at `npc_training_level` for `'conformation'` and every
enabled discipline. It is also simply true — the horse really was in work at that level.

**On death or removal** — `horse_training` and `training_programmes` both carry foreign keys into
`horses`, so both must be added to `deletableHorseSql`'s lists in `src/db/horseRemoval.ts` and to the
table list in `src/db/reset.ts`. CLAUDE.md's own note on that file is the rule being followed here: a
new table referencing `horses` must be added to one of its two lists.

### 3.5 No decay

Schema §4.6 decided this and it stands: no decay in the first pass. A level once earned is permanent.

`horse_training.last_trained_game_day` is stored anyway, doing nothing, exactly as §4.6 intended —
decay later is a config flag reading a column that already exists, with no schema change.

---

## 4. NPC horses

Config `npc_training_level`, default 2 (Working, +3.5%).

In `judgeOneClass`, a horse whose owning stable has no account reads
`MAX(stored level, npc_training_level)`. No rows are written, no tick stage runs, and it costs one
`MAX` in a loop that already fetches stable ownership.

The `MAX` matters in both directions: a Polished horse a player sells into an NPC stable does not get
worse, and an ordinary NPC-bred horse is brought up to the field standard.

The show barn is included — its horses' ranks are frozen (slice 0026 §4.5) but their training is the
field's baseline, and it should match the rest of the field.

**This number joins the NPC quality ceiling as the second dial governing how hard the computer field
is.** Keep it as data and keep it easy to change — CLAUDE.md's closing warning applies to it directly.
Setting it to 0 makes training a pure player advantage; setting it to 4 makes the field permanently
Polished and training a treadmill players run to stay level. Neither is the intent; 2 is.

---

## 5. Consequences elsewhere

### 5.1 Workload finally means training

Slice 0013 §3.4 declined to build workload because it "needs training to mean anything". Slice 0020
built it anyway as a legible stand-in — show entries in a trailing window — and flagged itself for
replacement the day training landed. This is that day.

`workloadFactor` (`src/db/incidents.ts`) becomes:

```
(show entries in window + training load in window) / workload_ceiling_entries, clamped to 0..1

training load = Σ over programmes overlapping the window of
                  training_programme_workload_entries + sessions_done × training_session_workload_entries
```

Computed from `started_game_day`/`due_game_day` overlap in the same batched shape the existing
workload query already uses — one more query per tick stage, not one per horse.

**Per-session precision was considered and declined**: it needs a third table to date each session,
for a number that is already an approximation of an approximation. If the four robustness-linked
incidents ever need sharper input, that is the change to make.

This is what stops training being pure upside. A horse in hard work is a horse more likely to pull a
suspensory, which is both true and the reason the risk model has a workload term at all.

### 5.2 Appraisal

`market_training_factors`, an array indexed by the **highest level held across all programme codes** —
`highestTrainingLevel(rows)`, mirroring `highestRankHeld`'s shape (`src/engines/showing/eligibility.ts`).

Default `[1.0, 1.03, 1.06, 1.10, 1.14]`, compounding into `appraise()` through the single
`appraiseHorseForStable` call site, so the market, the buy offers, NPC purchasing and the horse page's
guide value all pick it up at once (slice 0026 §1.5's route).

Without this the NPC market underprices every trained horse and a child sells a Polished mare for the
price of an untrained one.

### 5.3 The show snapshot

Add **`training_level_applied INTEGER NOT NULL DEFAULT 0`** to `show_entries` — a plain `ALTER TABLE
ADD COLUMN`, matching `care_modifier_applied` (0071) and `age_modifier_applied` (0075), and finally
keeping schema §6.4's and slice 0012 §2.4's promise.

The *factor* goes in `score_breakdown`'s new `training` block, not in a column, for the reason the
aptitude block gives: the factor table is a live tunable and is not snapshotted, so the breakdown is
its only surviving record of what a horse was actually judged with.

An `ability_test` entry stores level `0` and factor `1.0`, and its breakdown says so — a result page
that shows nothing is indistinguishable from one where something went wrong.

---

## 6. Screens

### 6.1 The Training card

On the horse page's **Shows** tab (slice 0026 stage 2), below the Ability card. Training exists to win
classes; it belongs with the classes.

**With a programme running:**

> **In training — Dressage.** Finishes in 40 days.
> 3 of 5 sessions done. Two more and she gains two levels instead of one.
> [ Do a session ]

The button is disabled with the reason when it is spent for this tick ("Already worked today — the
next session is available after the evening tick"), or while she is at pasture or has an open
incident.

**With none running:** every programme code the horse holds a level in, worded — `Conformation —
Schooled`, `Dressage — Started`, `Barrel Racing — Untrained`. A code with no row reads **Untrained**,
never blank. Then a picker of startable programmes, the cost, and the turn it will spend.

**Every redirect off this card goes through `horsePageUrl(horseId, 'shows', …)`** — slice 0026 §2.2's
rule, guarded by `test/horse-tabs-source.test.ts`, which reads `src/routes/horses.ts` off disk and
fails on a hand-built redirect.

### 6.2 The barn list

Two badges, mirroring care's own "due" badge: **In training** while a programme runs, and **Session
ready** when one is available this tick. A child should be able to find the horses waiting for a click
without opening eleven pages.

The tick cap (§3.2) is what keeps the second badge from becoming a chore treadmill: it can appear at
most three times a day per horse, and clicking sooner does nothing.

### 6.3 Routing and admin

One sub-path, `/train`, with an `action` field — the shape `/care` and `/stud` already use, rather
than two regex entries.

**Add `/train` to both `HORSE_ROUTE`'s regex and the handler chain in `src/router.ts`, and to
`test/router-paths.test.ts`.** The `/treat` 404 (a correct handler nobody could reach for a day) and
the same-account buy form are the two precedents; that test exists because of them.

No new admin screen. Every number is a live config key at `/admin/config`.

---

## 7. Data

**0176 — `horse_training`.** The permanent level. `horse_id` → `horses`, `programme_code` TEXT,
`level` INTEGER NOT NULL DEFAULT 0, `last_trained_game_day` INTEGER, `total_sessions` INTEGER NOT NULL
DEFAULT 0. `UNIQUE (horse_id, programme_code)`, which is what the upsert conflicts on.

**0177 — `training_programmes`.** One row per enrolment: `horse_id`, `programme_code`,
`started_game_day`, `length_game_days` (snapshot), `due_game_day`, `sessions_done`,
`last_session_tick_seq`, `last_session_game_day`, `status` CHECK `('in_progress','completed')`,
`cost_paid`. Index on `(status, due_game_day)` for the tick stage, and on `(horse_id, status)` for the
card — both are queries this slice actually makes (CLAUDE.md §7).

**0178 — `show_entries.training_level_applied`.** Plain `ALTER TABLE ADD COLUMN`.

**0179 — `ledger` kind `training`.** The usual full table rebuild; SQLite cannot `ALTER` a `CHECK`.
Follow `0171_ledger_add_gelding_kind.sql` exactly.

**0180 — config defaults.** All of §11's keys in one `json_set`.

---

## 8. What this slice does not build

Named so a future session knows they were considered.

- **The trainer profession.** Overview §8c's own recommendation is to leave trainers out of the first
  pass and add them once the action economy has been watched in play. Professions is its own unbuilt
  stage, and a trainer for hire is a way of converting money into training throughput — which is a
  decision about the action budget, best taken after this stage has been played with.
- **Decay.** §3.5. The column is there.
- **Tack.** The other unbuilt multiplier on the same line. It stays independent — two multipliers,
  two parameters, sharing nothing.
- **Per-discipline training *aptitude*.** A horse trains at the same rate in everything. Breed already
  speaks to discipline through `discipline_aptitudes`; a second breed-shaped term here would be hard
  to read and easy to double-count.

---

## 9. Tests

1. `trainingFactorFor` returns the table's factors, clamps an out-of-range level to the top entry, and
   returns 1.0 for level 0.
2. `trainingProgrammeForClass` returns `null` for `ability_test` and the right code for the other
   three types.
3. **An `ability_test` entry is judged at factor 1.0 for a Polished horse**, and the word written to
   `horse_ability_words` is identical to the untrained horse's with the same genotype. This is
   decision 1; test it through `judgeOneClass` against a real database, not through the engine.
4. A `young_conformation` entry *does* read the `'conformation'` level.
5. Completion is idempotent: running the tick stage twice over one due programme raises the level once.
6. Five sessions banked yields two levels; four yields one.
7. A session is refused twice in the same `tick_seq` and allowed after it advances.
8. Bringing a horse in from pasture pushes `due_game_day` out by exactly the days out, and its care
   timers by the same amount (extend the existing pasture test rather than writing a second one).
9. Starting is refused for: a second programme, a top-level programme code, a disabled discipline, a
   stable in debt, and a horse below `training_min_age_game_days`.
10. An NPC-owned Untrained horse judges at `npc_training_level`; an NPC-owned Polished one judges at
    Polished. Buying a horse out of an NPC stable writes rows at `npc_training_level`.
11. `appraise()` on two identical horses differing only in highest training level returns the higher
    value for the trained one.
12. `workloadFactor` rises with an overlapping programme and rises further with sessions banked.
13. `/train` appears in both `HORSE_ROUTE`'s regex and the handler chain (extend
    `test/router-paths.test.ts`), and every redirect off the Training card goes through
    `horsePageUrl` (extend `test/horse-tabs-source.test.ts`).
14. `horse_training` and `training_programmes` both appear in `src/db/reset.ts`'s table list and in
    `deletableHorseSql`'s lists.

---

## 10. Numbers that are first guesses

`training_programme_cost` (250) · `training_programme_game_days` (90) · `training_min_age_game_days`
(360) · `training_sessions_for_bonus_level` (5) · `training_level_factors`
(1.0 / 1.02 / 1.035 / 1.05 / 1.06) · `npc_training_level` (2) · `market_training_factors`
(1.0 / 1.03 / 1.06 / 1.10 / 1.14) · `training_programme_workload_entries` (1) ·
`training_session_workload_entries` (0.5).

All live config, all editable at `/admin/config`.

**The two to watch first.** `npc_training_level`, because it decides whether training is an edge or a
treadmill and it is invisible until a child notices they cannot win. And the top of
`training_level_factors`, because +6% sits directly against show noise at 10–15% — if it turns out
that a Polished ordinary horse beats an Untrained good one more often than feels right, that is the
number to cut, not the noise.

Costing, for scale: at 90 game days a programme is about three real days, and taking one horse from
Untrained to Polished costs 1000 across roughly twelve real days — against a farrier call at 30, a
full genotype panel at 700, and a show win paying 600.
