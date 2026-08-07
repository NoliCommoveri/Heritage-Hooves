# Slice 0028 — Conformation genetics

**This is the only conformation-genetics document. It holds two states: what exists today (§1) and
what exists once this slice lands (§2 onward). Nothing else about conformation genetics is worth
reading, and the intermediate proposals that led here have been deleted deliberately.**

Decided with the operator 2026-08-07, amended 2026-08-07 after a second round of measurement.
Per CLAUDE.md §2, treat §2–§8 as standing. §9 is the short list of what is genuinely still open.
**Two decisions taken 2026-08-07 after this document's first draft: the show barn's Novice tier
drops to the `low` band (built, migration `0176`), and conformation stops being realized by age
at all (§2.4) — the second replaces a recommendation this document previously made and the
measurement refuted.**

Measured throughout by `docs/analysis/breeding-lab.mjs`, which models both engines
(`--engine today` and `--engine proposed`). Re-run it after any change. Every table below names the
command that produced it.

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

Appended **after `PATN1`**, never inserted earlier, for the RNG-order reason `loci.ts` states in its
own header. Each locus's `wildType` is the middle rung — see §8 on why nothing in the game may be
left to that default.

### 2.2 The ladder — a rung every 4 points, 25 alleles

Each locus has **25 alleles, named for their own value on the trait's 1–99 scale**:

```
2, 6, 10, 14, 18, 22, ... 90, 94, 98             (a rung every 4 points)
```

An allele may sit at most **6 rungs — 24 points — from its breed's own standard**. That cap, and
nothing else, is the breed-type guarantee: it is what makes a Roman-nosed Arabian impossible. **Do
not widen it to tune quality.** Quality is tuned by §2.5's band deal, which changes what a horse is
dealt *inside* the reach and leaves breed type perfectly intact.

Note the reach is unchanged **in points** from the 8-point ladder this slice originally proposed —
the same 24-point window, sampled twice as finely. What the finer sampling buys is §2.3.

**Two rungs to a word.** Against `show_ideal_falloff` 2.0 the ladder and the vocabulary line up
exactly:

| distance | rungs off standard | word |
|---|---|---|
| 0–4 pts | 0–1 | **Outstanding** |
| 8–12 pts | 2–3 | **Good** |
| 16–20 pts | 4–5 | **Acceptable** |
| 24 pts | 6 (the edge of reach) | **Weak** |

**Poor is unreachable inside a breed, and that is worth knowing before someone hunts the bug.** The
worst distance a horse can reach is 24 points from the genes plus about 2 from the modifier and
noise; Poor needs more than 35. Measured over 12,000 founding horses the worst seen anywhere is
**26 points**. Poor survives for exactly two cases and they are both real: a cross-breed horse
registered under one parent's breed, and a hand-created horse left on the middle rung.

**Move the label edges to the midpoints between achievable distances: 88 / 72 / 56 / 40**
(`conformation_label_*_min`, migration 0135's four keys). The current 90/75/55/30 puts the Good edge
one point away from a 3-rung trait's own score, so about one trait in eight slips a word on the
modifier alone. At the midpoints **the word a player reads matches the genotype it should name
100% of the time**, up from 97%. This is a pure improvement and costs one extra `json_set`.

Every target in `breeds.ideal_vector` is re-seeded to its nearest rung. On a 4-point ladder **no
target moves more than 2 points**, comfortably inside the tolerance `docs/breed-ideal-vectors.md` §4
claims for itself.

### 2.3 Expression: the horse shows its worse allele

**A horse's displayed value for a trait is whichever of its two alleles is FURTHER from its own
breed standard.** Faults dominant, quality recessive.

```
expressed = worseAllele + (alleleCount − 10) × conformation_modifier_step + noise
            conformation_modifier_step = 0.10   (a range of ±1.0)
            conformation_noise_sd      = 0.5
```

**Which standard?** The horse's **own breed's live `ideal_vector`** — never the `ideal_vector`
snapshotted onto a `show_classes` row. The class snapshot stays what it has always been: the thing
distance is *measured against* at judging. Expression and measurement read different copies on
purpose, and a comment in `geneticValue()` should say so, because migration 0177 re-snaps every
target and the two will briefly disagree if anyone wires them together.

This is the load-bearing choice in the whole slice:

> **You cannot hide a fault, but you can hide a virtue.**

A horse can only look correct when it has nothing worse to show. What a child *sees* and what a
breeding programme *accumulates* move together, the count of good traits is visible for free, and it
cannot fall.

**What the 4-point ladder costs, stated plainly.** On the 8-point ladder Outstanding meant *exactly*
on target, so an Outstanding trait was homozygous-at-standard 100% of the time. Outstanding now
covers 0–1 rungs, so:

> **A trait reading Outstanding means both alleles are within one rung of the standard. In founding
> stock it is genuinely homozygous-at-standard about 30% of the time**, rising toward two thirds in a
> line that has been bred for that trait (measured: gen 8 of §3.4's barn reads 1.45 traits Outstanding
> against 0.94 fixed).

That is a real loss and it must not be papered over — about one Outstanding trait in five carries no
correct allele at all. The 30% is measured under §2.5's dealt bands; an earlier draft of this section
said 55%, which was measured under the concentration-weighted pool that §2.5 replaced.

It buys something the 8-point ladder could not: **the word saturates before the genes do.** A child gets a horse that looks perfect and still has real breeding left in it, and
the show score — continuous in distance — goes on separating a field after every word has gone
Outstanding. That is the answer to §8's own worry about a field of on-type horses compressing
upward. Measured: `bands --rung-step 4 --rungs-per-band 2`.

The 20-allele polygenic block keeps its exact shape, its exact inheritance (`inheritPolygenic`, not
one line changed) and its exact RNG streams. Demoted to ±1.0, it is the tie-breaker between two
horses with identical type genes.

`show_noise_sd` (5) is **not** touched. Uncertainty belongs in the show ring, where everyone can see
it is luck. It does not belong in the horse.

### 2.4 Conformation is not realized by age at all

**`conformationValues` stops calling `realization()`. A horse's conformation is §2.3's formula at
every age, from birth.** `abilityValues` keeps `realization()` exactly as it is today.

The problem this solves: `realization()` pulls a value toward an anchor by an age curve that is 0.55
at birth and only reaches 1.0 at five years, and every screen and the judge read the value at the
horse's *current* age. So below maturity a horse does not read as its own genotype, and §2.3's whole
guarantee is a maturity guarantee rather than a guarantee. At the adult classes' own minimum age the
curve is still 0.82, which reads a homozygous-at-8 Arabian head as about 16 — Good, not Outstanding —
and the young-horse classes slice 0025 built are worse.

**Anchoring the curve on the breed target instead of 50 does not fix it.** That was this document's
own recommendation and the measurement refuted it: it swaps one error for its mirror, so a young
horse reads too *good* rather than too bad, and the word still matches the genotype only 35% of the
time at a year old under either anchor (`bands --anchor target --age 1`). Any age curve on a
Mendelian type gene makes the word unfaithful; only removing it makes the word true.

Three things fall out of this, and they are the reason it is the right answer rather than merely the
simplest:

- **The guarantee holds at every age, not just at maturity** — word fidelity is 100% for a foal, a
  yearling and a broodmare alike. A child can read a foal the day it is born, which is what the whole
  of §2.3 is for.
- **It satisfies §5's rules 2 and 3 at the same time.** Inbreeding depression cannot be on
  conformation expression if realization is not applied to conformation at all, which is what slice
  0018's proposal asked for — and `realization()`, `anchorFor()` and `inbreeding_depression_factor`
  are themselves untouched, so nothing an inbred horse does gets *better*. Depression goes on
  continuing to apply to ability expression, where a real dilemma survives and where slice 0018 can
  still move it.
- **A type gene is a fact about the horse.** It does not develop. Ability genuinely does — a
  two-year-old is slower than a five-year-old — which is why the curve stays there and only there.

The costs, both small and both real. `conformation_maturity_years` and
`conformation_realization_at_birth` become ability-only settings and want a comment saying so rather
than a rename (renaming a config key is a migration for no behavioural gain). And
`ConformationValue.matureExpressed` becomes identical to `expressed`, so **the horse page's "will
mature to" line is dropped for conformation traits** — it would be printing the same number twice.

### 2.5 The bands are dealt, not drawn

A founding horse is **dealt a fixed profile of words**, one pair-spec per trait, shuffled across the
five traits. Bucket index 0 is Outstanding, 1 Good, 2 Acceptable, 3 Weak; under §2.3 a pair shows
the *higher* of its two buckets, so the word a spec produces can be read straight off the table with
no simulation at all.

| band | pair-specs (bucket, bucket) | what a child sees | mean score |
|---|---|---|---|
| **low** | `0-0, 1-1, 1-2, 2-2, 3-3` | 1 Outstanding, 1 Good, 2 Acceptable, **1 Weak** | 70.1 |
| **mid** | `0-0, 0-0, 1-1, 2-2, 3-3` | 2 Outstanding, 1 Good, 1 Acceptable, **1 Weak** | 76.1 |
| **high** | `0-0, 0-0, 0-0, 1-1, 2-2` | 3 Outstanding, 1 Good, 1 Acceptable, no Weak | 84.5 |

Inside a bucket, the exact rung and the side of the standard are drawn; where a breed's target sits
near an end of the 1–99 scale the side is forced inward rather than clamped onto the target, since
clamping would quietly manufacture correct alleles the deal never granted.

This replaces the concentration-weighted pool the slice originally specified. The reason is the one
that motivated deriving pools in the first place, taken one step further: a *distribution* has to be
re-tuned every time anything else moves, and it delivers a different answer for every breed. A
**deal** is stated in the vocabulary a child reads, is identical for all eight breeds by
construction, and is monotonic per trait without anyone having to check. `/admin/npc`'s band picker
reads `"low — one trait right for the breed, one wrong, three in between."`

**Fairness, which is the reason for dealing rather than drawing.** Four children keeping three
founders each from a shared batch of twelve: the gap between the luckiest and unluckiest child is
**2.4 points** — less than the luck in a single show — and **0.00 of 5** in traits on target. Every
child gets the same shape; only which trait is which varies. Measured: `fairness --rung-step 4`.

This is a knowing exception to `pool.ts`'s "a pool must list every locus" rule. `parseAllelePool`
must exempt these five **explicitly**, so a missing colour locus still throws.

### 2.6 The founding specialist, and why round-robin is now mandatory

Slice 0019's conformation specialist becomes an **upgrade of an allele the deal already granted**:
one allele already in the closest bucket is moved to exactly the breed's target rung. The quota is
the whole budget; the specialist spends it rather than adding to it.

**The specialist must be assigned round-robin across a founding batch, not drawn per horse.** On the
8-point ladder this was a nicety. On the 4-point ladder the closest bucket spans 0–1 rungs, so an
independently-drawn specialist leaves **89% of six-horse barns with no allele within reach of the
standard on some trait** — a trait that child could never breed right. Round-robin takes it to
**0%**. Measured: `sweep --rung-step 4 --round-robin 0` against `--round-robin 1`, the
`barn missing` column.

Founding stock mints at band **`low`**. `mid` is the consignment dealer's and the show barn's
working band; `high` is what a Champion field is made of.

### 2.7 Mare prenatal care — the mechanism, not an accelerator

A paid option on a covering that **moves the foal's worst trait two rungs (8 points) toward its
breed standard**.

- **Two rungs, not one.** Care is really defined in *points*: 8 points is the step the 8-point
  ladder measured and the pacing everything else was tuned against. At one rung a line does not
  finish — measured below.
- **It hangs off the pregnancy.** `pregnancies` already carries its own `rng_seed` and a snapshotted
  gestation length; one more snapshotted column is the whole storage cost.
- **Committed before the foal exists**, so it can never be an undo on a bad roll.
- **Capped at one per foal by construction.** No lifetime counter, no way to stack.
- **The mare's genotype is untouched.** One trait in one foal, moved once.
- **Toward the standard only, never away and never past it.** Two rungs is two applications of the
  same one-rung step, each of which stops at the target, so it cannot overshoot.
- **It cannot fail.** No die roll. The cost is the price.
- **The mechanic picks the trait; the player never chooses.** Whichever trait the foal shows
  furthest from its own breed standard, resolved at foaling, after the alleles are drawn.
- **Cost: `prenatal_care_cost` (default 500) plus one turn**, charged on the covering at the moment
  the player commits. A live tunable. No refund if the covering does not take.

**It moves the worst TRAIT, not the worst ALLELE.** Under §2.3 a horse shows its worse allele, so
improving one copy of a homozygous pair leaves the other copy showing and the purchase is invisible —
about half of all purchases, at random, with nothing on screen to explain it. Moving the trait costs
one allele step on a heterozygote and two on a homozygote. The extra cost is the point.

**The finding that reframes this whole section.** On the 4-point ladder, in a barn running under real
constraints — twelve stalls, a mare capped at five coverings, the genotype read one round in four —
a line that never buys care **does not produce an all-Outstanding horse in twenty-five generations
97% of the time.** It plateaus around 2.0 of 5 traits with COI already past 40%. Mendelian
inheritance shuffles alleles; it never invents one, and the founding batch simply does not hold
enough near-target alleles to finish five traits.

| care bought on | first all-Outstanding horse | first all-FIXED horse |
|---|---|---|
| no coverings | **97% never get there in 25 generations** | never |
| 1 covering in 4 | median gen 21 | median >25 |
| half | median gen 15 | median gen 20 |
| 3 in 4 | median gen 12 | median gen 16 |
| every covering | median gen 11 | median gen 14 |

`dynasty --mares 3 --studs 2 --cap 5 --herd 12 --select mixed --coax 2 --coax-chance <r>`

So **`prenatal_care_cost` is the most load-bearing number in this slice.** It does not accelerate the
endgame, it *is* the endgame, and whatever a child can afford per game year is the pace of the whole
game. It is also the right place for the pacing to live, since it moves without touching genetics.
The step size is the second dial: at one rung the median is 18 generations even buying it every
time, at three rungs it is 8.

### 2.8 NPC breeding stables buy care and test their stock

**Without this the NPC breeding stables plateau exactly the way a blind player does, and the field
the children compete against goes stale while the show barn's *minted* stock does not.** That is a
worse failure than the ceiling problem it superficially resembles: the children would face a
Champion field of freshly-minted high-band horses backed by breeding stables whose own lines stopped
improving at 2 of 5.

Two live tunables, both at `/admin/config`, both first guesses:

- **`npc_prenatal_care_chance`** (proposal **0.5**) — the share of NPC coverings that buy mare
  prenatal care. It is charged to the stable's real balance like any other cost, which means a stable
  that stops earning stops buying it. That is correct and is deliberately not special-cased: it
  becomes visible at `/admin/npc` as a stable going quiet, the same signal slice 0017 Part C built
  that page to give.
- **`npc_tested_share`** (proposal **0.5**) — roughly half an NPC stable's horses are treated as
  having had the conformation panel bought. Which half is derived deterministically from the horse's
  own `rng_seed` against the stable's, **never drawn per decision**, so a stable's opinion of one of
  its own horses does not flicker between two ticks.

**Where it wires.** `expressedFor` (`src/db/npcBreeding.ts`) is the single input to NPC mate
selection and is already shared with `src/db/npcMarket.ts`, so both the breeding stage and the
market ranking pick this up at once. For a *tested* horse, a conformation trait is scored from the
mean distance of its two alleles rather than from the shown (worse) one — the same information a
tested player has, computed by the same helper, with no second scoring path (CLAUDE.md §13).

**Neither setting raises the NPC ceiling.** `activeNpcCeilingRow` still caps NPC quality exactly as
slice 0015 §2.4 built it; these two stop an NPC line going stale *below* the ceiling. Say this in the
migration comment — the ceiling is the failure mode CLAUDE.md §13 names as most likely to kill the
project, and the next session must not read "let the NPCs improve" as a licence to remove it.

Two NPC stables need neither: the **show barn**, whose stock is minted to a rank plan and never
bred, and the **consignment dealer**, which mints rather than breeds.

---

## 3. What it produces

### 3.1 Founding stock

`sweep --breed all --n 8000 --rung-step 4 --rungs-per-band 2 --labels derived --founding-mode pairs
--round-robin 1`

| band | worst 20% | mean | best 20% | traits Outstanding | wrong-breed type | barn dead ends |
|---|---|---|---|---|---|---|
| low | 67.4 | **70.1** | 72.8 | 1.00 of 5 | ≤0.5% | 0% |
| mid | 73.2 | **76.1** | 78.9 | 2.00 of 5 | ≤0.6% | 0% |
| high | 81.6 | **84.5** | 87.4 | 3.00 of 5 | ≤0.1% | 0% |

All eight breeds agree to within 0.2 of a trait — the band picker means one thing everywhere, which
is the defect in §1's closing paragraph closed. The tails sit ±2.7 points from the mean and the bands
are 6.0 and 8.4 apart, so the bands never overlap on their averages while a lucky low horse still
beats an unlucky mid one. Against `show_noise_sd` 5 that reads right.

### 3.2 Showing

One horse against a field of seven show-barn horses of that rank, show noise on every entry, twelve
stalls, genotype read one round in four, care on half the coverings. **This table assumes
Novice/Open/Champion are minted at low/mid/high** (§9).

| generation | Novice win / top-3 | Open win / top-3 | Champion win / top-3 |
|---|---|---|---|
| founding | 21% / 52% | 3% / 16% | 0% / 0% |
| 4 | 49% / 82% | 16% / 45% | 1% / 5% |
| 7 | 78% / 96% | 41% / 76% | 5% / 22% |
| 10 | 94% / 99% | 72% / 94% | 22% / 54% |
| 13 | 99% / 100% | 90% / 99% | 46% / 79% |

A founding horse is **competitive in Novice on day one** — a ribbon in half its starts. Open ribbons
start landing around generation 4 and Open wins around generation 7. Champion is a long campaign.

### 3.3 Two great horses

Both parents reading Outstanding on a trait are within a rung of the standard by definition of
looking that way, so a foal of theirs is too. **Two great horses cannot produce a bad foal**, which
is the complaint this slice answers — but they *can* produce one a rung off, which is the room the
4-point ladder deliberately leaves.

### 3.4 The market, and what it rewards

`dynasty --herd 12 --select mixed --coax 2 --coax-chance 0.5 --market 4`, 20 generations:

| what the barn does | first all-Outstanding horse |
|---|---|
| no market at all | median gen 15 |
| buying + stud service, mid then high | median gen **17** |
| stud service only, no buying | median gen **13** |
| buying only, no stud service | median gen 18 |
| buying + stud service, testing every round | median gen **11** |

**Buying on looks actively costs you generations, and it is not churn** — thinning the market to one
horse a round gives the same answer. A mid-band horse on the shelf shows two Outstanding traits while
carrying nothing accumulated, and at 4 points a rung Outstanding only means within-one-rung; a
generation-eight home-bred that looks worse is often carrying far better genes. On the three rounds
in four where a child cannot see genotypes, they sell the good horse and buy the pretty one.

**Stud service is unambiguous gain** — it never displaces anything, so a barn keeps every allele it
has accumulated *and* gets outside blood, at no cost in stalls. It is also the only thing measured
here that holds COI down.

Together: **the market pays +2 generations if a child tests and costs 3 if they do not.** That makes
the conformation panel pay for itself twice — once on your own foals, once on what you buy — and it
is the strongest argument in this document for pricing the panel low (§9).

### 3.5 What the conformation test is worth

Twelve stalls, no care, first all-Outstanding horse: never testing, median gen 21+; one round in
four, gen 15; every round, gen 13. On the softer "first mid-band foal" bar at eight stalls: never
testing gen 10, one in eight gen 9, one in four gen 7, one in two gen 6, every round gen 5.

---

## 4. Rules that will bite you

Each of these is the obvious next change, and each causes a real defect.

1. **`geneticValue()` is shared with ability traits and must be split, not branched.**
   `abilityValues` calls it too (`src/engines/conformation/model.ts:126`), and ability must keep
   `potential × 5` exactly (§7 test 7). Conformation's version needs the breed target as an
   argument; ability's must not grow one.
2. **Do not put `realization()` back on conformation, in any form.** §2.4 takes it off entirely, and
   both of the obvious ways to put it back are defects. Leaving it as it is means a horse's displayed
   value is its allele pulled toward 50, so it is no longer any allele the horse owns and §2.3's
   guarantee is false below maturity. Re-anchoring it on the breed target is worse than it looks: it
   swaps the error for its mirror (young horses read too *good*), it was measured at 35% word
   fidelity at a year old, and while COI is still a multiplier on realization it makes an **inbred
   horse score better**, which undoes the health slice's central dilemma. `realization()`,
   `anchorFor()` and `inbreeding_depression_factor` are themselves untouched by this slice.
3. **§2.4 is what satisfies slice 0018's "depression off conformation expression".** Nothing further
   is owed to it here, and this slice is not blocked on 0018 landing. Depression goes on applying to
   *ability* expression; moving it to fitness stays 0018's call.
4. **On-target and FIXED now diverge by design.** The earlier draft of this document said the
   `dynasty` command's two columns print identically and that a divergence means rule 2 has been
   violated. That diagnostic is dead: at 4 points a rung, Outstanding covers a horse that is not yet
   homozygous, so `on target` legitimately runs ahead of `FIXED` by roughly a factor of three. Do
   not "fix" it.
5. **The polygenic loop must keep drawing its exact 20 bits per trait**, in place, even though the
   value is demoted (slice 0019 §7's rule). Skip them and every existing RNG stream shifts — colour,
   disease, ability, age all change for the same seed.
6. **`conformation_noise_sd` is shared with ability.** `rollEnvironmentalNoise` draws Normal(0, sd)
   for **all fourteen traits** from that one key. Dropping it 6 → 0.5 silently tightens every
   discipline class too. Split it (`ability_noise_sd`, staying at 6) and have `drawNoise` take one SD
   per trait category. **Decide before 0179 lands** — it is a conformation change leaking into
   ability, not an ability question.
7. **Noise is rounded to a whole number and stored** (`drawNoise`, `model.ts:27`). At SD 0.5 that is
   a three-point distribution, ~68% exactly zero — not a Gaussian. The bench models this faithfully,
   so the measurements hold; just know that the ±1.0 modifier, not noise, is the real tie-breaker.
   `LEGACY_NOISE_SD` becomes dead after the reset.
8. **`import_offers` needs the concentration/band snapshotted** (CLAUDE.md §5.5). It already carries
   `polygenic_one_chance`; after 0177's split that column holds only the ability half and its name
   becomes misleading next to the new one. Say so in the migration.
9. **Conformation loci are not injectable.** `injection.ts` assumes biallelic; the consignment
   allowlist is colour/gait only. That is a comment plus an assertion, not logic.

---

## 5. Build order

The later steps read the earlier ones.

1. `Locus.alleles` → `readonly string[]`; five conformation loci appended to `LOCI`, `wildType` the
   middle rung.
2. **`src/engines/conformation/typeGene.ts`** — new pure module: the ladder, `shownAlleleFor(pair,
   target)`, `dealForBand(band, ideal, rng)`. Everything imports it; nothing restates it.
3. `geneticValue()` in `src/engines/conformation/model.ts` — split per rule 1; the conformation
   version reads the type locus per §2.3 plus the demoted modifier, against the horse's own breed's
   live `ideal_vector`.
4. `conformationValues()` stops calling `realization()` (§2.4); `abilityValues()` keeps it.
   `matureExpressed` collapses onto `expressed`, so the horse page's "will mature to" line goes with
   it. One line of engine, one card, and it is what makes every guarantee in §2.3 true at any age.
5. `generateCandidate()` — deal the five type pairs per §2.5; specialist per §2.6, round-robin across
   the batch.
6. `parseAllelePool()` — exempt the five, explicitly.
7. Migrations (§6).
8. **Mare prenatal care** (§2.7) — a column on `pregnancies`, a checkbox on the covering form, a
   config key, an `ACTION_COSTS` entry, a ledger kind, and one call in the foaling path. Additive:
   it touches only new coverings and is the one part of this slice that could land separately.
9. **NPC care and testing** (§2.8) — two config keys, one change in `expressedFor`, one in the NPC
   covering path. Reads §2.7, so it lands after it.
10. Testing: a conformation panel on `/horses/:id/test`, reusing
   `horse_knowledge.subject_code = 'locus:NL'` exactly as colour does, in its own `<details>` group.
11. `inferFromPhenotype` — under §2.3 a horse's shown value **is** its worse allele, so looking tells
    you that one exactly and the test buys the *hidden better* one. One sentence, not a table.
12. `foalPrediction.ts` — **replaced by something much shorter**. The Poisson-binomial convolution
    goes; a 2×2 Punnett over known alleles crossed with the small modifier distribution is exact.
    It must read **Unknown** for an untested parent (slice 0025's rule, unchanged).
13. Everything that mints a horse (`src/db/founding.ts`, `npc.ts`, `consignment.ts`) passes the
    breed's ideal vector. `consignment.ts`'s hardcoded `cfg.quality_bands.mid ?? 0.5` becomes a real
    `consignment_quality_band` key.

The admin create-horse form needs a select rather than radios for a 25-allele locus. It stays a
neutral control (slice 0005 §6.6): a hand-created horse defaults to the middle rung on all five, not
to a breed's target.

---

## 6. Migrations

**`0176` is already built and applied-pending** — `npc_show_barn_rank_plan`'s Novice tier moved from
the `mid` band to `low` (§3.2's table assumes it). It is deliberately independent of everything else
here: the band names it uses exist today and keep their meaning after 0178 reshapes what a band
contains, so it improves the game before any of the rest lands.

Next free is `0177`. Each registered in `src/db/migrations.ts` (CLAUDE.md §8).

- **0177** — `breeds.ideal_vector` targets snapped to the 4-point ladder, all eight breeds, five
  traits. No target moves more than 2 points.
- **0178** — `quality_bands` reshaped from one number per band to a band **deal** (§2.5's five
  pair-specs) plus `ability_one_chance` (0.42 / 0.50 / 0.58, **today's values, unchanged**). The
  single number is currently *also* the ability allele frequency that `breeds.ability_bias` offsets,
  so moving it would silently undo slice 0024. This split is forced, not cosmetic.
- **0179** — `conformation_modifier_step` 0.10, `conformation_noise_sd` 0.5, `ability_noise_sd` 6
  (rule 6), `conformation_test_cost`.
- **0180** — `conformation_label_outstanding_min` 88, `..._good_min` 72, `..._acceptable_min` 56,
  `..._weak_min` 40 (§2.2).
- **0181** — `founding_quality_band` → `low`, new `consignment_quality_band` → `mid`.
- **0182** — `import_offers` band snapshot column (rule 8).
- **0183** — `pregnancies.prenatal_care` snapshot column, `prenatal_care_cost` = 500.
- **0184** — `npc_prenatal_care_chance` 0.5, `npc_tested_share` 0.5 (§2.8). Comment must state that
  neither raises the NPC ceiling.

§2.4 needs **no migration** — it is the removal of a call, plus a comment on
`conformation_maturity_years`/`conformation_realization_at_birth` saying they are ability-only now.

---

## 7. Tests

1. Every breed's snapped target sits **exactly on a rung** — read off the migration on disk, not
   hand-copied, the way `test/showing/breed-aptitude.test.ts` already does.
2. A generated horse of every breed is within 6 rungs of its target on every conformation trait, at
   every band. This is the test that would have caught the original defect.
3. Every band deals **exactly its stated word profile**, per trait, for every breed — 1/2/3 traits
   Outstanding and a Weak at low and mid. Asserted per trait, never on the average, since averaging
   is what hid the original bug.
4. A trait reading Outstanding has **both alleles within one rung** of the standard, over many
   seeds. §2.3's guarantee as it now actually stands — do not write the older, stronger assertion.
5. Two homozygous-identical parents produce a foal with the identical type pair, every time.
6. A round-robin founding batch of five or more leaves **no trait without an exact-target allele**
   (§2.5).
7. The same seed produces the **same ability traits, age, colour and disease genotype** before and
   after. The regression that proves rule 5's stream discipline held.
8. Ability traits are unaffected by the band deal at any setting, and `ability_noise_sd` is what
   moves ability noise (rule 6).
9. Prenatal care on a **homozygous** worst trait changes the shown value (the invisible-purchase
   case in §2.6), moves exactly two rungs, and never moves a trait past its target.
10. `foalPrediction` reads Unknown when either parent's type genes are untested by this viewer.
11. A breed with no `ideal_vector` still generates (middle rung) and is not judged.
12. An NPC stable's tested share is **stable across two calls** for the same horse (§2.8) and its
    quality still respects `activeNpcCeilingRow`.
13. §2.4: the **same horse reads the same conformation values at one year old and at ten** — and its
    ability values do not. This is the test that keeps the age curve off conformation once somebody
    "restores" it.
14. §2.4's corollary: a horse with a **non-zero COI reads its own alleles** on conformation, and
    still takes a depression penalty on ability. Rule 2, pinned.

---

## 8. The cost, and how it lands

**This needs a world reset.** No living horse has a type-locus genotype, and the missing-locus rule
would read them all as the middle rung — every horse in the game identical and off-type. A backfill
deriving each horse's pair from its expressed value does not work: today's values are centred on 50,
not on breed targets, so every Arabian would be permanently Poor-headed. **Grant the new founding
batches after the migrations land, not before** — `import_offers` snapshots the band.

Slice 0021 Part G spent the last reset on 2026-08-06, so this is a second one. That is the real price
of this slice and it is worth naming plainly to the operator before anything is built.

`foalPrediction.ts` gets substantially shorter, so this deletes real code as well as adding it.

---

## 9. Still open

1. **Confirm the consignment dealer mints at `mid`.** §2.6 says mid; the dealer is where a child buys
   raw material they cannot breed themselves, and low-band stock is barely better than their own.
2. **Is the conformation test one purchase per locus, or one panel per horse?** §3.4 and §3.5 both
   argue for pricing it low and selling it as one panel: it is worth two to five generations, and it
   is what turns the market from a trap into a gain. Five separate purchases is a bigger money sink
   but makes a child test the wrong thing.
3. **Are a horse's own type genes free once it has shown**, the way conformation *words* already are
   (slice 0022 Part B)? Under §2.3 looking already tells you the worse allele, so the test only buys
   the hidden better one. Middle option: your own horses free, another stable's only by testing.
4. **Split `ability_noise_sd` off, or accept the tightening?** Rule 6. Written into 0179 above as a
   split, which is the recommendation, but it has not been confirmed.
5. **Confirm the second reset** (§8), and that founding grants go out afterwards.

---

## 10. The bench

`docs/analysis/breeding-lab.mjs` is the only conformation bench and models both engines. **Its
defaults still reproduce the 8-point ladder this document originally specified**, so the amended
design must be asked for on the command line:

```
--rung-step 4 --rungs-per-band 2 --labels derived --founding-mode pairs --round-robin 1
--pairs-low 0-0,1-1,1-2,2-2,3-3 --pairs-mid 0-0,0-0,1-1,2-2,3-3 --pairs-high 0-0,0-0,0-0,1-1,2-2
```

```
# founding stock, all eight breeds: score spread, word census, barn dead ends
node docs/analysis/breeding-lab.mjs sweep --breed all --n 8000 <the flags above>

# does the word match the genes, and does Outstanding mean homozygous?
node docs/analysis/breeding-lab.mjs bands --breed AR --rung-step 4 --rungs-per-band 2

# a real barn: 12 stalls, mares capped at 5, genotype read 1 round in 4, care on half
node docs/analysis/breeding-lab.mjs dynasty --breed AR --mares 3 --studs 2 --cap 5 --herd 12 \
  --select mixed --coax 2 --coax-chance 0.5 --market 4 --stud-service 1 <the flags above>

# four children, three founders each, out of one batch of twelve
node docs/analysis/breeding-lab.mjs fairness --breed AR <the flags above>
```

`--anchor target|fifty` and `bands --age <years>` exist to re-run §2.4's measurement: score a
population at a given age off the value shown *that day* rather than the matured one. Both are only
there to show why the age curve had to go — the decided design uses neither.

It is a simulation of a system that has not been built, with its own PRNG and its own copy of the
game's constants — and that copy can drift. Every constant in it names its source. Money is not
modelled: `--buy-per-round` is the stand-in for a budget, and it is the first thing to distrust in
§3.4.
