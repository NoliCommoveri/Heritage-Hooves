# Slice 0011 — Discipline shows, and a fifth ability

**Status: specified, not built.**

The first classes judged on what a horse can *do* rather than what it looks like. Six disciplines,
a new `agility` trait to make them distinguishable, and the scorer that reads them — reusing the
show calendar, eligibility, placings, noise, prizes and tick stages slice 0008 already built.

**Ordered here deliberately.** *Decided by the operator, in conversation, 2026-08-02.* This lands
**before NPC stables and before the market**. The reasoning: discipline classes are the first thing
that makes the four ability traits mean anything, every horse in the game has been carrying them
since slice 0002, and nothing about them needs an NPC stable to be worth playing.

**This slice has a hard precondition. See §4.2 — it must not deploy without the world reset.**

---

## 1. What "done" looks like

A child opens `/shows`, sees the next show, and finds seven classes instead of one: the Quarter
Horse Conformation class that already exists, plus Barrel Racing, Flat Racing, Show Jumping,
Endurance, Dressage and Gaited Pleasure. Their four-year-old Arabian mare is ineligible for the
Quarter Horse class and eligible for five of the six new ones. They enter her in Endurance.

Three ticks later the show is judged. She placed second. The result screen says why: her stamina,
her agility, her speed, her trainability, each against the weight Endurance puts on it, and the
noise the judge's day added. It reads exactly like a conformation result, because it is the same
screen shape — a table of traits, weights and contributions.

Their brother's Quarter Horse won Barrel Racing the same day, and the two children can see plainly
that the horses are good at different things and neither would win the other's class.

---

## 2. Decisions taken for this slice

### 2.1 Six disciplines, all enabled, open to every breed and every cross

No breed gating. `crosses_eligible = 1` on every discipline class. Overview §4c already says
performance classes are open to crosses; this extends the same logic to breed — an Icelandic may
enter Flat Racing and will lose, and finding that out is the lesson.

**This is not the same as saying breed does not matter.** It matters through the allele pools
already seeded (`migrations/0024`/`0051`), which is where the difference actually lives. A breed
aptitude *modifier* is a later refinement (§3.2) and would be double-counting today.

### 2.2 A fifth ability trait: `agility`

*Requested by the operator, 2026-08-02.* Without it, Barrel Racing is Flat Racing with less
stamina, and the two western-flavoured disciplines select for the same horse. Agility is what makes
turning, rating and coming off a barrel a different question from running in a straight line, and it
gives Show Jumping and Dressage a second axis besides jump scope and trainability.

Full treatment in §4.

### 2.3 Abilities are revealed by results, never by looking

The horse page gains **no ability bars**. Slice 0006 §2 was explicit that stamina, jump scope,
speed and trainability are *"revealed by doing, not by looking"*, and `quantitative_traits`'
`teaching_text` says so to the player's face today.

A show result **is** doing. So the discipline result screen shows each ability value that produced
the score, exactly the way the conformation result screen shows each measurement — and the horse
page still shows none of them.

**This is a real change to what slice 0006 meant, stated rather than smuggled.** Ability values
become publicly visible for any horse that has been shown, and stay invisible for one that has not.
That is the intended shape: a horse's ability record is its results, and an unshown horse is an
unknown quantity. It also means entering a horse in a discipline is a genuine disclosure decision,
which is a better mechanic than a number that was always on the page.

### 2.4 No training weight, but the hook is carried

*Decided by the operator, in conversation, 2026-08-02.* Discipline scores multiply by a
`trainingFactor` that is **pinned at 1.0** and nothing in this slice sets otherwise.

This follows a convention this codebase has established twice: `realization()` in
`src/engines/conformation/model.ts` carries `trainingFactor`/`careFactor` defaulted to 1.0, and
`scoreEntry` in `src/engines/showing/score.ts` carries `careModifier`/`tackModifier` the same way.

**Do not add a `training_level_applied` column.** Slice 0010 §3.2/§3.3 refused `onset_model` and
`management_options` on the grounds that a nullable column nothing writes is *"a promise to a future
session nobody has kept."* The same applies here. The column arrives with the training slice.

**What makes the retrofit safe is the score's shape, and that is decided now** (§7): a weighted
composite finished by a line of multiplicative modifiers. Training then enters where care and tack
already sit. If a discipline were instead modelled as an event simulation — phases, a clock,
penalties — training would be a rewrite rather than a factor. It is not, and that is on purpose.

Snapshotting does the rest: `show_classes` copies its scoring parameters at creation (`CLAUDE.md`
§5.5), so classes judged before training exists keep their own rules forever.

### 2.5 A separate scorer, not a generalised one

`scoreAbilityEntry` is a new pure function in a new file, not a widened `scoreEntry`. The two
formulas are genuinely different — one is distance from a target through a falloff, the other is a
weighted mean of values that are unidirectional — and `CLAUDE.md` §5.1 wants an engine a future
session can hold entirely in view. A single function with a mode flag would be harder to read than
two functions, and the shared parts (`assignPlacings`, `noiseForEntry`) are already extracted.

---

## 3. Not built here

### 3.1 No training
§2.4. `horse_training` does not exist after this slice.

### 3.2 No breed aptitudes, no `eligible_class_types`
`breeds.discipline_aptitudes` and `breeds.eligible_class_types` stay unbuilt for all eight breeds.
Discipline classes are open to everyone (§2.1). These belong to the breeds stage.

### 3.3 No discipline tiers, no qualification, no promotion
`shows.tier` remains `'local'` for every show. There is still no designed path from local to
regional to national — for conformation or discipline classes. That gap is real and was reported
separately; it belongs with the NPC ceiling schedule, which is what makes a tier mean anything.

### 3.4 No NPC discipline barn
`stockShowBarn` still generates Quarter Horses only. It can pad five of the six new classes, because
they are open to all breeds — see §5.4 for the one it cannot.

### 3.5 No per-discipline show record
`horse_show_summary` stays one row per horse, counting starts and wins across everything. Schema
§6.5's optional `horse_discipline_summary` is not built. A horse that wins Dressage and loses
Endurance reads as one start each on one summary row.

### 3.6 No care, no tack
`careModifier`/`tackModifier` stay pinned at 1.0 in the ability scorer, same as the conformation one.

---

## 4. The `agility` trait

### 4.1 Appended, not inserted

Add `'agility'` to `TRAITS` in `src/engines/genetics/polygenic.ts` **at the end, after
`'fertility'`**. Add `agility: 'ability'` to `TRAIT_CATEGORY` and `agility: 'higher_better'` to
`TRAIT_DIRECTION` in `src/engines/conformation/traits.ts`.

Ten loci, like every other trait. `LOCI_PER_TRAIT` is unchanged.

**Appending is a recommendation here, not a constraint, and the reasoning is worth reading.** The
usual reason to append is reproducibility: `polygenicGamete` draws per trait in `TRAITS` order from
one RNG stream, so inserting shifts every draw after it and stored seeds stop reproducing their
horses. The world reset (§4.2) means no horse exists to be broken, so inserting `agility` next to
the other ability traits would be free this once.

**Append anyway.** The list already reads as append-ordered — `fertility` sits after `trainability`
out of category order, with a long comment explaining why — and that visible oddness is what tells
the *next* session, who will not have a reset available, that the rule is append-only. A tidily
grouped list invites someone to insert into the group and silently rewrite every horse in the game.
The tidiness is worth less than the signal.

`CONFORMATION_TRAITS` filters by category and is unaffected. Display order is
`quantitative_traits.sort_order`, which is independent of `TRAITS` order — so `agility` can be
appended to the list and still display beside the other abilities.

### 4.2 No legacy path — and this slice must not ship without the reset

*Decided by the operator, in conversation, 2026-08-02: the world is being reset when this releases.*

That removes what would otherwise be the fiddliest part of this slice. A horse born before a trait
exists has no key for it, and `getPolygenicString` returns all zeros for a missing key — the bottom
of the range. Slice 0003 hit this with `fertility` and solved it with `fertilityPotential()` in
`src/engines/breeding/fertility.ts`, which derives a stable stand-in from the horse's own
`rng_seed`. **No equivalent `agilityPotential()` is needed here**, because after the reset every
horse in the game is born with the trait.

**This is a hard precondition, and the failure is silent.** If this ships without the reset, every
pre-existing horse reads `agility ≈ 1` — dead last in every discipline that weights it, with no
error, no warning, and no visible symptom except that older horses mysteriously stop placing.

Two things follow, and both are part of "done":

1. **The build session confirms the reset has happened before deploying**, or does not deploy.
2. **`/admin/health`-style sanity check:** after the reset and the first foals, spot-check that a
   horse's stored genotype has an `agility` key. One query, once. If it is missing on a living
   horse, stop.

If the reset is cancelled, this slice needs `agilityPotential()` mirroring `fertilityPotential()`
exactly, and that must be built before the trait is scored — not after.

### 4.3 What agility does to score spread

Adding a fifth ability makes every discipline's scores *tighter*, not wider: a weighted mean over
more independent traits has lower variance. That is not a problem, but it changes the right noise
setting, and §6.5 carries the number.

---

## 5. The disciplines

### 5.1 The six

Weights over the five ability traits. Only ratios matter — the scorer divides by `Σ weight` (§7) —
so the band these sit in is arbitrary and the spread inside it is not.

| Discipline | `code` | speed | stamina | jump_scope | trainability | agility | Gate |
|---|---|---|---|---|---|---|---|
| Barrel Racing | `barrels` | 1.4 | 0.2 | 0 | 0.8 | **1.5** | — |
| Flat Racing | `racing` | **1.6** | 1.3 | 0 | 0.3 | 0.2 | — |
| Show Jumping | `jumping` | 0.3 | 0.5 | **1.6** | 1.0 | 1.0 | — |
| Endurance | `endurance` | 0.4 | **1.8** | 0 | 0.5 | 0.2 | — |
| Dressage | `dressage` | 0.1 | 0.8 | 0.2 | **1.6** | 0.9 | — |
| Gaited Pleasure | `gaited` | 0.6 | 0.5 | 0 | 1.2 | 1.0 | `requires_gait` |

Stored as JSON on the `disciplines` row, shape mirroring `breeds.ideal_vector`:

```json
{ "v": 1, "traits": { "speed": 1.4, "stamina": 0.2, "jump_scope": 0, "trainability": 0.8, "agility": 1.5 } }
```

A missing trait key reads as **0**, not 1.0 — the opposite of `judges.trait_weights`, and
deliberately so. A judge's missing key means "no opinion, use the default"; a discipline's missing
key means "this discipline does not care about that ability at all." Write the zeros explicitly
anyway, as above, so the row reads as a complete statement.

### 5.2 Every ability is dominant in exactly one discipline

Checked, and it is the property that makes the set worth having:

- **speed** → Flat Racing (1.6)
- **stamina** → Endurance (1.8)
- **jump_scope** → Show Jumping (1.6)
- **trainability** → Dressage (1.6)
- **agility** → Barrel Racing (1.5)

No trait is dead weight, and no two disciplines select for the same horse. The closest pair is
Barrel Racing and Flat Racing — both speed-led, and the reason agility was added — and they now
split cleanly on the other axis: barrels want agility 1.5 / stamina 0.2, racing wants stamina 1.3 /
agility 0.2. Same speed demand, opposite everything else.

Dressage and Gaited Pleasure are the next closest, both trainability-led. They are further separated
by the DMRT3 gate, so their fields never overlap.

### 5.3 Which breed belongs where

Not enforced anywhere (§2.1) — this is what the allele pools should produce, and a check on whether
every child has somewhere to go.

| Breed | Home discipline(s) |
|---|---|
| Quarter Horse | Barrel Racing |
| Arabian | Endurance |
| Thoroughbred | Flat Racing, Show Jumping |
| German Warmblood | Show Jumping, Dressage |
| Friesian | Dressage |
| Paso Fino | Gaited Pleasure |
| Icelandic | Gaited Pleasure, Endurance |
| Nokota | Barrel Racing, Endurance |

All eight covered. Flat Racing exists in this set specifically so the Thoroughbred has a discipline
of its own rather than sharing the Warmblood's — overview §4a says its identity *is* performance,
and it was the one breed the five-discipline draft left thin.

### 5.4 Minimum ages, and why they differ

Per discipline, snapshotted onto the class at creation. At `game_days_per_year = 360`:

| Discipline | Min age | Game days |
|---|---|---|
| Flat Racing | 2 years | 720 |
| Barrel Racing | 3 years | 1080 |
| Gaited Pleasure | 3 years | 1080 |
| Show Jumping | 4 years | 1440 |
| Dressage | 4 years | 1440 |
| Endurance | 5 years | 1800 |

Roughly true to life, and it does real work in the game: `conformation_maturity_years` is 5, and
ability values scale with realization, so a horse entering Endurance is at or near full expression
while a two-year-old racer is not. It gives a young horse somewhere to start and an older horse
somewhere to still be useful, which is the shape a show career should have.

No maximum ages. Ageing and decline is a later stage.

### 5.5 Gaited Pleasure will have thin fields, and ships anyway

`stockShowBarn` generates Quarter Horses, whose pool is `DMRT3 {"C":0.98,"A":0.02}` — so a show-barn
horse is gaited about one time in a thousand. Gaited Pleasure gets essentially **no NPC padding**
until the show barn is breed-aware.

Ship it regardless. The class degrades gracefully: `judgeOneClass` already refuses to top up a class
nobody entered, a class of two real horses is legal and produces real placings, and the Paso Fino
and Icelandic owners have **no class at all** today, since their breeds have no ideal vector. A thin
Gaited Pleasure class is strictly better than that, and it is the only thing in this slice those two
children get.

Flag it on the class page so nobody thinks it is broken: a class with fewer than three entries says
so in words.

---

## 6. Data

Six migrations. Next free number is **0058**.

### 6.1 `0058_quantitative_traits_agility.sql`

One `INSERT` into `quantitative_traits`: `agility`, category `ability`, direction `higher_better`,
`low_label` and `high_label` **NULL** (ability traits show no bar — §2.3), `locus_count` 10,
`sort_order` 10, `enabled` 1.

`teaching_text`, matching the voice of the existing eight:

> How quickly and cleanly a horse can turn, stop and change direction. Revealed by doing, not by
> looking — not shown here.

### 6.2 `0059_disciplines.sql`

```
CREATE TABLE disciplines (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- ability_weights: JSON, { "v": 1, "traits": { "speed": 1.4, ... } }. A missing key reads as 0
  -- (§5.1) - the opposite of judges.trait_weights, where a missing key reads as 1.0.
  ability_weights TEXT NOT NULL,
  requires_gait INTEGER NOT NULL DEFAULT 0,
  crosses_eligible INTEGER NOT NULL DEFAULT 1,
  min_age_game_days INTEGER NOT NULL,
  -- default_noise_sd: this discipline's default, copied onto the class at creation. Per-discipline
  -- rather than one config value because ability composites spread differently per weight vector
  -- (§6.5).
  default_noise_sd REAL NOT NULL,
  teaching_text TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);
```

This is `breeds` for disciplines, and `ability_weights` is `ideal_vector`'s counterpart: reference
data the class snapshots at creation and never re-reads. `enabled` is the §12.2 toggle, and §13.1
explains why it earns its place immediately.

### 6.3 `0060_seed_disciplines.sql`

The six rows from §5.1, with §5.4's ages and §6.5's noise values.

### 6.4 `0061_show_classes_discipline.sql` — a table rebuild

SQLite cannot `ALTER` a `CHECK` constraint or drop a `NOT NULL`, so this is a genuine rebuild:
create `show_classes_new`, copy, drop, rename, recreate both indexes. **Migration `0057` is the
worked precedent** — read it before writing this one.

Three changes:

- `class_type` `CHECK` widens to `IN ('breed_conformation', 'discipline')`
- `ideal_vector` becomes **nullable** (a discipline class has no ideal vector)
- new `ability_weights TEXT` nullable, snapshotted from `disciplines.ability_weights`

Plus a constraint making the pairing impossible to get wrong:

```sql
CHECK (
  (class_type = 'breed_conformation' AND ideal_vector IS NOT NULL AND ability_weights IS NULL AND breed_id IS NOT NULL)
  OR
  (class_type = 'discipline' AND ability_weights IS NOT NULL AND ideal_vector IS NULL AND discipline_code IS NOT NULL)
)
```

**`discipline_code` already exists** on `show_classes` — added by `0037`, always `NULL` to date, and
named that way by schema §6.2. Use it. Do not add a `discipline_id`; referencing reference data by
code is what `conditions.locus_code` already does.

Also recreate the two indexes `0037` defines (`idx_show_classes_show_id`,
`idx_show_classes_status`). A rebuild drops them with the table.

### 6.5 `0062_show_entries_trait_snapshot.sql` — a rename, by rebuild

Rename `conformation_snapshot` to **`trait_snapshot`**. Another rebuild (SQLite's `RENAME COLUMN`
exists but the surrounding comment block and the `NOT NULL` semantics are worth restating in one
place; either approach is acceptable, and a rebuild matches `0057`'s precedent).

**The blob shape does not change at all** — it is already trait-agnostic:

```json
{ "v": 1, "traits": { "speed": 62, "agility": 71 }, "age_years": 4.2, "coi": 0.0625 }
```

Only the column *name* said conformation. This is cosmetic and it is worth one migration anyway: a
column called `conformation_snapshot` holding `{"speed": 62}` is precisely the kind of thing that
misleads a session with no memory of this one. The world reset makes the copy step free.

### 6.6 `0063_config_disciplines.sql`

One live tunable:

```
$.show_discipline_classes_per_show   6
```

How many discipline classes a show carries — see §13.1. Everything else a discipline class needs
comes from the `disciplines` row, not config, because it is snapshotted.

**`noise_sd` is per-discipline, on the row, not config.** The reason, with the arithmetic:

Ability values land at roughly N(50, 11) for a mature horse. A weighted mean's spread is
`11 × √(Σw²) / Σw`, giving per-discipline population spreads of:

| Discipline | Score spread (sd) |
|---|---|
| Endurance | 7.3 |
| Flat Racing | 6.8 |
| Barrel Racing | 6.2 |
| Dressage | 6.2 |
| Gaited Pleasure | 5.8 |
| Show Jumping | 5.5 |

A conformation class spreads at roughly **10** by the same arithmetic, because
`traitScore = 100 − distance × falloff` at `falloff = 2.0` doubles differences before averaging,
and an ability composite has no such amplification.

So `show_noise_sd = 5` — tuned for conformation — makes discipline classes markedly luckier.
**Seed `default_noise_sd = 3.0` for all six**, which puts noise in the same proportion to signal
that conformation classes have today.

**These are estimates off the founder distribution, not measurements.** A selected population will
spread differently. Check them against real entries after the first few shows (§12) and retune the
rows; they are reference data, so it is one migration and no code.

---

## 7. The scorer

New file `src/engines/showing/abilityScore.ts`. Pure, no database access (`CLAUDE.md` §5.1).

```
rawScore   = Σ (weight_t × expressed_t) / Σ weight_t
finalScore = rawScore × careModifier × tackModifier × trainingFactor + noise
```

where `expressed_t` is the horse's expressed value for ability trait *t* on the 1–99 scale, and
`weight_t` comes from the class's snapshotted `ability_weights`.

Notes that matter:

- **Iterate `ABILITY_TRAITS`, never `Object.keys(weights)`** — the same discipline `scoreEntry`
  applies to `CONFORMATION_TRAITS` and `combine` applies to `LOCI`. A stable order means a result's
  breakdown always reads the same way regardless of how the JSON was written.
- **`ABILITY_TRAITS` is a new export in `src/engines/conformation/traits.ts`**, filtering
  `TRAITS` by `TRAIT_CATEGORY[t] === 'ability'` — the exact shape `CONFORMATION_TRAITS` already has,
  one line away. `fertility` is category `hidden` and is correctly excluded.
- **A missing weight key reads as 0** (§5.1).
- **`careModifier`, `tackModifier` and `trainingFactor` are all defaulted parameters pinned at
  1.0** (§2.4). Name all three in the signature.
- **Noise comes from the existing `noiseForEntry`**, unchanged — derived per (class, horse), which
  is what makes a re-fired tick reproduce a class byte for byte.
- **Placings come from the existing `assignPlacings`**, unchanged.

### 7.1 Expressing ability values

`src/db/shows.ts`'s `expressedTraitsFor` calls `conformationValues`, which maps
`CONFORMATION_TRAITS` only — ability values never come out of it today.

Add **`abilityValues(genotype, noise, ageYears, coi, config)`** to
`src/engines/conformation/model.ts`, beside `conformationValues` and about eight lines long: map
`ABILITY_TRAITS` through the existing `geneticValue` / `realization` / `expressedValue`, with
`anchorFor` returning **0** for a `higher_better` trait — which it already does, and which
`traits.ts:44`'s own comment anticipated: *"so a later slice displaying ability traits needs no new
expression function, only this lookup."*

That anchor of 0 is worth understanding, because it makes ability behave differently from
conformation and better: `expressed = geneticValue × realization`, so a young horse is
straightforwardly *worse* rather than pulled toward the middle. Horses genuinely improve with age
until maturity, which is the right shape for performance and is what §5.4's minimum ages lean on.

**Naming debt, accepted deliberately:** `src/engines/conformation/model.ts` will hold ability
expression, which its name does not suggest. A rename to `src/engines/traits/model.ts` would touch a
dozen imports for no behavioural gain. Leave it, and put a comment at the top of the file saying
what it actually contains. Flagged so the next session finds it stated rather than surprising.

---

## 8. The tick

No new stages. Both existing ones change.

### 8.1 `createDueShows` → `createShowIfMissing`

Today it loops breeds with a non-null `ideal_vector` and creates one class each. Now it creates:

1. one class per such breed, exactly as now — **unchanged**, and
2. one class per enabled discipline, ordered by `sort_order`, capped at
   `show_discipline_classes_per_show`.

Every class still lands in the **same single `env.DB.batch()`** as the `shows` row. `0036`'s comment
explains why and it has not stopped being true: a crash between the show and its classes would
leave a show that exists forever with no class, and `UNIQUE (scheduled_game_day, tier)` would hide
that gap from every future tick.

Sub-seeds continue off the show seed with the existing `class_N` / `judge_N` labels, with discipline
classes numbered after breed classes. Judges are drawn from the same pool — a judge weights
*conformation* traits, and `judgeWeights` simply contributes nothing to an ability score, since
`scoreAbilityEntry` iterates `ABILITY_TRAITS` and a conformation judge has no key for any of them.
That is correct behaviour, not an oversight: judge variance is a conformation mechanic. Whether
disciplines want their own judges is §15's question, not this slice's.

### 8.2 `judgeOneClass`

Branch once, at the top, on `cls.class_type`:

- `'breed_conformation'` → `expressedTraitsFor` + `scoreEntry`, exactly as today
- `'discipline'` → `abilityValues` + `scoreAbilityEntry`

Everything after the branch is shared and unchanged: NPC top-up, `assignPlacings`,
`horse_show_summary`, prize ledger rows, the single atomic batch, `closeShowIfAllClassesJudged`.

**Do not duplicate the batch.** The prize-money and summary code in `judgeOneClass` is the part most
expensive to get wrong, and it does not care which scorer produced the numbers.

### 8.3 Eligibility

**No changes to `checkEligibility` at all.** It already implements `requiresGait` and
`crossesEligible`, has never mentioned conformation, and is the reason this slice is as small as it
is. The class row carries `requires_gait` and `crosses_eligible`, copied from the discipline row at
creation.

`barred_by_condition` continues to apply — HERDA bars a horse from showing, in any class type.

---

## 9. Screens

- **`/shows/:id`** — lists all classes for a show. Already loops classes; needs a discipline
  class's name and, per §5.5, a "only N entered" note when a field is under three.
- **`/shows/:id/entries/:entryId`** — the result explanation. Branch on the breakdown blob's `kind`
  (§9.1): a conformation entry shows expressed / target / weight / trait score as now; a discipline
  entry shows expressed / weight / contribution, with **no target column**, because there is no
  target.
- **Horse page** — the "Enter in a show" flow now lists discipline classes the horse is eligible
  for. The Show record card is unchanged (one summary, §3.5). **No ability bars anywhere** (§2.3).
- **Barn list** — unchanged. The existing win/ribbon badge already counts every class type.

### 9.1 The `score_breakdown` blob

Add a `kind` key and drop `target` for ability entries:

```json
{ "v": 1, "kind": "ability", "discipline_code": "barrels",
  "traits": [ { "code": "speed", "expressed": 62, "weight": 1.4, "contribution": 86.8 } ],
  "weight_sum": 3.9, "raw_score": 64.1, "noise": -1.3, "final_score": 62.8 }
```

Conformation breakdowns gain `"kind": "conformation"` and are otherwise untouched. The renderer
branches on `kind`, and an old row without the key reads as conformation — though after the world
reset there will not be one.

---

## 10. Seeds and reproducibility

Nothing new. `noiseForEntry(classSeed, horseId, noiseSd)` is unchanged and is still the only random
draw a scored entry makes. Class seeds still derive from the show seed by label.

The one thing to hold onto: **`agility` is appended to `TRAITS`, so it draws last** in
`polygenicGamete` and `inheritPolygenic`. Every other trait's draw sequence is untouched (§4.1). If
`test/rng.test.ts`'s golden values change, something is wrong — check that before assuming the test
is stale.

---

## 11. Tests

Pure functions only, per this codebase's established convention — there is no D1 mock anywhere in
`/test`, and this slice does not introduce one.

1. **`scoreAbilityEntry`** — a worked example checked by hand; a missing weight key contributing
   zero rather than defaulting to 1.0; `Σ weight` normalisation, so scaling every weight by 2 leaves
   `rawScore` identical; the three modifiers all defaulting to 1.0.
2. **`abilityValues`** — five traits out, `fertility` excluded, anchor 0 (so a horse at realization
   0.5 expresses half its genetic value, not something pulled toward 50).
3. **`ABILITY_TRAITS`** — exactly `stamina`, `jump_scope`, `speed`, `trainability`, `agility`, in
   `TRAITS` order, and disjoint from `CONFORMATION_TRAITS`.
4. **`consistency.test.ts`, extended twice:**
   - the `TRAITS vs migrations/0029` block scans **`0029` + `0058` in sequence** and asserts against
     the whole of `TRAITS` — the pattern slice 0010 established when `LOCI` grew, and what proves
     `agility` is both correct and *last*.
   - a new block: every seeded discipline's `ability_weights` names only codes in `ABILITY_TRAITS`,
     with weights ≥ 0 and at least one > 0. This is `0035`'s ideal-vector test from the other side.
5. **Discipline seed sanity** — each of the five abilities is the strict maximum weight in at least
   one enabled discipline (§5.2). Cheap, and it fails loudly if someone retunes a row and
   accidentally makes a trait irrelevant everywhere.

`npm test` and `npx tsc --noEmit` both clean before the hand-verification pass.

---

## 12. Verifying it by hand

Against `wrangler dev --local`, after applying all migrations through `/admin/migrations` (**not**
the CLI — it uses a different splitter, and `0061`/`0062` are multi-statement rebuilds).

1. Confirm the world reset has happened (§4.2). Check a living horse's genotype has an `agility`
   key. **If it does not, stop.**
2. `/admin/horses/new` — create two founders, breed them, confirm the foal's genotype carries
   `agility` and that its ten loci are a real mix of both parents' rather than all zeros.
3. Advance the tick to a show creation. Confirm seven classes: one Quarter Horse Conformation, six
   disciplines.
4. Enter one horse in Barrel Racing and one in Endurance. Confirm the turn cost (1 each) and that
   the eligibility screen refuses a two-year-old for Endurance and accepts it for Flat Racing.
5. Confirm a **non-gaited** horse is refused by Gaited Pleasure with the right reason, and that a
   Paso Fino or Icelandic founder is accepted.
6. Advance to judging. Confirm: placings assigned, prize money in the ledger as `prize` rows,
   `horse_show_summary` incremented, the show closed only once every class is judged.
7. Open the result explanation for a discipline entry. Confirm five ability rows, no target column,
   and that the contributions sum to the raw score shown.
8. Confirm the horse page still shows **no ability bars** (§2.3).
9. **Re-fire the same tick.** Nothing double-judges, no second prize row, no summary double-count.
10. Record the actual spread of raw scores across the six discipline classes and compare against
    §6.5's estimates. Retune `default_noise_sd` if they are materially off.

---

## 13. Balance risks to watch

### 13.1 The action budget becomes the real limiter — this is the big one

`actions_per_tick` is **6**. Entering a show costs 1 turn. Going from one class per show to seven
means a player could plausibly want 7–21 entries against a budget of 6 per tick, shared with
breeding and genotype tests.

Overview §9 names this exact failure: *"more shows than a player has actions to enter … quietly
converts the action budget into the real limiter and makes the schedule decorative."* This slice
walks straight at it, deliberately, because six disciplines is what makes the ability traits mean
anything — but it must be watched from the first week.

**Three levers, in the order to reach for them**, none needing a deploy:

1. `disciplines.enabled` — turn a discipline off. One `UPDATE`, and existing classes are unaffected
   because they are snapshotted.
2. `show_discipline_classes_per_show` — carry fewer than six per show, rotating by `sort_order`.
3. `actions_per_tick` — raise it. Last resort; it loosens every other budget too.

### 13.2 The prize faucet multiplies by seven

`show_prize_schedule` is `[600, 350, 200, 120, 80, 50]` — **1400 per class**. Upkeep is 2 per horse
per game day, so a ten-horse stable pays 600 across a 30-game-day show cycle.

One class already pays more than two stables' upkeep. Seven classes pay 9800 per show cycle against
an unchanged sink. Some of that lands in the NPC show barn's balance and leaves the player economy,
but not most of it.

**Review `show_prize_schedule` when this lands.** It is a live tunable, read fresh at class creation,
so it is one edit on `/admin/config` and no migration. Halving it is the obvious first move.

### 13.3 Noise against a tighter spread

§6.5. The estimates are estimates; step 10 of §12 is how they get checked.

---

## 14. Documents to correct when this is built

- **`CLAUDE.md` §10** — a new row for this stage, and a note on the Tokens row if the ordering
  shifts again.
- **`docs/build-log.md`** — a dated entry. At minimum: `agility` appended and why append rather than
  insert (§4.1); the reset precondition (§4.2); `ABILITY_TRAITS` and `abilityValues` as the new
  shared helpers; the `show_classes` rebuild joining `0057` as a worked precedent; the naming debt in
  §7.1.
- **`docs/horse-game-schema.md` §3.5** — `disciplines` is described as "detailed in §7–§9 below" and
  never actually detailed. Replace with what was built.
- **`docs/horse-game-schema.md` §6.2** — `class_type` now has two real values, not four sketched
  ones.
- **`docs/breed-ideal-vectors.md` §6.3** — remove `discipline_aptitudes` from the "needs a
  `disciplines` table, which does not exist" line. It exists now.

---

## 15. What to raise rather than decide

- **Do disciplines want their own judges?** §8.1 notes a conformation judge contributes nothing to
  an ability score, which is defensible but means discipline classes have no judge variance at all —
  and overview §9 calls judge variance one of the two parameters carrying most of the feel. A
  `judges.ability_weights` column is the obvious answer and is deliberately not built here. Raise it
  after watching a few discipline classes, when there is something to look at.
- **Should a discipline result feed a separate show record?** §3.5 defers
  `horse_discipline_summary`. It matters most for registries, which do not exist.
- **Should ability values ever be visible without showing?** §2.3 says no. If it turns out children
  find it opaque rather than intriguing, that is a real signal — but change it deliberately, because
  "revealed by doing" is load-bearing for what makes entering a show a decision.
