# Slice 0029 — Ability genetics

**Status:** specified, not built (2026-08-08).

**Read `docs/slices/0028-conformation-genetics.md` §2 before this document.** This slice is the
ability-trait counterpart of that one, and it deliberately does *not* copy it. Where it departs, §2.1
says why.

**Do not build this before slice 0028's world reset (§8 of that document) has run.** That reset is
still outstanding. This slice needs the same reset, and the two must ride *one* reset between them —
see §8 below.

---

## 1. What is wrong today

Ability traits — `stamina`, `jump_scope`, `speed`, `trainability`, `agility` — still run on the
original slice 0002 model: twenty independent coin-flip alleles per trait, `potential` = the count of
`1`s, `geneticValue = potential × 5 + noise`. Breed enters at exactly one point, as a ±0.06 offset to
the coin's bias (`breeds.ability_bias`, migration `0142`).

Three defects, reported by the operator on 2026-08-08 after running `docs/analysis/breeding-lab.mjs`
at five horses per breed.

### 1.1 Breed is invisible in the results — and the founding specialist is why

The operator's report: *"the best stamina on Arabian was identical to best stamina on quarter
horse."* That is not noise swamping a signal. It is a constant.

`generateCandidate` (`src/engines/founding/generate.ts`) picks one eligible ability trait per founding
horse and **overwrites** its twenty bits to `founding_ability_specialist_potential` (15) ± 1 — a
genetic value of 70–80. That overwrite is breed-blind by design; `docs/breed-ability-and-aptitude.md`
§4 defends it explicitly, on the grounds that a breed leaning should never touch the one trait a horse
was singled out for. With four eligible traits and five horses per breed, there is a **76% chance each
breed's batch contains a stamina specialist**, and when it does that horse is pinned at ~75 for the
Arabian and the Quarter Horse alike. Both breeds' "best stamina" is the same hardcoded constant,
arrived at by the same code path.

The bias would have been faint even without it. ±0.06 moves the mean 6 points against a genetic SD of
11.2 and a birth-noise SD of 6 — a 12-point breed gap inside a 12.7-point spread, undetectable at
n = 5.

### 1.2 Nothing anywhere states what a breed cannot be

`potential` runs 0–20 for every breed, so a genetic value of 0–100 is reachable by any horse of any
breed. A Quarter Horse with 70 stamina and an Arabian with 20 stamina are both ordinary draws. There
is no floor and no ceiling at any layer — not at generation, not at inheritance, not at expression.

### 1.3 Foals cannot reliably match their parents, and structurally never could

Ten loci segregating independently give a foal a mean of exactly midparent with an SD of ~11 points,
so **half of all foals fall below midparent by construction.** Birth noise (SD 6) then adds a
permanent, invisible ±12 on top of that: a genetically excellent horse can score twelve points low for
its whole life, with no way for its owner to learn that and no way to fix it.

Five mediocre foals in a row from good parents is not bad luck. It is what this model does.
Conformation had the identical defect and slice 0028 closed it with the generational ratchet; ability
never got one.

### 1.4 Found while measuring: the quality bands barely exist, and a line runs away

Not in the operator's report — turned up by `docs/analysis/ability-lab.mjs` (§6) while benching the
other three, and arguably worse than any of them.

**The bands are nearly meaningless today.** On a horse's best ability trait, a `low`-band Quarter
Horse has a median of 73 and a `high`-band one a median of 76. Three points. Since
`npc_show_barn_rank_plan` mints the novice tier at `low` and the champion tier at `high`, **the
champion field is three points better than the novice field** — the operator's requirement that
champion-level NPCs outperform low-band stock is not merely untuned today, it is essentially absent.
The cause is §1.1 again: the specialist overwrite pins every horse's best trait at ~75 regardless of
band, so the band's own ±0.08 swing in allele frequency is nearly all that is left to distinguish them.

**And a breeding line runs away.** Selecting the best of four foals each generation from a low-band
founding pair, today's engine reaches a median that **beats the champion bar by generation 4** and
saturates at the 99 clamp by generation 8, with 97% of lines above the bar. That is CLAUDE.md §13's
NPC-ceiling failure mode arriving through the genetics rather than through NPC breeding — unbounded
improvement, after which the children cannot lose.

---

## 2. The shape

Four pieces. The first is load-bearing and nothing else works without it.

### 2.1 Where this departs from conformation, and why

| | Conformation (0028) | Ability (this slice) |
|---|---|---|
| Direction | bidirectional — distance from a target | unidirectional — higher is better |
| Breed data | `ideal_vector` (a target) | `ability_ranges` (a floor and a ceiling) |
| Loci per trait | 1 | **2** |
| Expression | **worse** of the pair — faults dominant | **mean** of all four alleles |
| Visible? | yes, a word per trait, always | no — only a show score and an ability-test word |
| Ratchet target | the breed standard | the breed **ceiling** |
| Ratchet-eligible traits | all five | **the breed's own top three** |

The two big departures are deliberate:

- **Mean-of-four, not worse-of-pair.** "The fault is what you see" is a statement about a horse an
  owner is *looking at*. Ability is invisible; there is no fault to see. Mean-of-four is also true to
  real quantitative genetics, and — the reason that matters here — it makes a foal's value land on
  exact midparent with a small spread instead of a large one, which is what §1.3 needs.
- **Two loci, not one.** With one locus, two homozygous parents produce foals with *zero* variance and
  a foal can never exceed its better parent's better allele; breeding stops being breeding and becomes
  arithmetic. Two loci keeps a genuine positive-surprise foal possible — you can stack a good locus
  from each parent — while still cutting foal SD from today's ~11 points to **~3**.

### 2.2 `breeds.ability_ranges` — the floor and the ceiling

A new `TEXT` column on `breeds`, holding JSON, in the same shape and with the same admin story as
`ideal_vector` and `discipline_aptitudes`:

```json
{"v":1,"traits":{"stamina":{"floor":54,"ceiling":94}, ...}}
```

Values are on the same 1–99 scale as everything else, and **every floor and ceiling sits on the
existing 25-rung ladder** (`TYPE_GENE_RUNG_BASE = 2`, `TYPE_GENE_RUNG_STEP = 4`, so every legal value
is ≡ 2 mod 4). Reusing the conformation ladder is worth more than a ladder tuned for ability: a future
session should have to learn one ladder, not two.

**Enforce the window at expression, not only at generation.** The expressed value is clamped to
`[floor, ceiling]` of the horse's **own breed's** window. This is what makes the operator's *"idc how
much breeding you do"* literally true rather than merely probable, and it closes the one real
loophole: an Arabian × Quarter Horse cross laundering high-stamina alleles into a foal registered as a
Quarter Horse. A cross's `breed_id` names the registry it competes under (CLAUDE.md §12, and
`aptitudeFor` already leans on exactly this by giving crosses a neutral aptitude), so the window it is
held to is the window of the breed it is registered as. That is consistent, and it is the only reading
that cannot be gamed.

**This replaces `breeds.ability_bias` (migrations `0141`/`0142`) entirely.** A probability nudge and a
hard bound are two answers to the same question and the bound is the better one; keeping both would
double-count breed identity the same way `parseAbilityBias`'s own comment refuses to double-count it
for conformation. Zero the column rather than dropping it (a `breeds` rebuild is not worth it), and
say so in the migration comment so the next session does not read a live-looking column as live.

### 2.3 The genotype: two Mendelian loci per ability trait

Ten new Mendelian loci in `src/engines/genetics/loci.ts`, two per ability trait, on the existing
25-rung type-gene ladder — `ST1`/`ST2`, `JS1`/`JS2`, `SP1`/`SP2`, `TR1`/`TR2`, `AG1`/`AG2`.

A trait's genetic value is the **mean of its four allele values**, plus the demoted polygenic
tie-breaker, clamped to the breed window:

```
abilityGeneticValue(trait) =
  clamp(
    mean(locus1.a, locus1.b, locus2.a, locus2.b)
      + (potential(trait) - 10) * ability_modifier_step
      + noise[trait],
    window.floor,
    window.ceiling
  )
```

The existing twenty-bit polygenic block is **kept and demoted**, exactly as slice 0028 §2.3 demoted
conformation's. `TRAITS` is append-only and its order is the RNG draw order (`polygenic.ts`'s own
comment); removing ability from it would renumber every draw downstream. Leave
`generateFounderPolygenic` and `inheritPolygenic` untouched and let the block be a ±1 tie-breaker via
`ability_modifier_step` (default `0.1`, mirroring `conformation_modifier_step`).

Because expression is a mean of four, **moving any one allele one rung moves the expressed value by
exactly one point** (`RUNG_STEP / 4`). Which of the four is moved therefore makes no difference to
*this* horse's score — it matters for what the horse can pass on, which is the whole point of §2.5's
choice to move the worst one.

### 2.4 Quality bands, and what a high-band horse looks like

The operator's ask: *"somewhere needs a number saying 'this is what a high band horse looks like' then
allowing variance from that number."*

Mirror `DEFAULT_PAIR_SPECS` (`typeGene.ts`) exactly — five specs per band, one per ability trait,
shuffled across the traits so every horse of a band has the same *shape* and only which trait is which
varies. The difference is that an ability spec names **four** bucket indices (four alleles, not two),
and the buckets are measured **downward from the breed's ceiling** rather than outward from a target.

Buckets are three rungs each, truncated at the window floor — the same construction as
`alleleBuckets()`. On a ten-rung window: bucket 0 = 0–2 rungs below ceiling, 1 = 3–5, 2 = 6–8,
3 = 9–10.

```
high: [0,0,0,0]  [0,0,0,1]  [0,0,1,1]  [1,1,1,2]  [1,2,2,3]
mid:  [0,0,0,1]  [0,1,1,1]  [1,1,2,2]  [1,2,2,3]  [2,3,3,3]
low:  [0,1,1,2]  [1,2,2,2]  [2,2,3,3]  [2,3,3,3]  [3,3,3,3]
```

These live in `config.values.quality_bands[band].ability_specs`, alongside the conformation `pairs`
already there — a live tunable, retunable from `/admin/config` with no deploy, exactly as migration
`0178` made the conformation specs.

**What that is worth, in points below ceiling** (bucket midpoints 1 / 4 / 7 / 9.5 rungs, × 4 points,
÷ 4 alleles):

| band | best trait | average trait |
|---|---|---|
| high | ceiling − 4 | ceiling − 13.5 |
| mid | ceiling − 7 | ceiling − 21 |
| low | ceiling − 16 | ceiling − 29.5 |

So on a Quarter Horse's speed window (54–94): a high-band horse averages **80.5** and its best sits at
**90**; a low-band founding horse averages **64.5** with a best of **78**. That 16-point average gap
is the operator's requirement stated as arithmetic, and §7 test 6 asserts it.

`npc_show_barn_rank_plan` already maps champion → `high` and novice → `low` (migrations `0173`/`0176`),
so **no change to the show barn is needed** for "champion-level NPCs on average outperform my
low-band and 2–3-generation stock" to hold. It falls out of the band specs.

### 2.5 The ratchet, aimed at the ceiling — and restricted to the breed's top three

Same shape as `applyBaselineRatchet` / `applyCareRatchet`, and it **replaces nothing** — a bred foal
gets both the conformation ratchet and this one, since they touch disjoint loci.

**Eligible traits are the breed's own top three by ceiling** (operator decision, 2026-08-08). Derived
from `ability_ranges`, never stored separately, so it can never drift out of agreement with the
window: sort the five traits by ceiling descending, tie-break by `TRAITS` order. That tie-break must be
**stable and RNG-free** — it defines what a breed can improve at, forever, and a per-horse draw would
make two horses of one breed improvable at different things.

- **No mare care (the free baseline):** one of the three eligible traits is chosen **at random** from
  the foal's own seeded rng, and that trait's **worst of four alleles** moves `ability_ratchet_rungs`
  closer to the ceiling. Never overshoots.
- **With mare care (`coverings.prenatal_care`, already built):** **all three** eligible traits are
  ratcheted, each by moving its own worst-of-four allele. Same step size, three times the coverage.

Moving the *worst* allele rather than the best-placed one is the operator's own call and is right for
a reason worth writing down: since any single allele move is worth the same +1 point to *this* horse
(§2.3), the choice only affects **what the horse passes on.** Raising the floor of a horse's four
alleles shrinks the chance of a bad gamete in the next generation, so the ratchet compounds down the
line instead of decorating one animal.

**A ceiling is what makes an ability ratchet safe at all.** Conformation's ratchet is self-limiting
because it moves toward a *target*. An unbounded upward ratchet on ability would walk straight through
the NPC quality ceiling — the failure mode CLAUDE.md §13 names as the one most likely to kill this
project. **Do not build §2.5 without §2.2.**

**A consequence to state plainly, because it is strong and intended:** a breed's other two ability
traits can never be improved by breeding at all. A Quarter Horse line will never breed up its stamina;
the only way to hold a good-for-a-QH stamina horse is to be dealt one. That is what makes a breed a
breed here.

### 2.6 The founding specialist becomes an upgrade inside the window

`generateCandidate`'s ability specialist stops being an absolute overwrite to potential 15 and becomes
what slice 0028 §2.6 already made the conformation one: **an upgrade of one allele the deal already
granted, to bucket 0 of that breed's own window.** An Arabian speed specialist then tops out at 70
(its window ceiling); a Quarter Horse speed specialist tops out at 94.

The assigned trait is **round-robin across the breed's three eligible traits** (§2.5), not across all
five and not drawn per horse — same reasoning as `applySpecialistUpgrade`'s own round-robin. This also
retires `founding_ability_specialist_potential` (migration `0101`), whose units (a count out of 20) no
longer exist.

This single change is what fixes §1.1. Do it even if nothing else in this slice is built.

---

## 3. Noise

**Set `ability_noise_sd` from 6 to 1.**

Birth noise is currently ~40% of all ability variance, rolled once, permanent, and invisible. It works
directly against the operator's *"reliably improve"* requirement: it is the one thing a child can do
nothing about and cannot even see. Meanwhile `show_noise_sd` (5) already supplies the day-to-day drama
at the point where drama belongs — a horse having a bad day at a show. Birth noise is a second,
worse copy of it.

This is a config edit. No migration to any engine, no reset needed for it alone (a stored roll is
frozen on `horses.environmental_noise` and only new horses pick up the new value — and the §8 reset
regenerates everything anyway). **It is the highest value-per-unit-of-work change in this document**
and can land ahead of the rest.

Note that show noise still applies *after* the window clamp, at scoring, not at expression. A Quarter
Horse with stamina expressed at 58 can still post a 63 in an endurance class. That is a race result,
not the horse's stamina, and it is correct.

---

## 4. The eight breeds' windows

First guesses, drawn to agree with the leanings already decided in migration `0142` and the aptitudes
in `0144`. Tune them by watching results, not by reasoning harder — the same instruction
`docs/breed-ideal-vectors.md` §4 gives.

Every value is on the rung ladder (≡ 2 mod 4). Every window is ten rungs (40 points) tall, so the
bucket construction in §2.4 lands identically for all of them. **The three ratchet-eligible traits per
breed are the top three ceilings, marked ★.**

| Breed | stamina | jump_scope | speed | trainability | agility |
|---|---|---|---|---|---|
| Quarter Horse | 18–58 | 14–54 | ★ 54–94 | ★ 34–74 | ★ 50–90 |
| Arabian | ★ 54–94 | 10–50 | 30–70 | ★ 42–82 | ★ 34–74 |
| Thoroughbred | ★ 46–86 | ★ 38–78 | ★ 54–94 | 14–54 | 18–58 |
| German Warmblood | 18–58 | ★ 54–94 | 14–54 | ★ 50–90 | ★ 38–78 |
| Friesian | 26–66 | ★ 30–70 | 10–50 | ★ 54–94 | ★ 34–74 |
| Paso Fino | 22–62 | 6–46 | ★ 26–66 | ★ 46–86 | ★ 54–94 |
| Icelandic | ★ 50–90 | 10–50 | 6–46 | ★ 34–74 | ★ 46–86 |
| Nokota | ★ 42–82 | 26–66 | ★ 34–74 | 30–70 | ★ 38–78 |

The two requirements the operator stated by name both hold by construction: the worst possible Arabian
has **54** stamina, and the best possible Quarter Horse has **58** — the two windows barely overlap,
so an Arabian is never bad at stamina and a Quarter Horse is never good at it.

Two rows worth their comment:

- **Icelandic** has no ceiling at 94 anywhere. A small, tough, hardy horse should not top the game's
  scale at anything; it wins by having no hole rather than by having a peak.
- **Nokota** is the flattest row in the set — nothing above 82, nothing below 66 in the ceilings —
  matching the treatment `0142` and `0144` already gave it and the reasoning
  `docs/breed-disease-panels.md` used when it gave the Nokota no disease panel. An unselected landrace
  should be even, not specialised.

---

## 5. Build order

Each numbered step is one migration or one module, and the repo deploys after every one.

1. `breeds.ability_ranges` column (`ALTER TABLE ADD COLUMN`, nullable — the `breeds.ideal_vector`
   precedent, migration `0034`, not a CHECK-forced rebuild).
2. Seed §4's eight rows.
3. `src/engines/breeds/abilityRange.ts` — `parseAbilityRanges`, `windowFor`, `ratchetEligibleTraits`.
   Everything imports it; nothing restates it.
4. Ten new loci in `loci.ts`, on the existing type-gene ladder.
5. `src/engines/ability/gene.ts` — the ability counterpart of `typeGene.ts`: `dealAbilityForBand`,
   `applyAbilitySpecialistUpgrade`, `applyAbilityBaselineRatchet`, `applyAbilityCareRatchet`.
6. `config.values.quality_bands[band].ability_specs` (§2.4) + `ability_modifier_step` +
   `ability_ratchet_rungs`; zero `ability_bias`; `ability_noise_sd` 6 → 1.
7. `abilityValues` (`src/engines/conformation/model.ts`) reads the new path. **Split it from
   `geneticValue` rather than branching inside it**, exactly as slice 0028 split
   `conformationGeneticValue` off — `geneticValue`'s `potential × 5 + noise` then has no callers left
   and should go.
8. Wire the four generation call sites: `generateCandidate` (founding, consignment, NPC mint),
   foal birth, `/admin/horses` create, and `mintFoundingHorses`' show-barn path.
9. `/admin/breeds` gains an editor for `ability_ranges` and the horse page's Ability card gains the
   §9.2 range line.
10. Re-measure `docs/analysis/breeding-lab.mjs` (§6).

Note that `abilityValues` still calls `realization()` — ability keeps the age curve, unlike
conformation (slice 0028 §2.4). Do not remove it here.

---

## 6. Measured — `docs/analysis/ability-lab.mjs`

Benched 2026-08-08, before building anything. `docs/analysis/breeding-lab.mjs` is conformation-only
and models no ratchet, so this slice got its own tool rather than surgery on that one: same standing
rules (own PRNG, own constants copy, reads nothing from the database), no state file, both engines
side by side. `node docs/analysis/ability-lab.mjs all` reproduces everything below at seed 20260808.

**These numbers are the reason the design in §2 is what it is. Re-run the lab before retuning §2.4 or
§4 — do not reason about them from first principles.**

### 6.1 Breed separation (`separation`, 2,000 founders per breed, band=mid)

Median / top-20% mean on the contested trait:

| trait | breed | today | proposed |
|---|---|---|---|
| Stamina | Arabian | 61.0 / 79.5 | **73.0 / 87.2** |
| | Quarter Horse | 49.0 / 78.0 | **36.0 / 50.9** |
| Jump scope | German Warmblood | 57.0 / 73.8 | 73.0 / 87.3 |
| | Quarter Horse | 43.0 / 61.6 | 32.0 / 46.8 |

Today the gap in *best-of-batch* stamina between Arabian and Quarter Horse is **+5 points** — the
operator's report was very nearly literally true. Proposed, it is **+37**, and the two distributions
do not overlap at all: the worst Arabian in 2,000 still beats the best Quarter Horse.

Four of the five tested pairs separate completely. The fifth — Quarter Horse vs Arabian **speed** —
still overlaps, because the Arabian speed window (30–70) genuinely overlaps the Quarter Horse's
(54–94). That is correct and should stay: an Arabian is a fast horse, just not a sprinter.

### 6.2 What a band looks like (`bands`, 3,000 per band, best trait)

Quarter Horse, median of the horse's best ability trait:

| band | today | proposed |
|---|---|---|
| low | 73 | 69 |
| mid | 74 | 80 |
| high | **76** | **85.5** |

Today's three-point low→high spread (§1.4) becomes **16.5 points**, and the spread *within* a band
tightens (SD 10.8 → 6.7 at low band). The champion field is now meaningfully a champion field.

### 6.3 Foals vs midparent (`foals`, 8,000 pairings, all eight breeds)

| engine | ≥ midparent | mean gain | SD | 5 in a row worse |
|---|---|---|---|---|
| today | 50.8% | −0.2 | **12.9** | 2.88% |
| proposed, no care | 62.0% | +0.7 | **3.0** | 0.79% |
| proposed, with care | **78.0%** | +2.1 | 2.9 | **0.05%** |

The SD collapse from 12.9 to 3.0 is the headline, not the percentage: today a foal swings ±26 points
around its parents for reasons no player can see or influence. Five consecutive foals below midparent
goes from **1 in 35 pairings to 1 in 2,000** with mare care.

The +0.7 vs +2.1 mean gain is exactly the operator's baseline/care split working as specified: the
free ratchet hits one of three eligible traits at random, so any one trait improves a third as often
as it does under care (0.67 ≈ 2 × ⅓).

### 6.4 A breeding programme (`programme`, 300 runs, best-of-4 foals, low-band founding pair)

Share of lines whose best horse meets the champion bar, by generation:

| gen | today | proposed, no care | proposed, with care |
|---|---|---|---|
| 0 | 22% | 0.3% | 0.3% |
| 2 | 46% | 5% | 8.5% |
| 4 | **72%** | 13% | 33.5% |
| 6 | 88% | 27% | 61% |
| 8 | **97%** (median pinned at the 99 clamp) | 44% | 73% |

Today's column is §1.4's runaway. The proposed columns are a real climb that does not finish: a
careful line crosses the champion bar around **generation 5** and is comfortably past it by 8, and it
**cannot** run away — generation 8's maximum is 94, the Quarter Horse speed ceiling, exactly.

### 6.5 The bound holds

`sweep` across all eight breeds × five traits × three bands, 1,200 horses each — **144,000 horses, no
horse expressed outside its breed's window in either direction.** Under today's engine the same sweep
puts a *low-band* Quarter Horse's stamina anywhere in 3–93.

### 6.6 Still owed

Teaching `breeding-lab.mjs` the *conformation* ratchet remains outstanding (CLAUDE.md's slice-0028
row). This slice does not close that; it sidesteps it by measuring ability in its own tool.

---

## 7. Tests

1. Every seeded `ability_ranges` value sits on the rung ladder, and `floor < ceiling`, for all eight
   breeds and all five traits. Read the migration off disk, do not re-type the numbers (the
   `test/showing/breed-aptitude.test.ts` pattern).
2. `ratchetEligibleTraits` returns exactly three traits, deterministically, for every breed — the same
   three on repeated calls and for two different horses of one breed.
3. No generated horse of any breed, at any band, over 10,000 draws, expresses outside its own window.
4. A foal bred from two parents at their ceiling never exceeds the ceiling; a foal bred from two
   parents at the floor never falls below it.
5. The ratchet never overshoots: a foal whose eligible traits are already all at ceiling is unchanged,
   and no allele is ever moved past the ceiling.
6. **The band guarantee.** Over 1,000 draws per band, a `high`-band horse's mean expressed value on
   its best trait exceeds a `low`-band horse's by at least 10 points, for every breed.
7. A cross-bred horse registered as breed X is clamped to X's window, even when one parent's breed has
   a higher ceiling for that trait.
8. A breed with a null `ability_ranges` still generates (no window, no clamp, no ratchet) — the "still
   generates, not judged" fallback slice 0028 §7 test 11 establishes.
9. Mare care ratchets three distinct traits; the baseline ratchets exactly one, and the same foal seed
   picks the same one every time.
10. The specialist upgrade lands inside the window: an Arabian speed specialist never exceeds 70.

---

## 8. The world reset

This slice needs one, for the same reason slice 0028 does: no living horse has an ability-locus
genotype, so nothing here reaches a real family horse until every horse is regenerated.

**Slice 0028's reset has not run yet.** Build this slice *before* that reset fires and both changes
ride one reset; build it after and the operator spends a second one on the children's stock inside a
fortnight. **That is the single scheduling decision in this document and it is worth more than
anything else in it.** The previous reset (slice 0021 Part G) was run by the operator on 2026-08-06
and the household has been playing on that stock since.

It must not run without asking the operator, same as §8 of slice 0028.

---

## 9. Open questions

**9.1 — Is the ability word banded absolutely, or against the breed's window?**

`horse_ability_words` (migration `0162`) bands a horse's expressed value against fixed absolute edges
(88 / 72 / 56 / 40) via `abilityLabelFor` → `bandForTraitScore`. Under this slice a Quarter Horse can
never reach Outstanding stamina — its ceiling is 58, which is *Acceptable* — so its owner sees a
mediocre word forever no matter how well the horse is bred.

Absolute is honest and it matches how the horse is actually scored in a class, so it should stay.
But the reading a child takes from it is wrong, which §9.2 fixes rather than the banding.

**9.2 — Recommended, not yet decided: name the breed's range on the Ability card.**

One muted line under each trait — `Stamina: Acceptable (Quarter Horses range 22–58)` — turns a
demoralising word into a legible one, costs one render change, and tells a child what their horse is
*for*. It leaks no truth the ability test has not already been paid for, since the range is a fact
about the breed and not about the horse. **Recommend building it; the operator has not confirmed.**

**9.3 — `ability_ratchet_rungs` — RESOLVED at 2 by measurement (§6.4).**

At 3, a careful line crosses the champion bar by generation 4 and is pinned against its breed ceiling
by generation 8 (87% of lines at the bar, median 94 of a possible 94) — the improvement runs out and
breeding stops having anything left to do. At 2, the same line crosses around generation 5 and is at
73% by generation 8 with room still above it. Keep 2. It stays a live tunable, so a retune costs an
`/admin/config` edit and not a deploy.

**9.4 — Does the round-robin specialist still make sense at all?**

§2.6 keeps it because slice 0019's brief (a breed winnable in 6–8 months) still stands and nothing has
replaced it. But once the specialist is an in-window upgrade rather than an absolute overwrite, it is
much closer to just being a good deal — and the band specs in §2.4 already guarantee every horse a
`[0,0,0,0]` trait at the high band. It may be redundant. Leave it in, measure, and revisit.
