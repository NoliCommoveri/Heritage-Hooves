# Fix: conformation genetics that actually describe a breed

Operator-reported, 2026-08-06, while reading `docs/fixes/quality-band-on-target.md`:

> *"All horses should be within a reasonable distance of their standard, all the time. Otherwise
> it's not actually that breed — no registry would accept an Arabian that looks like a
> Thoroughbred."*

and, in the same message, the reason a straight retune cannot deliver it:

> *"players cannot see the genes … a player would have to breed the same parents enough times to see
> if a bad foal was just bad luck or a truly bad pairing. That's expensive in our model where mares
> have a single baby a year. A mare could spend her whole breeding career and never give a baby the
> player can be reasonably sure should be used for next stage breeding."*

**This supersedes `docs/fixes/quality-band-on-target.md`.** That document's diagnosis is correct and
its measurements still hold; its *fix* patches the founding generator so that the band aims at the
breed target. This one changes the thing the band was patching around. If both were built, this one
would immediately make that one dead code. Build this instead.

Measured throughout by `docs/analysis/conformation-architecture.mjs` — run it after any change here.
Every number below is that script's output, not an estimate.

---

## 1. What is actually wrong

Three separate defects sit in one engine. They are usually discussed as one because they present as
one feeling ("breeding is too random"), but they need different fixes and only one of them is a
tuning problem.

### 1.1 The scale is breed-blind

A conformation trait rides on twenty alleles. Its value is `count × 5` — so the population sits on a
binomial centred at **50, for every breed, always**. A breed's target is an arbitrary point on that
same scale, and the engine has no idea it exists.

The Arabian head, the operator's own example (target 8, i.e. one allele of twenty):

| Arabian head, minted today at `mid` | dished (≤25) | straight (26–55) | **Roman (>55)** | range seen |
|---|---|---|---|---|
| | 21.7% | 51.9% | **26.5%** | 1–98 |

**More than a quarter of Arabians minted today have a Roman nose, and the full 1–98 range is
reachable.** The mean Arabian is 20.8 points from its own standard across five traits, and **94.4%
of Arabians carry at least one trait more than 25 points off** — a trait that reads Weak or Poor no
matter what else the horse does. Every breed has the same problem; the Arabian just has it worst,
because its standard is the most distinctive.

| Breed | mean \|expressed − target\| | share with a "wrong breed" trait |
|---|---|---|
| Arabian | 20.8 | 94.4% |
| Friesian | 17.0 | 81.2% |
| German Warmblood | 14.9 | 71.5% |
| Thoroughbred | 13.6 | 64.4% |
| Paso Fino | 13.7 | 57.5% |
| Quarter Horse | 13.1 | 53.7% |
| Icelandic | 12.3 | 44.4% |
| Nokota | 12.2 | 44.6% |

The operator is right that this is not a breed. It is one population of horses wearing eight
different registry names, judged against eight standards none of them was built to meet.

### 1.2 The genotype is unreadable, by construction

Twenty alleles, all interchangeable, all anonymous. A horse's phenotype is their *count*. So:

- **Homozygous and heterozygous are literally the same thing.** There is no locus at which a horse
  "carries" anything; there is only a total. The word *carrier* has no meaning for conformation.
- **Nothing can be tested.** `horse_knowledge` can reveal a colour locus or a disease locus because
  those are single genes with named alleles. There is no equivalent question to ask here — "does she
  carry a long neck?" does not parse against a count.
- **Two horses that look identical can breed completely differently, and no amount of money or time
  will tell you which is which** except producing foals.

That last one is the operator's complaint verbatim, and it is structural rather than tuned.

### 1.3 The variance swamps the signal

Even setting aside 1.1 and 1.2, the scatter is larger than the target window.

Two Quarter Horses, each selected until all five of its traits read Outstanding — the best horse a
child could realistically own — bred together:

| Foal, per trait | Outstanding | Good | Acceptable | Weak/Poor |
|---|---|---|---|---|
| today | **37.6%** | 36.0% | 22.0% | 4.4% |

**A foal matching both its Outstanding parents on all five traits: 0.9%.** One in a hundred and
eleven. A mare has perhaps ten foals in her life.

The spread of one foal's trait around its parents' is an **SD of 10.6 points**, against an
Outstanding window of ±5. Two thirds of that is meiosis (the parents are heterozygous at most loci
and cannot help it), the rest is `conformation_noise_sd` at 6.

That last figure deserves its own line, because it is the cheapest thing on this page to fix:

| | traits reading Outstanding, of 5 |
|---|---|
| a **genetically perfect** Paso Fino, today | **3.15** |

A horse with a flawless genotype loses nearly two traits of five to birth noise alone. `noise_sd` of
6 against a ±5 window means the environment is a bigger factor than the entire breeding programme.

---

## 2. Why none of this is a tuning problem

- **1.1 cannot be tuned.** There is one dial (`polygenic_one_chance`) and every breed needs it
  pointing a different way per trait — an Arabian wants 15 alleles of neck and 2 of head at once.
  `quality-band-on-target.md` §2 proves this exhaustively and it is still the right proof.
- **1.2 cannot be tuned at all.** No number changes what a count of anonymous alleles can express.
- **1.3 can be tuned, partly.** Dropping `conformation_noise_sd` is a one-line config change worth a
  real improvement. The meiosis half cannot be tuned, only re-architected: the variance comes from
  parents being heterozygous, and under this architecture they will *always* be heterozygous, because
  the alleles that make a 55-neck and the alleles that make a 55-neck differently are the same
  alleles.

---

## 3. The proposal, in one paragraph

**Split each conformation trait into a large, testable, graded gene that decides the horse's shape,
and keep the existing twenty-allele block as a small heritable modifier on top of it.**

The graded gene's alleles *are* points on the trait's own 1–99 scale — a neck allele is a number
like 42 or 58 — and a horse's shape is the **average of its two**. Breeds differ by which alleles
their founding pool carries: an Arabian's head pool is full of low numbers, a Friesian's of high
ones. Everything else in the game — the meter, the long/short and dished/Roman words, the judge, the
Poor-to-Outstanding vocabulary, show scoring, the appraisal — reads exactly the same value it reads
today and needs no change at all.

That single move fixes all three defects at once:

- **type** — an Arabian's head cannot be Roman because no Arabian carries a Roman allele;
- **legibility** — a test returns two numbers, and a foal's is the average of one from each parent,
  which is arithmetic a nine-year-old can do;
- **variance** — two horses that both test 54/54 produce a 54 foal every single time, and only the
  small modifier and a small noise term move it.

---

## 4. The architecture

### 4.1 One new Mendelian locus per conformation trait

Five new loci appended to `LOCI` — `NL`, `SA`, `BL`, `HS`, `HP`, one per conformation trait. They
use the **existing Mendelian machinery unchanged**: `meiosis`, `combine`, `sortAllelePair`,
`getMendelianPair`, `drawAllele` and `parseAllelePool` are all already allele-count-agnostic. The
only structural change is `Locus.alleles`, today typed `readonly [string, string]`, which becomes
`readonly string[]`. `wildType` is already spelled out per locus, so the missing-locus rule keeps
working.

### 4.2 The allele ladder

Each conformation locus has **13 alleles, named for their own value on the trait's 1–99 scale**:

```
2, 10, 18, 26, 34, 42, 50, 58, 66, 74, 82, 90, 98        (a rung every 8 points)
```

A horse's **type value** for the trait is the mean of its two alleles. So the reachable values are
every 4 points from 2 to 98 — a homozygote lands on a rung, a heterozygote lands midway between two.

Eight points per rung is chosen against the label bands (migration 0135) so that **one rung off
target is roughly one word worse**:

| rungs off target | points | traitScore | word |
|---|---|---|---|
| 0 | 0 | 100 | Outstanding |
| ½ (a heterozygote) | 4 | 92 | Outstanding |
| 1 | 8 | 84 | Good |
| 2 | 16 | 68 | Acceptable |
| 3 | 24 | 52 | Weak |
| 4+ | 32+ | ≤36 | Weak → Poor |

### 4.3 The twenty-allele block stays, demoted

`horses.genotype.polygenic` keeps its exact shape, its exact inheritance (`inheritPolygenic`, not one
line changed), and its exact RNG streams. What changes is what a `'1'` is worth:

```
expressed = typeValue + (alleleCount − 10) × conformation_modifier_step + noise
```

with `conformation_modifier_step` at **0.75** instead of today's 5 — a range of ±7.5 and an SD of
about 1.7 points. It is now the fine adjustment that separates two horses with the same type genes,
and the thing a breeding programme still has left to chase after the type genes are fixed. This is
what stops the game ending the day a child gets all five loci homozygous.

`conformation_noise_sd` drops **6 → 2**, so the environment nudges rather than decides.

Together those two put a horse within about ±5 points of its own type value, which is what makes the
genotype nearly readable from the phenotype — and makes the small remaining ambiguity worth paying a
test to resolve (§6).

### 4.4 Breed pools are derived from the breed's own standard, never hand-written

For these five loci the founding pool is **computed from `breeds.ideal_vector` and the quality
band**, not stored in `breeds.founding_allele_pool`:

```
target rung        gets  conformation_band_concentration        (0.35 / 0.55 / 0.75 by band)
one rung away      gets  0.45 × the remainder, split both ways
two rungs away     gets  0.18 × the remainder
three rungs away   gets  0.06 × the remainder
beyond that        gets  nothing
                   then renormalise, truncating at the ends of the ladder
```

This is deliberately a **rule rather than 40 hand-written pools**, for one reason worth stating
plainly: a hand-written pool can drift from the breed's own standard, and that drift is exactly the
defect this document exists to fix. Retune a breed target and its pool follows automatically, in the
same migration, with no way to forget.

It is a knowing exception to `pool.ts`'s "a pool must list every locus" rule, and `parseAllelePool`
must exempt these five explicitly rather than by omission, so a missing colour locus still throws.

### 4.5 The quality band finally means what its name says

The band is now the **concentration** of the pool around the breed's target — one number, one
meaning, and monotonic for every breed automatically because it is defined relative to the breed
rather than against a fixed scale.

Traits reading Outstanding, of five, on a freshly minted horse:

| Breed | today: low / mid / high | proposed: low / mid / high |
|---|---|---|
| Quarter Horse | 1.43 / 1.42 / **1.31** ← falls | 2.52 / 2.94 / 3.57 |
| Arabian | 0.96 / 0.97 / 1.02 | 2.58 / 3.00 / 3.66 |
| Thoroughbred | 1.23 / 1.49 / 1.52 | 2.55 / 2.96 / 3.59 |
| German Warmblood | 1.06 / 1.32 / 1.48 | 2.54 / 2.98 / 3.59 |
| Friesian | 0.95 / 1.12 / 1.32 | 2.55 / 2.95 / 3.60 |
| Paso Fino | 1.20 / 1.35 / 1.45 | 2.52 / 2.96 / 3.58 |
| Icelandic | 1.69 / 1.47 / **1.14** ← falls | 2.51 / 2.94 / 3.59 |
| Nokota | 1.48 / 1.49 / **1.37** ← falls | 2.52 / 2.95 / 3.58 |

Three breeds get **worse** at a higher band today. All eight rise under the proposal, and all eight
rise by nearly the same amount — so `/admin/npc`'s band picker means one thing regardless of which
breed is in the box, which it has never done.

### 4.6 Breed targets move onto the ladder

Every target in `breeds.ideal_vector` is re-seeded to its nearest rung. **No target moves more than
4 points**, which is inside the tolerance `docs/breed-ideal-vectors.md` §4 already claims for itself
("a starting point to be tuned by observation"). Without this there is a permanent snap-to-grid
error nobody can ever breed away, and it is expensive:

| a genetically perfect Paso Fino reads Outstanding on | of 5 |
|---|---|
| today | 3.15 |
| proposed, targets left off the ladder | 4.36 |
| proposed, targets on the ladder | **4.97** |

`docs/breed-ideal-vectors.md` §5's rule — keep targets off 50 — still applies and is unaffected; 50
is a rung, and no breed's snapped target lands on it except the German Warmblood's head, which is
already at 50 today.

---

## 5. What it buys, measured

### 5.1 Type

| | mean \|expressed − target\| | share with a "wrong breed" trait |
|---|---|---|
| today, all eight breeds | 12.2 – 20.8 | 44% – 94% |
| proposed, all eight breeds | **5.3 – 5.5** | **0.1% – 0.2%** |

The Arabian head:

| | dished | straight | Roman | range seen |
|---|---|---|---|---|
| today | 21.7% | 51.9% | 26.5% | 1–98 |
| proposed | **98.2%** | 1.8% | **0.0%** | **1–37** |

A Roman-nosed Arabian is not rare under the proposal. It is impossible.

### 5.2 Breeding true

Two Quarter Horses, each Outstanding on all five traits, bred together:

| Foal, per trait | Outstanding | Good | Acceptable | Weak/Poor | **all five traits** |
|---|---|---|---|---|---|
| today | 37.6% | 36.0% | 22.0% | 4.4% | **0.9%** |
| proposed | **85.1%** | 14.4% | 0.5% | 0.0% | **44.9%** |

One foal in a hundred and eleven becomes nearly one in two. The spread of a single foal around its
parents falls from an **SD of 10.6 points to 3.6**.

### 5.3 Telling a good pairing from a bad one

This is the one the operator asked for, and it is the reason the type gene must be *testable* rather
than merely present. Arabian head, four pairings. **In rows 2, 3 and 4 every parent expresses the
same value** — one rung long — so a child looking at those six horses cannot tell them apart:

| pairing | Outstanding | Good | Acceptable | worse | **foal breeds on** |
|---|---|---|---|---|---|
| both parents test correct (8/8 × 8/8) | 96.5% | 3.5% | 0.0% | 0.0% | **100.0%** |
| both look one step long, homozygous | 16.8% | 79.0% | 4.2% | 0.0% | **0.0%** |
| both look one step long, split | 33.0% | 42.3% | 24.5% | 0.2% | **25.0%** |
| one of each | 36.3% | 42.8% | 20.9% | 0.0% | **0.0%** |

*"Breeds on"* is the foal carrying two correct alleles, so it passes the right head to every foal it
ever has. **That column, not the label column, is what a breeding programme accumulates** — and note
row 4, which has the *highest* Outstanding rate of the three and produces nothing that breeds on.

Row 2 still throws an Outstanding-looking foal 17% of the time on luck alone. That is the false
signal the operator described, and under the proposal a child does not have to see through it by
raising foals: **the pairing is testable before the covering, so the breeding preview states these
rows exactly**, rather than leaving them to be discovered over a mare's whole career.

### 5.4 Headroom left to breed for

The thing `quality-band-on-target.md` §8 was rightly anxious about.

| | traits on target, of 5 |
|---|---|
| founding stock at `low` | 2.5 |
| founding stock at `mid` | 2.9 |
| founding stock at `high` | 3.6 |
| **ceiling, a perfect horse** | **5.0** |

Minting founding stock at `low` leaves **2.5 traits of journey** — more than today's real 2.1, and
far more than the 1.4 that document warned about. The recommendation is `low`, for the same reason
it gave and one more: the journey is now *legible*, so 2.5 traits of it is 2.5 traits of decisions
rather than 2.5 traits of waiting.

---

## 6. What a child actually does

Nothing on the horse page changes shape. The meter still reads `18`, still says *dished*, and the
Conformation card still says **Outstanding**. The long/short and dished/Roman range the operator
likes is untouched — it is still an absolute measurement, which is why an Arabian's "long" back is
still visibly shorter than a Nokota's "short" one. Three things are added.

**One line under the meter, naming the standard.** *"Now 18, will mature to 12 — a little long for
an Arabian (standard 10)."* Today the card says *dished* and leaves the child to remember what an
Arabian is supposed to be.

**A conformation test, alongside the colour and health panels that already exist.** It returns the
two numbers:

> **Head profile.** This horse carries a **10** and an **18**. The Arabian standard is **10**.

**A real foal forecast on the breeding preview**, replacing `foalPrediction.ts`'s honest-but-wide
range with an exact one, because a Punnett square over two known alleles is exact:

> **Head profile.** Star carries 10 and 18. Comet carries 10 and 10.
> Every foal gets a 10 from Comet. Half get a 10 from Star as well — those foals are **exactly
> right, and will pass it on**. The other half get an 18, and will be a little long.

That is the whole game, and it is arithmetic a nine-year-old can do: *take one number from each
parent and average them.* No calculus, no reading twenty anonymous alleles through a fog of noise,
and no needing eight foals to find out what a pairing does.

---

## 7. Things that must land with it, and one that must not

**Must land:**

1. **`conformation_noise_sd` 6 → 2.** Without it the ceiling stays at 4.4 of 5 traits and half the
   gain in §5.2 never appears. Snapshotted at birth, so it reaches new horses only.
2. **Breed targets onto the ladder** (§4.6), or the ceiling is permanently 4.36 of 5.
3. **Slice 0019's conformation specialist is reframed, not deleted.** Its promise — every founding
   horse is genuinely good at one thing — is worth keeping and is now expressible far better: **one
   trait's type locus is set homozygous at the breed's target rung**, so the horse is not merely good
   at it but *breeds on* for it. That is a better gift than the current ±1-allele version and it
   costs nothing extra. The ability specialist is untouched.
4. **`import_offers` needs the band snapshotted** the same way `polygenic_one_chance` is today
   (CLAUDE.md §5.5), so a pending founding offer generates under the rules it was minted with.

**Must not land, and this is a genuine trap:** *do not* re-anchor `realization()` from 50 onto the
breed target. It is the obvious next thought and it is wrong twice over. Inbreeding depression is a
multiplier on realization, so anchoring on the target would make **an inbred horse score better**,
undoing the health slice's central dilemma; and anchoring on 50 is what makes a young horse of an
extreme breed read closer to the population mean and mature into its type, which is both correct
biologically and the existing "you cannot fully judge a foal" mechanic. Leave `realization()`,
`anchorFor()` and `inbreeding_depression_factor` exactly as they are — this proposal touches none of
them. One consequence to expect and watch: with genotypes now tightly on target, realization's pull
toward 50 becomes the *largest* remaining deviation for young and inbred horses of distinctive
breeds. Class ordering is unaffected (the pull is monotone within a class), only absolute scores.

---

## 8. Build order

Each step is small; the order matters because the later ones read the earlier ones.

1. `Locus.alleles` → `readonly string[]`; five conformation loci appended to `LOCI`. Guard
   `injection.ts`'s biallelic assumption (conformation loci are not injectable — the consignment
   allowlist is colour/gait only, so this is a comment plus an assertion, not logic).
2. `src/engines/conformation/typeGene.ts` — a new pure module: the ladder, `typeValueFor(pair)`,
   `poolForTarget(targetRung, concentration)`. Everything else imports it; nothing restates it.
3. `geneticValue()` in `src/engines/conformation/model.ts` — reads the type locus plus the demoted
   modifier. This is the one function that changes the meaning of a horse's number, and every screen
   already goes through it.
4. `generateCandidate()` — draw the five type pairs from the derived pool; reframe the conformation
   specialist per §7.3. The polygenic loop is untouched, still drawing its twenty per trait, so every
   existing RNG stream stays where it is.
5. `parseAllelePool()` — exempt the five, explicitly.
6. Migrations (§9).
7. Testing: a conformation panel on `/horses/:id/test`, reusing `horse_knowledge.subject_code =
   'locus:NL'` exactly as colour does. Its own `<details>` group per slice 0021 Part F.
8. `inferFromPhenotype` — a horse's own expressed value narrows its pair to a couple of
   possibilities; the test resolves which. This is the "worth paying for" ambiguity and it needs to
   read as one sentence, not a table.
9. `foalPrediction.ts` — **replaced by something shorter**. The Poisson-binomial convolution goes;
   a 2×2 Punnett over known alleles crossed with the small modifier distribution is exact and far
   easier to phrase. It must read **Unknown** for an untested parent, exactly as it does today for an
   unlabelled one — a forecast built from genes the player has not paid for is cheating dressed as
   helpfulness (slice 0025's rule, unchanged).
10. `src/render/admin.ts` — both band pickers say `"{band} ({n}% chance per allele)"`, which becomes
    untrue. They should read `"{band} — about {n} of 5 traits right for the breed"`.
11. Everything that mints a horse (`src/db/founding.ts`, `npc.ts`, `consignment.ts`) passes the
    breed's ideal vector, which most already do for the specialist. `consignment.ts`'s hardcoded
    `cfg.quality_bands.mid ?? 0.5` becomes a real `consignment_quality_band` key — that hardcode is
    its own small defect and `quality-band-on-target.md` §7 was right to name it.

**The admin create-horse form** (`src/render/horses.ts`, the twenty-six-fieldset list) needs a select
rather than radios for a 13-allele locus. It stays a neutral control (slice 0005 §6.6): a
hand-created horse defaults to the middle rung on all five, not to a breed's target.

---

## 9. Migrations

Next free is `0176`.

- **0176** — `breeds.ideal_vector` targets snapped to the ladder, all eight breeds, five traits.
- **0177** — `quality_bands` reshaped to carry two numbers per band: `conformation_concentration`
  (0.35 / 0.55 / 0.75) and `ability_one_chance` (0.42 / 0.50 / 0.58, **today's values, unchanged** —
  this fix must not move ability at all, which is what makes it verifiable). Same reasoning as
  `quality-band-on-target.md` §5, same shape, different second number.
- **0178** — `conformation_modifier_step` 0.75, `conformation_noise_sd` 6 → 2,
  `conformation_test_cost`.
- **0179** — `founding_quality_band` → `low`, new `consignment_quality_band` → `low`.
- **0180** — `import_offers.conformation_concentration`, snapshot column.

Each registered in `src/db/migrations.ts` (CLAUDE.md §8).

---

## 10. Tests

1. Every breed's snapped target sits **exactly on a rung** — read off the migration on disk, not
   hand-copied, the way `test/showing/breed-aptitude.test.ts` already does.
2. A generated horse of every breed is within 3 rungs of its own target on every conformation trait,
   at every band. This is the test that would have caught the original defect.
3. The band is **monotonic per breed and per trait** — asserted per trait, not on the average, since
   averaging is exactly what hid the original bug.
4. `typeValueFor` on two identical alleles returns that allele's value exactly; on two alleles it
   returns their mean.
5. Two homozygous-identical parents produce a foal with the identical type pair, every time, over
   many seeds.
6. The same seed produces the **same ability traits, the same age, the same colour and disease
   genotype** before and after. This is the regression that proves the polygenic loop's stream
   discipline held.
7. Ability traits are unaffected by `conformation_concentration` at any value.
8. A breed with no `ideal_vector` still generates (middle rung), and is not judged.
9. `foalPrediction` reads Unknown when either parent's type genes are untested by this viewer.
10. A pending `import_offers` row minted before the migration generates against the old behaviour.

---

## 11. The cost, stated plainly

- **This needs a world reset.** Every living horse has no type-locus genotype, and the missing-locus
  rule would read them all as the middle rung — every horse in the game identical and off-type. A
  backfill that derives each horse's pair from its current expressed value was considered and does
  not work: today's values are centred on 50, not on breed targets, so every Arabian would be
  permanently Poor-headed and every Friesian Poor-necked. Reset is the honest answer, and the
  operator has offered one. **Grant the new founding batches after the migrations land, not before.**
- **`docs/fixes/quality-band-on-target.md` is superseded.** Its §1–§3 diagnosis is preserved above
  and its live-population measurements (§3.1) remain the best evidence in the repository. Its §4–§12
  should not be built. Mark it superseded rather than deleting it; §3.2's warning about how to
  explain this to the children is still the right warning.
- **Scores compress upward.** A field of on-type horses is a closer field, so `show_noise_sd` (5)
  decides a larger share of classes. That is the dial to reach for if it grates, not this one — but
  it now has more work to do, and the show barn's rank plan (§4.5's monotone bands) is what finally
  makes a Champion field genuinely harder than a Novice one.
- **It is a real slice of work**, not a patch: eleven steps in §8, five migrations, a new testable
  gene family. It deletes more than it adds in two places, though — `foalPrediction.ts` gets
  substantially shorter, and the whole of `quality-band-on-target.md` stops being needed.

---

## 12. What needs the operator before anyone builds

Per CLAUDE.md §2, these are genuinely undecided and the build should stop for them.

1. **Is the conformation test one purchase per locus, or one panel for the whole horse?** Five
   separate purchases per horse is a real money sink and lets a child test only the trait they care
   about; one panel is kinder and much simpler to explain. Price matters either way — this is the
   test a child will want on *every* horse they consider buying or breeding to.
2. **Should the type genes be free once a horse has shown**, the way conformation *words* already
   are (slice 0022 Part B)? It would make the whole mechanic reachable without money, at the cost of
   the sink in (1). A middle option: the horse's own genes free after a start, another stable's genes
   only by testing.
3. **Founding band `low` (2.5 traits right) or `mid` (2.9)?** §5.4 recommends `low`. This is the
   headroom decision and it is the number to revisit first if breeding starts to feel pointless.
4. **Rung step 8, giving 13 alleles?** A step of 10 would give 11 alleles and a cleaner "one step =
   one band" story, at the cost of a coarser ladder and slightly larger target snapping. 8 is
   recommended and everything above is measured at 8.
5. **Confirm the reset**, and confirm that new founding grants go out afterwards rather than before.
