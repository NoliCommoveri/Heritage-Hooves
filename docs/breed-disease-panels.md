# Breed disease panels — the seven non-Quarter-Horse breeds

*Written 2026-08-04. This is a **data record**, not a built feature — the status
`docs/breed-ideal-vectors.md` carried for conformation until the same day it and this document were
both written, when its seven remaining vectors were seeded (migration `0107`) and the NPC show barn
made breed-aware. This document has not had that follow-through yet: nothing in it is in the
database. `conditions`, `loci` and every `breeds.founding_allele_pool` are unchanged by writing
this file.*

Named as a gap twice already: overview §4a's breed table lists "signature conditions" per breed
and calls them one of the strongest identity markers available; `docs/build-log.md`'s 2026-08-04
entry says plainly that "the seven non-Quarter-Horse disease panels are still unwritten anywhere,
for all eight breeds." This is that writing.

---

## 1. What already exists, and what this document adds

The Quarter Horse panel is live: HYPP, PSSM1, HERDA, GBED, built in
`docs/slices/0010-health-first-pass.md` and seeded in `migrations/0050`-`0053`. Four single-gene
loci, the `conditions`/`horse_conditions`/`horse_knowledge` machinery, the status engine, the test
screen, the breeding preview's health line, the tick's death stage. All of it is breed-agnostic —
`breed_associations` is display-only (slice 0010 §5.1) — so **adding a condition for another breed
needs no new engine, only new rows**, exactly the way `breed-ideal-vectors.md` needed no new
scorer, only new targets.

This document works out what those new rows should say: which of overview §4a's named conditions
can actually be built against the machinery that exists today, what their genetics really are, and
what the founding pools should carry. §6 is honest about the ones that cannot be built yet and why,
the same way §3.4/§3.5 of slice 0010 were honest about polygenic and colour-linked conditions from
the start.

---

## 2. The constraint that shapes everything below

Slice 0010 built exactly one mechanism: a `conditions` row with a `trigger` naming a locus, a
mutant allele, and dominant-or-recessive. `conditionStatus()` reads a genotype and returns
clear/carrier/affected. That is the **only** condition category with working machinery today.

Overview §3a names three categories. Single-gene is built. The other two are not:

- **Colour-linked conditions** (§3a) ride on a colour locus that already exists — Grey-linked
  melanoma needs nothing new *genetically*, since `G` is already in `LOCI`. But melanoma risk rises
  with age rather than being a fixed genotype-to-status mapping, and slice 0010 §3.2 is explicit
  that `conditions.onset_model` is a column that was deliberately **not built**, because a nullable
  column nothing writes is a promise to a future session nobody keeps. There is nowhere to attach an
  age-rising risk yet.
- **Polygenic predispositions** (§3a) need the additive machinery conformation already has, applied
  to a risk score instead of an expressed trait. The substrate — `foot_robustness`,
  `joint_robustness`, `ligament_robustness` — was built in slice 0014 §2.6 precisely so it would
  exist before it was needed, but nothing reads it. No onset roll exists for any polygenic trait.

**So this document only specifies single-gene conditions that fit the existing `trigger` shape.**
Every colour-linked or polygenic condition overview §4a names for a breed is listed in §6 as
deferred, with the reason, so a future session finds it recorded rather than has to re-derive it.

This produces an honest and, it turns out, realistic result: **three of the seven breeds get no
buildable single-gene condition at all**, because their real signature problems are not single-gene
diseases. That is not a failure of this pass — it is the actual state of equine veterinary genetics,
and overview §3a already predicted it for the Thoroughbred by name ("this category also stops the
Thoroughbred having nothing... which is itself accurate and worth showing").

---

## 3. At a glance

| Breed | Overview §4a's signature conditions | Buildable now (single-gene) | Deferred (needs unbuilt machinery) |
|---|---|---|---|
| Quarter Horse (built) | HYPP, PSSM1, GBED, HERDA | — already built | — |
| Arabian | SCID, cerebellar abiotrophy, lavender foal syndrome; melanoma via grey | **SCID, CA, LFS** | Melanoma via grey (colour-linked, needs onset model) |
| Thoroughbred | Laryngeal neuropathy, bone/tendon fragility | **none** | Both named conditions are polygenic by nature |
| Paso Fino | DSLD | **none** | DSLD has no confirmed single locus even in reality (§6.2) |
| Icelandic | Insect bite hypersensitivity; MCOA via silver | **none** | IBH is polygenic; MCOA needs a Silver locus that does not exist |
| German Warmblood | WFFS, osteochondrosis | **WFFS** | Osteochondrosis (polygenic) |
| Friesian | Dwarfism, hydrocephalus | **Dwarfism, hydrocephalus** | — both buildable |
| Nokota | None distinctive | **none, deliberately** | The landrace is the healthy outcross — see §6.6 |

Six new loci, four breeds gain a panel, three genuinely get nothing this pass. After this document
is built, the game's lethal single-gene set is GBED (existing) plus SCID, LFS, WFFS and
hydrocephalus — **five**, landing exactly on overview §3b's own ceiling ("four or five across the
whole game is enough to make testing matter... a dozen makes foaling an anxious event rather than a
hopeful one").

---

## 4. Six new loci, appended

Per `src/engines/genetics/loci.ts`'s own rule: **append only, never insert.** These six go after
`GBED`, at `sort_order` 10 through 15. All six are recessive except none — every one of the six
buildable conditions below turns out to be recessive in reality, which is itself worth noting: the
QH panel's two dominants (HYPP, PSSM1) are the unusual case, not the norm.

| Code | Name | Alleles (canonical order) | `wildType` | Inheritance | Breed |
|---|---|---|---|---|---|
| `SCID` | Severe combined immunodeficiency | `["N","Sc"]` | `N` | recessive | Arabian |
| `CA` | Cerebellar abiotrophy | `["N","Ca"]` | `N` | recessive | Arabian |
| `LFS` | Lavender foal syndrome | `["N","Lv"]` | `N` | recessive | Arabian |
| `WFFS` | Warmblood fragile foal syndrome | `["N","Wf"]` | `N` | recessive | German Warmblood |
| `DWARF` | Dwarfism | `["N","Dw"]` | `N` | recessive | Friesian |
| `HYDRO` | Hydrocephalus | `["N","Hy"]` | `N` | recessive | Friesian |

All six follow the QH panel's convention exactly: wild type is `N` and is `alleles[0]`, spelled out
per-locus rather than assumed from position, per `loci.ts`'s own comment about why that matters.

**`src/engines/genetics/expression.ts` must not be touched.** These six loci change nothing about
any horse's appearance, same as the four before them.

---

## 5. The six conditions, specified

Each of these is a real, named, single-gene equine condition with an identified gene, translated
onto this engine's abstraction the same way slice 0010 §2.1 took the real Quarter Horse five-panel
"rather than inventing one." `trigger` blobs are ready to paste. `teaching_text` and `event_text`
are drafted per slice 0010 §5's own instruction ("draft the wording before building the mechanic,
not after") and written to the same constraints: no semicolons, no double hyphens, doubled
apostrophes, readable by a nine-year-old.

### 5.1 SCID — severe combined immunodeficiency (Arabian)

Real gene: `PRKDC`, ECA9. A foal with two mutant copies is born with no working immune system —
no B or T lymphocytes — and looks entirely normal at birth because maternal antibodies protect it
for the first weeks of life. It dies of infection once that protection wears off, historically
around two to four months old, and there is no cure.

- `severity_class`: **lethal**. `signs_visible`: **0** — same reasoning as GBED, a foal with SCID
  looks completely healthy until it isn't, and there is nothing to see at birth.
- `bars_showing`: 0 (moot — no affected foal reaches showing age).
- `trigger`: `{"v":1,"locus":"SCID","mutant":"Sc","mode":"recessive"}`
- `breed_associations`: `["AR"]`

**Realism note, worth raising rather than silently absorbing (see §9).** The game's only timing
lever for a lethal condition is `lethal_foal_death_game_days`, a single global config value
currently 30 (slice 0010 §2.2), snapshotted per horse at birth. SCID's real death window is months,
not days. This document recommends **reusing the existing global window rather than adding a
per-condition one** — see §9 for the reasoning — which means SCID's in-game timeline is compressed
well below its real one. Say so honestly in the teaching text rather than imply the game models the
delay accurately.

> **Teaching text:** Recessive. It takes two copies, one from each parent, to cause it. A foal with
> SCID has no working immune system and cannot fight off infection. It looks completely healthy at
> birth because it is still protected by its dam''s antibodies, and there is no cure once that
> protection wears off. In real Arabians this can take months to become apparent. This game
> compresses that timeline so the outcome is not lost in a gap between logins.

> **Event text:** The foal was born with SCID, severe combined immunodeficiency. A foal with this
> condition has no working immune system and cannot fight off infection, which is why it seemed
> well at first and then was not. SCID is recessive. That means a horse needs two copies to be
> affected, one from each parent, and a horse with only one copy is perfectly healthy its whole
> life, a carrier. Two carriers bred together have about a one in four chance of an affected foal
> each time. Neither parent shows anything at all. A genotype test tells you whether a horse is a
> carrier. It is the only way to know.

### 5.2 CA — cerebellar abiotrophy (Arabian)

Real gene: `MUTYH`, ECA2. Two mutant copies cause the cerebellum to degenerate starting a few weeks
after birth — head tremor, poor balance, an exaggerated startle response. It is not fatal on its
own but makes a horse unsafe to ride or handle closely, and severity varies from mild to disabling.

- `severity_class`: **degenerative** — the direct parallel to HERDA: visible, not lethal, career-
  ending.
- `signs_visible`: **1** (same simplification the QH panel already accepts for HERDA — real signs
  take weeks to appear; the game shows status from birth, which is the existing convention, not a
  new one this document introduces).
- `bars_showing`: **1** — an ataxic horse cannot be safely shown.
- `trigger`: `{"v":1,"locus":"CA","mutant":"Ca","mode":"recessive"}`
- `breed_associations`: `["AR"]`

> **Teaching text:** Recessive. It takes two copies, one from each parent, to cause it. Affects
> balance and coordination by damaging part of the brain that controls movement, causing tremors
> and an unsteady stance. It is not fatal but a horse with cerebellar abiotrophy cannot be safely
> ridden or shown.

> **Event text (fires at signs, per slice 0010 §6.3, same as HERDA):** Recessive, it takes two
> copies, one from each parent, to cause it. The brain does not develop the way it should, and
> balance and coordination are affected for life. A horse with cerebellar abiotrophy cannot be
> entered in a show.

### 5.3 LFS — lavender foal syndrome (Arabian)

Real gene: `MYO5A`, ECA1. Two mutant copies produce a foal with severe neurological signs from the
moment of birth — unable to stand, paddling, seizures — often alongside a distinctive pale,
lavender-tinged coat (the name). There is no treatment; affected foals do not survive.

- `severity_class`: **lethal**. `signs_visible`: **1** — unlike GBED and SCID, LFS is visibly wrong
  from birth. **This is a deliberate, useful contrast**, and worth stating in a migration comment so
  a future session does not "fix" it into matching GBED's silence: `signs_visible` and
  `severity_class` are independent columns exactly so a condition can be lethal *and* obviously
  wrong from day one, which is the honest biology here and teaches a different lesson than GBED's
  "looked fine, then wasn't."
- `bars_showing`: 0 (moot).
- `trigger`: `{"v":1,"locus":"LFS","mutant":"Lv","mode":"recessive"}`
- `breed_associations`: `["AR"]`

> **Teaching text:** Recessive and lethal. It takes two copies, one from each parent, to cause it.
> A foal with lavender foal syndrome cannot stand and has severe seizures from birth, unlike some
> other lethal conditions where a foal looks well at first. There is nothing that can be done.

> **Event text:** The foal was born with lavender foal syndrome. Unlike some other conditions, this
> one was visible right away. It cannot stand and its nervous system did not develop the way it
> should, and there is nothing that can be done about it. Lavender foal syndrome is recessive. That
> means a horse needs two copies to be affected, one from each parent, and a horse with only one
> copy is perfectly healthy its whole life, a carrier. Two carriers bred together have about a one
> in four chance of an affected foal each time. Neither parent shows anything at all. A genotype
> test tells you whether a horse is a carrier. It is the only way to know.

### 5.4 WFFS — Warmblood fragile foal syndrome (German Warmblood)

Real gene: `PLOD1`. Two mutant copies produce connective tissue too fragile to hold together — skin
that tears under normal handling, hyperextended joints. Affected foals are commonly stillborn or die
within days of birth from the resulting wounds. Traces to a small number of influential Hanoverian
stallions, the same "one successful sire" pattern HYPP is the QH teaching case for.

- `severity_class`: **lethal**. `signs_visible`: **1** — visibly fragile skin and wounds at birth,
  same reasoning as LFS.
- `bars_showing`: 0 (moot).
- `trigger`: `{"v":1,"locus":"WFFS","mutant":"Wf","mode":"recessive"}`
- `breed_associations`: `["GW"]`

> **Teaching text:** Recessive and lethal. It takes two copies, one from each parent, to cause it.
> A foal with WFFS has skin and connective tissue too fragile to hold together, and does not
> survive. Like HYPP in Quarter Horses, it traces back to a small number of very successful
> stallions.

> **Event text:** The foal was born with WFFS, Warmblood fragile foal syndrome. Its skin and
> connective tissue could not hold together the way they should, and there was nothing that could
> be done. WFFS is recessive. That means a horse needs two copies to be affected, one from each
> parent, and a horse with only one copy is perfectly healthy its whole life, a carrier. Two
> carriers bred together have about a one in four chance of an affected foal each time. Neither
> parent shows anything at all. A genotype test tells you whether a horse is a carrier. It is the
> only way to know.

### 5.5 Dwarfism (Friesian)

Real gene: `B3GALNT2`. Two mutant copies produce a foal with disproportionately short limbs and an
oversized head relative to body — visible at birth, permanent, not itself life-shortening, but a
horse the breed standard cannot recognise and that cannot be ridden. Several distinct dwarfism
mutations exist in real Friesians; this is the best-characterised one and is the one worth modelling
first, the same "one real, well-documented locus rather than inventing a composite" reasoning
slice 0010 §2.1 used for the QH panel.

- `severity_class`: **degenerative** — visible, not lethal, career-ending. The direct Friesian
  parallel to HERDA and CA.
- `signs_visible`: **1**. `bars_showing`: **1**.
- `trigger`: `{"v":1,"locus":"DWARF","mutant":"Dw","mode":"recessive"}`
- `breed_associations`: `["FR"]`

> **Teaching text:** Recessive. It takes two copies, one from each parent, to cause it. A foal with
> dwarfism has short limbs and an oversized head, visible from birth. It does not shorten the
> horse''s life but the horse cannot be shown and is not the shape the breed standard describes.

> **Event text (fires at signs, at birth):** Recessive, it takes two copies, one from each parent,
> to cause it. The limbs and head did not grow in proportion the way they should, and this does not
> change as the foal grows up. A horse with dwarfism cannot be entered in a show.

### 5.6 Hydrocephalus (Friesian)

Real gene: `B3GAT3`. Two mutant copies cause fluid to build up around the brain before birth,
producing a visibly domed, oversized skull. In reality this frequently causes a difficult birth and
the foal often does not survive it; where a foal is born alive, it does not survive long. **Per
overview §3b's already-decided pattern for every lethal in this game (born, then dies — not a
stillbirth, not an early-term loss), hydrocephalus follows the same shape as GBED rather than a new
one**, even though real hydrocephalus more often causes stillbirth. Consistency with the one
decision already made about how lethals present matters more here than chasing the single most
common real outcome.

- `severity_class`: **lethal**. `signs_visible`: **1** — an enlarged head is visible at birth,
  same reasoning as WFFS and LFS.
- `bars_showing`: 0 (moot).
- `trigger`: `{"v":1,"locus":"HYDRO","mutant":"Hy","mode":"recessive"}`
- `breed_associations`: `["FR"]`

> **Teaching text:** Recessive and lethal. It takes two copies, one from each parent, to cause it.
> Fluid builds up around the brain before birth, causing a visibly enlarged head, and the foal does
> not survive. This is one of two conditions with a name and a known cause in Friesians, a breed
> descended from a small closed population where recessive conditions like this one surface more
> often than in an open breed.

> **Event text:** The foal was born with hydrocephalus. Fluid had built up around the brain before
> birth, and there was nothing that could be done. Hydrocephalus is recessive. That means a horse
> needs two copies to be affected, one from each parent, and a horse with only one copy is
> perfectly healthy its whole life, a carrier. Two carriers bred together have about a one in four
> chance of an affected foal each time. Neither parent shows anything at all. A genotype test tells
> you whether a horse is a carrier. It is the only way to know.

---

## 6. Deferred, and why — every named condition this document does not build

Recorded so a future session does not re-research these from nothing, the same service slice 0010
§3.1-§3.7 performed for its own deferrals.

### 6.1 Melanoma via grey (Arabian)

Real and genuinely common — most grey horses develop melanomas with age, and Arabians grey out at a
high rate. `G` already exists as a locus, so no new gene is needed. What is missing is **an onset
model that reads a fixed genotype into a risk that rises with a horse's age**, which is exactly the
column slice 0010 §3.2 named and declined to build. Do not attach this as a fixed genotype trigger
(a grey horse is not born with melanoma) — that would be a wrong answer masquerading as a real one,
the same failure mode overview §3b warns about for polygenic traits generally. Wait for the onset
model.

### 6.2 DSLD / ESPA (Paso Fino)

Degenerative suspensory ligament desmitis. Real, breed-associated, and heritability is suspected —
but **unlike every condition in §5, there is no confirmed single causal gene** even in reality.
Research has proposed candidate variants but nothing with the certainty HYPP, HERDA or WFFS have.
Building a `trigger` for it would mean inventing a locus with no real counterpart, which is exactly
what slice 0010 §2.1 declined to do for the QH panel ("taking the real list rather than inventing
one is the whole point"). This stays a polygenic candidate, blocked on the same onset model as §6.1,
and possibly permanently uncertain even then — DSLD may end up as a risk factor rather than a
clean-genotype prediction no matter what machinery exists. The Paso Fino gets no single-gene panel
in this pass, and that absence is itself honest: not every breed's real problem is a testable gene.

### 6.3 Insect bite hypersensitivity + MCOA via silver (Icelandic)

IBH is an immune-mediated, multifactorial allergic response — polygenic, same blocker as §6.1.
MCOA (multiple congenital ocular anomalies) is real and genuinely single-gene in reality (`PMEL17`,
the Silver locus) — but **the Silver locus does not exist in this game yet**. `LOCI` currently has
`CR` for Cream, not Silver; overview §3b's own list of colour loci still to be built ("no frame,
tobiano, sabino or splash locus anywhere yet") should be read as also missing Silver. When Silver
lands as a colour locus (presumably alongside the other colour genetics overview §13 schedules),
MCOA becomes buildable with the same `trigger` shape every condition in §5 uses — homozygous Silver,
`{"v":1,"locus":"Z","mutant":"Z","mode":"recessive"}` or similar, no new engine required at that
point either. Recorded here so whoever adds Silver finds this half-finished rather than starting
from zero.

### 6.4 Osteochondrosis (German Warmblood)

Polygenic, same blocker as §6.1 and §6.3. German Warmblood gets one buildable condition (WFFS, §5.4)
and one deferred one, which is a reasonable split rather than an oversight.

### 6.5 Laryngeal neuropathy, bone/tendon fragility (Thoroughbred)

Both multifactorial. Overview §3a already names the Thoroughbred as the breed whose real problems
are "mostly not Mendelian," and this document's finding — zero buildable single-gene conditions —
is that prediction confirmed rather than a gap. **Do not invent a Thoroughbred single-gene
condition to avoid an empty row in a table.** An empty row here is the correct, honest answer, and
overview §3a says explicitly that this is "itself accurate and worth showing." When the polygenic
onset model exists, laryngeal neuropathy is the Thoroughbred's first candidate.

### 6.6 Nokota

No signature condition, deliberately — overview's own table says "None distinctive," and §4a frames
the Nokota as "healthy, unrefined, unrelated to everything else... the outcross that answers gene-
pool collapse in-world." Giving it a manufactured disease to fill a table cell would work directly
against the one thing the breed exists to do. Its founding pool still needs `"N":1.0` entries for
all six new loci (§7), the same as every breed that does not carry a condition — that is bookkeeping,
not identity.

---

## 7. Founding pool updates, all eight breeds

Per slice 0010 §4.3's rule, restated in `src/engines/founding/pool.ts`: **a pool missing a locus is
an error, not a default.** Adding six loci means every one of the eight `founding_allele_pool`
blobs needs six new keys in the same migration, the same shape `migrations/0051` used for the
original four disease loci. Existing keys (`E`, `A`, `CR`, `G`, `DMRT3`, and for Quarter Horse the
four existing disease loci) are copied unchanged from `0051`; only the six new keys are added below.

**Recommended mutant allele frequencies**, deliberately low per overview §3f's "tune so most foals
are healthy" and matched in spirit to the QH panel's own numbers (HYPP 0.02, PSSM1 0.03, HERDA 0.06,
GBED 0.05):

| Condition | Breed | Mutant allele frequency | Approx. carrier rate | Approx. affected rate |
|---|---|---|---|---|
| SCID | Arabian | 0.03 | ~5.8% | ~0.09% (lethal, clamped — see below) |
| CA | Arabian | 0.05 | ~9.5% | ~0.25% |
| LFS | Arabian | 0.02 | ~3.9% | ~0.04% (lethal, clamped) |
| WFFS | German Warmblood | 0.04 | ~7.7% | ~0.16% (lethal, clamped) |
| Dwarfism | Friesian | 0.06 | ~11.3% | ~0.36% |
| Hydrocephalus | Friesian | 0.04 | ~7.7% | ~0.16% (lethal, clamped) |

**The lethal clamp already exists** (slice 0010 §4.3): the founding/import generator never produces
a homozygous-affected candidate for a lethal condition, replacing one mutant allele with wild type
instead. It is data-driven off the `conditions` table already, so SCID, LFS, WFFS and hydrocephalus
need no new code for this — only their `conditions.severity_class = 'lethal'` rows, which §5 above
specifies.

**Every other breed gets `"N":1.0` for all six new keys.** This is the same pattern `0051` already
established for HYPP/PSSM1/HERDA/GBED on the seven non-QH breeds, extended one step further: real
biology, confined to the breed it actually occurs in, first pass. Ready-to-paste per-breed key sets
(append these six key:value pairs into each breed's existing pool literal, do not use `json_set`,
per `0051`'s own comment about why a full literal is what the consistency test parses):

```
QH, AR, TB, PF, IC, GW, FR, NOK all get, as their default:
"SCID":{"N":1.0},"CA":{"N":1.0},"LFS":{"N":1.0},"WFFS":{"N":1.0},"DWARF":{"N":1.0},"HYDRO":{"N":1.0}

AR overrides three of the six:
"SCID":{"N":0.97,"Sc":0.03},"CA":{"N":0.95,"Ca":0.05},"LFS":{"N":0.98,"Lv":0.02}

GW overrides one:
"WFFS":{"N":0.96,"Wf":0.04}

FR overrides two:
"DWARF":{"N":0.94,"Dw":0.06},"HYDRO":{"N":0.96,"Hy":0.04}
```

---

## 8. Migration plan, when this is built

Mirroring slice 0010 §5's own shape, roughly one logical change per file, numbers taken from
whatever is next free in `migrations/` at build time (currently past `0106`, but per `CLAUDE.md`
§11 always re-check rather than trust a number written here):

1. Seed the six `loci` rows (§4).
2. Update all eight `founding_allele_pool`s with the six new keys (§7) — one `UPDATE` per breed, a
   full literal each, same shape as `0051`.
3. Seed the six `conditions` rows (§5) — `category = 'single_gene'` for all six, same table
   `0053` already created, no schema change needed.

**No `CREATE TABLE` anywhere in this list** — unlike slice 0010, every table this needs
(`conditions`, `horse_conditions`, `horse_knowledge`) and every route, event kind and tick stage
already exists and is breed-agnostic. This really is closer to `breed-ideal-vectors.md`'s "step 3
is fifteen minutes" than to a new slice.

**Unlike the ideal-vector document, there was never a show-barn blocker here** — and as of the same
day this document was written, that blocker closed anyway: migration `0107` seeded all seven
remaining `ideal_vector`s and `stockShowBarn` (`src/db/npc.ts`) stopped hardcoding Quarter Horses,
so `breed-ideal-vectors.md` §6.1's own blocker no longer applies to *that* document either (see
`CLAUDE.md` §10's "the other seven breeds" row). Disease panels were never blocked by it in the
first place — they create no classes and touch no NPC stocking logic, they change what a horse's
genotype can express and what a Health card shows, nothing about where a horse can compete. **This
document's contents are safe to seed the day someone chooses to, and now so are the ideal
vectors.**

Same warning slice 0010 §5 gave and lost an afternoon to: **no semicolons, no double hyphens,
anywhere inside a string literal** in the `teaching_text`/`event_text` values, or `/admin/migrations`
fails with `unrecognized token` in a way the operator cannot fix from the browser. The drafts in §5
above already follow this; keep it true through any editing.

---

## 9. Open question to raise, not decide here

**Should `lethal_foal_death_game_days` become per-condition, or stay one global value?**

§5.1 flags this concretely: SCID's real death window is months, GBED's and the game's current
30-day default both model something closer to days. Two paths, and this document does not pick one:

- **Keep the single global config value** (this document's working assumption throughout §5).
  Simpler, no schema change, and slice 0010 already made this exact compromise for GBED — a real
  neonatal lethal typically presents within hours to days, and the game stretched it to 30 game days
  *for pacing*, not realism. SCID just stretches the same knob further than its own biology, and
  saying so honestly in the teaching text (as §5.1 drafts) is arguably enough.
- **Add a nullable `conditions.death_window_game_days`**, falling back to the global default when
  null. More accurate, and the column costs little — but it is exactly the kind of "a nullable
  column nothing else needs yet" slice 0010 §3.2 warned against building ahead of use, and no other
  condition in this pass or the existing QH panel needs a different window than the default.

**This document's own lean is the first option** — reuse the shared window, disclose the compression
honestly in text, revisit only if a future session has a second condition that genuinely needs a
different number. But per `CLAUDE.md` §2, this is exactly the kind of judgment call to put in front
of whoever is building the slice, not silently resolve here.

---

## 10. What this does not close

Same list `breed-ideal-vectors.md` §6.3 already keeps, restated with two lines now struck — one by
that document's own seeding, one by this one:

- `eligible_class_types` and `discipline_aptitudes` — still unwritten.
- `height_range` and `weight_range` — still unwritten.
- ~~Disease panels for the seven non-Quarter-Horse breeds~~ — **specified here**, not yet seeded.
- ~~Ideal vectors for seven of eight breeds~~ — **seeded 2026-08-04** (migration `0107`), alongside a
  breed-aware NPC show barn that closed `breed-ideal-vectors.md` §6.1's blocker the same day. See
  `CLAUDE.md` §10.

Writing this document does not seed it — two of the five things overview §4a calls breed identity
are still open (`eligible_class_types`/`discipline_aptitudes` and `height_range`/`weight_range`),
and this document's own six loci are drafted but not yet in the database either.
