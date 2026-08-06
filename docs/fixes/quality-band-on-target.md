# Fix: the quality band never looks at the breed

> **SUPERSEDED, 2026-08-06, by `docs/fixes/conformation-breed-type.md`. Do not build §4 onward.**
>
> The operator read this document and reported that the defect goes deeper than the generator: an
> Arabian whose head standard is 8 can be minted at 90, so the *scale itself* is breed-blind, not
> just the band that draws on it. That document changes the thing this one patches around, and would
> make every line of §4–§12 below dead code the day it landed.
>
> **§1–§3 are not superseded.** The diagnosis is correct, and §3.1's measurements against the live
> 2026-08-06 population are still the best evidence in the repository — the successor quotes them.
> §3.2's warning about how to explain this to the children is still the right warning.

Operator-reported, 2026-08-06, on reading `docs/analysis/training-effect.mjs` scenario 6:

> *"mid was supposed to mean that a horse was on target for a conformation trait 50% of the time."*

It does not, and as written it cannot. This is a real defect, not a tuning complaint, and it has
been in the game since slice 0005.

Measured throughout by `docs/analysis/training-effect.mjs` (scenarios 6, 7 and 8) — re-run it after
any change here.

---

## 1. What is actually happening

`generateCandidate` (`src/engines/founding/generate.ts`) draws every polygenic trait from a single
number, `polygenicOneChance` — the chance that any one allele is a `'1'`. Slice 0005 §4 defined it
that way, and it is applied identically to all eight traits.

**It never reads the breed's `ideal_vector`.** There is no line in the generator that knows what
shape a Paso Fino is supposed to be.

That is fine for the ability traits — speed, stamina and the rest are `higher_better` with no target
at all, so more alleles genuinely is better and the band works exactly as intended. It is wrong for
the five conformation traits, which slice 0006 §2.2 corrected into **bidirectional measurements
against an intermediate target**. For those, more alleles is not better; more alleles is *longer*,
and a breed that wants a short back is made worse by every one of them.

---

## 2. The Paso Fino, trait by trait

Each trait rides on 20 alleles and measures the allele count × 5, so a breed standard is really a
statement about how many alleles a horse needs.

| Trait | Breed wants | Needs, of 20 alleles | Counts as right (±1) |
|---|---|---|---|
| Neck length | 68 | **14** | 13–15 |
| Shoulder angle | 60 | 12 | 11–13 |
| Back length | 30 | **6** | 5–7 |
| Hock set | 45 | 9 | 8–10 |
| Head profile | 62 | 12 | 11–13 |

A Paso Fino wants a high-set neck (14 alleles) **and** a short back (6 alleles). One dial cannot
deliver both. Here is what each band actually gives, computed exactly from the binomial:

| Trait | Needs | `low` (0.42) | `mid` (0.50) | `high` (0.58) |
|---|---|---|---|---|
| Neck length | 14 | 3% | 13% | **31%** |
| Shoulder angle | 12 | 16% | 35% | 50% |
| Back length | 6 | **31%** | 13% | 3% |
| Hock set | 9 | 48% | 46% | 27% |
| Head profile | 12 | 16% | 35% | 50% |
| **Average** | | **23%** | **28%** | **32%** |

**The neck row and the back row move in opposite directions.** Turning the dial up to get the neck
right (13% → 31%) destroys the back (13% → 3%), and turning it down does the reverse. `mid` averages
28%, not 50%, and no value of the dial would ever reach 50% for this breed.

**So a "mid band" Paso Fino is not a Paso Fino:**

| Trait | Breed wants | Horse measures |
|---|---|---|
| Neck length | 68 | 54 |
| Shoulder angle | 60 | 52 |
| Back length | 30 | **46** |
| Hock set | 45 | 49 |
| Head profile | 62 | 52 |

It measures about 50 on everything, because that is the only thing the dial can do. The back is 16
points too long and the neck 14 too low. **The breed exists in the judging and nowhere in the
breeding.**

---

## 3. What this has cost, across all eight breeds

Chance a conformation trait lands on target, by band (scenario 7):

| Breed | `low` | `mid` | `high` | Intended at `mid` |
|---|---|---|---|---|
| Quarter Horse | 31.3% | 30.8% | 26.9% | 50% |
| Arabian | 15.2% | 16.1% | 18.5% | 50% |
| Thoroughbred | 22.9% | 34.0% | 35.9% | 50% |
| German Warmblood | 19.7% | 29.9% | 33.8% | 50% |
| Friesian | 14.5% | 19.6% | 27.4% | 50% |
| Paso Fino | 22.9% | 28.3% | 32.2% | 50% |
| Icelandic | **42.6%** | 32.5% | 19.2% | 50% |
| Fjord | 33.0% | 32.5% | 28.8% | 50% |

### 3.1 Confirmed against the live population, 2026-08-06

The operator exported every horse in the game (101 generated horses across 15 stables, plus 6
home-bred foals) after the Part G reset. It matches, and it is better evidence than the simulation.

**The band's effect on a horse's score, measured directly.** The band raises a horse's allele count
and does nothing else, so correlating allele count against the judge's score tests it without having
to guess anything:

| Breed | n | Weighted-avg target | Correlation of alleles with score |
|---|---|---|---|
| Quarter Horse | 28 | 50.1 | **−0.30** |
| Paso Fino | 44 | 52.0 | −0.07 |
| German Warmblood | 29 | 64.6 | **+0.77** |

Exactly what §1 predicts from each breed's weighted-average target: for the Quarter Horse a higher
band produces a **worse** horse, for the Paso Fino it does nothing, and only for the German
Warmblood — whose standard genuinely wants a big horse — does it help. **One dial, three different
meanings, none of them the one on the label.**

**Unselected horses land where predicted.** NPC breeding stables average 2.15 traits right and the
consignment yard 2.21, against the predicted 2.1–2.2. The show barn reads higher (2.42) only because
four of every ten of its horses are minted at `high`, which for two of the three breeds in play is
not an improvement.

**Slice 0019's specialist is working perfectly: 0 of 101 horses have zero traits right.** That is the
guarantee doing exactly its job, and it is the reason `low` at 2.9 traits right is still a decent
horse rather than a bad one.

### 3.2 This does NOT mean the children's horses are bad — read this before repeating §2 to anyone

The operator drew exactly the wrong conclusion from §2, and reasonably: *"I have multiple horses with
several Outstanding traits. I'm confused how that is if you're saying we got worse horses than we
should have."* The horses are fine. The numbers in §2 and §3 describe **what the band contributes**,
not what a player's barn looks like.

**"Outstanding" on the Conformation card and "on target" in this document are the same bar.**
Outstanding is `traitScore >= 90` (migration 0135) against a falloff of 2.0 — that is *within 5 of the
breed target*. One allele is worth 5. The only difference is the step at which they are read: this
document measures the genotype, the card measures the expressed value after birth noise. Same test,
one step apart.

**Measured on the operator's own sixteen Paso Finos**, they read **2.58 of 5 on target by genotype**
and **1.89 Outstanding on screen** (birth noise scatters a few off — a narrow window is easier to fall
out of than into). One mare, PW Sweet Escape, shows 4 of 5 Outstanding.

**2.58 of 5 is 52% — essentially exactly the 50% the band was supposed to deliver.** Three things get
a player horse there, and the band is the smallest of them:

| Source | Traits on target |
|---|---|
| Slice 0019's guaranteed conformation specialist | 1.00 |
| The quality band | ~1.1 |
| The player's own choosing (keep 2 of 4 mares, 1 of 2 stallions) | ~0.5 |
| **Total** | **~2.6** |

The band contributes about 1.1 and would contribute roughly that much at *any* setting — that is the
whole defect, stated as a number. **Two accidents are carrying the intent**: a gift slice 0019 gave
every founding horse, and the fact that a player gets to pick.

**So the damage is in the NPC field, not the player barn.** An NPC horse gets the specialist and no
choice: 2.15 of 5. And the show barn's champions get nothing at all from being minted at `high` —
for the Quarter Horse it hurts them. That is the part a child actually feels, because moving up to
Champion does not put them against better horses.

Three consequences worth naming separately:

- **No cell is near its band**, and the worst-served breeds are the ones with the most distinctive
  standards — Arabian at 16% (a dished head at 8 and a long neck at 75 pull the same dial opposite
  ways), Friesian at 20%.
- **The bands are not even monotonic in one direction.** For the Quarter Horse, Icelandic and Fjord,
  a *higher* band produces a *worse* horse. For the other five it is the other way up. An operator
  picking `high` at `/admin/npc` gets a better horse or a worse one depending on the breed, and
  nothing on the screen says which.
- **The show barn's ladder is inverted.** Its plan (`npc_show_barn_rank_plan`, migration 0173) mints
  novice and open at `mid` and champion at `high`. For a Paso Fino that is 2.1 traits right at
  novice and 2.3 at champion — both scoring 72. **The champion field the children have been
  competing against is not better than the novice field.** For a Quarter Horse it is actively worse
  (2.2 → 2.1). The live export (§3.1) agrees: splitting the show barn's Quarter Horses by allele
  count puts the four likeliest champions at a mean score of 68.8 against the other six's 81.8. Treat
  that gap as directional only — four horses is far too few to trust the size of it, and which four
  are actually champions is inferred rather than known. The **−0.30 correlation above is the reliable
  measurement**; this is the same finding seen from the angle a child would experience it.

---

## 4. The fix

**A conformation trait's band is the chance that trait lands on its own breed's target.** Each of
the five is decided independently, against its own number, exactly as the operator described it.

In `generateCandidate`, after the existing polygenic loop and **before** the slice 0019 specialist
overwrite:

```
for each conformation trait t with an entry in the breed's ideal_vector:
    rng = makeRng(deriveSeed(seed, `band_on_target_${t}`))
    if rng.next() < conformationOnTargetChance:
        potential = clampPotential(round(ideal[t].target / 5) + pick(SPECIALIST_OFFSETS))
        polygenic[t] = specialistBits(rng, potential)
```

Three things about that shape are load-bearing:

- **It reuses `specialistBits`, `SPECIALIST_OFFSETS` and `clampPotential` unchanged.** "On target"
  already had a definition in this file — slice 0019's, within ±1 allele — and this must not invent
  a second one.
- **It overwrites rather than resamples**, and it takes a **per-trait sub-seed** off a
  never-before-used label. The existing loop still draws exactly 20 values per trait no matter what
  happens here, and `founding_age` and both specialist streams still sit where they always did.
  This is slice 0019 §7's rule and it is the reason this can land without changing what any existing
  seed produces up to that point.
- **A trait that does not land on target keeps the flat draw the loop already made**, at
  `ability_one_chance` — i.e. an unselected trait, near 50. It is not redrawn at the band. "On
  target half the time" says nothing about what the other half should be, and an ordinary horse is
  the honest answer.

**Ability traits are not touched.** The loop keeps drawing them at an allele frequency, and
`breeds.ability_bias` keeps offsetting it. Nothing in §1's argument applies to a trait with no
target.

---

## 5. This forces two numbers per band, not one

`quality_bands` is `{"low":0.42,"mid":0.50,"high":0.58}` — one number per band, and that number is
currently doing **both** jobs: the conformation draw and the ability draw.

It cannot keep doing both, because the two now want different values. Setting the band to 0.25/0.75
as an on-target chance would, if ability kept reading the same field, blow the ability spread from
today's 0.42–0.58 out to 0.25–0.75 — and make `breeds.ability_bias` (±0.05, clamped by
`ABILITY_BIAS_CHANCE_MIN/MAX`) meaningless against it. Nobody asked for that and it would quietly
undo slice 0024's breed identity work.

**So `quality_bands` widens from a number to an object**, the same shape `feed_levels` and
`market_rank_factors` already use:

```json
{
  "v": 1,
  "bands": {
    "low":  { "conformation_on_target_chance": 0.25, "ability_one_chance": 0.42 },
    "mid":  { "conformation_on_target_chance": 0.50, "ability_one_chance": 0.50 },
    "high": { "conformation_on_target_chance": 0.75, "ability_one_chance": 0.58 }
  }
}
```

**The ability numbers are today's values, unchanged.** This fix must not move ability at all — that
is what makes it verifiable.

---

## 6. Slice 0019's guaranteed specialist stays

Operator's decision, 2026-08-06. It runs last and always wins, so every founding horse still arrives
genuinely good at one named conformation trait.

The two are different promises and both are wanted: the band is *a chance per trait*, the specialist
is *a guarantee of at least one*. Keeping it is why a `low`-band horse averages 2.9 traits right
rather than the 1.9 the chance alone would give.

---

## 7. Where new horses mint — every band choice needs re-picking

The number means something new, so every place that picked a band picked it under the old meaning.
Measured for the Paso Fino (scenario 8; the other breeds land within a point):

| | Traits right | Score |
|---|---|---|
| Today, any band | 2.1–2.3 | 72 |
| Fixed, `low` | 2.9 | 76 |
| Fixed, `mid` | 3.6 | 80 |
| Fixed, `high` | 4.3 | 85 |
| Perfectly bred | 5.0 | 89 |

| Call site | Today | Becomes | Why |
|---|---|---|---|
| `founding_quality_band` | `mid` | **`low`** | Still a real gain on today's 2.1, but leaves 2.1 traits to breed for rather than 1.4 — see §8 |
| Consignment dealer | `mid`, **hardcoded** | **`low`**, via a new `consignment_quality_band` key | The hardcode (`src/db/consignment.ts`, `cfg.quality_bands.mid ?? 0.5`) is its own small defect; fix it here rather than leaving one band name in code |
| `npc_show_barn_rank_plan` | novice/open `mid`, champion `high` | **unchanged** | The plan was always right; the numbers behind it were not. Champions become 4.3 traits right against a player's 2.9, so the ladder finally points up |
| `/admin/horses` create form | flat 50/50, no band | **unchanged** | A neutral control on purpose (slice 0005 §6.6) |

---

## 7.1 Two things the live export found that no simulation would have

Both come from the 2026-08-06 population dump (§3.1) and neither was predicted.

**Players hold better horses than the generator makes, because they choose.** Player stables average
**2.63** traits right against NPC breeding stables' 2.15 — while carrying an *identical* allele count
(50.6 vs 50.4). It is not a better band; it is that a founding grant shows four mares and keeps two,
two stallions and keeps one (`founding_mare_candidates`/`_claims`, migration 0025). Selection is
worth about half a trait.

Every measurement in `docs/slices/0027-training.md` §10.1 modelled the generator's raw output and so
**understated a player horse's standing against the NPC-bred field**. It did not model the show barn,
which is the field that actually matters, so the training numbers stand — but a future session
measuring anything about player-versus-NPC quality must model the claim step or it will be wrong in
the player's favour by roughly this much.

**Home-bred foals start behind the founding stock.** The six foals born in-game average **1.83**
traits right against their founding parents' 2.32. This is expected rather than broken — slice 0019's
specialist is a gift to *generated* horses, and a foal inherits genes, not the guarantee — but it
means a child's first home-bred crop is measurably worse than the horses they were given, which is
the opposite of the feeling the game wants. Six foals is far too few to conclude anything; **watch
this number as the population grows.**

**It also bears directly on §7's band choice.** Raising founding stock widens this gap: mint at `mid`
(3.6 traits right) and the first foals look worse still by comparison. Minting at `low` (2.9) keeps
the gap close to today's. That is a second, independent reason for the same decision.

---

## 8. The cost, stated plainly

Fixing this makes every new horse better, and the ceiling does not move — a perfectly bred horse
still scores 89. So the room left for breeding shrinks.

Today a child starts at **2.1 traits right** and breeds toward 5: about 2.9 traits of progress to
chase, which is years of it. At `mid` they would start at 3.6 and have **1.4** left. Minting founding
stock at `low` keeps 2.1 of that journey intact while still handing them a better horse than they get
now. That is the whole reason for the band change in §7, and it is the number to revisit first if
breeding starts to feel pointless.

**The same numbers as a player actually experiences them** — that is, after the specialist and after
choosing 2 of 4 (§3.2), which is the version to quote to the operator:

| | A player's own horses |
|---|---|
| Today | ~2.6 of 5 |
| Fixed, minting at `low` | ~3.3 of 5 |
| Fixed, minting at `mid` | ~4.1 of 5 |
| Ceiling | 5 of 5 |

`mid` would put a brand-new founding horse within one trait of perfect on the day it arrives. **`low`
is a real step up from today without eating the journey**, and this is the clearest single argument
for it.

Two smaller effects, both measured and both accepted:

- A founding-grade horse beats a perfectly bred one **16.6%** of the time at `low`, against 9.5%
  today. Higher, but breeding still plainly wins.
- Scores compress upward, so show noise (SD 5) decides a larger share of close classes. If that
  starts to grate, `show_noise_sd` is the dial, not this one.

---

## 9. Existing horses, and how to land this

**Nothing about a living horse changes.** A genotype is written once at birth and never recomputed,
so this reaches horses generated after it deploys and no others.

**The world reset is spent.** An earlier draft of this section proposed landing alongside slice 0021
Part G's reset so that one reset covered both; the operator ran that reset on 2026-08-06 and the
children already have their new horses. That option is gone, and this must now be planned as a change
landing into a live population.

**The good news is that the gap is small.** A Paso Fino minted today sits at 2.1 traits right,
scoring 72; one minted at the `low` band after the fix sits at 2.9, scoring 76. **Four points, against
a show-noise SD of 5** — so an existing horse is less than one bad day from the judge behind a new
one, not obsolete. This is emphatically not the situation where a child's whole barn becomes junk, and
it should not be presented to them as one.

Three ways to land it. **The third is recommended.**

1. **Run a second reset.** Cleanest population, and the children have held their current horses for
   only a day or two, so it is the cheapest moment there will ever be. But it throws away a grant they
   have just been excited about, and a second reset inside a week teaches that nothing is permanent —
   which is the opposite of what a breeding game is for.
2. **Land it and say nothing.** The mix persists for generations, because the children's own foals
   inherit from the horses they already have. Not recommended, but survivable given the four-point
   gap.
3. **Land it, then grant every child a fresh founding batch.** No reset, nothing lost. The batch
   mechanism already exists and an operator can grant one from `/admin`, so this needs no new code.
   Each child keeps the horses they have and gets new ones drawn under the corrected rules, and the
   better stock spreads through their own breeding from there — which is the game working, not a
   patch on it.

`import_offers.polygenic_one_chance` is a snapshot column (`mintOffer`, CLAUDE.md §5.5), so a pending
founding offer keeps the number it was minted with. It needs a sibling,
`import_offers.conformation_on_target_chance`, or an offer granted before the fix will be generated
against a field that no longer means what it did. **For option 3 this matters directly: grant the new
batches *after* the migration lands, not before, or they will be generated under the old rules.**

`import_offers.polygenic_one_chance` is a snapshot column (`mintOffer`, CLAUDE.md §5.5), so a pending
founding offer keeps the number it was minted with. It needs a sibling,
`import_offers.conformation_on_target_chance`, or an offer granted before the fix will be generated
against a field that no longer means what it did.

---

## 10. Migrations

Next free is `0176`. Slice 0027's proposed numbers shift up accordingly — migration numbers are
claimed at build time (overview §13).

- **0176** — `quality_bands` reshaped to §5's object. `json_set` on the existing key.
- **0177** — `import_offers.conformation_on_target_chance`, plain `ALTER TABLE ADD COLUMN`,
  defaulting to the value that reproduces today's behaviour for any pending offer.
- **0178** — `founding_quality_band` → `low`, and a new `consignment_quality_band` → `low`.

Each also needs registering in `src/db/migrations.ts` (CLAUDE.md §8).

Code: `src/lib/config-cache.ts` (the type), `src/engines/founding/generate.ts` (§4),
`src/db/founding.ts` / `src/db/npc.ts` / `src/db/consignment.ts` (pass the new number; drop the
hardcoded `mid`), and `src/render/admin.ts` — **both band pickers currently label themselves
`"{band} ({n}% chance per allele)"`, which becomes flatly untrue.** They should read
`"{band} — about {n} of 5 traits right for the breed"`.

---

## 11. Tests

1. `generateCandidate` at `conformation_on_target_chance: 1.0` puts **every** conformation trait
   within ±1 allele of its breed's target; at `0.0`, only the slice 0019 specialist is on target.
2. Over many seeds at `0.50`, each conformation trait independently lands on target about half the
   time — asserted per trait, not on the average, since averaging is exactly what hid this bug.
3. The same seed produces the **same ability traits, the same age and the same Mendelian genotype**
   before and after the change. This is the regression that proves §4's stream discipline held.
4. Ability traits are unaffected by `conformation_on_target_chance` at any value.
5. A breed with no `ideal_vector` generates exactly as it does today (no target to aim at).
6. Read the seeded bands off the migration on disk and assert `low < mid < high` in on-target chance
   for **every breed**, the way `test/showing/breed-aptitude.test.ts` already reads its seeds rather
   than hand-copying them. This is the test that would have caught the original defect.
7. A pending `import_offers` row minted before the migration still generates its candidates against
   the old behaviour.

---

## 12. Numbers

`conformation_on_target_chance` — **0.25 / 0.50 / 0.75** (operator's choice, 2026-08-06).
`ability_one_chance` — 0.42 / 0.50 / 0.58, today's values, deliberately unchanged.
`founding_quality_band` — `mid` → `low`. `consignment_quality_band` — new, `low`.

The on-target tolerance stays `SPECIALIST_OFFSETS` (±1 allele). It is not a config key and should not
become one without a reason — it is the game's single definition of "right for the breed", shared
with slice 0019, and two definitions would drift.
