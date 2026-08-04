# Breed conformation ideals — all eight breeds

*Written 2026-08-02. **Update 2026-08-04: all eight vectors are now live** — see the note below.*

**All eight breeds' ideal vectors are live in the database.** The Quarter Horse's is
`migrations/0035_seed_qh_ideal_vector.sql`; the other seven were seeded verbatim from §3 below by
`migrations/0107_seed_breed_ideal_vectors.sql` on 2026-08-04, alongside making the NPC show barn
breed-aware (`stockShowBarn`, `src/db/npc.ts`) rather than Quarter-Horse-only — the blocker §6
describes below. See that date's build-log entry for what was built and what is still open.

§6 is left in place as-written, unedited, because it explains *why* this took until 2026-08-04
rather than landing with the rest of the breed identity work, and that reasoning is still correct
history — just no longer a live blocker.

Overview §4a says *"building an ideal vector for a breed before there is a scorer to read it is
guessing."* The scorer now exists and has been tuned against one breed for a full slice, so the
guessing objection no longer applies — but the *fields* those classes would be judged in do not
exist yet, which is a different objection and the reason for §6.

---

## 1. What an ideal vector is

For each of the four conformation traits, a **target** on the same 1–99 scale a horse is measured
on, and a **weight** saying how much that trait matters to this breed. Stored as JSON on the
`breeds` row:

```json
{
  "v": 1,
  "traits": {
    "neck_length":    { "target": 55, "weight": 1.0 },
    "shoulder_angle": { "target": 70, "weight": 1.2 },
    "back_length":    { "target": 35, "weight": 1.1 },
    "hock_set":       { "target": 50, "weight": 0.9 }
  }
}
```

The scorer (`src/engines/showing/score.ts`) does, per trait:

```
distance    = |expressed − target|
traitScore  = max(0, 100 − distance × show_ideal_falloff)     // falloff default 2.0
weight      = breedWeight × judgeWeight
rawScore    = Σ (weight × traitScore) / Σ weight
```

Two consequences worth holding while reading the tables below:

- **At the default falloff of 2.0, being 50 points off a target scores zero on that trait.** A
  target of 82 (the Friesian's neck) means anything under 32 scores nothing there.
- **Weights are normalised away by the `Σ weight` division.** Only the *ratios* between the four
  weights matter. A breed with all weights at 1.4 scores identically to one with all at 1.0. This is
  why every vector below sits in roughly the 0.8–1.5 band — the band is arbitrary, the spread inside
  it is not.

Judges then multiply each breed weight by their own (`judges.trait_weights`, centred on 1.0), so a
breed's weighting is a tendency rather than a fixed rule.

---

## 2. What the four traits mean

Restated from `migrations/0029_seed_quantitative_traits.sql` so this document reads on its own. All
four are **bidirectional** — neither end is good, which is the whole point of having a target rather
than "higher is better".

| Trait | 1 means | 99 means |
|---|---|---|
| `neck_length` | short | long |
| `shoulder_angle` | upright | sloping |
| `back_length` | short | long |
| `hock_set` | straight (post-legged) | angled (sickle-hocked) |

---

## 3. The eight vectors

### 3.1 At a glance

Targets, with each breed's weight in parentheses. The Quarter Horse row is what is actually in the
database; the other seven are proposed.

| Breed | Neck | Shoulder | Back | Hock |
|---|---|---|---|---|
| **Quarter Horse** (built) | 55 (1.0) | 70 (1.2) | 35 (1.1) | 50 (0.9) |
| Arabian | 75 (1.4) | 72 (1.1) | 28 (1.2) | 48 (0.8) |
| Thoroughbred | 65 (1.0) | 80 (1.5) | 50 (0.9) | 55 (1.0) |
| German Warmblood | 72 (1.2) | 78 (1.3) | 52 (0.9) | 62 (1.2) |
| Friesian | 82 (1.5) | 68 (1.0) | 40 (1.0) | 62 (1.1) |
| Paso Fino | 68 (1.2) | 60 (1.0) | 30 (1.3) | 45 (1.1) |
| Icelandic | 40 (0.9) | 35 (1.2) | 42 (1.0) | 36 (1.1) |
| Nokota | 40 (1.0) | 45 (0.9) | 58 (1.1) | 36 (1.0) |

**The set is deliberately not a gradient.** Every trait has breeds wanting each end of it:

- **Neck** — Friesian (82) at one end, Icelandic and Nokota (40) at the other.
- **Shoulder** — Thoroughbred (80) against Icelandic (35). This is the sharpest contrast in the set,
  and it is real: a galloping horse wants a laid-back shoulder, a tölting pony does not.
- **Back** — Arabian (28) against Nokota (58). The Arabian's short back is a defining breed trait;
  the landrace's longer back is what an unselected horse looks like.
- **Hock** — German Warmblood and Friesian (62) against Icelandic and Nokota (36).

A child who breeds one "best horse" and enters it everywhere will find it wins in one breed's class
and places nowhere else. That is the intended lesson and it only works if the targets genuinely
conflict, which is why no two rows above are close together.

### 3.2 Quarter Horse — `QH` (already in the database, do not change)

```json
{"v":1,"traits":{"neck_length":{"target":55,"weight":1.0},"shoulder_angle":{"target":70,"weight":1.2},"back_length":{"target":35,"weight":1.1},"hock_set":{"target":50,"weight":0.9}}}
```

A moderate neck, a sloping shoulder, a short back, a middling hock. Three of four targets sit
somewhere other than the top of the scale on purpose. **This is live and has classes judged against
it — it must not be edited**, only superseded by a new migration if it is ever genuinely wrong.

### 3.3 Arabian — `AR`

```json
{"v":1,"traits":{"neck_length":{"target":75,"weight":1.4},"shoulder_angle":{"target":72,"weight":1.1},"back_length":{"target":28,"weight":1.2},"hock_set":{"target":48,"weight":0.8}}}
```

The long, high-set, arched neck is the breed's calling card and carries the heaviest weight in the
set outside the Friesian. The short back is genuinely anatomical — Arabians frequently carry five
lumbar vertebrae instead of six — so it gets the second-heaviest weight and the shortest target of
any breed. The hock is asked only to be correct, hence the lowest weight on the row.

**Selection pressure this creates:** long neck *and* short back at once, which are not correlated in
the engine, so an Arabian programme is chasing two independent traits hard. This is the tightest
standard in the set after the Friesian.

### 3.4 Thoroughbred — `TB`

```json
{"v":1,"traits":{"neck_length":{"target":65,"weight":1.0},"shoulder_angle":{"target":80,"weight":1.5},"back_length":{"target":50,"weight":0.9},"hock_set":{"target":55,"weight":1.0}}}
```

Built to gallop. The laid-back shoulder is the most extreme target in the whole set and carries the
heaviest single weight — a Thoroughbred class is very nearly a shoulder class. Everything else is
asked to be moderate: the back wants length for stride but strength against it, so it sits at the
middle honestly rather than as a shrug.

**Selection pressure this creates:** one trait dominates, so this is the most legible breed to breed
for and a reasonable one for a new player. It is also the breed where judge variance bites hardest —
a judge who down-weights shoulder scrambles the class.

### 3.5 German Warmblood — `GW`

```json
{"v":1,"traits":{"neck_length":{"target":72,"weight":1.2},"shoulder_angle":{"target":78,"weight":1.3},"back_length":{"target":52,"weight":0.9},"hock_set":{"target":62,"weight":1.2}}}
```

The modern sport horse: uphill neck, big sloping shoulder for front-leg movement, a back with enough
length to bend through, and a well-angled hock for engagement. Three of four traits carry weight
above 1.0, which makes this the most *demanding* standard in the set even though no single target is
extreme — there is nowhere to be weak.

**Selection pressure this creates:** an all-rounder, which is thematically right for a performance
breed and mechanically the hardest kind of horse to produce. Expect Warmblood classes to be won by
narrower margins than Thoroughbred ones.

### 3.6 Friesian — `FR`

```json
{"v":1,"traits":{"neck_length":{"target":82,"weight":1.5},"shoulder_angle":{"target":68,"weight":1.0},"back_length":{"target":40,"weight":1.0},"hock_set":{"target":62,"weight":1.1}}}
```

The baroque type: a very long, high, arched neck is the breed, and the standard says so with the
highest target and the heaviest weight anywhere in the set. Sloping shoulder, short-to-moderate back,
noticeably angled hock behind.

This is intentionally the hardest single trait target in the game. Overview §4a already casts the
Friesian as the hard-mode breed on genetics grounds — a closed pool where COI and recessives *are*
the experience — and the conformation standard is built to agree rather than to compensate. At
falloff 2.0 a Friesian expressing a neck of 50 scores 36 on the trait that matters most to its own
breed.

**Watch this one in play.** If Friesian classes turn out to be unwinnable rather than hard, the fix
is to soften the neck target toward 75 — a new migration, not an edit — before touching anything
structural.

### 3.7 Paso Fino — `PF`

```json
{"v":1,"traits":{"neck_length":{"target":68,"weight":1.2},"shoulder_angle":{"target":60,"weight":1.0},"back_length":{"target":30,"weight":1.3},"hock_set":{"target":45,"weight":1.1}}}
```

An elegant, high-carried neck and a genuinely short back — the short back is what a collected,
four-beat gait is carried on, so it takes the heaviest weight on the row. The shoulder is moderately
sloping rather than extreme, and the hock is asked to be slightly straighter than middling, because
the fino gait is quick and low rather than big and reaching.

**Note for whoever builds gaited classes:** this vector describes the Paso Fino *in a conformation
class*. A gaited performance class is gated on DMRT3 (overview §9) and is a different class type
entirely — it does not read this vector.

### 3.8 Icelandic — `IC`

```json
{"v":1,"traits":{"neck_length":{"target":40,"weight":0.9},"shoulder_angle":{"target":35,"weight":1.2},"back_length":{"target":42,"weight":1.0},"hock_set":{"target":36,"weight":1.1}}}
```

The compact one, and the deliberate counter-example to every sport breed above. A **shorter, thicker
neck**, a **noticeably upright shoulder**, a short-to-moderate back and a **straighter hock**. It is
the only breed in the set that wants an upright shoulder, and that single number is the clearest
teaching moment available: a horse bred to win Thoroughbred classes scores 10 out of 100 on the
Icelandic's most heavily weighted trait.

The shoulder gets the heaviest weight precisely because it is the counter-example — the standard
should be assertive about the thing that makes it different, not apologetic.

### 3.9 Nokota — `NOK`

```json
{"v":1,"traits":{"neck_length":{"target":40,"weight":1.0},"shoulder_angle":{"target":45,"weight":0.9},"back_length":{"target":58,"weight":1.1},"hock_set":{"target":36,"weight":1.0}}}
```

The landrace. Overview §4a calls it *"healthy, unrefined, unrelated to everything else"*, and the
standard describes an unselected working horse rather than a refined one: shortish neck, fairly
upright shoulder, the **longest back in the set**, straight-ish behind. Weights are close to flat,
because a landrace has no single defining feature to weight up.

Two things this is doing on purpose:

- **It is the mildest standard**, so it is a forgiving breed to show while learning. The weighted
  average distance of its targets from the population centre is the lowest of the eight.
- **It is still a real shape.** It is the only breed wanting a long back, so a Nokota that places
  well is genuinely a different animal from a Quarter Horse that places well — not just a worse one.

See §5 for why "mildest standard" needed a floor under it rather than being taken all the way to a
flat 50/50/50/50.

### 3.10 Paint, and crosses

Neither gets a vector, and neither needs one.

- **Paint is a display alias on the Quarter Horse** (overview §4a, decided 2 Aug 2026). A Paint's
  `breed_id` *is* Quarter Horse, so it is judged against the Quarter Horse standard in the Quarter
  Horse class. No row, no vector.
- **Crosses have no ideal and are not judged against one** (overview §4c). A recognised cross, if one
  is ever promoted, becomes a `breeds` row and gets a vector at that point like any other breed.

---

## 4. How these numbers were arrived at

Real breed standards, translated onto the engine's 1–99 scale. Three rules were applied throughout:

1. **No target may be "more is better."** Every one of the 32 numbers is a target a horse can
   overshoot. This is slice 0006 §2.3's whole argument carried into the standards themselves.
2. **Every trait must have breeds pulling both ways.** Checked in §3.1 — all four do.
3. **Targets should sit away from the population centre.** See §5, which is the non-obvious one.

They are a **starting point to be tuned by observation**, in exactly the sense
`migrations/0024_seed_breed_pools.sql` says its allele pools are. Nothing here is a research result,
and the first season of real showing will say more than any amount of further reasoning.

---

## 5. The one non-obvious constraint: keep targets off 50

Slice 0006 §155 names a hole and asks the show slice to check it rather than assume:

> *If a breed's ideal for some trait happens to sit near the population middle, then for that one
> trait inbreeding would help rather than hurt.*

This is real. Realization pulls an expressed value toward the bidirectional anchor of **50**, and
inbreeding depression pulls it further toward 50 (`realization()` in
`src/engines/conformation/model.ts`). So a breed whose targets sit *on* 50 would reward inbreeding on
its own conformation standard — an inbred horse would score *better*, which is backwards for the
whole design and would quietly undo the health slice's central dilemma.

A flat 50/50/50/50 vector is therefore not available, however tempting it is as "the easy breed."
This is what shaped the Nokota (§3.9): it needed to be the mildest standard *and* have no target
sitting on the centre, so it got a real if unglamorous shape instead of a shrug.

Weighted mean distance of each breed's targets from 50, as a rough exposure index — higher is safer:

| Breed | Index |
|---|---|
| Arabian | 19.4 |
| Friesian | 19.4 |
| German Warmblood | 17.2 |
| Thoroughbred | 14.8 |
| Paso Fino | 13.7 |
| Icelandic | 12.0 |
| Quarter Horse | 10.8 |
| Nokota | 9.3 |

The Quarter Horse sits low because its hock target is exactly 50 — which is why that trait carries
the lowest weight on the row, and why the two traits doing most of the work (shoulder at 70, back at
35) are far off centre. The mitigation was already in the shipped vector; this table just makes it
visible.

**None of this is a full fix.** The right fix, if the hole ever bites in play, is the one slice 0006
already names: apply inbreeding depression to the ability traits, where the direction is
unambiguous. Keeping targets off centre only reduces the exposure.

---

## 6. Why these were not seeded at first, and what seeding them took

**Historical as of 2026-08-04 — all three steps in §6.2 are done.** Left as-written below because
the reasoning for *why* a data-only migration waited on a code change is worth keeping, not because
anything here is still open.

### 6.1 The blocker is show fields, not the vectors

`createShowIfMissing` (`src/db/shows.ts:402`) creates **one class per breed whose `ideal_vector` is
non-null**, with no code change needed. Adding these seven vectors would therefore, on the very next
tick, turn every show from one class into eight.

`stockShowBarn` (`src/db/npc.ts:66`) generates **Quarter Horses only** — it looks up the `QH` breed
by code and throws if it is missing. So seven of those eight classes would have no NPC padding at
all. A class with one player entry would be a class of one, and a player would win a national-sounding
ribbon by being the only Arabian owner in the family.

That is a worse outcome than having no Arabian class, which is why this document exists instead of a
migration.

### 6.2 What has to land alongside them

Roughly in dependency order:

1. **A breed-aware NPC show barn.** ~~`stockShowBarn` stops hardcoding `QH` and stocks per breed —
   either every enabled breed, or the breeds players actually own.~~ **Done 2026-08-04**: it now
   loops every breed `getBreedsInPlay` returns with a non-null `ideal_vector` and tops each one up
   to its own target independently.
2. **A decision about empty classes.** ~~A show with eight classes where the family owns four breeds
   will have four dead classes every month unless class creation is conditioned on something.~~
   **Decided 2026-08-04: not gated.** Followed the precedent slice 0012 §5.5 already set for Gaited
   Pleasure — a class nobody entered is never topped up and simply judges zero entries; a thin class
   is strictly better than no class, and gating creation on ownership was more machinery than the
   problem needed.
3. **The migration itself.** **Done 2026-08-04**: `migrations/0107_seed_breed_ideal_vectors.sql`,
   the §3 JSON blobs pasted verbatim.

### 6.3 The rest of the breeds stage

Ideal vectors are one of five things overview §4a lists as breed identity. Seeding these did not
close the stage — still unwritten anywhere, for all eight breeds:

- `eligible_class_types` and `discipline_aptitudes` — the `disciplines` table now holds all six
  disciplines slice 0012 §5.1 named (migrations `0063` + `0108`, 2026-08-04), so this is no longer
  blocked on schema or on a thin discipline set either. Slice 0012 §2.1 deliberately shipped with no
  breed gating at all (every discipline is `crosses_eligible = 1` and open to every breed) rather
  than pre-empting this - `discipline_aptitudes` is the modifier that would make breed matter
  *beyond* the allele pools it already lives in, and building it before the aptitudes are decided
  would double-count
- `height_range` and `weight_range`
- disease panels for the seven non-Quarter-Horse breeds — the `conditions` table holds the Quarter
  Horse's four (`migrations/0053`), and overview §4a names the others' signature conditions but
  nothing has been specified

---

## 7. If you change a number in this file

Change it **here and in a new migration**, never by editing a shipped one (`CLAUDE.md` §8). And
note that `show_classes.ideal_vector` is snapshotted at class creation (`CLAUDE.md` §5.5), so a
retuned standard affects classes created afterwards and leaves judged history alone — which is the
behaviour you want, and also means a change takes effect a month later rather than immediately.
