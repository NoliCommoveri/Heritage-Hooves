# Why foals come out worse than their parents, and what to do about it

Operator-reported, 2026-08-07:

> *"how do we make it more consistent that babies of founders do NOT come out worse than their
> parents every time?"*
>
> *"we may have to implement something that allows you to coax the genes to do right — incrementally
> of course"*
>
> *"we moved off an averaging system. we are doing a random pull of one of the two traits. the number
> visible to the child has to reflect a real value. and show noise, birth noise, all the modifiers,
> are negotiable"*

Every number here is output from `docs/analysis/breeding-lab.mjs`, which gained `--coax` and two new
`--expression` rules for this document. Re-run it after any change.

**Scope.** Conformation only.

---

## 0. Decided, 2026-08-07

**This document is no longer a proposal.** Every question it opened was answered by the operator on
the day it was written. Per CLAUDE.md §2, treat the following as standing — if any of it looks
wrong, say so, but do not quietly build something else.

| | decision |
|---|---|
| **Expression rule** | **`worst` — faults dominant, quality recessive.** Reverses the random pull decided earlier in conversation. §2. |
| **"Faults dominant" as a story** | Accepted. §7.2. |
| **Inbreeding depression** | **Comes off conformation expression**, per slice 0018. §1.2. |
| **Prenatal care** | Built. Costs **money and one turn**, charged on the covering. §3. |
| **Its price** | **`prenatal_care_cost` = 500** to start, a live tunable the operator sets at `/admin/config`. §3.4. |
| **Which trait it moves** | **The mechanic takes the worst one; the player never chooses.** Worst *trait* of the foal the pairing produced, not worst *allele*. §3.1. |
| **Can it fail?** | **No.** The cost is the price, not a die roll. §3.5. |
| **`conformation_modifier_step`** | 0.75 → **0.10**. §4. |
| **`conformation_noise_sd`** | 6 → **0.5**. §4. |
| **Founding band** | back to **`low`**. §6.4. |

`docs/analysis/breeding-lab.mjs` now **defaults to these settings**, so a bare `dynasty` run measures
the decided design rather than the superseded one. The older documents in `docs/fixes/` were measured
before the decision and their commands need `--expression average` to reproduce their own numbers.

**A note for the next session, because it cost an earlier one a wasted pass.** Every measurement in
`conformation-breed-type.md` and `conformation-founding-quality.md` predates the expression decision
and is therefore taken under the *averaging* rule. This document is the first measured under `worst`,
and §2 is the reason that distinction turns out to matter enormously. Do not carry a number across
from those documents without checking which rule produced it.

---

## 1. The defect, decomposed

Foals come out **-3.3 to -4.0 points worse than their parents, every generation, forever**. That is
the `gain` column of `dynasty`, and it never turns positive at any generation under any expression
rule as originally specified. Measured by switching each contributor off in turn (Arabian, band
`low`, 8 mares, 4 stallions, lifetime cap of 4 foals, 200 runs, generation 8):

| | averaging | random pull |
|---|---|---|
| as specified | -3.3 | **-4.0** |
| birth noise off | -3.2 | — |
| inbreeding depression off | -2.6 | -2.8 |
| selecting on tested genes, not looks | -2.3 | -2.5 |
| **tested genes and no inbreeding depression** | **-0.5** | **-0.8** |

Two things sit on top of the genetics and account for most of it.

### 1.1 The child is selecting on a number that isn't the horse

Under **averaging**, a horse carrying `10 and 10` and a horse carrying `2 and 18` both display
exactly 10 and both read Outstanding. The first passes a 10 to every foal; the second never passes a
10 at all. They are indistinguishable.

Under the **random pull** the number displayed is at least a *real allele* — which is what the
operator asked for — but it is a coin flip which one you see. A horse showing 10 might be `10/10` or
`10/34`, and the child has no way to tell. Selection on looks therefore regresses *harder* under the
random pull than under averaging (-4.0 vs -3.3), because the parents were picked for showing their
good allele and their foals go back to flipping the coin.

**So the random pull fixes honesty and makes selection worse.** Both problems have the same root:
what the child can see does not determine what the horse passes on. §2 is the rule that closes it.

### 1.2 Inbreeding depression punishes the child who plays best

Coaxing at 2 steps, tested selection, averaging rule:

| gen | traits FIXED at standard | traits reading Outstanding | score |
|---|---|---|---|
| 3 | 4.06 | 3.76 | 91.9 |
| 7 | **5.00 — genetically perfect** | 3.27 | 90.5 |
| 8 | **5.00** | **3.14** | **90.2** |

**A herd that has achieved a genetically perfect Arabian looks worse than it did at generation 3.**
COI multiplies `realization()`, which pulls expression toward 50, and the further a breed's standard
sits from 50 the more it costs. Nothing on screen would ever explain this.

It has a second consequence under the new rules that is arguably worse: **COI is what breaks the
"the number is a real value" guarantee.** With depression live, a horse's displayed value is its
allele pulled some distance toward 50, so it is no longer any allele the horse actually owns.
Measured — the same run with depression on vs off, the on-target and FIXED columns stop agreeing
(3.46 vs 3.50) purely because of it.

`docs/slices/0018-genetic-progress-and-inbreeding.md` already proposes moving inbreeding depression
off conformation expression and onto fitness. This is the third independent argument for it, and the
first that says the new expression rule does not work at all without it. **The operator agreed on
2026-08-07: it moves.** Nothing else in this document stands if it does not.

---

## 2. The finding: a third expression rule does what neither of the first two can

The operator's constraint — *the number visible to the child has to reflect a real value* — rules out
averaging and admits the random pull. It also admits two rules nobody had considered, and one of them
is dramatically better. Both are in the bench as `--expression worst` and `--expression best`.

**`worst` — the horse shows whichever of its two alleles is FURTHER from its own breed standard.**
Faults dominant, quality recessive. The number is a real allele, exactly as under the random pull,
**and it is deterministic**. The consequence is the whole finding:

> **A trait reading Outstanding is homozygous at the standard. Always. There is no fake.**

Because a horse only looks correct when it has nothing worse to show. It follows that what the child
sees and what a breeding programme accumulates are *the same number*. In the bench's output the
`on target` and `FIXED` columns become identical, row for row, generation after generation.

**Decided 2026-08-07: this is the rule.** It reverses the random pull taken earlier in conversation.

### 2.1 What that buys

A child selecting purely on looks — no test, no genotype knowledge, no coaxing — Arabian, band `mid`,
inbreeding depression off conformation:

| gen | on target (**= FIXED**) | gain |
|---|---|---|
| founding | 1.95 | — |
| 3 | 2.80 | -0.4 |
| 5 | 3.39 | -0.2 |
| 8 | **4.08** | **-0.3** |

Compare against the averaging rule under the same selection, from
`conformation-founding-quality.md` §3: **FIXED moved 1.33 → 1.41 in eight generations, and no run
ever produced a finished horse.** That plateau is the single worst result in this whole line of work,
and it was thought to be structural. It is not. **It is an artifact of averaging, and the `worst`
rule removes it entirely** — the same child, doing the same thing, now nearly triples the number.

The gain of -0.2 to -0.4 against a `show_noise_sd` of 5 is a twentieth of the luck in one class. The
"babies are worse than their parents" complaint is gone as a felt thing.

**This table is band `mid`, and the decided founding band is `low` (§6.4).** At `low` the same child
reaches only **2.90 of 5 by generation 8** (§3.2). The expression rule removes the plateau; it does
not on its own carry a line to a finished horse from the plainer founding stock the band change
gives it. That is what prenatal care is for, and it is why §3 is not decoration.

### 2.2 Two Outstanding parents, measured

The headline test from `conformation-breed-type.md` §5.2 — two unrelated horses both reading
Outstanding on all five traits, bred together:

All three rules measured on the same bench, same seed, same tightened modifier and noise (§4), so
these are like-for-like:

| | foal matches both parents on all five | mean traits on target | within-pairing SD |
|---|---|---|---|
| averaging | 25.1% | 3.88 of 5 | 4.0 pts |
| random pull | 18.0% | 3.58 of 5 | 4.7 pts |
| **faults dominant** | **100.0%** | **5.00 of 5** | **0.6 pts** |

Both parents are homozygous at the standard *by definition of looking that way*, so every foal is
too. **The question in the title has a total answer for the case that matters most to a child: two
great horses cannot produce a worse foal.**

> **A correction worth recording.** `conformation-breed-type.md` §5.2 puts the averaging rule's
> figure at **44.9%**, measured in `conformation-architecture.mjs`. The bench says **25.1%** for what
> reads like the same experiment. The two are not measuring the same thing: the architecture script
> pairs parents that are *genetically* on target, while the bench pairs parents that a child would
> pick because they *read* Outstanding — fakes included, which under averaging is a large share of
> them. The bench's number is the one a player experiences and it is the one to trust here. §5.2 is
> not wrong, but it answers a question nobody in the game can ask.

### 2.3 The mirror rule, for completeness

**`best` — the horse shows its better allele.** Quality dominant, the same shape as the game's
existing disease carriers. Founding horses look wonderful (2.95 of 5 on target at band `low`,
score 92.4) and hide everything: FIXED crawls 1.35 → 2.59 over eight generations and the gain sits
at -1.6 throughout. It is the hidden-carrier game, it needs testing to play at all, and the score is
already at 97.7 by generation 8 with no headroom left. **Rejected.**

---

## 3. Mare prenatal care

The operator's own framing, 2026-08-07:

> *"running it doesn't change the mare's genes; it means that the baby foal's worst gene is moved
> towards standard"*

It attaches to the **pregnancy**, which is what makes it fit the game rather than sit beside it:

- `pregnancies` already exists, already carries its own `rng_seed` and its own snapshotted gestation
  length (CLAUDE.md §5.5), and is already what the tick walks. One more snapshotted column on that
  row is the whole storage cost.
- The decision is committed **before the foal exists**, so it can never be an undo on a bad roll.
  The player pays blind. That is a real decision rather than a correction.
- It is **capped at one per foal by construction** — no lifetime counter, no way to stack.
- **The mare's genotype is untouched.** Nothing is inherited that she did not already carry; one
  trait in one foal moved once, at the moment that foal was formed.

The genetic rule: the allele moves **one rung toward the foal's own breed standard**, never away and
never past it. Breed type therefore strictly improves and cannot erode — the objection that sank
random drift (`conformation-founding-quality.md` §5) — and an NPC stable that never buys it never
moves. It is directed and visible, so the breeding preview's Punnett square stays exact.

### 3.1 It moves the worst TRAIT, not the worst ALLELE

Demonstrated on a real covering in the bench (two 4-of-5 Arabians, both stuck at neck 58/82 against
a standard of 74), four foals, the same purchase:

| | what the foal inherited | what care did | what the child sees |
|---|---|---|---|
| foal A | `58 + 82` | moved the 58 to 66 | neck 58 → **67**, score 91.9 → **96.6** |
| foal B | `58 + 58` | moved one copy to 66 | **nothing. Still shows 58.** |

Under the `worst` expression rule a horse displays its *worse* allele, so improving one copy of a
homozygous pair leaves the other copy showing. **Roughly half of all purchases are invisible, at
random, with nothing on screen to explain why.** That is precisely the "did I just get unlucky"
feeling this whole redesign exists to remove, and it would be discovered by a child rather than by a
test.

So the mechanic moves **the worst *trait* one rung**, not the worst *allele* — whatever that costs in
alleles. One step on a heterozygote, two on a homozygote. Read that way the operator's sentence is
exactly right and is **always visible**. In the bench this is `--coax-mode shown` (now the default),
and re-running the identical covering moves all four foals (neck 58/59 → 65, 66, 67, 67).

The extra cost on a homozygote is not a flaw. It means the mechanic does twice as much genetic work
in exactly the case where a line is most stuck — which is §3.3.

**Decided 2026-08-07: the mechanic takes the worst trait; the player never picks.** The trait is
whichever one the *foal* — the horse the mare-and-stallion pairing actually produced — shows furthest
from its own breed standard, resolved at foaling, after the alleles are drawn. That is the operator's
own wording, it is much the simpler thing to explain to a nine-year-old, and it is what every number
in this document is measured on. Letting the player choose is strictly more powerful and would want
re-measuring before it is ever offered.

### 3.2 What it buys

Arabian, band `low` (the decided founding band, §6.4), faults dominant, selection on looks only,
care bought on every covering. Traits on target, which under this rule is identically traits
permanently fixed; `gain` in parentheses is what the mating bought over its own two parents.

| gen | no care | care, worst allele | **care, worst trait (decided)** |
|---|---|---|---|
| founding | 1.35 | 1.35 | 1.35 |
| 3 | 1.61 (-0.8) | 2.64 (+1.8) | **2.95 (+2.2)** |
| **5** | 2.18 (-0.3) | 3.96 (+1.5) | **4.42 (+1.7)** |
| 8 | **2.90** (-0.4) | 4.90 (+0.2) | **5.00** (-0.2) |

**Without care the gain is negative in every generation; with it the gain is positive in every
generation until the herd runs out of room.** Worst-trait finishes the type-gene game outright —
5.00 of 5 by generation 8, best foal scoring 99.9 — and its lone negative figure is that ceiling,
not regression: at generation 7 the herd is already at 4.96, so generation 8 has nothing left to buy.
Worst-allele is about one generation slower and never quite finishes (4.90). The worst-allele column
is retained only as the evidence for §3.1's decision — it is not a mode the game offers.

> **A correction, 2026-08-07.** The first draft of this table reported the no-care column as
> 2.63 / 3.39 / 4.08, which are band **`mid`** figures (they are §2.1's) pasted into a band-`low`
> table. Re-measured, an uncared-for band-`low` line reaches **2.90 of 5, not 4.08**. The error ran
> in the conservative direction: prenatal care buys considerably more than the draft claimed —
> 2.90 → 5.00 rather than 4.08 → 5.00 — and without it a child at the decided founding band does
> **not** get near a finished horse in eight generations. That is the argument for the mechanic
> existing at all, and it was being understated.

Note that the sim buys care on **every** covering. In real play cost and turns mean a child will not,
so the true curve sits between the "no care" and "care" columns — **the price is the pacing dial**
(§3.4), which is a much better place for pacing to live than the genetics.

### 3.3 It is the escape hatch for an allele nobody owns

This is the finding that makes it more than a grind, and it came out of playing the bench by hand
rather than from a sweep.

After three generations the demo herd's best horse was 4 of 5 — shoulder, back, hock and head all
homozygous at standard — and **stuck at neck `58/82`, where the standard is 74. Neither allele is
correct, and after three generations no horse in the line owned a 74.** Mendelian inheritance
shuffles alleles; it never invents one. That line plateaus at 4 of 5 forever.

Two coverings with prenatal care, and it does not:

| | neck | score | traits on target |
|---|---|---|---|
| generation 4, care | 65–67 | 95.2–96.3 | 4 of 5 |
| generation 5, care | **73–75** | **98.4–99.6** | **5 of 5** |

The line walked 58 → 66 → 74 and finished. **Prenatal care is the only mechanism in the design that
introduces a correct allele into a closed herd**, and it does it a rung at a time, visibly, by
decision. The consignment dealer is the other route and costs money the child may not have; this one
is reachable from the barn they already own.

### 3.4 What it costs

**Money and one turn, both charged on the covering**, at the moment the player commits — not at
foaling. Decided 2026-08-07.

- **`prenatal_care_cost`, default 500.** A live tunable (CLAUDE.md §5.5) read from config at purchase
  time, set by the operator at `/admin/config`. It is not snapshotted onto the pregnancy, because it
  is charged once at booking and never re-read.
- **One turn**, a new `ACTION_COSTS` entry alongside the covering's own.
- The ledger kind is new; the money leaves the stable at booking and there is **no refund path** —
  a covering that fails to conceive does not return it, exactly as a stud fee does not (slice 0017
  §13, the operator's standing call on live-foal guarantees).

**500 is a first guess and is the first number to revisit in real play.** §3.2 is why: it decides
whether a child buys care on one mare a year or on all seven, and therefore where between 4.08 and
5.00 of 5 a line lands by generation 8. Pacing lives here deliberately, so that it can be moved
without touching the genetics.

### 3.5 It cannot fail

Decided 2026-08-07: **there is no die roll.** The cost is the price. A purchase always moves the
foal's worst trait one rung, always visibly.

This is not a softness. Reintroducing "did I just get unlucky" is exactly what this redesign exists
to remove, and §3.1 shows how easy the *silent* version of that failure is to build by accident. If
the mechanic ever needs to be slower, the price moves (§3.4) — a lever the player can see and plan
around — not the odds.

---

## 4. The numbers

The operator offered noise and the modifiers. Taking them up on it is what makes the displayed number
exactly an allele rather than approximately one. Measured with `bands`, under a whole-rung rule:

| modifier range | noise SD | word matches the genes | Outstanding really is homozygous-at-standard |
|---|---|---|---|
| ±7.5 (fix doc as written) | 2 | 88% | 86% |
| ±2.5 | 1 | 100% | 100% |
| **±1.0** | **0.5** | **100%** | **100%** |

The second column is the one a child's breeding decisions actually rest on: it is §2's "there is no
fake" guarantee, measured. At the settings as originally written it fails one time in seven.

**Decided 2026-08-07: `conformation_modifier_step` 0.75 → 0.10 (a range of ±1.0), and
`conformation_noise_sd` 6 → 0.5.** At those settings a mature, outbred horse's displayed number sits
within about a point of a real allele it owns, and the word beneath it is never wrong — which is the
guarantee that matters, since the word is what a child reads. The twenty-allele block survives as a
tie-breaker between two horses with identical type genes — which is all §4.3 of
`conformation-breed-type.md` ever wanted it for — rather than as something that can move a horse a
full rung and lie about its genotype.

`show_noise_sd` (5) is deliberately **not** touched. Uncertainty belongs in the show ring, where it
is a judge's opinion on the day and everyone can see it is luck. It does not belong in the horse.

---

## 5. What a twelve-year-old does

1. **Look at the horse.** *"Willow's head reads 18. The Arabian standard is 10. She has at least one
   18 in her — that's the one holding her back."* No purchase, no menu, no maths.
2. **Find a stallion whose head reads 10.** He shows his worse allele, so he is `10/10` — certain.
   Every foal gets a 10 from him.
3. **The foal reads 18 or 10.** If 18 she is `10/18` and still carries the good one. If 10 she is
   `10/10` and **finished on that trait, permanently.**
4. **Or, if no such stallion exists** — which is §3.3, and eventually it is every line's problem —
   **buy prenatal care when booking the covering.** It costs money and a turn, it is bought before
   the foal exists, and whatever that foal's weakest trait turns out to be comes back one rung
   better. Two or three foals of that and the line owns an allele nobody in it owned before.
5. That trait never comes back. **The count of finished traits is the score, it is visible for free,
   and it cannot fall.**

The test still has a job — it tells you the *hidden better* allele, so you can tell a `34/34` from a
`10/34` before you breed to him — but it is now an optimisation rather than the price of entry. That
is a much better place for it than `conformation-founding-quality.md` §3 left it, where a child who
never tested could not progress at all.

---

## 6. The build order

Decided; largest first. Each is measured in the section named.

1. **Expression rule `worst` (faults dominant).** §2. It satisfies the operator's constraint
   identically — every displayed number is a real allele — and additionally makes that number
   *informative*, which the random pull does not. It single-handedly removes the selecting-on-looks
   plateau, and everything below is measured on top of it.
2. **Inbreeding depression off conformation expression**, per slice 0018. §1.2. Nothing else here
   works with it in place, and it is what breaks the "real value" guarantee.
3. **`conformation_modifier_step` → 0.10 and `conformation_noise_sd` → 0.5.** §4.
4. **Founding band back to `low`**, since `worst` makes founders much plainer on its own (1.35 of 5
   at `low`, 1.95 at `mid`) and coaxing needs the room.
5. **Mare prenatal care**, one step, worst-trait mode, `prenatal_care_cost` 500 plus one turn. §3.
6. **Show the finished-trait count.** Under `worst` this is free — it is the same number as the
   traits reading Outstanding — but it should be *named* as permanence somewhere: a padlock, a
   "breeds true" line. It is the only measure of progress that cannot fall.

Items 1–4 change what every horse in the game looks like and want a slice document and a reset plan
of their own; item 5 is additive and touches only new coverings.

---

## 7. The decisions, and why they went the way they did

Recorded in full because several of them reverse or constrain earlier calls, and a future session
will need to know they were made deliberately.

1. **`worst` versus the random pull — `worst`.** A reversal of a decision taken earlier in
   conversation. The random pull met the operator's stated constraint but made selection *worse than
   averaging* (§1.1), which nobody had measured when it was chosen.
2. **"Faults dominant" is acceptable as a story — accepted.** It is unusual biologically — real
   conformation is polygenic and additive — but it is legible, it is honest, and the game already
   teaches dominance through disease and colour. A child reads it as *"you can't hide a fault, but
   you can hide a virtue"*, which is close enough to true of real horses to pass.
3. **Inbreeding depression comes off conformation — yes.** Slice 0018's call, confirmed here.
   This document's recommendations do not stand without it (§1.2).
4. **Prenatal care costs money and a turn; `prenatal_care_cost` starts at 500** — §3.4. The price is
   the pacing dial and is the one number to revisit first if progress feels wrong in real play.
5. **The mechanic takes the worst trait; the player does not choose** — §3.1. The operator's own
   wording, the simpler thing to explain, and what every measurement here assumes.
6. **Prenatal care cannot fail** — §3.5. The cost is the price, not a die roll.
7. **The modifier and noise numbers move**, to 0.10 and 0.5 — §4.

---

## 8. Running it yourself

The bench now defaults to the decided design: `--expression worst`, `--modifier-step 0.10`,
`--noise-sd 0.5`, `--inbreeding 0`, `--coax-mode shown`, `--coax-policy worst`. Every flag below is
therefore only needed to depart from the decision.

```
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8                        # the decided design
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --coax 1               # ... with prenatal care every covering
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --expression average   # the old baseline, for comparison
node docs/analysis/breeding-lab.mjs breed 12 to 16 --foals 4 --prenatal 1                # one covering, four foals, care bought
node docs/analysis/breeding-lab.mjs legibility --breed AR
node docs/analysis/breeding-lab.mjs bands --breed AR
```

In `dynasty`, `gain` is the whole question: what a mating bought over the two horses that went into
it. Under the `worst` rule the `on target` and `FIXED` columns should be identical — if they ever
diverge, something is pulling expression off the allele value, and that something is almost certainly
inbreeding depression (§1.2) creeping back in.
