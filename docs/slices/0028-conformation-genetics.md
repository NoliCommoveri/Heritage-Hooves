# Slice 0028 — Conformation genetics

**This is the only conformation-genetics document. It holds two states: what exists today (§1) and
what exists once this slice lands (§2 onward). Nothing else about conformation genetics is worth
reading, and the intermediate proposals that led here have been deleted deliberately.**

Decided with the operator 2026-08-07. Per CLAUDE.md §2, treat §2–§8 as standing. §9 is the short
list of what is genuinely still open.

Measured throughout by `docs/analysis/breeding-lab.mjs`, which models both engines
(`--engine today` and `--engine proposed`). Re-run it after any change.

---

## 1. What exists today

Five conformation traits — `neck_length`, `shoulder_angle`, `back_length`, `hock_set`,
`head_profile` — each carried as **20 polygenic alleles** (`LOCI_PER_TRAIT = 10`, two per locus).

```
potential()    = count of '1' alleles, 0..20
geneticValue   = potential × 5 + noise,     clamped 1..99      (conformation_noise_sd = 6)
realization    = age curve × (1 − COI × inbreeding_depression_factor)
expressed      = 50 + (geneticValue − 50) × realization        (anchor 50, bidirectional)
```

A trait is judged as **distance from the breed's own target** in `breeds.ideal_vector`, and rendered
as a word (Poor / Weak / Acceptable / Good / Outstanding) once the horse has one show start.

**Three defects, all measured, and the reason this slice exists.**

- **The scale is breed-blind.** Nothing in the draw reads `ideal_vector`. **26.5% of Arabians minted
  today have a Roman nose** (the range is 1–98 against a standard of 8), and 94.4% of horses carry
  at least one trait more than 25 points off their own breed's standard.
- **The genotype is unreadable.** 20 alleles produce a value; homozygous and heterozygous present
  identically; a mare has one foal a year. A whole breeding career can pass without a player
  learning whether a pairing was good or merely unlucky.
- **Variance swamps the signal.** Two Quarter Horses both Outstanding on all five traits throw a
  foal matching them on all five **0.9%** of the time, at an SD of **10.6 points against a ±5
  window**. A *genetically perfect* Paso Fino reads Outstanding on only **3.15 of 5** — noise at 6
  costs nearly two traits on its own.

And the quality band never means what its name says: `mid` delivers 16–34% on-target depending on
breed, and for three breeds a *higher* band produces a *worse* horse — so the show barn's Champion
field has never actually been better than its Novice field.

---

## 2. What lands

### 2.1 One Mendelian locus per conformation trait

Five new loci appended to `LOCI` — `NL`, `SA`, `BL`, `HS`, `HP`. They use the existing Mendelian
machinery unchanged (`meiosis`, `combine`, `sortAllelePair`, `getMendelianPair`, `drawAllele`,
`parseAllelePool` are all already allele-count-agnostic). The one structural change: `Locus.alleles`
becomes `readonly string[]`, from `readonly [string, string]`.

### 2.2 The ladder

Each locus has **13 alleles, named for their own value on the trait's 1–99 scale**:

```
2, 10, 18, 26, 34, 42, 50, 58, 66, 74, 82, 90, 98        (a rung every 8 points)
```

Eight points per rung is chosen against the label bands (migration `0135`) so **one rung off target
is about one word worse**: 0 rungs → Outstanding, 1 → Good, 2 → Acceptable, 3 → Weak, 4+ → Poor.

Every target in `breeds.ideal_vector` is re-seeded to its nearest rung. **No target moves more than
4 points**, inside the tolerance `docs/breed-ideal-vectors.md` §4 claims for itself. Without it there
is a permanent snap-to-grid error nobody can breed away, and it costs a genetically perfect Paso Fino
0.6 of a trait (4.36 → 4.97 of 5).

### 2.3 Expression: the horse shows its worse allele

**A horse's displayed value for a trait is whichever of its two alleles is FURTHER from its own breed
standard.** Faults dominant, quality recessive.

```
expressed = worseAllele + (alleleCount − 10) × conformation_modifier_step + noise
            conformation_modifier_step = 0.10   (a range of ±1.0)
            conformation_noise_sd      = 0.5
```

This is the load-bearing choice in the whole slice, and one sentence says why:

> **A trait reading Outstanding is homozygous at the standard. Always. There is no fake.**

A horse can only look correct when it has nothing worse to show. So what a child *sees* and what a
breeding programme *accumulates* are the same number — the count of finished traits is visible for
free, it is exactly the count of traits reading Outstanding, and it cannot fall. A child reads the
rule as *"you can't hide a fault, but you can hide a virtue."*

Measured at these settings: the word beneath a trait matches the genotype **100%** of the time, and
an Outstanding trait really is homozygous-at-standard **100%** of the time. That second number is
what a child's breeding decisions rest on.

The 20-allele polygenic block keeps its exact shape, its exact inheritance (`inheritPolygenic`, not
one line changed) and its exact RNG streams. Demoted to ±1.0, it is the tie-breaker between two
horses with identical type genes — the thing still worth chasing after the type genes are fixed.

`show_noise_sd` (5) is **not** touched. Uncertainty belongs in the show ring, where everyone can see
it is luck. It does not belong in the horse.

### 2.4 Breed pools are derived from the standard, never hand-written

For these five loci the founding pool is **computed** from `breeds.ideal_vector` and the band, not
stored in `breeds.founding_allele_pool`:

```
target rung        gets  conformation_concentration      (0.28 / 0.55 / 0.75 by band)
one rung away      gets  0.45 × the remainder, split both ways
two rungs away     gets  0.18 × the remainder
three rungs away   gets  0.06 × the remainder
beyond             nothing
                   then renormalise, truncating at the ends of the ladder
```

A rule rather than 40 hand-written pools, for one reason: a hand-written pool drifts from the
standard it describes, and that drift is the defect in §1. Retune a breed target and its pool follows
in the same migration, with no way to forget.

This is a knowing exception to `pool.ts`'s "a pool must list every locus" rule. `parseAllelePool`
must exempt these five **explicitly**, so a missing colour locus still throws.

### 2.5 The band finally means what its name says

The band is the **concentration** of the pool around the breed's own target — one number, one
meaning, monotonic for every breed automatically because it is defined relative to the breed rather
than against a fixed scale. `/admin/npc`'s band picker means the same thing whichever breed is in
the box, which it has never done.

Both band pickers in `src/render/admin.ts` currently say `"{band} ({n}% chance per allele)"`, which
becomes untrue; they read `"{band} — about {n} of 5 traits right for the breed"`.

### 2.6 The founding specialist: carrier, not finished

Slice 0019's conformation specialist is **reframed, not deleted**. One trait gets **one allele at
the breed's target rung, the other drawn from the pool** — the horse carries the correct gene, so a
small barn is never short of raw material, but has not been handed a finished trait.

Homozygous-at-target was measured and is too generous: it hands over 1.34 of the 5-trait endgame at
mint. Carrier hands over 0.42. The ability specialist is untouched.

Founding stock mints at band **`low`** (concentration 0.28): about **2.5 of 5 traits right, and 2.5
left to breed for**. `mid`/`high` stay at 0.55/0.75 — they are the show barn's and the consignment
dealer's bands, not the children's.

### 2.7 Mare prenatal care

A paid option on a covering that **moves the foal's worst trait one rung toward its breed standard**.

- **It hangs off the pregnancy.** `pregnancies` already carries its own `rng_seed` and a snapshotted
  gestation length; one more snapshotted column is the whole storage cost.
- **Committed before the foal exists**, so it can never be an undo on a bad roll. The player pays
  blind — a real decision rather than a correction.
- **Capped at one per foal by construction.** No lifetime counter, no way to stack.
- **The mare's genotype is untouched.** One trait in one foal, moved once, at the moment that foal
  was formed.
- **Toward the standard only, never away and never past it.** Breed type strictly improves and
  cannot erode, and an NPC stable that never buys it never moves.
- **It cannot fail.** No die roll. The cost is the price. If it needs to be slower, the price moves —
  a lever the player can see and plan around, not the odds.
- **The mechanic picks the trait; the player never chooses.** Whichever trait the foal shows
  furthest from its own breed standard, resolved at foaling, after the alleles are drawn.
- **Cost: `prenatal_care_cost` (default 500) plus one turn**, charged on the covering at the moment
  the player commits. A live tunable, set at `/admin/config`. No refund if the covering does not
  take — the same rule as a stud fee.

**It moves the worst TRAIT, not the worst ALLELE, and that distinction is not cosmetic.** Under §2.3
a horse shows its worse allele, so improving one copy of a homozygous pair leaves the other copy
showing and the purchase is invisible — about half of all purchases, at random, with nothing on
screen to explain it. Moving the trait costs one allele step on a heterozygote and two on a
homozygote. The extra cost is the point: the mechanic does twice as much genetic work in exactly
the case where a line is most stuck.

**This is the only mechanism in the design that puts a correct allele into a closed herd.** Mendelian
inheritance shuffles alleles; it never invents one. A line whose neck alleles are `58` and `82`
against a standard of `74`, where no horse in three generations owns a `74`, plateaus at 4 of 5
forever — two coverings with care walk it 58 → 66 → 74 and finish it.

**500 is a first guess and is the first number to revisit in real play.** It decides whether a child
buys care on one mare a year or on all seven, and therefore where a line lands (§3). Pacing lives in
the price deliberately, so it can be moved without touching the genetics.

---

## 3. What it produces

Arabian, band `low`, selection on looks alone — no testing, no genotype knowledge. Traits on target,
which under §2.3 is identically traits permanently fixed.

| gen | no prenatal care | care bought every covering |
|---|---|---|
| founding | 1.35 | 1.35 |
| 3 | 1.61 | 2.95 |
| 5 | 2.18 | 4.42 |
| 8 | **2.90** | **5.00** |

Real play sits between the two columns, since cost and turns mean a child will not buy it on every
covering — which is what makes the price the pacing dial.

Two Outstanding parents, bred together:

| | foal matches both parents on all five | within-pairing SD |
|---|---|---|
| today | 0.9% | 10.6 pts |
| **this slice** | **100%** | **0.6 pts** |

Both parents are homozygous at the standard *by definition of looking that way*, so every foal is.
**Two great horses cannot produce a worse foal**, which is the complaint this slice answers.

Founding stock is uniform across all eight breeds (2.5–2.6 traits on target, wrong-breed type
≤0.5%), so the band picker means one thing everywhere.

---

## 4. Rules that will bite you

Each of these is the obvious next change, and each causes a real defect.

1. **Do not re-anchor `realization()` off 50 onto the breed target.** Inbreeding depression is a
   multiplier on realization, so anchoring on the target makes **an inbred horse score better**,
   undoing the health slice's central dilemma. Leave `realization()`, `anchorFor()` and
   `inbreeding_depression_factor` alone — this slice touches none of them.
2. **Inbreeding depression must come off conformation expression** (slice 0018's proposal). With it
   live, a horse's displayed value is its allele pulled some distance toward 50 — so it is no longer
   any allele the horse owns, and §2.3's guarantee is false. Watch for it: `dynasty`'s `on target`
   and `FIXED` columns print identically under this design, and if they ever diverge, this is why.
3. **The polygenic loop must keep drawing its exact 20 bits per trait**, in place, even though the
   value is demoted (slice 0019 §7's rule). Skip them and every existing RNG stream shifts — colour,
   disease, ability, age all change for the same seed.
4. **`conformation_noise_sd` is shared with ability.** `rollEnvironmentalNoise` draws
   Normal(0, sd) for **all fourteen traits** from that one key. Dropping it 6 → 0.5 silently tightens
   every discipline class too. Either accept it, or split the key (`ability_noise_sd`, staying at 6)
   and have `drawNoise` take one SD per trait category. **Decide this before the migration lands** —
   it is a conformation change leaking into ability, not an ability question.
5. **`import_offers` needs the band snapshotted** (CLAUDE.md §5.5), so a pending founding offer
   generates under the rules it was minted with.
6. **Conformation loci are not injectable.** `injection.ts` assumes biallelic; the consignment
   allowlist is colour/gait only. That is a comment plus an assertion, not logic.

---

## 5. Build order

The later steps read the earlier ones.

1. `Locus.alleles` → `readonly string[]`; five conformation loci appended to `LOCI`.
2. **`src/engines/conformation/typeGene.ts`** — new pure module: the ladder, `shownAlleleFor(pair,
   target)`, `poolForTarget(targetRung, concentration)`. Everything imports it; nothing restates it.
3. `geneticValue()` in `src/engines/conformation/model.ts` — reads the type locus per §2.3 plus the
   demoted modifier. The one function that changes the meaning of a horse's number, and every screen
   already goes through it.
4. `generateCandidate()` — draw the five type pairs from the derived pool; specialist per §2.6. The
   polygenic loop is untouched (rule 3).
5. `parseAllelePool()` — exempt the five, explicitly.
6. Migrations (§6).
7. **Mare prenatal care** (§2.7) — a column on `pregnancies`, a checkbox on the covering form, a
   config key, an `ACTION_COSTS` entry, a ledger kind, and one call in the foaling path. Additive:
   it touches only new coverings and is the one part of this slice that could land separately.
8. Testing: a conformation panel on `/horses/:id/test`, reusing
   `horse_knowledge.subject_code = 'locus:NL'` exactly as colour does, in its own `<details>` group.
9. `inferFromPhenotype` — under §2.3 a horse's shown value **is** its worse allele, so looking tells
   you that one exactly and the test buys the *hidden better* one. One sentence, not a table.
10. `foalPrediction.ts` — **replaced by something much shorter**. The Poisson-binomial convolution
    goes; a 2×2 Punnett over known alleles crossed with the small modifier distribution is exact.
    It must read **Unknown** for an untested parent (slice 0025's rule, unchanged).
11. Everything that mints a horse (`src/db/founding.ts`, `npc.ts`, `consignment.ts`) passes the
    breed's ideal vector. `consignment.ts`'s hardcoded `cfg.quality_bands.mid ?? 0.5` becomes a real
    `consignment_quality_band` key.

The admin create-horse form needs a select rather than radios for a 13-allele locus. It stays a
neutral control (slice 0005 §6.6): a hand-created horse defaults to the middle rung on all five, not
to a breed's target.

---

## 6. Migrations

Next free is `0176`. Each registered in `src/db/migrations.ts` (CLAUDE.md §8).

- **0176** — `breeds.ideal_vector` targets snapped to the ladder, all eight breeds, five traits.
- **0177** — `quality_bands` reshaped to two numbers per band: `conformation_concentration`
  (0.28 / 0.55 / 0.75) and `ability_one_chance` (0.42 / 0.50 / 0.58, **today's values, unchanged**).
  The single number is currently *also* the ability allele frequency that `breeds.ability_bias`
  offsets, so moving it would silently undo slice 0024. This split is forced, not cosmetic.
- **0178** — `conformation_modifier_step` 0.10, `conformation_noise_sd` 0.5, `conformation_test_cost`.
- **0179** — `founding_quality_band` → `low`, new `consignment_quality_band` → `low`.
- **0180** — `import_offers.conformation_concentration`, snapshot column.
- **0181** — `pregnancies.prenatal_care` snapshot column, `prenatal_care_cost` = 500.

---

## 7. Tests

1. Every breed's snapped target sits **exactly on a rung** — read off the migration on disk, not
   hand-copied, the way `test/showing/breed-aptitude.test.ts` already does.
2. A generated horse of every breed is within 3 rungs of its target on every conformation trait, at
   every band. This is the test that would have caught the original defect.
3. The band is **monotonic per breed and per trait** — asserted per trait, never on the average,
   since averaging is what hid the original bug.
4. A trait reading Outstanding is homozygous at the standard, over many seeds. §2.3's guarantee,
   pinned.
5. Two homozygous-identical parents produce a foal with the identical type pair, every time.
6. The same seed produces the **same ability traits, age, colour and disease genotype** before and
   after. The regression that proves rule 3's stream discipline held.
7. Ability traits are unaffected by `conformation_concentration` at any value.
8. Prenatal care on a **homozygous** worst trait changes the shown value (the invisible-purchase
   case in §2.7), and never moves a trait past its target.
9. `foalPrediction` reads Unknown when either parent's type genes are untested by this viewer.
10. A breed with no `ideal_vector` still generates (middle rung) and is not judged.

---

## 8. The cost, and how it lands

**This needs a world reset.** No living horse has a type-locus genotype, and the missing-locus rule
would read them all as the middle rung — every horse in the game identical and off-type. A backfill
deriving each horse's pair from its expressed value does not work: today's values are centred on 50,
not on breed targets, so every Arabian would be permanently Poor-headed. **Grant the new founding
batches after the migrations land, not before** — `import_offers` snapshots the band.

Scores compress upward: a field of on-type horses is a closer field, so `show_noise_sd` decides a
larger share of classes. That is the dial to reach for if it grates, not this one.

`foalPrediction.ts` gets substantially shorter, so this deletes real code as well as adding it.

---

## 9. Still open

1. **Is the conformation test one purchase per locus, or one panel per horse?** Five purchases is a
   real money sink and lets a child test only what they care about; one panel is kinder and simpler
   to explain. Either way this is the test a child wants on every horse they consider buying.
2. **Are a horse's own type genes free once it has shown**, the way conformation *words* already are
   (slice 0022 Part B)? Under §2.3 looking already tells you the worse allele, so the test only buys
   the hidden better one — which makes free-after-a-start cheaper than it used to be. Middle option:
   your own horses free, another stable's only by testing.
3. **Rung step 8 (13 alleles)?** A step of 10 gives 11 alleles and a cleaner one-step-one-band story,
   at the cost of a coarser ladder and larger target snapping. Everything above is measured at 8.
4. **Split `ability_noise_sd` off, or accept the tightening?** Rule 4. Needs deciding before 0178.
5. **Confirm the reset**, and that founding grants go out afterwards.

---

## 10. The bench

`docs/analysis/breeding-lab.mjs` is the only conformation bench and models both engines. It defaults
to this slice's decided settings, so a bare run measures what is specified above.

```
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8              # the design
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --coax 1     # ... with prenatal care
node docs/analysis/breeding-lab.mjs breed 12 to 16 --foals 4 --prenatal 1      # one covering, four foals
node docs/analysis/breeding-lab.mjs bands --breed AR                           # does the word match the genes?
node docs/analysis/breeding-lab.mjs sweep --breed all                          # founding stock, all breeds
```

It is a simulation of a system that has not been built, with its own PRNG and its own copy of the
game's constants — and that copy can drift. Every constant in it names its source.
