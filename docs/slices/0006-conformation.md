# Slice 0006 — Conformation: potential, expression and display

**Status:** specified, and **second in the queue rather than first** — the image slot is built before it (§9). Slices 0001, 0002, 0003 and 0005 are built. Slice 0004 (semen storage) is specified but **not** built, and nothing here depends on it — the two can land in either order. Slice 0005 §7 (the parent's PIN) is specified but **not** built; nothing here depends on it either. Nothing in this document exists yet.

**Nothing here depends on the image slot either** — if that slice slips, this one is still buildable exactly as written. The order between them is a choice about what the children see next, not a technical dependency.

**Who this is for.** A Claude Code session that has read `CLAUDE.md` and nothing else. Everything you need is in this document. **Do not read `docs/horse-game-overview.md` or `docs/horse-game-schema.md` in full.** Sections are cited inline where they matter — read only those.

**What this slice is.** Every horse in the game already carries real, heritable, inherited conformation genetics. Nothing displays them. This slice turns those hidden numbers into four measurements a child can read, compare between two horses, and watch change as a foal grows up.

**Why this comes now.** Slice 0005 §2.7 promised it by name: *"The interesting choice the design imagines — 'the flashy chestnut against the plainer mare with the better shoulder' — needs conformation display, which is the next slice."* Today a founding batch is chosen on colour and sex alone. This is also the direct prerequisite for the first show class: a scorer needs something to score, and a breed ideal is meaningless until there is an expressed value to compare it against.

**One thing to hold onto while building.** This slice produces **measurements, not marks.** A long neck is not a good neck. Nothing here may say a horse is good, score it, rank it, or average its traits into one number — that is the show slice's job, one slice away, and it needs a breed ideal to do it honestly. See §2.3, which is the decision most likely to be quietly broken.

---

## 1. What "done" looks like

On the live URL, on a phone, with no terminal:

1. Apply the new migrations from `/admin/migrations`.
2. Open any horse's page. A **Conformation** card shows four measurements — neck length, shoulder angle, back length, hock set — each as a value between two named extremes (*short ↔ long*), with the value it will settle at when grown shown alongside.
3. Open a newborn foal. Its four values sit close to the middle and the page says, in one sentence, that a foal has not grown into its frame yet and roughly when it will.
4. Press the admin advance button repeatedly. The foal's values move away from the middle, towards its mature values, and stop moving once it is about five.
5. Breed the same mare to the same stallion twice. The two foals have **different** mature values. Same parents, different draw.
6. Breed a horse to its own parent or full sibling. The resulting foal's values sit visibly closer to the middle than its genetics alone would give, and the page names inbreeding as the reason, next to the COI already shown.
7. Open a founding offer at `/stables/:id/founding`. Each of the six candidates now shows its four measurements, so the choice is genuinely between the flashy chestnut and the plainer mare with the better shoulder.
8. Claim a candidate. The four numbers in the barn match the four numbers on the candidate card exactly.
9. Look everywhere. Nothing anywhere shows speed, stamina, jump scope, trainability or fertility — those are stored and inherited but not displayed.
10. Open a horse born before this slice (any founding horse, any foal already in the game). Its conformation displays normally, with no backfill and no migration having touched it.

If all ten work, the slice is done.

---

## 2. Decisions taken for this slice

### 2.1 The engine expresses every trait; the screens display four

`TRAITS` in `src/engines/genetics/polygenic.ts` holds nine entries. The expression function loops over them the way everything in this codebase loops over `LOCI` — writing it for literally one trait would be worse code than writing it for all nine, and would have to be rewritten immediately.

The **display** is where the "one trait end to end" discipline actually applies, and it is held to the four conformation traits. This is a deliberate, slightly wider reading of the build order's "one polygenic trait end to end", and the reason is that one measurement alone (*"neck length: 62"*) does not make a horse legible or a choice between two horses interesting, while four cost exactly the same renderer.

**The four ability traits — stamina, jump scope, speed, trainability — are expressed by the same function and displayed nowhere.** This is not laziness. You learn that a horse is fast by racing it, not by looking at it. Conformation is visible on a horse standing in a field; ability is revealed by doing. Their display belongs to the slice that builds performance classes, and it will want a different frame (§2.4).

**Fertility is never displayed, in this slice or any other.** Slice 0003 §5 is explicit: a subfertile mare's owner finds out by missing, not by reading a number. `fertility` is in `TRAITS` and must be given `category = 'hidden'` in the new table, and every display query must filter on category rather than iterating the whole list. See §5.1.

### 2.2 Conformation traits are bidirectional measurements, and this changes the model

**This contradicts one line of the design record, deliberately.** Overview §2b describes the display as *"current value, breed ideal, genetic ceiling"* and the model as *"expressed value = potential × realization"*. That framing is right for ability — more speed is better, and a ceiling is exactly what a speed gene gives you. It is wrong for shape.

Neck length has no good direction. A long neck is wanted in one breed and not another; a short back is a virtue and a short neck usually is not. If the model is `potential × realization`, then a foal starts at zero neck and grows longer, and a horse with "low potential" has an extremely short neck rather than an ordinarily-proportioned one. That is incoherent, and it would silently teach children that one end of every measurement is better.

**The correction: realization moves a horse away from the population middle towards its own genetic value, in whichever direction that lies.**

- A foal reads close to the middle on everything — undifferentiated, which is what foals actually look like.
- As it matures it moves towards its genetic value, up or down.
- At maturity it reads its genetic value.

The third number is therefore not a *ceiling* but a **mature value**, and that is the word to use on screen. Keep the word "ceiling" out of the conformation UI entirely; when ability traits are eventually displayed, they are unidirectional and "ceiling" is the correct word for them then.

### 2.3 Nothing in this slice judges, scores, ranks or averages

Do not build:

- a single "conformation score" per horse, even as a display convenience;
- an average of the four traits;
- any word that implies quality — *good*, *excellent*, *poor*, *correct*, *faulty*;
- a sort by any of it;
- a breed ideal, in the `breeds` table or anywhere else.

A number that looks like a score will be treated as one, will be compared between horses, and will then be contradicted by the real scorer one slice later — and the real scorer weights traits per breed and per judge, so it will genuinely disagree. Slice 0005 §2.2 already refused to write ideal vectors before a scorer exists to read them; this is the same refusal from the other side.

**Instead, every trait is displayed between two neutral named extremes** — *short ↔ long*, *upright ↔ sloping* — with a line on the page saying, in plain English, that these are measurements rather than marks and that which end a breed wants arrives with the first show class. That sentence is not decoration; it is the thing that stops a child concluding their horse is bad.

### 2.4 The environmental noise roll is stored; everything else is computed on read

`horses.environmental_noise` is a new JSON column, written once at birth, holding one integer offset per trait.

It is stored rather than derived because `conformation_noise_sd` is config, and CLAUDE.md §5.5 is exactly about this: if the roll were re-derived on every read, an operator raising the noise setting would retroactively change the mature value of every horse already alive. Rolling once and storing the realised offset means changing that setting only affects horses born afterwards.

**The genetic value, the realization and the expressed value are all computed on read, from the genotype, the stored noise, the horse's COI and its age.** They are not stored and there is no cache column. This keeps the genotype the single source of truth and means a corrected formula fixes every horse in the game on the next page load, with no migration.

**The honest cost of that choice, stated so nobody discovers it:** `inbreeding_depression_factor` (§4.3) is read at display time, so changing it re-scores every inbred horse in the game at once. That is intended — it is a global balance knob, in the same class as `conformation_maturity_years` — but it means it should be tuned in the first weeks of play and then left alone, because after that a child will notice their horse moving. Note it on `/admin/config` next to the value.

### 2.5 Horses born before this slice need no backfill

A horse with no `environmental_noise` value falls back to deriving its noise from `deriveSeed(horse.rng_seed, 'birth_noise')` scaled by a **module constant**, not by config — so a legacy horse's numbers are stable forever regardless of what the setting is changed to afterwards.

This is the same shape slice 0003 used for `fertilityPotential`'s legacy fallback, and for the same reason: a stable, well-distributed stand-in derived from the horse's own seed is not a guess. A SQL backfill is not possible here anyway — a plain-SQL migration has no access to the JS RNG, which slice 0003's migration `0021` already ran into.

### 2.6 What a candidate shows is what the claimed horse gets

`import_candidates.rng_seed` becomes `horses.rng_seed` unchanged on claim (see `migrations/0023_import_candidates.sql`). So a candidate's noise is derived from exactly the same seed the claimed horse will carry, and the four numbers on the candidate card are the four numbers in the barn — the same guarantee slice 0002 gave for the COI preview and slice 0003 gave for the rolled genotype.

The claim writes that derived noise into the new horse row. Do not add a noise column to `import_candidates`; the seed already carries it.

---

## 3. Not built here

Each of these is a real thing that belongs to a named later stage. Do not build them, and do not leave stubs.

- **Breed ideal vectors, show classes, judges, scoring.** The next slice. `breeds.ideal_vector` stays absent.
- **Ability trait display** (speed, stamina, jump scope, trainability) — the performance-class slice, which will want the "ceiling" frame in §2.2.
- **Fertility display.** Never.
- **Training and care as inputs to realization.** The realization function takes `trainingFactor` and `careFactor` parameters that default to `1.0`, so those slices wire in without touching the model. Nothing computes them yet and no column stores them.
- **Age-related decline.** Realization is flat at maturity and stays flat. A twenty-five-year-old reads the same as a six-year-old. The ageing and death stage adds the decline curve; adding it now means guessing where it starts.
- **An uncertain mature value for young horses.** Showing a foal's mature value as a range that narrows with age would make raising a prospect a genuine gamble, and is probably right eventually. It needs an estimate deliberately offset from the truth (otherwise the midpoint leaks the true value on day one), which is real machinery. The seed label **`ceiling_estimate` is reserved** for it — same convention as slice 0004's reserved `straw_thaw`.
- **Predicted foal conformation on the breeding page.** Valuable, and it wants the range machinery above to be honest about how uncertain it is.
- **`horses.height` and `horses.weight`** (schema §4.1). These need per-breed height and weight ranges, which slice 0005 §2.2 deliberately left out and the breeds stage adds.
- **`phenotype_cache`.** Not needed at this scale; the schema doc already calls it disposable.

---

## 4. The model, precisely

All of it is pure functions with no database access, per CLAUDE.md §5.1.

### 4.1 Genetic value

```
potential(genotype, trait)   ->  0..20    (already exists, src/engines/genetics/polygenic.ts)
geneticValue = clamp(potential * 5 + noise[trait], 1, 99)
```

`potential` is the count of `1` alleles across the trait's ten loci, so for a mid-band founder it is `Binomial(20, 0.5)` — mean 10, standard deviation about 2.24. Multiplied by 5 that is a mean of **50** with a standard deviation of about **11** on a 0–100 scale, which is the bell curve overview §2b asks for. 100 is a theoretical maximum no horse in this game will reach; it is not a target.

The clamp to 1..99 keeps a value off the exact endpoints so the display bar never pins flush against a label.

### 4.2 Environmental noise

```
noise[trait] ~ round(normal(0, conformation_noise_sd))
```

Drawn once at birth, from a single `makeRng(deriveSeed(seed, 'birth_noise'))`, **one draw per trait in `TRAITS` array order**. The label was reserved for exactly this in `polygenic.ts`'s header comment. Iterating anything other than `TRAITS`, in that order, breaks reproducibility — the same rule `LOCI` carries (CLAUDE.md §11, 2026-08-02 genetics entry).

`conformation_noise_sd = 6` is the starting value. Against a genetic standard deviation of 11 that puts heritability at roughly 0.78 — high for real conformation, deliberately. Lower it and selective breeding stops visibly working within the handful of generations this game will actually see; raise it and breeding becomes arithmetic. **This is the first number to tune once there is real play**, and the thing to watch is whether a child's third-generation horses are visibly better than their founding stock.

### 4.3 Realization

```
base(ageYears)  = min(1, atBirth + (1 - atBirth) * ageYears / maturityYears)
realization     = base(ageYears) * (1 - coi * inbreeding_depression_factor)
                                 * trainingFactor * careFactor      // both 1.0 for now
```

Linear, because a curve here would be false precision. `conformation_realization_at_birth = 0.55`, `conformation_maturity_years = 5`.

**Inbreeding depresses realization, not the genetic value**, and that is a considered choice. Overview §2d asks that COI *"depress quantitative trait expression"*, and the naive reading — subtract points — has no meaning for a bidirectional measurement, because there is no direction to subtract towards. What inbreeding actually does to an animal is hold back development, and an inbred horse that never fully grows into its frame is both true and expressible: it reads closer to the undifferentiated middle for its whole life.

With `inbreeding_depression_factor = 1.0` the rule reads cleanly as **a horse expresses `(1 − COI)` of its genetic differentiation**, which mirrors the definition of COI as the probability of homozygosity by descent. Full siblings mated give a foal at COI 0.25, expressing three quarters of its differentiation — a few points on every trait, compounding across four of them. It stays config so it can be tuned.

**The hole in this, named rather than hidden:** if a breed's ideal for some trait happens to sit near the population middle, then for that one trait inbreeding would help rather than hurt. Across four traits and a real ideal vector this should be swamped, but the show slice should check it rather than assume. If it does bite, the fix is to also apply depression to the ability traits, where the direction is unambiguous — and in any case COI is meant to bite hardest through defect probability in the health slice, not here.

### 4.4 Expressed value

```
ANCHOR = 50                                    // the population middle, for bidirectional traits
expressed = round(ANCHOR + (geneticValue - ANCHOR) * realization)
```

Worked example. A foal with `potential = 14` and `noise = -2` has `geneticValue = 68`.

| Age | realization (COI 0) | expressed |
|---|---|---|
| newborn | 0.55 | 60 |
| 2 years | 0.73 | 63 |
| 5 years+ | 1.00 | 68 |

The same foal out of a full-sibling mating (COI 0.25) reads 66 at maturity instead of 68, and a horse whose genetic value is 32 rather than 68 mirrors it exactly on the other side of 50.

For a unidirectional trait the anchor is 0 rather than 50, which recovers overview §2b's `potential × realization` unchanged. Carry the anchor as trait metadata (§5.1) so the ability slice needs no new function — and so that no session ever writes `if (trait === 'speed')`.

---

## 5. Data

Four migrations. **The numbers below are provisional** — the image slot is built first and takes `0026` onwards, so read `migrations/` for the next free number and renumber these as you go. See §9.

### 5.1 New table: `quantitative_traits` (first new migration)

Schema doc §3.4, with three additions argued below.

| Column | Notes |
|---|---|
| `id`, `code`, `name` | `code` matches `TRAITS` exactly |
| `category` | `conformation` / `ability` / `hidden` |
| `direction` | `bidirectional` / `higher_better` — decides the anchor in §4.4 |
| `low_label`, `high_label` | the two named extremes, nullable for `hidden` |
| `locus_count` | 10, matching `LOCI_PER_TRAIT` |
| `teaching_text` | the short note shown to players, editable without a deploy |
| `enabled`, `sort_order` | as `loci` has them |

Additions to the schema doc's list: `direction` (forced by §2.2), `low_label`/`high_label` (forced by §2.3), and `teaching_text` (matching the `loci` table's precedent). `display_unit` from the schema doc is dropped — these are unitless positions between two labels, and a unit would imply a scale that does not exist. **Say all four in your summary**, and update the schema doc's §3.4 line.

**This table is display metadata. It is not the iteration order for anything genetic.** `TRAITS` in `polygenic.ts` stays the single source of truth for order, exactly as `LOCI` does, because the RNG draws against it. Do not reorder `TRAITS`, do not add to it, and do not iterate the database rows to make a random draw. Where the engine needs `direction` or an anchor, define it in a new `src/engines/conformation/traits.ts` that **imports** `TRAITS` rather than restating it, and mirror it into the seed migration.

Seed nine rows (second new migration):

| code | category | direction | low ↔ high |
|---|---|---|---|
| `neck_length` | conformation | bidirectional | short ↔ long |
| `shoulder_angle` | conformation | bidirectional | upright ↔ sloping |
| `back_length` | conformation | bidirectional | short ↔ long |
| `hock_set` | conformation | bidirectional | straight ↔ angled |
| `stamina` | ability | higher_better | — |
| `jump_scope` | ability | higher_better | — |
| `speed` | ability | higher_better | — |
| `trainability` | ability | higher_better | — |
| `fertility` | hidden | higher_better | — |

`hock_set`'s teaching text is worth writing properly — *post-legged* at one extreme and *sickle-hocked* at the other are the real terms, both are faults, and it is the clearest example in the set of a measurement where the middle is what a breed wants. It sets up the next slice's ideal vector better than any of the other three.

### 5.2 New column: `horses.environmental_noise` (third new migration)

`TEXT`, nullable. JSON, shape documented in the migration comment and in `src/engines/conformation/`:

```
{ "v": 1, "noise": { "neck_length": -2, "shoulder_angle": 4, ... } }
```

Nullable is load-bearing (§2.5) — null means "born before this slice, derive the fallback", and must stay legal rather than being backfilled away.

Written at three creation points, all of which already exist and all of which must be updated:

- `buildFoalInsertStatements` in `src/db/horses.ts` — from `deriveSeed(foal_rng_seed, 'birth_noise')`.
- `buildFoundingHorseInsertStatement` in `src/db/horses.ts` — from `deriveSeed(rng_seed, 'birth_noise')`. Serves both the admin founder form and a founding claim.
- Nothing else. There is no third path that inserts a horse; if you find one, that is a bug worth reporting rather than a fourth call site.

**No change to `pregnancies`.** Schema doc §10 mentions a `rolled_noise` column alongside `rolled_genotype`; it is not needed. Genetics are rolled at conception because the pregnancy is a stored fact about a foal that does not exist yet and whose genotype must not drift; environmental noise is by definition applied at birth, nothing displays a pregnancy's conformation, and the foal's seed is already fixed at conception — so rolling it at foaling from that seed is both simpler and more faithful. Note the deviation in your summary.

### 5.3 Config (fourth new migration)

| Key | Value | Kind |
|---|---|---|
| `conformation_noise_sd` | 6 | read at birth, realised value snapshotted (§2.4) |
| `conformation_maturity_years` | 5 | live |
| `conformation_realization_at_birth` | 0.55 | live |
| `inbreeding_depression_factor` | 1.0 | live — see the warning in §2.4 |

All four are numeric, so all four are editable from `/admin/config`'s existing numeric form.

---

## 6. Where it appears

Four screens, no new routes, no new pages.

1. **The horse page** (`src/render/horses.ts`'s `renderHorsePage`) — a **Conformation** card, four rows. Each row: the trait name, the two extreme labels, a bar showing the current value, and the mature value stated in words and numbers (*"now 60, will mature to 68 — long"*). Under the card, one sentence that these are measurements rather than marks, and one sentence naming inbreeding if the horse's COI is above the existing `coi_warn_threshold`. For a horse under `conformation_maturity_years`, one sentence saying it has not grown into its frame yet.
2. **The founding candidate list** (`src/render/founding.ts`) — the same four measurements per candidate, compactly. This is the payoff slice 0005 §2.7 promised; without it the screen is unchanged and the slice has missed its point.
3. **The barn list** (`renderBarnList`) — the four values compactly per row, so two horses in the same barn can be compared without opening both.
4. **`/admin/config`** — the four new keys, with the §2.4 warning against `inbreeding_depression_factor`.

**No JavaScript** (CLAUDE.md §11, 2026-08-02). The bar is two nested `<div>`s with an inline `width` percentage — add a `.meter` component to `public/style.css`'s existing token block and reuse the `:root` custom properties rather than hardcoding colour. On a phone, four bars in a card is about the limit before it stops being readable; if it feels crowded, the barn list is the one to compress, not the horse page.

---

## 7. Seeds and reproducibility

- **New label, from a horse's own seed: `birth_noise`.** Already reserved in `polygenic.ts`. One `makeRng` per horse, `TRAITS.length` draws in array order.
- **Reserved, drawn nowhere: `ceiling_estimate`** (§3).
- No existing label changes. No existing draw order changes. Adding this label does not shift any other system's stream, because every stream is its own `deriveSeed` — the property slice 0002's inheritance code was built for.
- `test/rng.test.ts`'s golden values must still pass untouched. If they fail, you have changed the RNG itself, and CLAUDE.md §11 says what that means.

---

## 8. Tests

`src/engines/conformation/` is pure, so all of this runs without a database.

1. **Golden values.** A fixed genotype, seed, COI and age produce exact expected numbers, at newborn / partway / mature.
2. **Bidirectionality.** A horse with `potential = 6` and one with `potential = 14` sit symmetrically about 50 at every age. This is the test that catches a regression to `potential × realization`.
3. **Full siblings differ.** Two foals from the same pairing with different `foal_rng_seed`s get different genetic values. (Acceptance step 5.)
4. **Inbreeding is monotonic.** Rising COI moves the mature value strictly towards 50, never past it, and COI 0 changes nothing.
5. **Legacy fallback is stable.** A horse with null `environmental_noise` produces the same numbers across two calls, and produces the *same* numbers when `conformation_noise_sd` is changed — this is what §2.5 actually promises.
6. **Consistency.** Extend `test/genetics/consistency.test.ts`, which already does this for `LOCI` against `0015_seed_loci.sql`: the codes seeded by the trait-seed migration must equal `TRAITS` exactly, in order, with matching `locus_count` and `direction`. It parses the migration text; follow that pattern rather than inventing a second one.
7. **Clamping.** `potential = 0` and `potential = 20` both land inside 1..99 after a large noise draw.

---

## 9. Where this sits in the order, and how to number the migrations

**The image slot is built before this slice, not after it.** An earlier draft of this document argued the reverse, on the grounds that the image library did not exist and that overview §14 had not decided whether images were matched to phenotype. **Both were resolved in conversation on 2 August 2026 and the reordering is withdrawn** — the operator is generating the library per breed and uploading it through GitHub's web editor, and images are matched on breed only (overview §5b, §14). The overview §13 build order, which always had the image slot first, is correct as written and needs no change on this point.

So the sequence around this slice is: **image slot → this slice → one show class.** Nothing about the content of this document changes; only its position.

**On the migration numbers.** §5 proposes `0026`–`0029`. Treat that as "this slice expects four migrations", not as a reservation. The image slot is built first and will take `0026` onwards, so **renumber this slice's migrations to whatever is actually free when you build it** — check `migrations/` rather than trusting this document, per CLAUDE.md §9. The same applies to the deferred PIN work in slice 0005 §7, whose own numbering note has now been wrong twice for exactly this reason.

---

## 10. If this is too large for one session

The split is clean, and it is **§6 item 3**: the barn list.

Build the engine, the migrations, the horse page and the founding candidate list — that is acceptance steps 1 through 10 minus the ability to compare two horses without opening both pages. The barn-list display is a second renderer over a model that is by then finished and tested, and it can land in ten minutes whenever someone next touches that file.

Do not split it the other way, and do not split the engine from the display. A stored noise column that nothing reads is worse than nothing: it is a migration a future session has to reason about with no screen to check it against.
