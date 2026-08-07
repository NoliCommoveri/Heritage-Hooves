# Founding quality under the type-gene engine

Operator-reported, 2026-08-07, while reading `docs/fixes/conformation-breed-type.md`:

> *"we need to find a way to make our founding/gen 1 slightly worse, without undoing the work of
> getting a 90 on a breed that wants 8"*

and, in the same conversation, two proposals for how:

> *"have the fixed alleles anytime a horse is fresh minted, but afterwards, their gene can adjust"*
>
> *"increase the gene possibilities to every 4 … and then for bands, specify founders are not
> allowed to be closer to perfect than xyz, while making sure at least a few traits slip through
> unmolested to making breeding better possible"*

**This is a companion to `conformation-breed-type.md`, not a replacement.** That document's
architecture is unchanged and should still be built. This one answers the founding-quality question
it left open in its §12.3, corrects one of its numbers, and reports two things nobody was looking
for that are more important than the question asked.

Every number below is output from `docs/analysis/breeding-lab.mjs`, which gained the dials and the
two measurement commands (`sweep`, `programme`) used here. Re-run it after any change.

---

## 1. The two dials are already separate, and only one of them is the guarantee

The thing that makes a 90-headed Arabian impossible is **reach**: an allele may never sit more than
`reachPoints` (24, three rungs) from its own breed's standard. Nothing else contributes to it.

Everything else — the concentration, the shape, the specialist, the band — only decides how the pool
is distributed *inside* that reach. **You can slacken all of it to flat and an Arabian's head still
cannot exceed 34.**

That is the whole answer to "without undoing the work". Every option in this document leaves reach
at 24 and none of them moves the wrong-breed share above 0.5%:

| | wrong-breed share (a trait >25 points off) |
|---|---|
| today's live engine | 44% – 94% |
| type gene, fix doc as written | 0.1% – 0.4% |
| type gene, every option below | **0.1% – 0.5%** |

The dial to *never* reach for when tuning quality is `reachPoints`. It is labelled as such in the
bench.

---

## 2. Correction: gen 1 is already half a trait better than the fix document claims

`conformation-breed-type.md` §5.4 offers founding stock at `low` as **2.5 traits on target of 5**,
and rests its "2.5 traits of journey" reassurance on that number. Measured:

| Arabian, band `low` | traits on target | traits FIXED at standard |
|---|---|---|
| §5.4's number, reproduced (**no specialist**) | 2.59 | 0.42 |
| §7.3 as actually specified (**specialist included**) | **3.04** | **1.34** |

**§5.4's table was computed without §7.3's own reframed specialist.** `conformation-architecture.mjs`
models today's ±1-allele specialist but not the proposal's homozygous-at-target one, so the headroom
table understates the thing it exists to measure.

With the specialist as written, founding stock at `low` lands on the document's own `mid` figure.
The operator's sense that gen 1 arrives too finished is correct, and this is most of why.

The `FIXED` column is the more serious half. §7.3 hands every founding horse **one trait already
homozygous at its breed's standard** — a trait that is finished, breeds true to every foal it will
ever have, and cost nothing. That is **1.34 of the 5-trait type-gene endgame given away at mint**,
before the child makes a single decision.

---

## 3. The finding nobody was looking for: selecting on looks plateaus in one generation

A breeding programme, herd of six, best pair bred each generation, keep the best six, selection on
**conformation score** — which is all a child can see:

| gen | mean score | traits on target | traits FIXED |
|---|---|---|---|
| founding | 89.4 | 3.07 | 1.33 |
| 1 | 92.0 | 3.70 | 1.35 |
| 4 | 92.5 | 3.80 | 1.39 |
| 8 | 92.7 | 3.87 | **1.41** |

**Eight generations of selection move FIXED from 1.33 to 1.41, and no run ever produces a finished
horse.** The programme is over after generation 1.

The cause is structural and it is defect 1.2 wearing a new hat. A horse carrying 10/10 and a horse
carrying 2/18 both express 10 and both score 100 on that trait. **They are indistinguishable to a
player selecting on the phenotype**, so phenotypic selection exerts *no pressure toward
homozygosity whatsoever.* The population converges on "expresses the right value" within one
generation and then stops, permanently.

Selecting on the **tested** genotype instead:

| gen | traits FIXED | herd holds a finished horse |
|---|---|---|
| founding | 1.33 | 0% |
| 4 | 3.36 | 28% |
| 8 | **4.45** | **53%** |

**So the conformation test is not a nice-to-have that adds depth. It is the only thing that makes
the type-gene architecture a game rather than a one-generation puzzle.** This raises the stakes on
`conformation-breed-type.md` §12.1 and §12.2 considerably: if the test is priced so that a child
skips it, the entire endgame is unreachable and they will never know why.

**Recommendation, and this is a change of view from §12.2's "middle option":** a horse's own type
genes should be **free to its owner** once it has started once, on exactly the same gate the
conformation *words* already use (slice 0022 Part B). Another stable's genes stay paid. The money
sink is not worth a mechanic the children cannot find.

---

## 4. The second finding: finishing a horse makes it worse, and worse for the best breeds

Selecting on the tested genotype works, but it requires line-breeding, and the herd's COI climbs.
COI is a multiplier on realization, which pulls expression **toward 50** — so the cost of inbreeding
is proportional to how far a breed's standard sits from the middle.

Same programme, generation 6, two breeds, near-identical genetic achievement:

| | traits FIXED | mean COI | **mean score** |
|---|---|---|---|
| Quarter Horse | 4.33 | 45.6% | **87.4** |
| Arabian | 4.29 | 41.3% | **79.3** |

Eight points apart for the same accomplishment, purely because the Arabian's standards are far from
50. And within a single Arabian programme the score *falls* while FIXED rises — 89.4 at founding to
73.8 at generation 8.

Larger herds and buying in fresh horses each generation soften it but do not remove it (measured at
herd 6/12/20 and outcross 0/1/2).

`conformation-breed-type.md` §7 predicted the direction of this ("realization's pull toward 50
becomes the *largest* remaining deviation") and was right to forbid re-anchoring `realization()` on
the breed target — that would make an inbred horse score *better*. But nobody had measured the size,
and 8 points against a `show_noise_sd` of 5 is not a rounding error.

**This is a new open question and it belongs to the health/inbreeding slice, not this one.** It is
recorded here because it was found here. `docs/slices/0018-genetic-progress-and-inbreeding.md`
already proposes moving inbreeding depression off conformation expression and onto fitness; that
proposal now has a second, independent argument for it.

---

## 5. Proposal 1 (drift): solves a real problem, at the cost of the whole fix

An inherited allele may step one rung. Implemented in the bench as `--drift <p>`.

It does buy one thing nothing else buys: **an allele that exists in no founding horse can appear
later.** That matters for §6 below. Against it:

- **The exact Punnett square stops being exact.** "Comet carries 10 and 10, so every foal gets a 10"
  becomes "usually". The breeding preview — the single feature that makes this architecture legible
  to a nine-year-old (`conformation-breed-type.md` §6) — goes back to being probabilistic, and a
  test a child paid for now predicts their foal only most of the time.
- **It erodes breed type from the far end.** Reach is enforced on the founding pool only. Drift is a
  random walk with no such cap, and NPC stables and the show barn breed every tick under no selection
  pressure at all. Clamping the walk to the breed's reach (`--drift-clamped`, the bench's default)
  fixes that, but a clamped walk mostly pushes horses *away* from a target they have reached — which
  reads to a child as "my perfect stallion throws imperfect foals for no reason."
- **The problem it intuitively solves is already solved.** "The game ends when all five loci are
  fixed" is what the demoted twenty-allele modifier exists to prevent (§4.3). §3 above shows the
  type-gene game is nowhere near ending anyway.

**Recommendation: do not build drift.** Keep it in the bench as the fallback if §6 turns out not to
leave enough headroom.

---

## 6. Proposal 2 (a hole around the target): right instinct, defeated by arithmetic

The proposal is that founders may not carry an allele closer than *n* rungs to perfect, with a small
escape so a few slip through. Implemented as `--founding-mode ring --hole <rungs>
--target-chance <p>`.

The operator's own caveat — *"making sure at least a few traits slip through"* — is load-bearing
rather than decorative, because **Mendelian inheritance shuffles alleles and never invents one.** An
allele absent from a child's founding stock can never be bred, only bought. So the escape chance
must be big enough that a starting barn reliably contains the correct allele for all five traits.

How big is that? For a barn of six horses (twelve alleles per trait):

| allele frequency | traits, of 5, permanently unreachable in that barn |
|---|---|
| 6% | **2.38** |
| 10% | 1.41 |
| 15% | 0.71 |
| 20% | 0.34 |
| 28% (what the peak pool already delivers) | **0.10** |

Measured, at the 6% escape the proposal implies: **97% of six-horse barns start with two or three
traits they can never breed correct.** The escape has to be around 25–30% before that goes away —
at which point it is not a ring any more, it is the pool the fix document already specifies.

Two further results worth recording:

- **A hole with `--hole 0` is arithmetically identical to a peak with a lower concentration.** The
  only thing the hole adds is the exclusion zone, and the exclusion zone is what breaks the look:
  at `--hole 1` (step 8, so alleles forced ≥16 points off) the Arabian's mean deviation goes 5.4 →
  11.6 and the wrong-breed share goes 0.3% → 5.3%. That is the guarantee starting to fray.
- **Step 4 does not rescue it.** A finer ladder makes the hole gentler, but a step-4 hole-1 barn
  still starts 95% missing an allele, because the escape chance is what drives that number and the
  step does not touch it. Step 4 also costs the fix document's §4.2 property that *one rung off ≈
  one word worse* — at step 4 a rung is 4 points, still Outstanding, so more of the difference
  between two horses becomes invisible without a test.

**Recommendation: do not build the hole, and keep the ladder at step 8.** But the *intent* behind it
is exactly right, and §7 delivers it by another route.

---

## 7. What to actually do: demote the founding specialist

The proposal's intent is "close to right, almost never exactly right, but the right allele is out
there somewhere". The obstacle is that low allele frequency makes the material absent from small
barns. **The founding specialist decouples those two things**: it can guarantee the correct allele
is present in every horse regardless of how rare it is in the pool.

`conformation-breed-type.md` §7.3 currently sets one trait **homozygous** at the breed's target.
Change it to **carrier**: one allele at the target, the other drawn from the pool as normal.

The horse still arrives with a real gift, and a better-phrased one — *"she carries the correct
Arabian head"* — but it is raw material rather than a finished trait.

| Arabian, band `low` | score | on target | **FIXED** | carries | barn missing an allele |
|---|---|---|---|---|---|
| fix doc as written (`fixed`) | 89.2 | 3.04 | **1.34** | 2.96 | 2% |
| **specialist `carrier`** | 88.2 | 2.73 | **0.62** | 2.96 | 2% |
| `carrier` + concentration 0.35 → 0.28 | 87.7 | 2.60 | **0.43** | 2.61 | 6% |
| specialist removed entirely | 87.6 | 2.59 | 0.42 | 2.45 | 8% |
| concentration 0.15, specialist `fixed` | 88.1 | 2.82 | 1.06 | 1.89 | **24%** |

Read the last row against the third: lowering the concentration *alone* is the obvious lever and it
is the wrong one — it barely touches what the horse arrives owning (FIXED 1.06) while quadrupling
the chance a child starts with a dead trait.

**The recommended setting is `carrier` plus a concentration of 0.28**, measured across all eight
breeds:

| Breed | score | on target | FIXED | carries | wrong-breed | barn missing |
|---|---|---|---|---|---|---|
| Quarter Horse | 87.2 | 2.52 | 0.41 | 2.57 | 0.1% | 10% |
| Arabian | 87.7 | 2.62 | 0.44 | 2.60 | 0.3% | 6% |
| Thoroughbred | 87.5 | 2.54 | 0.41 | 2.56 | 0.4% | 7% |
| German Warmblood | 87.6 | 2.60 | 0.43 | 2.57 | 0.2% | 8% |
| Friesian | 87.5 | 2.57 | 0.43 | 2.59 | 0.2% | 8% |
| Paso Fino | 87.4 | 2.55 | 0.42 | 2.56 | 0.4% | 7% |
| Icelandic | 87.5 | 2.56 | 0.43 | 2.58 | 0.5% | 6% |
| Nokota | 87.4 | 2.53 | 0.42 | 2.57 | 0.3% | 5% |

That is:

- **on target 3.04 → 2.55** — gen 1 is slightly worse to look at, and now genuinely matches the
  "2.5 traits of journey" §5.4 advertises;
- **FIXED 1.34 → 0.42** — three quarters of the free endgame handed back;
- **carries 2.96 → 2.57** — the raw material is still there, which is what the hole could not manage;
- **wrong-breed ≤0.5% on every breed** — the guarantee untouched, which was the constraint;
- **uniform across all eight breeds**, so the band picker keeps meaning one thing.

The 6–10% of barns starting short of one allele is a feature at that level rather than a bug: it is
a reason to shop, and with testing built the child can *see* why, which the 97% version never
allowed.

---

## 8. What this changes in `conformation-breed-type.md`

Nothing architectural. Three edits:

1. **§5.4's table** is measured without §7.3's specialist and should say so, or be re-measured with
   it. As written it understates gen 1 by roughly half a trait.
2. **§7.3** — `homozygous at the breed's target rung` becomes `one allele at the breed's target
   rung, the other drawn from the pool`. One word in the migration, and a better sentence for the
   founding-offer screen.
3. **§9's migration 0177** — `conformation_concentration` at `low` becomes 0.28 rather than 0.35.
   `mid`/`high` are left at 0.55/0.75 and are untouched by this document; they are the show barn's
   and the consignment dealer's bands, not the children's.

None of it touches reach, the ladder, the modifier, the noise, `realization()` or the polygenic
stream discipline.

---

## 9. What needs the operator

1. **Confirm `carrier` over `fixed`** for the founding specialist (§7). This is the main
   recommendation and it is the one that answers the question as asked.
2. **Confirm concentration 0.28 at `low`**, or keep 0.35 and take `carrier` alone (on target 2.73,
   FIXED 0.62, and no barn ever short of material). 0.35 is the safer of the two and 0.28 is the
   closer match to what §5.4 promises.
3. **Reopen §12.2 (are type genes free after a start?)** in light of §3. My recommendation is now
   *yes for your own horses*, because a child who skips the test never gets past generation 1 and
   nothing on screen would tell them so.
4. **Note §4 for the inbreeding slice.** No action here; it wants deciding before `0018` is built,
   and it is a second independent argument for that slice's central proposal.
5. **Drift and the hole are recommended against** (§5, §6) but both stay in the bench, so either can
   be re-argued with numbers rather than from scratch.

---

## 10. Running it yourself

```
node docs/analysis/breeding-lab.mjs sweep --breed all --band low          # the baseline
node docs/analysis/breeding-lab.mjs sweep --breed AR --specialist carrier --concentration 0.28
node docs/analysis/breeding-lab.mjs programme --breed AR --gens 8         # selecting on looks
node docs/analysis/breeding-lab.mjs programme --breed AR --gens 8 --select tested
node docs/analysis/breeding-lab.mjs sweep --breed AR --founding-mode ring --hole 1 --target-chance 0.06
node docs/analysis/breeding-lab.mjs sweep --breed AR --drift 0.05
```

Every dial is listed at the top of the script. `--reach` is the breed-type guarantee and is the one
to leave alone; everything else is quality.
