# Breed ability bias and discipline aptitude

*Written 2026-08-04, in response to an operator report: German Warmbloods were beating Quarter
Horses in barrel racing.*

This document is the reasoning behind `breeds.ability_bias` (migrations `0141`/`0142`) and
`breeds.discipline_aptitudes` (migrations `0143`/`0144`). The numbers themselves live in those
migrations; if you change one, change it there in a **new** migration (`CLAUDE.md` §8) and update §3
here so the two do not drift.

---

## 1. What was actually wrong

Nothing. There was no bug — breed had simply never entered ability at any point, and nobody had
noticed because for the first two days only one discipline existed and only one breed had an ideal
vector.

The full path, as it stood before this change:

1. `horses.genotype.polygenic.speed` — ten loci, two alleles each. `potential()` counts the `'1'`s,
   giving 0–20.
2. `geneticValue = potential × 5 + birth_noise`, clamped 1–99.
3. `expressed = anchor + (geneticValue − anchor) × realization`, and `anchorFor()` returns **0** for
   every ability trait, so this reduces to `geneticValue × realization`.
4. `scoreAbilityEntry` — a weighted mean over the five ability traits, then the modifier line.

`breed_id` appears at no point in that chain. The three places breed *does* live were all somewhere
else:

- **`founding_allele_pool`** is Mendelian only — colour, gait, disease. Migration `0010`'s own
  comment says so. It never touched a polygenic trait.
- **`ideal_vector`** covers the five conformation traits and nothing else.
- **Discipline `show_classes`** carry `breed_id = NULL` — migration `0064`'s `CHECK` forbids setting
  it — and every discipline is seeded `crosses_eligible = 1`. Slice 0012 §3.2 chose this
  deliberately: *"Discipline classes are open to everyone."*

So a German Warmblood's speed alleles were drawn from the identical distribution as a Quarter
Horse's, and whichever horse happened to roll a **founding specialist** (slice 0019 Part B) in
`speed` or `agility` won the barrel class. That specialist is picked uniformly from
`getSpecializableAbilityTraits()`, which returns all five ability traits now that all six
disciplines are enabled — so every founding and consignment horse of every breed had a flat 2-in-5
chance of being bred for barrels by accident.

**This was not a defect in slice 0012 or 0019.** Both named the gap and left it open on purpose,
because the aptitudes had not been decided. They have now.

---

## 2. Two mechanisms, not one

The operator chose to build both. They answer different questions and neither substitutes for the
other.

| | `ability_bias` | `discipline_aptitudes` |
|---|---|---|
| **Question it answers** | What is this breed *born* leaning towards? | What is this breed *suited to* today? |
| **Where it applies** | `generateCandidate`, at the polygenic draw | `scoreAbilityEntry`, at the modifier line |
| **Who it reaches** | Only horses generated after it landed | Every horse, immediately |
| **Heritable?** | Yes — it moves real alleles, which then segregate normally | No — it is a fact about the breed, not the horse |
| **Breeds true?** | Yes. Selecting within a breed responds to it | No. An elite horse gets the same multiplier as a poor one |

The bias alone would have taken game-months to become visible and would erode under selection. The
aptitude alone would have been a thumb on the scale that no amount of good breeding could answer.
Together, the bias makes a breed's stock genuinely different and the aptitude says what that stock
is *for*.

**Foals inherit the bias for free** and needed no code change: `inheritPolygenic` draws each locus
50/50 from the parents, so a Quarter Horse line founded on speed-leaning stock stays speed-leaning
without anything re-reading `breeds.ability_bias` after birth.

---

## 3. The numbers, and why these ones

### 3.1 `ability_bias` — offsets to the draw chance

An offset is added to the quality band's `polygenic_one_chance` for that trait only. Expected
potential is `20 × chance` and `geneticValue = potential × 5`, so:

> **An offset of 0.06 is worth 1.2 potential = 6 geneticValue points**, on the same 1–99 scale a
> horse is measured on.

Every row sums to zero, and `test/genetics/breed-ability-bias.test.ts` reads migration `0142` and
asserts it. This is the load-bearing constraint: a row that does not sum to zero does not make a
breed *different*, it makes that breed *better*, and eight breeds each quietly better than the last
is how a game stops having eight breeds.

| Breed | speed | stamina | jump_scope | trainability | agility |
|---|---|---|---|---|---|
| Quarter Horse | **+0.06** | −0.06 | −0.06 | 0.00 | **+0.06** |
| Arabian | −0.02 | **+0.06** | −0.06 | +0.02 | 0.00 |
| Thoroughbred | **+0.06** | +0.04 | +0.02 | −0.06 | −0.06 |
| German Warmblood | −0.06 | −0.06 | **+0.06** | **+0.05** | +0.01 |
| Friesian | −0.06 | −0.02 | 0.00 | **+0.06** | +0.02 |
| Paso Fino | 0.00 | −0.04 | −0.06 | +0.04 | **+0.06** |
| Icelandic | −0.06 | **+0.06** | −0.06 | +0.02 | +0.04 |
| Nokota | 0.00 | +0.04 | −0.04 | −0.02 | +0.02 |

The Nokota row is deliberately the flattest — an unselected landrace should not have sharp
specialisation, the same call `docs/breed-disease-panels.md` made when it gave the Nokota no disease
panel.

### 3.2 `discipline_aptitudes` — multipliers on the final score

Maximum deviation from neutral is **0.05**. Rows are *not* zero-sum (a breed may genuinely be good
at two things, and a horse only ever enters one class at a time so there is nothing to spend); what
is checked instead is that every row's **mean sits within 0.02 of 1.00**, so no breed is quietly
advantaged everywhere. Today's spread is 0.987 to 1.000.

| Breed | Barrels | Racing | Jumping | Endurance | Dressage | Gaited |
|---|---|---|---|---|---|---|
| Quarter Horse | **1.05** | 1.02 | 0.97 | 0.95 | 0.98 | 1.00 |
| Arabian | 0.98 | 1.00 | 0.97 | **1.05** | 1.00 | 1.00 |
| Thoroughbred | 0.98 | **1.05** | 1.02 | 1.00 | 0.97 | 0.98 |
| German Warmblood | **0.95** | 0.97 | **1.05** | 0.97 | **1.04** | 0.98 |
| Friesian | 0.95 | 0.96 | 0.98 | 0.98 | **1.05** | 1.00 |
| Paso Fino | 1.00 | 0.97 | 0.95 | 1.00 | 1.00 | **1.05** |
| Icelandic | 0.98 | 0.95 | 0.95 | 1.02 | 0.98 | **1.04** |
| Nokota | 1.00 | 0.98 | 0.98 | 1.02 | 0.98 | 1.00 |

The Friesian has the lowest row mean in the set, on purpose. It is overview §4a's hard-mode breed
and its reward is the conformation ring, where migration `0107` gave it the heaviest single trait
weight in the game.

---

## 4. Why ±0.05 and not more

This is the only genuinely contested number here, so the arithmetic is written out.

Take a mid-band, mature, unspecialised horse: every ability expresses at about **50**, and Barrel
Racing weights them `speed 1.4 / agility 1.5 / trainability 0.8 / stamina 0.2 / jump_scope 0`
(sum 3.9). Baseline `rawScore` ≈ 50.

**Quarter Horse.** Speed and agility both rise to geneticValue 56; stamina falls to 44.

```
(1.4×56 + 0.2×44 + 0.8×50 + 1.5×56) / 3.9 = 54.2     then ×1.05 → 56.9
```

**German Warmblood.** Speed falls to 44, trainability rises to 55, agility ≈51.

```
(1.4×44 + 0.2×50 + 0.8×55 + 1.5×51) / 3.9 = 49.3     then ×0.95 → 46.8
```

A gap of **10.1 points**. Barrel Racing's `noise_sd` is 3.0, so that is about **3.4σ** — an equally
bred Quarter Horse beats an equally bred Warmblood essentially every time. That is the fix.

**Now the constraint in the other direction.** A founding specialist sets its trait's potential to
15 outright, so the specialist trait lands at geneticValue 75 — and, importantly, **the breed bias
does not apply to it**, because the specialist *overwrites* the draw rather than adjusting it. A
Warmblood singled out for speed gets the full 75, not 75 minus a breed penalty.

```
Warmblood with a speed specialist:
  (1.4×75 + 0.2×50 + 0.8×55 + 1.5×51) / 3.9 = 60.4   then ×0.95 → 57.4
Quarter Horse with no specialist:                                 56.9
```

**57.4 > 56.9.** An exceptional off-breed horse can still take the class from an ordinary on-breed
one, by a margin small enough that noise decides it. That is the property ±0.05 was chosen for, and
`test/showing/breed-aptitude.test.ts` asserts both halves of it — the specialist wins, the ordinary
Warmblood does not.

Push the aptitude past about ±0.06 and that stops being true: breed becomes a gate rather than a
strong tendency, and a child whose best horse is the wrong breed can never win no matter how well
they breed. Pull it below about ±0.03 and the original complaint comes back.

---

## 5. What this deliberately does not do

- **No `eligible_class_types`.** Every discipline still admits every breed. An aptitude says a
  Warmblood is *bad* at barrels, not that it is *barred* from them — a child can still enter one and
  watch it place fifth, which teaches more than a greyed-out button.
- **No conformation counterpart.** `scoreEntry` gets no aptitude parameter. A conformation class
  already admits one breed and judges it against that breed's own `ideal_vector`, so every entry
  would receive the identical multiplier and nothing would change but the number on the page.
- **Crossbreds read neutral**, always. `horses.breed_id` on a cross names the registry it competes
  under — a Paint's `breed_id` *is* the Quarter Horse's (overview §4a), which `checkEligibility`
  relies on — so honouring it here would hand a half-Warmblood cross the full Quarter Horse barrel
  bonus. A cross has no single breed to be suited to.
- **NPC valuation is untouched.** `engines/npc/selection.ts` and `db/npcMarket.ts` score with
  `noise: 0` and no care, age or tack modifier; aptitude joins that list rather than breaking into
  it. An NPC stable is single-breed, so an aptitude would multiply every candidate it ranks by the
  same number and change no decision it makes. This is not a second scoring path (`CLAUDE.md` §13) —
  it is the same function, called with the show-time modifiers a valuation has never used.
- **Horses created by hand at `/admin/horses` get neither**, and get no founding specialist either.
  That form uses `generateFounderPolygenic`'s flat 50/50 draw, which slice 0005 §6.6 chose so a
  hand-built test horse is a neutral control. Left alone on purpose; say so if that turns out to be
  the wrong call.

---

## 6. If it still feels wrong after a few game weeks

In rough order of how likely each is to be the problem:

1. **Aptitude too weak / too strong** — `breeds.discipline_aptitudes`, a new migration. This is the
   fast lever and it affects every existing horse immediately.
2. **The specialist is still doing too much of the work** — `founding_ability_specialist_potential`
   is a live config key at `/admin/config` (default 15). Dropping it to 13 halves the specialist's
   advantage without touching breed at all.
3. **A breed is leaning the wrong way** — `breeds.ability_bias`, a new migration. Slowest to take
   effect, since only horses born afterwards carry it.
4. **The whole ability spread is too narrow to tell breeds apart** — that is `quality_bands` and
   `conformation_noise_sd`, and it is a bigger conversation than this document.

Watch it at `/admin/npc` (are NPC stables still competitive?) and on the show result pages, where a
discipline entry's `score_breakdown` now carries an `aptitude` block recording the exact multiplier
the horse was judged with — necessary because the aptitude is a live tunable and is **not**
snapshotted onto the class.
