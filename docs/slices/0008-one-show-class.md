# Slice 0008 — One show class: the Quarter Horse ideal, a judge, and a placing

**Status:** specified, not built. Next in the build order (`CLAUDE.md` §10). Slices 0001, 0002, 0003, 0005, 0006 and 0007 are built. Slice 0004 (semen storage) and slice 0005 §7 (the parent's PIN) are specified but not built, and **nothing here depends on either** — they can land before or after this in any order.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those.

**What this slice is.** Every horse in the game already carries four real, heritable, visible conformation measurements. Nothing in the game has an opinion about them. This slice adds the first opinion: a Quarter Horse breed standard, three judges who weight it differently, a monthly show, and a class that ranks the horses entered into it and hands out ribbons.

**Why this comes now.** The build order calls this *"One show class that scores it — the Quarter Horse's ideal vector, and the class that judges against it. A playable loop exists here. Worth stopping to actually play it."* Slice 0006 §2.3 deliberately refused to score, rank or average anything, and put a sentence on every horse page promising that *which end a breed wants arrives with the first show class*. This is that slice. It is the one that makes breeding decisions pay off, and it closes the loop the game has been building towards since slice 0001: breed a horse → watch it grow → show it → find out whether the pairing you chose was a good one.

**One thing to hold onto while building.** A show result is an **explanation**, not just a number. Overview §9 is explicit: *"Snapshot how a result was reached, not just the result… it means a child asking why their horse placed fourth gets an answer months later."* Every screen in this slice must be able to answer that question, and every score must be reconstructible from stored data years later. See §7.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. Go to `/admin/shows`. Press **Stock the show barn**. Six Quarter Horses appear in an NPC stable that no player owns.
3. Press the admin advance button until the tick creates a show. `/shows` lists it: a name, a date in game days, the class it holds, and who is judging.
4. Open the show. It names the judge and says in one sentence what that judge cares about most.
5. Open a Quarter Horse aged three or over. Press **Enter in a show**. It appears in the class's entry list.
6. Try to enter an Arabian, a two-year-old, and a crossbred. Each refusal names the horse and says exactly which rule it failed.
7. Advance the tick past the show's date. The class is judged. Every entry has a placing, the top six carry ribbon colours, and the results are on `/shows/:id`.
8. Open a result. It shows, per trait: what your horse measured, what the breed standard wants, how much this judge weighted it, and the points that came out. The sum of those, plus the noise, is the final score printed at the bottom. The arithmetic visibly works.
9. Open the horse's page. A **Show record** card shows starts, wins, best result, and its recent placings.
10. Advance the tick a further month. A new show is created with a **different** judge, and a horse that placed second under the first judge can place first under the second.
11. Press the admin advance button several times in a row over a show that has already been judged. Nothing is judged twice, no horse's start count goes up twice, no duplicate entries appear.
12. Look everywhere. No money has moved, no balance has changed, and nothing anywhere shows a horse's speed, stamina, jump scope, trainability or fertility.

If all twelve work, the slice is done.

---

## 2. Decisions taken for this slice

These four were decided in conversation on 2 Aug 2026, when this document was written. They are decisions, not recommendations.

### 2.1 Shows run monthly — every 30 game days

This closes the **show cadence** open question in overview §14.

At the current settings — `game_days_per_tick = 10`, three tick slots a day — the world advances 30 game days per real day. A monthly circuit is therefore **one show per real day**, which is exactly the reasoning overview §9 arrives at: *"At one month per real day, a monthly circuit means a show every real day, which sits neatly against the tick schedule and the action budget."*

The interval is config (`show_interval_game_days`, default 30), and shows are scheduled **in game days, not in ticks** — per overview §9 and `CLAUDE.md` §5.3, so the calendar survives a change to how often the tick fires.

### 2.2 One NPC stable of real, stored horses fills the field

With around five players, a Quarter-Horse-only class could easily have one entry. A child who wins uncontested every month has not won anything, and the "worth stopping to actually play it" moment falls flat.

**The fix is the simplest honest form of what the design already calls the destination.** Overview §10b: *"An NPC stable is a bot player. It owns horses with real genotypes… No parallel scoring path. Two scoring paths will drift apart and one will end up accidentally advantaged."* It also considers generating throwaway opponents at scoring time and calls that *"reasonable as an interim step; not recommended as the destination."*

So: **one NPC stable, holding real `horses` rows**, generated by the founding-stock generator that already exists (`generateCandidate`, `src/engines/founding/generate.ts`), scored by exactly the same code as player horses. They are inspectable — a child can open one and see its conformation like any other horse.

**What they deliberately do not do in this slice:** breed, age out, die, get bought, get sold, or improve. There is no selection policy and no quality ceiling. Those are the NPC stages further down the build order (overview §10c/§10d), and §10d's escalation risk is the failure mode most likely to kill this project — do not start it here by accident. The show barn is a fixed set of horses an admin mints once and can top up by hand.

### 2.3 Ribbons only — no entry fees, no prize money, no ledger

Nothing in this game has spent or earned a penny yet; `stables.balance` has held its starting value since slice 0001 and nothing writes to it.

**This slice does not change that.** No `entry_fee` column, no `prize_awarded` column, no `ledger` table, no write to `stables.balance` anywhere. Placings and a permanent show record are the whole reward.

**This is a deliberate departure from the schema document**, which specifies `entry_fee` and `prize_structure` on `show_classes` and `prize_awarded` on `show_entries` (schema §6.2, §6.4). Those columns are correct for the finished game and wrong for the first one: money in a five-player economy with no market, no upkeep and nothing to buy is a number that goes up. It arrives with the market stage, where it has somewhere to go. Adding the columns then is a migration; adding them now is dead weight that has to be explained to every session in between.

**Do not add money to this slice for tidiness.** If a later slice adds it, `show_entries` gains a `prize_awarded` column and the ledger arrives with it.

### 2.4 Three judges, weighting the standard differently

Overview §9: *"Rotating judges who weight traits differently… means no single horse dominates every class. This matters unusually much when the losing player is at your dinner table."*

A judge is a row with a JSON weights object. Three of them is not machinery — it is a seed migration — and it is the difference between *the best horse always wins* and *it depends who's judging*. Without it, one child's best horse takes every ribbon until the NPC stages land, which is a long time to be losing to the same horse.

Each show's class draws a judge deterministically from the pool off the show's own seed. The judge is named on the show page **before** the class is judged, so a player can decide whether to enter.

---

## 3. Not built here

Say no to all of these. Each has its own stage in the build order.

- **Money in any form** — see §2.3.
- **Performance classes, gaited classes, and cross eligibility.** Overview §4c: crosses are eligible for performance classes and barred from breed classes. This slice builds one breed class, so crosses are barred and there is nowhere else for them to go yet. `show_classes.crosses_eligible` and `requires_gait` exist as columns and the eligibility engine honours both, because both are two lines and testable — but the seeded class sets `crosses_eligible = 0` and `requires_gait = 0`, and no other class type is built.
- **The other seven breeds' ideal vectors.** Overview §4a is explicit that these arrive in one later stage, after the scorer exists and has been tuned against one breed. **Do not write an ideal vector for any breed but the Quarter Horse.** Slice 0005 §2.2 and slice 0006 §2.3 both already refused to do this; it is the same refusal a third time.
- **Registries and the Circle of Excellence** (overview §9a, schema §6.6). This slice builds `horse_show_summary`, which is the table a registry evaluates against — but no registry, no criteria, no inductees. The standards-versus-circles fork is still open in overview §14 and is a family-dynamics decision, not a technical one.
- **Care, tack and training modifiers.** Overview §8a puts these at ±5%, deliberately smaller than show noise. Nothing tracks care or tack yet. The scorer's shape leaves room for them (§4.5) but this slice passes no such modifier and stores no such column.
- **Show tiers.** `shows.tier` exists and every show seeded here is `'local'`. Regional and national arrive with the NPC ceiling schedule, which is what makes tiers mean anything.
- **The action budget.** "Turns and tick" has not been built, so nothing limits how much a player does per tick. §5.4's per-stable entry cap is the stand-in, and it is a cap on this one thing rather than the beginning of a budget system.
- **An entry deadline distinct from the show date.** Entries close when the tick judges the show. See §6.3.
- **Withdrawing an entry.** Entering is final. Adding a withdrawal is easy later; deciding whether a withdrawal refunds anything is not, and there is nothing to refund yet.

---

## 4. The scoring model, precisely

All of this is pure functions in `src/engines/showing/`, no database access, per `CLAUDE.md` §5.1. The caller reads the rows, calls the engine, writes the result.

### 4.1 What the scorer reads

For each horse: its **four expressed conformation values**, exactly as slice 0006 already computes them for display — `conformationValues(genotype, noise, ageYears, coi, config)` in `src/engines/conformation/model.ts`, returning `expressed` per trait on a 1–99 scale.

**Use `expressed`, not `matureExpressed`.** A four-year-old is judged on the horse standing in front of the judge, not on the horse it will become. This is the whole reason the class has a minimum age (§5.4) and it is the mechanic that makes a horse's show career have a shape — improving as it matures, and eventually being beaten by younger stock.

**Do not re-implement any part of slice 0006's pipeline.** If the scorer needs a number, it comes out of `conformationValues`. Two implementations of realization will drift, and the horse page and the show result will then disagree about the same horse on the same day, which is exactly the bug a child will find first.

### 4.2 The breed ideal

A breed's ideal vector is a JSON object on the `breeds` row: for each conformation trait, a **target** on the same 1–99 scale the horse is measured on, and a **weight** saying how much that trait matters to this breed.

```json
{
  "v": 1,
  "traits": {
    "neck_length":    { "target": 55, "weight": 1.0 },
    "shoulder_angle": { "target": 70, "weight": 1.2 },
    "back_length":    { "target": 35, "weight": 1.1 },
    "hock_set":       { "target": 50, "weight": 0.9 }
  }
}
```

Those are the Quarter Horse's numbers, and they are chosen to be genuinely non-trivial rather than "high is good": a Quarter Horse wants a **moderate neck**, a **sloping shoulder**, a **short back**, and a **middling hock** — neither post-legged nor sickle-hocked. Three of the four targets are somewhere other than the top of the scale, which is the point. A child who breeds for "more of everything" will not win, and finding that out is the lesson.

**Every breed is a row, never a branch.** `CLAUDE.md` §11's breeds entry: *"If you find yourself typing `if (breed.code === '...')`, the thing you want is a field on the row instead."* A breed with a null `ideal_vector` simply cannot have a breed class created for it — the class-creation code skips it — and that is how the other seven breeds behave until their stage lands.

### 4.3 The judge

A judge is a row in `judges` with a `trait_weights` JSON object — a multiplier per conformation trait, centred on 1.0:

```json
{ "v": 1, "traits": { "neck_length": 1.1, "shoulder_angle": 1.6, "back_length": 0.8, "hock_set": 0.7 } }
```

A missing trait key reads as `1.0`, so a judge row written before a fifth conformation trait exists keeps working. Use the same missing-key discipline the genotype blob uses (`CLAUDE.md` §11, slice 0002 entry).

### 4.4 The score

For each conformation trait *t*:

```
distance_t    = |expressed_t − target_t|
traitScore_t  = max(0, 100 − distance_t × show_ideal_falloff)
weight_t      = breedWeight_t × judgeWeight_t
```

```
rawScore = Σ (weight_t × traitScore_t) / Σ weight_t
```

`show_ideal_falloff` is config, default **2.0** — so being 10 points off the standard on a trait costs 20 points on that trait, and being 50 or more off scores zero on it. The division by `Σ weight_t` keeps `rawScore` on a 0–100 scale no matter what the weights are, which is what makes two different judges' scores comparable in size (and makes the numbers on screen mean something to a child).

### 4.5 Noise, and the final score

```
finalScore = rawScore × careModifier × tackModifier + noise
```

`careModifier` and `tackModifier` are **pinned at 1.0** and nothing in this slice sets them otherwise (§3). They are named in the function signature with defaults, the same way slice 0006's `realization()` carries `trainingFactor`/`careFactor`, so the stage that builds care can wire them in without changing this function's shape.

```
noise = rng.normal(0, show_noise_sd)
```

drawn from a seed derived per **(class, horse)** — see §7.2. Default `show_noise_sd` is **5**, in score points on the 0–100 scale.

**A note on where "5" comes from, because it looks like a disagreement with the design record and is not one.** Overview §9 says noise *"somewhere around 10–15%"* is the usual working range. That figure describes the *size of the swing*, not a multiplier on the score. On our 0–100 scale, a standard deviation of 5 points means a two-sigma swing of about ±10 points — the top of §9's range — and it means two horses eight points apart in raw score finish in that order about **87% of the time**. That is the behaviour §9 is describing: close classes genuinely swing, clear superiority usually holds. Implementing it as a percentage of the score instead would make noise *smaller* for the horses that are already losing, which is backwards. If tuning shows this is too loose or too tight, `show_noise_sd` is a live tunable on `/admin/config` — change it there, not in code.

### 4.6 A worked example, checked

Quarter Horse standard as in §4.2. `show_ideal_falloff = 2.0`.

Two horses:

| | neck | shoulder | back | hock |
|---|---|---|---|---|
| **Ash** (expressed) | 58 | 66 | 40 | 52 |
| **Birch** (expressed) | 55 | 71 | 48 | 50 |
| Standard wants | 55 | 70 | 35 | 50 |

Trait scores (`100 − distance × 2`):

| | neck | shoulder | back | hock |
|---|---|---|---|---|
| Ash | 94 | 92 | 90 | 96 |
| Birch | 100 | 98 | 74 | 100 |

Ash is decent everywhere. Birch is near-perfect on three and clearly long in the back.

**Under Judge Marchbank (balanced — all weights 1.0).** Combined weights are the breed's own: 1.0, 1.2, 1.1, 0.9, summing to 4.2.

- Ash: (94×1.0 + 92×1.2 + 90×1.1 + 96×0.9) / 4.2 = 389.8 / 4.2 = **92.81**
- Birch: (100×1.0 + 98×1.2 + 74×1.1 + 100×0.9) / 4.2 = 389.0 / 4.2 = **92.62**

Ash wins, by two tenths of a point — well inside the noise, so this pair genuinely swings from month to month.

**Under Judge Ellery (favours the shoulder — 1.1 / 1.6 / 0.8 / 0.7).** Combined weights are 1.1, 1.92, 0.88, 0.63, summing to 4.53.

- Ash: (94×1.1 + 92×1.92 + 90×0.88 + 96×0.63) / 4.53 = 419.72 / 4.53 = **92.65**
- Birch: (100×1.1 + 98×1.92 + 74×0.88 + 100×0.63) / 4.53 = 426.28 / 4.53 = **94.10**

Birch wins, and not narrowly.

**Under Judge Halloway (favours substance — 0.8 / 0.8 / 1.5 / 1.3).** Combined weights are 0.8, 0.96, 1.65, 1.17, summing to 4.58.

- Ash: (94×0.8 + 92×0.96 + 90×1.65 + 96×1.17) / 4.58 = 424.34 / 4.58 = **92.65**
- Birch: (100×0.8 + 98×0.96 + 74×1.65 + 100×1.17) / 4.58 = 413.18 / 4.58 = **90.21**

Ash wins clearly — Birch's long back is the thing this judge cares about most.

**Same two horses, three judges, two different winners.** That is §2.4 working, and it is worth putting these exact numbers in a test.

> **Check this arithmetic yourself before building.** Slice 0006 §4.4 shipped a worked example whose prose result disagreed with its own formula, and the session that built it correctly implemented the formula and flagged the prose. Do the same here: if a number above does not reproduce, the formula in §4.4 is the specification and the table is the mistake. Say so in your summary.

### 4.7 Placing

Sort entries by `final_score` descending. Ties break by `raw_score` descending, then by `horse_id` ascending — deterministic, so re-running the scorer on the same data produces byte-identical placings. Real ties are near-impossible once real-valued noise is added; the tiebreak exists so the sort is total rather than because ties are expected.

Placings are 1-based and every entry gets one, however large the field.

**Ribbons.** The top six placings carry a colour, using the ordinary US show convention: **1st blue, 2nd red, 3rd yellow, 4th white, 5th pink, 6th green**. This is a display constant in the renderer, not a column and not config. Seventh and below place without a ribbon. It costs nothing and it is most of what a seven-year-old will actually care about.

---

## 5. Data

**Read `migrations/` and take the next free number.** At the time of writing the last file is `0031_config_conformation.sql`, so these would be `0032`–`0041` — but `CLAUDE.md` §11's numbering entry exists because that guess has been wrong twice already. One logical change per file, per `CLAUDE.md` §8, and **register every new file in `src/db/migrations.ts`** or `/admin/migrations` cannot see it.

### 5.1 New table: `judges`

```
id, code (unique), name, blurb, trait_weights (TEXT, JSON — §4.3), active (0/1), sort_order
```

`blurb` is one plain sentence shown on the show page — *"Likes a horse that moves; weights the shoulder above everything else."* Editable from D1's console without a deploy, the same way `quantitative_traits.teaching_text` is.

Seeded with three rows, matching §4.6's worked example:

| code | name | weights (neck / shoulder / back / hock) | cares about |
|---|---|---|---|
| `balanced` | Marchbank | 1.0 / 1.0 / 1.0 / 1.0 | the standard as written |
| `movement` | Ellery | 1.1 / 1.6 / 0.8 / 0.7 | the shoulder, and how the horse moves |
| `substance` | Halloway | 0.8 / 0.8 / 1.5 / 1.3 | a short strong back and correct hocks |

Judge names are placeholders — surnames only, no first names, clearly fictional. The operator can rename them from D1's console; nothing keys off the name.

### 5.2 New column: `breeds.ideal_vector`

`TEXT`, nullable, JSON as in §4.2. Null on all eight breeds after the schema migration; a second migration writes the Quarter Horse's. Seven breeds stay null and that is the correct state until their stage lands.

Document the JSON shape in a comment at the top of the migration, per `CLAUDE.md` §7.

### 5.3 New table: `shows`

```
id, name, tier ('local'/'regional'/'national'), venue,
scheduled_game_day, entry_deadline_game_day,
status ('entries_open' / 'judged' / 'cancelled'),
rng_seed, created_game_day, created_real_ts
```

`UNIQUE (scheduled_game_day, tier)` — one local show per game day. **This index is what makes the show-creation tick stage idempotent** (§6.1); it is not a cosmetic constraint, so do not drop it if it ever gets in the way.

`venue` is a place name drawn deterministically from a fixed twelve-name list by the show's month index, so the same venue comes round each year and the circuit feels like a circuit. `name` is assembled at creation and stored — `"Cedar Hollow Spring Show, Year 2"` — never re-derived, so renaming the list later does not rewrite history.

### 5.4 New table: `show_classes`

```
id, show_id, name, class_type ('breed_conformation'),
breed_id (nullable), discipline_code (nullable, always null here),
min_age_game_days, max_age_game_days (nullable), sex_restriction (nullable),
crosses_eligible (0/1), requires_gait (0/1),
target_field_size, max_entries_per_stable,
judge_id, ideal_vector (TEXT, JSON), ideal_falloff (REAL), noise_sd (REAL),
status ('scheduled' / 'judged'), judged_game_day (nullable), rng_seed
```

**Every rule the class is judged by is snapshotted onto the class row at creation** — the ideal vector, the falloff, the noise standard deviation, the age limits, the field size, the entry cap. This is `CLAUDE.md` §5.5, and it matters more here than almost anywhere else in the codebase: a class judged in March under one standard and a class judged in April under a retuned standard must both stay explainable, and a result whose rules have since changed underneath it is not an explanation of anything.

Config supplies these as defaults **at class-creation time only**. Nothing in the judging stage reads config for a scoring parameter — it reads the class row. If you find the scorer reaching for `ctx.config`, something has gone wrong.

`min_age_game_days` defaults from `show_conformation_min_age_game_days`, **1080** — three game years, the same number `min_breeding_age_game_days` already uses. Younger horses are barred because slice 0006's realization deliberately holds a foal near the population middle, so a yearling would be judged on a shape it does not have yet. Say that in the refusal message when someone tries.

`max_entries_per_stable` defaults from config at **3** — the stand-in for the action budget that does not exist yet (§3).

### 5.5 New table: `show_entries`

```
id, class_id, horse_id, entered_by_stable_id, is_npc, entered_game_day,
conformation_snapshot (TEXT, JSON),
raw_score (REAL, nullable), noise_applied (REAL, nullable), final_score (REAL, nullable),
score_breakdown (TEXT, JSON, nullable),
placing (INTEGER, nullable), scored_game_day (nullable)
```

`UNIQUE (class_id, horse_id)` — a horse cannot be entered twice, and this is also the backstop against the field-filling stage double-inserting an NPC horse on a re-fired tick.

Index `(horse_id)` — the horse page's show-record card reads it.

**`conformation_snapshot`** is written at *entry* time and holds what the horse measured when it was entered, plus its age and COI:

```json
{ "v": 1, "traits": { "neck_length": 58, "shoulder_angle": 66, "back_length": 40, "hock_set": 52 },
  "age_years": 4.2, "coi": 0.0625 }
```

**`score_breakdown`** is written at *judging* time and is the thing that answers "why did my horse place fourth", per overview §9:

```json
{ "v": 1, "judge_code": "movement",
  "traits": [ { "code": "neck_length", "expressed": 58, "target": 55, "weight": 1.1, "trait_score": 94 }, … ],
  "weight_sum": 4.53, "raw_score": 92.65, "noise": -1.31, "final_score": 91.34 }
```

**This is a small departure from the schema document**, which specifies a single `phenotype_snapshot` blob plus separate `care_modifier_applied` / `tack_modifier_applied` / `training_level_applied` columns (schema §6.4). Two blobs — one for what was measured, one for how it was scored — is the same information split along the line the screens actually read it, and the three modifier columns are omitted because nothing sets them (§2.3, §3). Add them when something does.

Scores are `REAL`. **The no-floats rule in `CLAUDE.md` §7 is about money and does not apply here** — the same exemption `horses.coi` already takes, and for the same reason.

### 5.6 New table: `horse_show_summary`

```
horse_id (PRIMARY KEY), starts, wins, placings (TEXT, JSON), best_placing, last_shown_game_day
```

`placings` is a JSON object of position → count, `{"1": 3, "2": 1, "4": 2}`. `total_earnings` from schema §6.5 is omitted — no money (§2.3).

Per schema §6.5 this is **permanent and survives the horse**, which is why it is a separate table rather than columns on `horses`: the ageing-and-death stage will prune horse rows, and a show record that vanishes with the horse makes a future hall of fame meaningless. It is also the table a registry will evaluate against, which is why it is worth building now even though nothing evaluates it yet.

**Updated incrementally** (`starts = starts + 1`), which is not idempotent on its own — its safety comes entirely from the class status guard and the atomic batch in §6.2. That coupling is load-bearing; do not move the summary update out of that batch.

### 5.7 New table row: the NPC show barn

A plain SQL migration inserts one stable with `is_npc = 1`, `account_id NULL`, a fixed prefix, `capacity` large enough for the barn, and `prefix_locked = 1`.

**It must also insert the matching `stable_prefix_history` row**, per `CLAUDE.md` §11's prefix-registry entry — both rows in the same migration, so no player can ever claim that prefix. Getting this wrong is silent until a child picks the same word and the insert fails.

The horses are **not** seeded by migration — they need the JS generator and the RNG, which plain SQL has no access to. An admin action mints them (§8.2).

`src/db/npc.ts` exports the prefix as a named constant and `getShowBarnStable(env)` looks the stable up by it. One documented magic string, replaced by a proper `npc_policy` row when the NPC stage lands.

### 5.8 Config

One migration adding these to the single config row, plus matching entries in `ConfigValues` in `src/lib/config-cache.ts`:

| key | default | live or snapshotted |
|---|---|---|
| `show_interval_game_days` | 30 | live — changes when the *next* show is created |
| `show_entry_window_game_days` | 30 | live — how far ahead a show is created and entries open |
| `show_noise_sd` | 5 | **snapshotted onto the class** at creation |
| `show_ideal_falloff` | 2.0 | **snapshotted onto the class** at creation |
| `show_target_field_size` | 8 | **snapshotted onto the class** at creation |
| `show_max_entries_per_stable` | 3 | **snapshotted onto the class** at creation |
| `show_conformation_min_age_game_days` | 1080 | **snapshotted onto the class** at creation |
| `npc_show_barn_quality_band` | `"mid"` | live — read when an admin stocks the barn |
| `npc_show_barn_size` | 6 | live — read when an admin stocks the barn |

Changing a snapshotted value affects classes created afterwards and never a class that already exists — which is the entire §5.4 argument, and worth one sentence on `/admin/config` next to them.

`show_noise_sd`, `show_ideal_falloff` and the quality band are fractional, so they go in the `DECIMAL_CONFIG_KEYS` list slice 0006 added to `routes/admin.ts` rather than the whole-numbers list. `npc_show_barn_quality_band` is a string and belongs on `/admin/shows` as a dropdown, not on the numeric config form — the same treatment `founding_quality_band` already gets.

---

## 6. The tick

Two new stages in `src/db/shows.ts`, called from `executeTick` in `src/db/tick.ts` **after** the existing breeding stages, in the same try block, guarded the same way. Follow the pattern slice 0003 established exactly — read its comment in `tick.ts` before adding to it.

### 6.1 Stage one: create shows that are due

Shows fall on game days that are exact multiples of `show_interval_game_days`. Each tick, for every such day falling in `(gameDay, gameDay + show_entry_window_game_days]` that has no `shows` row, create one: mint its seed, pick its venue and name, create its class, and pick the class's judge.

**Idempotency comes from the `UNIQUE (scheduled_game_day, tier)` index**, not from a counter and not from a "last created" column. Derive which shows *should* exist from `game_day` arithmetic and insert the missing ones — `CLAUDE.md` §5.4's *"write `x = f(game_day − last_processed)` rather than `x += 1`"*, applied to a calendar. A tick that fires twice creates nothing the second time. A tick that is missed entirely creates the show late but on its correct game day, and if that day has already passed the show is created and judged in the same tick, which is the right behaviour for a world that was paused.

A class is only created for a breed whose `ideal_vector` is non-null (§4.2). Today that is the Quarter Horse and nothing else, and when the other seven breeds get vectors, they get classes with no code change.

### 6.2 Stage two: judge shows whose day has arrived

For every class whose show's `scheduled_game_day <= gameDay` and whose `status = 'scheduled'`:

1. Load the entries.
2. **Top the field up.** If entries are fewer than `target_field_size`, pick eligible NPC horses from the show barn — deterministically, off `deriveSeed(class.rng_seed, 'npc_field')` — and build entry inserts for them. Never more than the shortfall.
3. Score every entry (§4), sort, assign placings (§4.7).
4. Build **one `env.DB.batch()`** containing: the NPC entry inserts, every entry's score/breakdown/placing update, every entered horse's `horse_show_summary` upsert, and finally the class's `status = 'judged'` update (and the show's, once all its classes are judged).

**That single batch is the whole idempotency story**, and it is the thing most likely to be broken by a well-meaning refactor. D1 batches are one implicit transaction (`CLAUDE.md` §11, prefix-registry entry): if the tick dies anywhere in it, nothing lands, the class is still `'scheduled'`, and the next tick redoes all of it identically — same NPC field, same noise, same placings, because every draw is seeded per (class, horse) rather than per insert order (§7.2). If the summary updates were split into their own batch, a crash between the two would double a horse's start count with no way to detect it.

**Topping up at judging time rather than at creation time is deliberate.** It means the NPC field is decided by the same seed that scores the class, in one pass, with no half-populated intermediate state and no wrong top-up count when a player enters late. The cost is that a player cannot see who they are up against before entering — which is arguably better, and is certainly truer to a real entry list.

---

## 7. Seeds and reproducibility

`CLAUDE.md` §5.2 admits no exceptions: every draw goes through `src/lib/rng`, and a sub-seed is always `deriveSeed(parentSeed, label)` — never a second `makeRng` from a stored seed.

### 7.1 Seeds minted

- `shows.rng_seed` — `randomSeed()` at creation. The only new call to `randomSeed()` in this slice.
- `show_classes.rng_seed` — `deriveSeed(show.rng_seed, 'class_' + ordinal)`, where ordinal is 1-based within the show. Not minted independently, so a show's whole outcome is reconstructible from one stored number.

### 7.2 New sub-seed labels

From `shows.rng_seed`: `venue`, `class_<n>`, `judge_<n>`.
From `show_classes.rng_seed`: `npc_field`, and **`noise_<horseId>`** for each entry's noise draw.

**Deriving the noise per horse id rather than drawing sequentially down the entry list is the important one.** It means the noise a horse gets does not depend on how many other horses entered, what order they entered in, or whether the tick is being re-run after a crash. A re-fired tick reproduces the class byte for byte. Sequential draws would not, and the failure would be invisible until someone asked why a result changed.

From the show barn horses' own seeds: nothing new — a minted NPC horse goes through `generateCandidate` and `buildFoundingHorseInsertStatement` exactly as a founding candidate does, reusing `pool_mendelian`, `pool_polygenic`, `founding_age` and `birth_noise` unchanged.

`test/rng.test.ts`'s golden values must not change. Nothing in this slice touches the RNG algorithm; if that test fails, stop.

---

## 8. Where it appears

### 8.1 Player screens

- **`/shows`** — the circuit. The next show with its date, venue, class and judge; a link to enter; and the last few judged shows with their winners. Reached from a new **Shows** link in the primary nav (`pageShell` in `src/render/layout.ts`).
- **`/shows/:id`** — one show. Before judging: the class, its rules in plain English (breed, minimum age, purebreds only), the judge and their blurb, the current entry list, and a form to enter one of the current stable's eligible horses. After judging: the full results table, placings, ribbon colours, and a link into each entry's breakdown.
- **`/shows/:id/entries/:entryId`** — one result, explained. The per-trait table from §5.5's `score_breakdown` — what your horse measured, what the standard wants, this judge's weight, the points — then the weighted average, the noise, and the final score. **This is the screen the whole slice exists for.** Write it so the arithmetic visibly adds up, and say in one plain sentence that the noise is the judge having an ordinary human day.
- **Horse page** — a **Show record** card: starts, wins, best placing, last shown, and the horse's recent results with placings and ribbons. Plus an **Enter in a show** button when the horse is eligible for an open class, and a plain sentence saying why not when it is not.
- **Barn list** — a small ribbon count or best-placing badge per horse. Keep it to one glanceable thing; the barn list is already dense.

**Two things must be true of every one of these screens.** Nothing shows a horse's speed, stamina, jump scope, trainability or fertility (slice 0006 §2.1, slice 0003 §5). And nothing shows an NPC horse's genotype that it would not show a player's — the show barn's horses go through the same render path, with the same truth/knowledge line (`CLAUDE.md` §12), or the first thing a child learns is to read the opposition's genes.

### 8.2 `/admin/shows`

A new admin subpage in the existing subnav pattern (`adminSubnav()` in `src/render/admin.ts`). Per `CLAUDE.md` §13 there is no polished admin UI, so this is a read-only display of the live tunables plus three controls:

- **Stock the show barn** — mints `npc_show_barn_size` Quarter Horses into the NPC stable at the chosen quality band, using `generateCandidate` and `buildFoundingHorseInsertStatement`. Idempotent in the sense that it tops the barn up to the target count rather than always adding more. Requires a ticked confirmation checkbox (no JavaScript exists in this codebase — `CLAUDE.md` §11's 2026-08-02 no-JS entry; use the `required` checkbox pattern the manual tick control already uses).
- **Judge the next show now** — runs the judging stage immediately without advancing the world, for testing.
- **A list of recent shows** with their status, judge and winner.

Do not build a show-creation form. Shows come from the tick.

---

## 9. Tests

New `test/showing/` directory, matching `test/conformation/` and `test/breeding/`.

**`score.test.ts`**
- A horse matching the standard exactly scores 100 under every judge.
- Trait score falls off linearly and clamps at 0 rather than going negative (a horse 60 points off a target scores 0 on that trait, not −20).
- §4.6's three worked examples reproduce to two decimal places. **Assert the numbers, and comment why** — slice 0006's test does this for the same reason, and it is what stops a future session "fixing" a working implementation to match a typo in a document.
- A missing trait key in a judge's weights reads as 1.0.
- Judge weights change the winner: Ash beats Birch under `balanced` and `substance`, Birch beats Ash under `movement`.

**`eligibility.test.ts`**
- Wrong breed, too young, too old, wrong sex, crossbred into a purebred class, `requires_gait` against a horse with no DMRT3 gait allele — each refused, each with its own distinguishable reason.
- A **Paint is eligible.** A Paint's `breed_id` is Quarter Horse (overview §4a), so it enters Quarter Horse classes as itself. This falls out of the design for free and is worth a test so nobody "fixes" it later.
- The per-stable entry cap counts only that stable's entries in that class.

**`placing.test.ts`**
- Descending by final score; ties break deterministically; running the same class twice gives identical placings.
- Ribbon colours attach to placings 1–6 and nothing below.

**`noise.test.ts`**
- The same (class seed, horse id) gives the same noise every time.
- Entry order does not change any horse's noise.

**`test/genetics/consistency.test.ts`** — extend it, as slice 0006 did: the Quarter Horse's seeded `ideal_vector` names exactly the four codes in `CONFORMATION_TRAITS`, no more and no fewer. That test already parses migration text; follow its shape.

Run `npm test` and `npx tsc --noEmit`, both clean.

---

## 10. Verifying it by hand

Slice 0006 shipped without a browser pass and said so. Do not repeat that here — this slice has more moving parts across the tick, and the acceptance list in §1 is the pass. Run `wrangler dev --local`, apply every migration through `/admin/migrations`, and walk all twelve steps. You will need a `.dev.vars` file with `SESSION_SECRET=<anything>` (`CLAUDE.md` §11's UI entry explains why, and why browser-driven logins do not stick over plain HTTP locally).

Pay particular attention to step 11 — re-firing the tick over an already-judged show — because that is the bug that will not show up in tests and will quietly corrupt every horse's record if it is wrong.

---

## 11. If this is too large for one session

It probably is. Split it here, and the first half is playable on its own:

**Part one — scoring, with no schedule.** `judges`, `breeds.ideal_vector`, `shows`, `show_classes`, `show_entries`, the `src/engines/showing/` engine and its tests, the NPC show barn and its admin stocking action, and a `/admin/shows` control that creates one show and judges it on demand. No tick stages, no `/shows` player screens beyond a results page. This is the whole scorer, testable and tunable, without touching the tick.

**Part two — the circuit.** The two tick stages, the monthly schedule, the player-facing `/shows` screens and entry form, `horse_show_summary`, and the horse page's show record card.

If you split it, **say so in your summary and update `CLAUDE.md` §10 with which half landed**, the way slice 0005's §7 split is recorded. A half-built slice that nobody wrote down is the failure mode `CLAUDE.md` §1 exists to prevent.

---

## 12. What to raise rather than decide

Three things this document does not settle. If your build runs into them, say so rather than picking quietly (`CLAUDE.md` §2).

- **Whether the show barn's horses should be beatable from day one.** They are minted at the `mid` quality band, the same band founding stock uses, so a child's founding horses are roughly competitive and a well-bred second generation should start winning. If the first month of real play shows the NPC horses either sweeping every class or never placing, the fix is `npc_show_barn_quality_band` and re-stocking, not code — but it is worth reporting the observation, because it is the first real data point on overview §10d's ceiling problem.
- **Whether one class a month is enough to enter.** With `max_entries_per_stable = 3` and one class, a child with six horses can only show half of them. That may be a good constraint or a frustrating one. A second class split by sex is the obvious answer if it bites.
- **Whether the results screen is legible to a seven-year-old.** The breakdown table in §8.1 is the heart of this slice and it is a table of numbers. If it does not read, the fix is a sentence in plain English above it — *"Your horse's back is longer than the standard wants, and this judge cared about that more than most"* — generated from the largest weighted trait deficit. That sentence is cheap and might be the most valuable thing in the slice, but it is a writing problem more than a coding one, so it is called out here rather than specified.
