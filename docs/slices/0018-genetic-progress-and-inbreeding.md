# Slice 0018 — Genetic progress: making selective breeding actually get somewhere

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts this slice
depends on are quoted or summarised below.**

This is a spec, not a build log. **Nothing in this document has landed**, and several of its numbers
are open questions the operator has to settle before anyone builds them — see §10. `CLAUDE.md` §10's
table should carry a "specified, not built" row pointing here, the same way slice 0004's does.

Where this comes from:

- **A question the operator asked on 2026-08-03**: *"help me design a way to actually breed better
  horses more reliably in less than 50 generations — we are dealing with a very small static
  population here, and penalizing inbreeding heavily."*
- `docs/horse-game-overview.md` **§10a** — "Gene pool collapse. The more serious one. Every horse
  descends from founding stock within a handful of generations. COI climbs, defects surface,
  quantitative traits stop improving, and the game quietly stalls. At one game month per real day,
  the shelf life of a closed five-player pool is measured in real months." This slice is that
  section coming due.
- `docs/horse-game-overview.md` **§2d** — "Let COI raise defect probability and depress quantitative
  trait expression. Without this, optimal play is to mate the two highest-scoring animals repeatedly
  and the game has no strategy." §4 of this slice argues the *first* half of that sentence is
  carrying almost none of the weight today and should carry most of it.
- `docs/horse-game-overview.md` **§11** — stud services, "strongly recommended", still unbuilt.
- `docs/horse-game-overview.md` **§12.3** — imports as the genetic-diversity valve.
- `docs/slices/0017-market.md` **§13** — the stud-services spec, already written, still unbuilt.
- `docs/slices/0014-before-the-children-play.md` **§6** — the three robustness traits, built as
  substrate in 2026-08-03 with *nothing reading them*, explicitly so that a later slice could give
  them a job without needing every living horse to be reborn. This is that later slice.

---

## 1. The problem, measured

`docs/analysis/population-sim.mjs` (added by this slice's own investigation — run it with
`node docs/analysis/population-sim.mjs`) runs the live conformation and showing formulas over a
simulated closed population: five stables, six mares and two stallions each, truncation selection on
show score, same-stable breeding exactly as `src/routes/horses.ts` enforces it today.

**Scenario A — the game as built:**

| gen | mean score | best | mean COI | genetic SD |
|---|---|---|---|---|
| 0 | 65.7 | 89.2 | 0% | 2.48 |
| 5 | 77.5 | 92.3 | 36% | 1.88 |
| 10 | 81.9 | 90.6 | 56% | 1.76 |
| 15 | 83.6 | 91.9 | 64% | 1.65 |
| 25 | 84.2 | 91.8 | 61% | 1.65 |
| 50 | 84.6 | 91.9 | 61% | 1.80 |

**Generations 15 through 50 add nothing.** The population arrives at a mean of ~84 and sits there
forever. Put that on the real clock: `game_days_per_tick` 10 × three slots a day = 30 game days per
real day, and `game_days_per_year` 360, so a game year is 12 real days. With
`min_breeding_age_game_days` 1080 and a ~340-day gestation, a generation is roughly four game years
— about **48 real days**. So:

- COI passes 50% at about **16 real months**.
- The plateau arrives at about **two real years**.
- Generation 50 is roughly **six and a half real years** away, and is indistinguishable from
  generation 15.

Three findings sit underneath that, and they matter more than the headline.

### 1.1 Reliability is a packaging problem, not a merit problem

Take two horses whose potential is *exactly* on the Quarter Horse ideal (11 / 14 / 7 / 10 across
neck, shoulder, back, hock) and vary only how those alleles are packaged across the ten loci:

| parents' packaging | het loci per trait | foal mean | foal SD | P(foal ≥ 90) |
|---|---|---|---|---|
| maximally heterozygous | 8.0 | 81.6 | 6.9 | **10.3%** |
| maximally homozygous | 0.5 | 89.6 | 4.0 | **49.9%** |

Identical parental merit. Five times the hit rate. A heterozygous parent contributes a *random half*
of its alleles; a homozygous one contributes the same half every time. **The thing that makes a
breeding programme reliable is homozygosity at the right loci** — which is what a real breeder means
by a prepotent sire, and it is exactly what our inbreeding penalty punishes.

Today the game gives a player no way to see zygosity, no vocabulary for it, and no reward for
pursuing it. The only visible number is merit, which is the wrong target once merit is already close
to the ideal.

### 1.2 The COI penalty is a tax that selection routes around, until it hits a wall

`realization = 1 − COI × inbreeding_depression_factor` shrinks expression toward the anchor of 50.
Selection simply answers by picking more extreme genotypes. The potential a horse needs to still
*look* right:

| COI | neck (55) | shoulder (70) | back (35) | hock (50) |
|---|---|---|---|---|
| 0% | 11.0 | 14.0 | 7.0 | 10.0 |
| 25% | 11.3 | 15.3 | 6.0 | 10.0 |
| 40% | 11.7 | 16.7 | 5.0 | 10.0 |
| 60% | 12.5 | **20.0** | 2.5 | 10.0 |

At COI 60% a correct Quarter Horse shoulder requires 20 alleles out of 20 — the ceiling. That is
precisely where Scenario A's population is pinned, and it explains the shape of the table in §1:
the mean stops climbing not because selection ran out of *pressure* but because it ran out of
*alleles* to answer the tax with.

Note what this penalty does **not** do: it does not make a player stop inbreeding. It makes inbred
horses need impossible genotypes, and it flattens every horse in the game toward mediocrity at the
same time, which is a worse outcome than either the design or the operator intended.

### 1.3 Same-stable-only breeding is the structural cause

`src/routes/horses.ts:415` builds the stallion list from the mare's own stable. With ten stalls, a
line runs on one or two sires and five or six mares — an effective population size around six, which
predicts roughly 8% inbreeding per generation on its own. The simulation's COI curve (56% by
generation 10) is consistent with that plus the concentration a player adds by always choosing the
best sire.

Scenario C (stud access to every sire in the game, everything else unchanged) reaches a mean of
**92.9 by generation 10** instead of 81.9 — but note its genetic SD falls to 0.32 by generation 45,
which is fixation. Faster progress and a *harder* stop. That is not an argument against stud
services; it is an argument that they must land alongside §7's outcross valve.

### 1.4 What is *not* the problem

The correlation between a horse's own show score and its true genetic merit is **0.74**; a
twenty-foal progeny test only reaches **0.80**. Selection accuracy is not the bottleneck, and an
estimated-breeding-value system — the obvious first idea, and one worth naming so a future session
doesn't rediscover it as new — would buy very little here. Do not start there.

---

## 2. What already exists and must not be re-implemented

- **The expression pipeline.** `src/engines/conformation/model.ts` — `potential()` → `geneticValue()`
  → `realization()` → `expressedValue()`. This slice changes what `realization()`'s COI term is
  *worth*, and adds new consumers of COI elsewhere. It must not fork the pipeline or add a second
  scoring path (`CLAUDE.md` §13).
- **COI itself.** `src/engines/genetics/pedigree.ts`'s tabular `kinship()`, and
  `loadPedigreeContext` in `src/db/horses.ts`. Correct as written. **Do not change `PEDIGREE_DEPTH`**
  — `src/engines/genetics/loci.ts` explains why it is structural and not a config value. One
  consequence worth knowing before reading any COI number in this document: because ancestors past
  six generations are treated as unrelated founders, the stored COI *understates* true homozygosity
  in a long-closed pool. A population can be far more fixed than its COI column admits — §1.1's
  packaging table is the thing that is actually happening, and it is invisible on every screen.
- **The three robustness traits.** `foot_robustness`, `joint_robustness`, `ligament_robustness` in
  `TRAITS` (`src/engines/genetics/polygenic.ts`), drawn at `robustness_one_chance` by
  `generateCandidate`. Every living horse already carries them. **Nothing reads them.** §4.3 gives
  them their job. Do not add a fourth.
- **Conditions and the truth/knowledge split.** `conditions`, `horse_conditions`, `horse_knowledge`,
  and `src/db/health.ts`. §4.3's acquired unsoundness is a new *row* in `conditions`, not a new
  mechanism. Note `horse_knowledge.subject_code` already carries two prefix families (bare disease
  codes, and `locus:<code>` from amendment 0017a) — §5.2 proposes a third, and the guard in
  `db/health.ts`'s `knowledgeMap` must be extended, not bypassed.
- **`show_entries.score_breakdown`** (`migrations/0065_show_entries_trait_snapshot.sql`) already
  stores each entry's expressed trait values at the moment it was judged. §5.1 reads this and needs
  no new table.
- **The consignment dealer.** `src/db/consignment.ts`, `runConsignments`, `consignment_injections`.
  §7 retunes what it mints; it does not replace it.
- **`src/engines/market/appraise.ts`.** If §5 makes zygosity visible and valuable, appraisal
  eventually needs a term for it — flagged in §10, deliberately not specified here.

---

## 3. Scope

**In scope**, in the order they should be built (§12):

- **Part A** — move inbreeding depression off conformation expression and onto fitness (§4).
- **Part B** — make zygosity visible and nameable (§5).
- **Part C** — stud services, per `docs/slices/0017-market.md` §13 (§6).
- **Part D** — retune the outcross valve for variance rather than volume (§7).
- **Part E** — lower the environmental-noise floor (§8).

**Out of scope, deliberately:**

- Estimated breeding values. See §1.4 — measured, and it is not the bottleneck.
- Any change to `PEDIGREE_DEPTH` or to how COI is calculated.
- Any change to `TRAITS`. It is append-only and a genotype is fixed at birth; this slice needs no
  new heritable trait, which is the entire reason slice 0014 §6 put the robustness traits in early.
- Marker-assisted selection, embryo transfer, cloning, or any mechanism that lets a player choose a
  foal's genotype. If reliability still feels out of reach after Parts A–E, that is a conversation,
  not a follow-up task.

---

## 4. Part A — inbreeding depression moves from conformation to fitness

**The argument.** Inbreeding depression in real animals falls hardest on fitness traits — fertility,
viability, longevity, soundness — and comparatively lightly on skeletal conformation. The current
model has it exactly inverted: a flat `COI × 1.0` haircut on every conformation measurement, and a
mild `1 − 0.5 × COI` on conception. So the present design is both less accurate than it could be
*and* produces the plateau in §1.2. Fixing the biology and fixing the gameplay are the same edit.

What this buys: **linebreeding becomes a real strategy with a real price.** A player can concentrate
their good alleles and get the consistent foals §1.1 shows are otherwise unreachable — and pay for it
in mares that do not conceive, foals that do not survive, and horses that break down young. That is
Quarter Horse history, and `docs/horse-game-overview.md` §2f already names HYPP as the teaching case
for precisely this trade. It is a better lesson than a flat tax, and it is a decision rather than a
penalty.

### 4.1 Conformation expression

`inbreeding_depression_factor`: **1.0 → a much smaller number** (§10 Q1 — the operator picks it;
the simulation was run at 0.2 and the analysis assumes something in that region).

**This is retroactive and world-visible.** `migrations/0031_config_conformation.sql`'s own comment
warns of it: the factor is read fresh on every page view, so the moment it changes, *every inbred
horse in the game is re-scored at once*. At the COI levels play will already have reached, dropping
1.0 → 0.2 makes a large fraction of the world's horses visibly better overnight. That is the
intended correction, but the operator must expect it and should have wording ready for the children.
**Do not ship Part A's conformation change without the fitness penalties below** — on its own it
makes inbreeding strictly free, which is worse than today.

### 4.2 Fertility, viability and longevity

- `inbreeding_fertility_penalty` (currently 0.5, in `conceptionChance`): **raise it** (§10 Q2).
- **New: foal viability.** A COI-scaled chance that a pregnancy does not produce a live foal.
  `docs/horse-game-overview.md` §2e's homozygous-frame wording is the precedent for how to present a
  loss gently — an early-term pregnancy that does not continue, explained through the genetics. Reuse
  it; do not write a second vocabulary for the same event.
- **New: lifespan.** A COI term in `rollLifespanGameDays` (`src/engines/ageing/lifespan.ts`). Note
  `CLAUDE.md` §5.5: lifespan is rolled once at birth and snapshotted, so this only ever affects
  horses born after it ships, and cannot retroactively kill anything. Say so on the admin screen.

### 4.3 Soundness — giving the robustness traits their job

The largest piece of Part A, and the one that could reasonably be split into its own slice.

A horse's realised soundness derives from its three robustness traits through the **existing**
`potential → geneticValue → realization` pipeline, with COI entering at `realization` exactly as it
does for conformation — the one place a heavy COI factor still belongs. Low realised soundness
raises the per-tick probability that the horse acquires an unsoundness condition.

An acquired unsoundness is a **new row in `conditions`**, not a new subsystem: it is diagnosed,
managed and paid for through `src/db/health.ts` and slice 0013's care machinery, and it depresses
show scores through the care modifier that already exists. Nothing new is needed on the show side.

Three things this must respect:

1. **Onset is a seeded draw** (`CLAUDE.md` §5.2) off the horse's own `rng_seed` with a fresh,
   never-before-used label.
2. **Idempotency** (`CLAUDE.md` §5.4) — derive from `game_day` elapsed, never `+= 1` per tick.
3. **Truth vs knowledge** (`CLAUDE.md` §12) — robustness values are genotype-derived and must never
   render to a player. What a player sees is the *diagnosed condition*, and (if §5.2 is built) a
   test they paid for. `src/engines/breeding/fertility.ts`'s header is the model for how to document
   a function that reads truth and may only be called from the world resolving physics.

---

## 5. Part B — make zygosity visible and nameable

Players cannot chase what they cannot see, and §1.1 says zygosity is the whole game. Two mechanisms;
build them in this order.

### 5.1 A progeny consistency record (free, no new genetics)

For a horse with enough judged offspring, show the **spread** of its foals' scores alongside their
average. This is how real breeders judge prepotency, it needs no new schema, and it leaks nothing:
it reads `show_entries.score_breakdown`, which is already public.

Reading show records rather than the foals' stored genotypes is the deliberate choice. It keeps the
statistic public and viewer-independent (no per-stable knowledge check, no truth leak to reason
about), and it means **only shown foals count** — which is realistic, and gives a player a reason to
show stock they are evaluating rather than only stock they expect to win with.

Present it in words, not just a number — the operator does not code and neither do the children.
"Ten foals shown, average 84, and they land close together" reads better than a standard deviation,
and a low-spread sire wants a name a child will use.

### 5.2 A paid zygosity test (later, and only if 5.1 proves the appetite)

A per-trait test reporting how many of a trait's ten loci are homozygous, sold and stored through the
existing mechanism: `horse_knowledge` with a new `subject_code` family, `zygosity:<trait>`, alongside
the bare disease codes and 0017a's `locus:<code>`. **Extend the prefix guard in `db/health.ts`'s
`knowledgeMap`** — 0017a's build-log entry flags this as a standing footgun for exactly this case.

---

## 6. Part C — stud services

Already specified in `docs/slices/0017-market.md` §13. Build it as written; this slice adds only the
evidence for its priority (§1.3) and one constraint: **it must not ship before Part D**, or the
population fixes faster than it improves (Scenario C's genetic SD falling to 0.32).

---

## 7. Part D — the outcross valve's quality, not its volume

The consignment dealer mints at the `mid` band (`quality_bands.mid` = 0.50, every allele a coin
flip). Simulated as Scenario B and D, that inflow **holds the population at ~83 forever**: injecting
average horses into an above-average pool is a permanent anchor, not an outcross.

An outcross should be **unrelated and extreme, not unrelated and average**. Draw each consignment
horse's per-trait allele frequency from a wide distribution rather than fixing every trait at the
band, so some arrive at 18/20 on shoulder and 4/20 on back. Such a horse is useless in the ring and
genuinely valuable in a breeding shed, which is the distinction the market currently cannot express.

Fewer of them, priced higher. `consignment_batch_min`/`_max` and `consignment_price_multiplier` are
already live tunables; the per-trait spread is a new one (§10 Q4).

---

## 8. Part E — the noise floor

`conformation_noise_sd` 6 → 3 or 4 (§10 Q5). One config edit, and it is snapshotted at birth
(`migrations/0031`'s comment), so it only affects horses born afterwards — no retroactive shift, and
the two populations coexist correctly by design.

**Build it last**, because of the interaction: dropping the noise barely helps heterozygous parents
(81.6 → 83.5) and transforms matched homozygous ones (89.6 → 93.9, and P(foal ≥ 90) from 50% to
94%). It is a multiplier on Parts A and B, not a substitute for them. Shipping it first would spend
the lever on a population that cannot use it.

---

## 9. Migrations and config

Numbered from `0099`, one logical change per file (`CLAUDE.md` §8), **each also registered in
`src/db/migrations.ts`** so `/admin/migrations` can see it. Expected shape:

- Retune `inbreeding_depression_factor` and `inbreeding_fertility_penalty` (§4.1, §4.2).
- New config for foal viability and the lifespan COI term (§4.2).
- New config for soundness onset, plus the `conditions` rows for acquired unsoundness (§4.3) —
  the table and the seed are two files.
- New config for the consignment per-trait spread (§7).
- Retune `conformation_noise_sd` (§8).

Every tunable added here is a **live** tunable except the ones §4.2 and §8 explicitly snapshot;
re-read `CLAUDE.md` §5.5 before deciding which side a new number falls on.

---

## 10. Open questions — the operator decides these, not the session

**Do not pick these yourself** (`CLAUDE.md` §2). Every one changes how the game feels, and the
simulation can price any answer in a few seconds — use it rather than guessing.

- **Q1.** What should `inbreeding_depression_factor` become? The analysis assumes ~0.2. Anything
  above ~0.4 keeps the §1.2 wall in place.
- **Q2.** How hard should the fitness penalties bite — fertility, foal viability, lifespan,
  soundness? These four together replace the deterrent that §4.1 removes, and they are the whole
  balance of the slice. Getting them collectively too light makes inbreeding free.
- **Q3.** Is a foal lost to inbreeding acceptable in this game, for these players? §4.2 assumes yes,
  on the precedent of §2e's homozygous frame, which is already decided. **If the answer is no, say
  so before Part A is built** — the deterrent has to be rebuilt out of fertility, soundness and
  longevity alone, which is a different balance, not a smaller one.
- **Q4.** How extreme should consignment horses be (§7)?
- **Q5.** `conformation_noise_sd` — 3, or 4? (§8)
- **Q6.** Should zygosity carry a price in `appraise()` once §5 makes it visible? A prepotent sire
  is worth more than his own show record; today the appraisal cannot say so.
- **Q7.** Part A §4.1 changes every existing horse's displayed numbers the moment it deploys. Is
  that acceptable as a one-time correction, and does the operator want wording prepared for the
  children before it ships?

---

## 11. Testing

- **Pure-engine unit tests** for every new function, per `CLAUDE.md` §5.1 — soundness onset,
  viability, the lifespan COI term, the consignment spread, and §5.1's progeny statistic all take
  data and return data, so none of them needs a database.
- **Seeded-draw tests**, per `CLAUDE.md` §5.2 — a given seed produces a given outcome, and a
  population of draws produces the expected proportion. This is the reason for the rule.
- **Idempotency tests** for anything added to the tick (`CLAUDE.md` §5.4) — same tick fired twice
  produces one effect, and a skipped tick is survivable.
- **Re-run `docs/analysis/population-sim.mjs`** with the chosen numbers before shipping, and paste
  the resulting table into the build-log entry. If the mean is still flat from generation 15, the
  slice has not worked, whatever the unit tests say. This is the acceptance test for the slice as a
  whole, and it is the reason the simulation is in the repo rather than in a chat log.
- Standing constraint every session in `docs/build-log.md` has recorded: no Cloudflare login in the
  sandbox, so nothing here can be verified against live D1 or `wrangler dev`. Say what you did and
  did not verify.

---

## 12. Build order

Parts A and B are the slice. C, D and E are each independently shippable and can be separate
sessions. **A before B** (B is only worth seeing once zygosity is worth pursuing), **D before C**
(§6), **E last** (§8).

A reasonable split across sessions: A (§4.1–4.2), then A (§4.3, soundness — big enough to stand
alone), then B, then D, then C, then E.

## 13. When a part lands

- Update `CLAUDE.md` §10's table row for this slice.
- Add a dated entry to `docs/build-log.md` (`CLAUDE.md` §9), including the re-run simulation table
  from §11.
- If the chosen config values differ from what §10 assumed, **update the constants block in
  `docs/analysis/population-sim.mjs` to match**. A drifted copy of the game's numbers is worse than
  no simulation at all, and its header says so.
