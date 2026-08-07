# Why foals come out worse than their parents, and what to do about it

Operator-reported, 2026-08-07:

> *"how do we make it more consistent that babies of founders do NOT come out worse than their
> parents every time?"*

and, a message later:

> *"the other game i played used an outside mechanism (training and care) to give an actionable path
> that allowed you to force better genetics through grinding. no its not my favorite. but we may
> have to implement something that allows you to coax the genes to do right — incrementally of
> course"*

Every number here is output from `docs/analysis/breeding-lab.mjs`, which gained one new dial
(`--coax`) for this document. Re-run it after any change.

**Scope.** This is about conformation only. The operator's separate point in the same conversation —
that ability traits need to be breed-fixed too, because a Friesian with a speed of 100 is ridiculous
— is a real defect and is **not addressed here**. It wants its own document.

---

## 1. The answer to the question as asked

Foals come out worse than their parents by **-3.3 points a generation**, forever, under the
type-gene design as currently specified. That is the `gain` column of `dynasty`, and it never turns
positive at any generation.

That deficit is not one thing. Measured by switching each contributor off in turn (Arabian, band
`low`, 8 mares, 4 stallions, lifetime cap of 4 foals, 200 runs, generation 8):

| what is switched off | gain at gen 8 |
|---|---|
| nothing — the design as specified | **-3.3** |
| birth noise (`--noise-sd 0`) | -3.2 |
| inbreeding depression (`--inbreeding 0`) | -2.6 |
| noise, inbreeding **and** the modifier | -1.9 |
| selecting on tested genes instead of looks (`--select tested`) | -2.3 |
| tested genes **and** no inbreeding depression | **-0.5** |

Read the last row against the first. **Roughly 85% of "my foal is worse than its parents" is not
genetics at all.** It is two things sitting on top of the genetics:

### 1.1 Selecting on looks, which is all a child can see (worth ~2.0 points)

The score is a **tent**: `100 − |value − standard| × 2`, peaked at the breed standard. Two horses can
sit exactly on the peak for completely different reasons:

- **10 and 10** — homozygous at the standard. Every foal gets a 10.
- **2 and 18** — one rung either side. Averages to exactly 10, reads Outstanding, and passes a 2 or
  an 18. Never a 10.

They are *phenotypically identical*. A child picking their two best-looking horses picks the second
kind about as often as the first, and the second kind cannot help but throw scatter. Because the
score is a tent, scatter is pure loss — any variance around the peak costs score in both directions.
This is arithmetic, not tuning: **while parents are heterozygous, their foals average out to the
same value and score lower for it.**

### 1.2 Inbreeding depression on conformation expression (worth ~0.7 and growing)

This one is worse than its size suggests, because of *when* it lands. Coaxing at 2 steps, selection
on tested genes:

| gen | traits FIXED at standard | traits reading Outstanding | score |
|---|---|---|---|
| 3 | 4.06 | 3.76 | 91.9 |
| 5 | 4.90 | 3.62 | 91.7 |
| 7 | **5.00 — genetically perfect** | 3.27 | 90.5 |
| 8 | **5.00** | **3.14** | **90.2** |

**A herd that has achieved a genetically perfect Arabian looks worse than it did at generation 3.**
COI is a multiplier on `realization()`, which pulls expression toward 50 — and the further a breed's
standard sits from 50, the more it costs. The child who plays best is punished hardest, at exactly
the moment they should be celebrating, and nothing on screen explains why.

`docs/slices/0018-genetic-progress-and-inbreeding.md` already proposes moving inbreeding depression
off conformation expression and onto fitness. `docs/fixes/conformation-founding-quality.md` §4 gave
it a second argument. **This is the third, and it is the strongest: without it, no amount of coaxing
or grinding can produce a herd that visibly improves past generation 4.**

### 1.3 The irreducible remainder (-0.5)

With genes visible and COI off conformation, the deficit is **-0.5 points a generation** against a
`show_noise_sd` of 5. That is a tenth of the luck in a single class. It is gone as a felt problem.

---

## 2. So: does the game need a grind mechanic at all?

**Yes — but not for the reason the question implies.** Fixing §1.1 and §1.2 stops foals being worse
than their parents. It does not, on its own, hit the operator's other brief:

> *"within 5 generations, you've got great horses if you play your cards right"*

Best case without any coaxing (tested selection, carrier specialist, one horse bought in per
generation, COI off conformation) — generation 5 lands at **3.71 of 5 traits Outstanding, 2.64
FIXED**. Good. Not great. The 5-trait endgame is still out past generation 10.

There is a real 1.5-trait gap between what selection alone delivers by generation 5 and what the
operator wants. **That gap is what a coax mechanic should fill, and it should fill exactly that
much.**

---

## 3. The proposal: a young-horse programme that moves one allele one rung

Modelled in the bench as `--coax <n>`, deliberately as the most conservative version that could be
built, so the numbers are a floor rather than a best case:

1. **It moves one allele one rung toward the horse's own breed standard.** Never away, never past it.
2. **It is capped for life**, and it is spent on the horse, not the stable.
3. **It only reaches young horses** — a programme that closes when the skeleton does. A bought-in
   adult is past it, which is what keeps it a *breeding* mechanic rather than a shopping one.
4. **It is directed and visible.** The player chooses the trait and sees the allele change. The
   breeding preview's Punnett square stays exact, which is the whole reason the type gene is legible
   to a nine-year-old.

Point 1 is what makes this safe where random drift was not. `conformation-founding-quality.md` §5
rejected drift because a random walk erodes breed type from the far end and NPC stables breed every
tick under no selection pressure. A toward-standard-only move **cannot** erode breed type: it
strictly improves it, and an NPC stable that never buys the programme never moves at all.

### 3.1 What it buys, measured

Arabian, tested selection, carrier specialist, one horse bought in per generation, inbreeding
depression off conformation:

| gen | coax 0 — on target / FIXED / gain | **coax 1** — on target / FIXED / gain | coax 2 |
|---|---|---|---|
| F | 2.71 / 0.64 / — | 2.71 / 0.64 / — | 2.71 / 0.64 / — |
| 1 | 2.86 / 0.89 / -0.3 | **3.00 / 1.43 / +0.3** | 3.17 / 2.04 / +0.9 |
| 3 | 3.29 / 1.72 / -0.6 | **3.66 / 3.04 / +0.2** | 4.22 / 4.07 / +1.2 |
| **5** | 3.62 / 2.44 / -0.4 | **4.36 / 4.20 / +0.4** | 4.77 / 4.90 / +0.0 |
| 8 | 4.13 / 3.43 / -0.4 | **4.77 / 4.93 / -0.6** | 4.82 / 5.00 / -1.3 |

**At one step, the gain is positive in every generation from 1 to 6.** Foals are *better* than their
parents, reliably, which is a stronger result than the question asked for. Generation 5 reads 4.36
of 5 traits Outstanding and 4.20 of 5 FIXED — "great horses by generation 5", on the nose.

**One step is the right setting; two is too many.** At coax 2 the type-gene game is finished by
generation 5 and the gain turns negative afterwards because there is nothing left to buy — the child
spends three more generations watching the number not move.

Measured across four breeds at coax 1 (QH / AR / FR / IC), generation 5 reads
**4.32 / 4.36 / 4.33 / 4.35** traits on target. Uniform, so the mechanic needs no per-breed tuning.

### 3.2 The child who never tests still gets somewhere

Selecting on looks, coaxing the *worst-looking* trait (which is what a child without a test can see):

| gen | on target | FIXED | gain |
|---|---|---|---|
| F | 2.71 | 0.64 | — |
| 5 | 3.96 | 2.18 | -1.5 |
| 8 | 4.29 | 3.18 | -1.5 |

Slower, and the foals still read slightly worse than the selected parents — but the herd climbs
steadily and ends up with good-looking horses. That is the right difficulty gradient: **the casual
path works, and the informed path works better.** Nobody is locked out, and there is a visible reason
to learn more.

---

## 4. What it looks like to a twelve-year-old

The whole loop, with the coax mechanic in it:

1. **Test the horse** (free on your own, once it has started — see §5.1). *"Willow carries a 2 and an
   18. The Arabian head standard is 10."*
2. **Breed her to a stallion who carries a 10.** The preview states the four outcomes exactly.
3. **A foal comes out carrying 10 and 18.** Better than her dam already.
4. **Put the foal on the young-horse programme.** Costs money, a turn, and real game-time while she
   grows. Her 18 becomes a 10. *"Marigold now carries 10 and 10 — every foal she ever has will have
   a correct Arabian head."*
5. That trait is **finished, permanently, and visibly.** It never comes back.

Step 5 is the thing the current design has no equivalent of. A child needs something that ratchets —
a result that cannot be undone by next year's bad luck. The FIXED count is that ratchet, and coaxing
is what lets a child *reach* it by decision rather than by waiting for the right foal.

---

## 5. What has to land with it, in order

**These are ordered by size, and the order matters — the coax mechanic is close to worthless
without the first two.**

1. **Inbreeding depression comes off conformation expression** (slice 0018's existing proposal).
   Without it, coaxing produces a genetically perfect herd that looks worse than a mediocre one (§1.2).
   This is the single highest-value change on this page and it is already specified elsewhere.
2. **A horse's own type genes are free to its owner once it has started**, on the same gate the
   conformation words already use (slice 0022 Part B). `conformation-founding-quality.md` §3 found a
   player who never tests plateaus at generation 1; this document finds testing is worth ~2.0 points
   a generation of the parent-to-foal deficit on its own. Another stable's genes stay paid.
3. **The coax mechanic at one step**, per §3.
4. **The FIXED count is shown.** A padlock, a "breeds true" line, something. It is the only measure
   of progress that cannot fall, and at the moment nothing on any screen reports it. A child whose
   score dipped this year needs to be able to see that their herd still went forward.

---

## 6. What needs the operator

1. **Confirm §5.1** — inbreeding depression off conformation. It is slice 0018's call, not this
   document's, but this document's recommendations do not work without it.
2. **What does the programme cost, and what does it consume?** Money and a turn is the obvious
   answer. Real game-time (a programme that runs for N game days on a growing horse) is the better
   one, because it makes the young-horse window mean something and stops a rich stable buying five
   rungs in an afternoon. Not decided here.
3. **One step per horse per lifetime, or one per year while young?** Measured at one *total*, which
   is the conservative reading. One per year while young is a bigger mechanic and would want
   re-measuring before it is built.
4. **Does the programme risk anything?** A version that can fail, or that costs condition, is more
   interesting than one that always works — but it also reintroduces the "did I just get unlucky"
   problem this whole redesign exists to remove. Recommendation: **it always works.** The cost is the
   price, not a die roll.
5. **Ability traits are still breed-blind** (the Friesian-with-speed-100 problem). Untouched here,
   and it is the other half of the reset.

---

## 7. Running it yourself

```
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8            # the defect, as specified
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --select tested --inbreeding 0
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --select tested --inbreeding 0 \
      --specialist carrier --outcross 1 --coax 1                             # the recommendation
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --coax 2   # coaxing without §5.1
```

The `gain` column is the whole question: what a mating bought over the two horses that went into it.
`--coax-policy worst` is the child who has not tested; `finish` is the child who has.
