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

**Scope.** Conformation only. The operator's separate point — that ability traits need to be
breed-fixed too, because a Friesian with a speed of 100 is ridiculous — is a real defect and is
**not addressed here**. It wants its own document.

**A note for the next session, because it cost this one a wasted pass.** The move off averaging was
decided in conversation and is recorded in **no document**, and `PROP.expression` in the bench is
still `'average'` by default (commit `e1746b7` added the dial without changing the default).
Every measurement in `conformation-breed-type.md` and `conformation-founding-quality.md` predates
the decision and is therefore measured under the *old* rule. This document is the first measured
under the new one, and §2 is the reason that distinction turns out to matter enormously.

---

## 1. The defect, decomposed

Foals come out **-3.3 to -4.0 points worse than their parents, every generation, forever**. That is
the `gain` column of `dynasty`, and it never turns positive at any generation under any expression
rule as currently specified. Measured by switching each contributor off in turn (Arabian, band
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
what the child can see does not determine what the horse passes on.

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
first that says the new expression rule does not work at all without it.

---

## 2. The finding: a third expression rule does what neither of the first two can

The operator's constraint — *the number visible to the child has to reflect a real value* — rules out
averaging and admits the random pull. It also admits two rules nobody had considered, and one of them
is dramatically better. Both are now in the bench as `--expression worst` and `--expression best`.

**`worst` — the horse shows whichever of its two alleles is FURTHER from its own breed standard.**
Faults dominant, quality recessive. The number is a real allele, exactly as under the random pull,
**and it is deterministic**. The consequence is the whole finding:

> **A trait reading Outstanding is homozygous at the standard. Always. There is no fake.**

Because a horse only looks correct when it has nothing worse to show. It follows that what the child
sees and what a breeding programme accumulates are *the same number*. In the bench's output the
`on target` and `FIXED` columns become identical, row for row, generation after generation.

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
already at 97.7 by generation 8 with no headroom left. **Recommended against.**

---

## 3. Coaxing, in this new light

Modelled as `--coax <n>`, deliberately the most conservative version that could be built:

1. **It moves one allele one rung toward the horse's own breed standard.** Never away, never past.
2. **Capped for life**, spent on the horse rather than the stable.
3. **Only reaches young horses** — a programme that closes when the skeleton does. A bought-in adult
   is past it, which keeps it a breeding mechanic rather than a shopping one.
4. **Directed and visible.** The player picks the trait and sees the allele change, so the breeding
   preview's Punnett square stays exact.

Point 1 is what makes this safe where random drift was not
(`conformation-founding-quality.md` §5): a toward-standard-only move cannot erode breed type, and an
NPC stable that never buys the programme never moves at all.

Under the `worst` rule coaxing is **much more powerful than it was under averaging**, because moving
the worse allele moves the visible number directly and permanently. One step is now plenty, and the
founding band has to come back down to `low` to leave room for it.

**Arabian, band `low`, faults dominant, selection on looks only, coax 1:**

| gen | on target (**= FIXED**) | gain |
|---|---|---|
| founding | 1.35 | — |
| 1 | 1.24 | **+1.3** |
| 3 | 2.63 | **+1.9** |
| **5** | **3.90** | **+1.5** |
| 8 | 4.89 | +0.2 |

**The gain is positive in every single generation.** Foals are reliably *better* than their parents —
a stronger result than the question asked for — and generation 5 lands at 3.90 of 5 traits correct,
every one of them permanent and heritable. That is the operator's "great horses within 5 generations"
brief, met, by a child who never buys a single test.

Measured at that setting across all eight breeds:

| | QH | AR | TB | GW | FR | PF | IC | NOK |
|---|---|---|---|---|---|---|---|---|
| founding | 1.33 | 1.35 | 1.34 | 1.34 | 1.33 | 1.33 | 1.33 | 1.33 |
| gen 3 | 2.43 | 2.59 | 2.37 | 2.44 | 2.45 | 2.37 | 2.40 | 2.37 |
| **gen 5** | **3.78** | **3.85** | **3.75** | **3.81** | **3.85** | **3.73** | **3.74** | **3.74** |
| gen 8 | 4.81 | 4.85 | 4.78 | 4.83 | 4.83 | 4.81 | 4.80 | 4.78 |

Uniform. No per-breed tuning needed, which is the property the quality band has never had.

---

## 4. The negotiable numbers

The operator offered noise and the modifiers. Taking them up on it is what makes the displayed number
exactly an allele rather than approximately one. Measured with `bands`, under a whole-rung rule:

| modifier range | noise SD | word matches the genes |
|---|---|---|
| ±7.5 (fix doc as written) | 2 | 89% |
| ±2.5 | 1 | 100% |
| **±1.0** | **0.5** | **100%** |

**Recommended: `conformation_modifier_step` 0.75 → 0.10 (a range of ±1.0), `conformation_noise_sd`
6 → 0.5.** At those settings a mature, outbred horse displays its own worse allele exactly, and the
word beneath it is never wrong. The twenty-allele block survives as a tie-breaker between two horses
with identical type genes — which is all §4.3 of the fix document ever wanted it for — rather than as
something that can move a horse a full rung and lie about its genotype.

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
4. **Or put the foal on the young-horse programme** and turn her 18 into a 10 by decision rather than
   by waiting for the right roll.
5. That trait never comes back. **The count of finished traits is the score, it is visible for free,
   and it cannot fall.**

The test still has a job — it tells you the *hidden better* allele, so you can tell a `34/34` from a
`10/34` before you breed to him — but it is now an optimisation rather than the price of entry. That
is a much better place for it than `conformation-founding-quality.md` §3 left it, where a child who
never tested could not progress at all.

---

## 6. Recommendations, in order of size

1. **Expression rule `worst` (faults dominant), not the random pull.** §2. It satisfies the
   operator's own constraint identically — every displayed number is a real allele — and additionally
   makes that number *informative*, which the random pull does not. It single-handedly removes the
   selecting-on-looks plateau. **This is a change of direction from a decision already taken in
   conversation, so it needs the operator's agreement rather than assuming.**
2. **Inbreeding depression off conformation expression** (slice 0018's existing proposal). §1.2.
   Nothing else here works with it in place, and it is what breaks the "real value" guarantee.
3. **`conformation_modifier_step` → 0.10 and `conformation_noise_sd` → 0.5.** §4.
4. **Founding band back to `low`**, since `worst` makes founders much plainer on its own (1.35 of 5
   at `low`, 1.95 at `mid`) and coaxing needs the room.
5. **The coax mechanic at one step**, per §3.
6. **Show the finished-trait count.** Under `worst` this is free — it is the same number as the
   traits reading Outstanding — but it should be *named* as permanence somewhere: a padlock, a
   "breeds true" line. It is the only measure of progress that cannot fall.

---

## 7. What needs the operator

1. **`worst` versus the random pull.** The main recommendation, and a reversal of a decision already
   made. Everything in §2 and §3 is measured on it.
2. **Is "faults dominant" acceptable as a story?** It is unusual biologically — real conformation is
   polygenic and additive — but it is legible, it is honest, and the game already teaches dominance
   through disease and colour. A child reads it as *"you can't hide a fault, but you can hide a
   virtue"*, which is close enough to true of real horses to pass.
3. **Confirm inbreeding depression comes off conformation** (§6.2). Slice 0018's call, but this
   document's recommendations do not stand without it.
4. **What does the young-horse programme cost, and what does it consume?** Money and a turn is
   obvious. Real game-time on a growing horse is better — it makes the young-horse window mean
   something and stops a rich stable buying five rungs in an afternoon.
5. **One coax step per horse per lifetime, or one per year while young?** Measured at one total,
   the conservative reading.
6. **Should the programme be able to fail?** Recommendation: **no.** The cost is the price, not a
   die roll. Reintroducing "did I just get unlucky" is what this whole redesign exists to remove.
7. **Ability traits are still breed-blind.** The other half of the reset, untouched here.

---

## 8. Running it yourself

```
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8                     # averaging, the old baseline
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --expression random # the decision as taken
node docs/analysis/breeding-lab.mjs dynasty --breed AR --rounds 8 --expression worst \
      --band low --modifier-step 0.10 --noise-sd 0.5 --inbreeding 0 --coax 1 --coax-policy worst
node docs/analysis/breeding-lab.mjs legibility --breed AR --expression worst --modifier-step 0.10 --noise-sd 0.5
node docs/analysis/breeding-lab.mjs bands --breed AR --expression worst
```

In `dynasty`, `gain` is the whole question: what a mating bought over the two horses that went into
it. Under `--expression worst` the `on target` and `FIXED` columns should be identical — if they ever
diverge, something is pulling expression off the allele value, and that something is almost certainly
inbreeding depression.
