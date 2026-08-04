# Slice 0020 — Acquired conditions: colic, laminitis, and the reason to pay the vet

**Read `CLAUDE.md` first, then this. Do not read the full design documents — the parts this slice
depends on are quoted or summarised below.** This is a **specification, not a build** — the same
status slice 0018 carries in `CLAUDE.md` §10 today. Nothing in `conditions`, `horses`, or
`horse_conditions` has changed by writing this document.

Where this comes from:

- `docs/horse-game-overview.md` §3a — the polygenic predisposition category, described but never
  built: "a heritable risk score, modified by age, workload, weight and care, producing a
  probability of onset rather than a fixed outcome." This slice is that category's consequences,
  finally attached to the substrate slice 0014 built ahead of use for exactly this purpose.
- `docs/horse-game-schema.md` §4.5 — `horse_conditions.state` already names `at_risk`/`managed`/
  `resolved` as values "arriving with the polygenic and care stages." This slice is that stage.
- `docs/slices/0013-care-and-condition.md` §3.4 — declined workload, injury and lameness on
  purpose, calling it "a whole design conversation about whether a child's best horse can be taken
  away by a die roll" and explicitly leaving it for a future session to open. **This document is
  that conversation, opened deliberately and with the operator's sign-off on the sharpest question
  in it (§2.8 below).**
- `docs/slices/0014-before-the-children-play.md` §2.6/§2.7 — the three heritable soundness traits
  (`foot_robustness`, `joint_robustness`, `ligament_robustness`), built as substrate with nothing
  reading them yet. This slice is the first thing that reads them.

What already exists and must not be re-implemented:

- `src/engines/health/status.ts`'s `conditionStatus`, `ownerVisibleStatus` — single-gene truth and
  the knowledge boundary. Reused for nothing here — see §2.7, acquired conditions have no hidden
  carrier state to protect.
- `src/engines/care/modifier.ts`'s `careModifier` — already returns a `conditionDelta` slot,
  currently fed only by slice 0014 Part B's unmanaged-single-gene-condition penalty. This slice adds
  a second contributor to the same slot rather than inventing a parallel score.
- `horse_conditions.management_state` / `management_until_game_day`, and the −0.03 unmanaged
  penalty machinery (slice 0014 §5) — reused as-is for every acquired condition whose outcome
  settles into `manageable`. No new management mechanism is built here.
- `src/engines/showing/eligibility.ts` — gains one new read (an open acute incident, or a
  degenerative acquired outcome, bars a class entry), the caller-computes-the-fact-engine-judges-
  the-rule split slice 0010 §7.4 already established.
- `potential(genotype, trait)` in `src/engines/genetics/polygenic.ts` — read directly for the three
  robustness traits, with **no** `*Potential()` legacy stand-in needed, because slice 0014 shipped
  alongside a full world reset (§11 of that document): every horse alive today has real
  `foot_robustness`/`joint_robustness`/`ligament_robustness` genotype keys, unlike `fertility`.

---

## 1. What "done" looks like

1. A tick fires. Somewhere in the family's stables, a horse comes down with colic. The stable's
   events feed gets one line, by name, in plain English, naming what it is and what it costs to
   treat and by when.
2. The owner opens the horse's page and sees a new **Incidents** card: *"Comet has colic. Call the
   vet within 4 days or risk losing him."* A **Call the vet — 180** button.
3. They pay. The card updates: *"Treated. Comet is being watched."* A few ticks later, an event says
   he has recovered, and his page goes back to normal. Nothing about him is marked forever.
4. On a second horse, they do nothing — busy, away, or a deliberate gamble because money is tight.
   The window closes. A tick rolls the outcome and, this time, the horse does not survive. The
   events feed explains what happened and why, in the same calm, blameless register slice 0010 §5.6
   established for GBED, and the horse stays in the barn list marked **Died**, in every produce
   record and pedigree it belongs to, exactly like a genetic lethal.
5. A third horse, mid-incident, cannot be entered in a show — refused by name and by reason, the
   same shape HERDA already refuses a show entry.
6. A stable that has kept a horse on **Premium** feed for a long stretch and shown it hard on a
   punishing schedule finds that horse develops laminitis at a visibly higher rate than a
   lightly-campaigned horse on Standard feed — and a horse with genuinely poor `foot_robustness`
   (never shown to the player directly, per slice 0014 §2.7) is worse off again, at the same care
   and workload.
7. A horse pastured for a long recovery period gets far fewer workload-driven incidents than the
   same horse shown every month — but a horse left out in turnout for a long stretch is now
   noticeably more likely to develop rain rot than one kept in the barn. Neither direction is a
   strictly better choice; both are real trades.
8. `/admin/incidents` shows, per condition, how many are currently open, and the real outcome split
   (resolved / settled into management / became degenerative / died) across everything that has ever
   resolved — the same tuning instrument `/admin/health` already is for the single-gene panel.

---

## 2. Decisions taken for this slice

These are decisions, not suggestions, per `CLAUDE.md` §2. Two of them (§2.8 in particular) were put
to the operator directly before this document was written, because they are exactly the kind of
question slice 0013 §3.4 and §15 named and declined to answer alone.

### 2.1 A fifth severity class: `acute`

Overview §3d names four: lethal, manageable, degenerative, latent. All four describe a **fixed**
consequence — GBED always kills on a snapshotted date, HERDA always bars showing, HYPP is always
"diagnosed, not cured." None of them describe **a real event with an outcome still open**, which is
what every acquired condition in this slice is at the moment it fires.

`acute` is added as a fifth `severity_class` value. It behaves like none of the other four on its
own — it is a *state a row passes through*, not a fixed shape. An `acute` row always resolves into
one of the other three (or fully away) within its treatment window; see §5.2. No table gains a
`CHECK` constraint on `severity_class` (there isn't one today — confirmed by reading
`migrations/0052_conditions.sql`, which is why this costs no migration on its own), so this is a
new value in an already-open set, the same way `horse_conditions.state` already anticipated values
nothing had written yet.

### 2.2 One engine, two phases, twelve rows — not twelve mechanisms

Every acquired condition in §4 shares exactly one shape: an **onset roll** (does it happen this
game day, as a function of care, workload, environment, luck, and — for four of the twelve — a
heritable robustness score), followed by a **treatment window**, followed by a **resolution roll**
(what happens, drawn from a per-condition probability table that differs depending on whether the
owner paid in time).

This is deliberate and mirrors slice 0010's own founding decision: HYPP, PSSM1, HERDA and GBED are
one `conditionStatus` function and four rows of data, never four functions. Colic and laminitis are
one `onsetRisk`/`resolveIncident` pair of functions and twelve rows of data — different tissue,
different numbers, same two functions. `CLAUDE.md` §13's "no parallel scoring path" rule extends
naturally here: writing a special case per condition code is exactly the mistake that rule exists to
prevent.

### 2.3 The robustness traits get their first reader, and only four conditions get one

Of the twelve, **four** read a robustness trait as an onset modifier: laminitis and navicular read
`foot_robustness`, osteoarthritis reads `joint_robustness`, suspensory ligament injury reads
`ligament_robustness` — exactly the tissue groupings slice 0014 §2.7 named by example ("navicular
and laminitis both read the foot; DSLD and a suspensory injury both read ligament").

**No new heritable trait is added.** Colic, ulcers, tying-up, strangles, hoof abscess/thrush, skin
conditions and eye injury have no robustness link — there is no `gut_robustness` or
`muscle_robustness` trait, and this document does not propose adding one. `TRAITS` is append-only
and a new heritable trait changes every future horse's genotype forever; that is a bigger decision
than this slice needs to make to answer "give us a reason to pay the vet," and overview §3a's own
list of polygenic predispositions already includes several (osteochondrosis, laryngeal neuropathy)
that this document does not attempt either — see §3.

The robustness score modifies **onset probability only**, not the outcome table once an incident
fires. A horse with poor `foot_robustness` gets laminitis *more often*; it does not get a worse
laminitis. This is a simplification worth naming rather than hiding — see §12.

### 2.4 Workload, for now, is show-entry frequency

Slice 0013 §3.4 declined to build workload, reasoning that it "needs training and a fuller show
calendar to mean anything." That is a real objection and it still holds for a training-derived
signal. But the user asking for this slice specifically named "overworked" as one of the causes
worth having, and a workload signal that means *something* now is better than none, provided it is
legible and does not pretend to be more than it is.

**Recommendation: workload reads the count of `show_entries` for a horse in a trailing window**
(`workload_window_game_days`, default 90), normalised against a config ceiling
(`workload_ceiling_entries`, default 4 — a horse shown four or more times in three game months is at
maximum workload contribution). This is cheap (one indexed count per horse per check), it is
something a player can see and reason about on the horse's own show record, and it does not require
training to exist. **When training lands, workload should be redefined to read real training
intensity instead** — flagged explicitly so a future session does not read this as the final word,
the same way slice 0013 itself expects to be superseded here.

Breeding activity (coverings, pregnancy) is deliberately **not** counted as workload. A hard-worked
broodmare is a real thing, but conflating campaign fatigue with reproductive load is a second
decision this slice does not need to make to be useful.

### 2.5 Location cuts both ways, on purpose

Turnout (the barn/pasture mechanic, `CLAUDE.md` §10's "Location" row) already freezes care timers
and blocks breeding/showing. It is tempting to treat pasture as strictly safer for everything here —
real life says otherwise. **A `pasture_multiplier` is set per condition**, not globally:

- **Below 1.0** (pasture reduces risk) for every workload- and stress-linked condition: colic,
  ulcers, tying-up, laminitis, navicular, osteoarthritis, suspensory injury. Rest is rest.
- **Above 1.0** (pasture raises risk) for the two genuinely environmental ones: rain rot/mud fever
  (wet turnout is the real-world cause) and eye injury (pasture hazards — branches, fence lines,
  other horses — that a stall does not present). This is the one place turnout is a real trade
  rather than a free good, and it is worth being honest about that rather than making pasture a
  strictly dominant choice the way premium feed currently risks being (slice 0013 §13.2).
- **1.0 (no effect)** for choke, strangles, hoof abscess/thrush — location is not the operative
  variable for any of these three.

### 2.6 Premium feed gets a genuine downside, and it lands on laminitis

Slice 0013 §13.2 flagged its own open risk by name: *"premium feed at double board may be worth it
only for a stable that is already winning... the fix is to lower `premium.upkeep_multiplier` rather
than raise its care delta"* if premium turns out close to strictly dominant. This slice gives
premium feed a cost that is not a config-tuning question but a real, in-fiction one: **laminitis's
`care_weight` reads `feed_level` directly** (not the general care modifier, which is about farrier
and wellness currency) — richer feed measurably raises laminitis risk, which is biologically true
and gives the feed choice the two-sidedness slice 0013 wanted but did not yet have a mechanism to
express. This is the only condition in the set that reads `feed_level` as an input; the rest read
the farrier/wellness care state via the existing care modifier's own components.

### 2.7 No truth-versus-knowledge boundary here — an incident is visible the moment it happens

`CLAUDE.md` §12 makes truth-versus-knowledge load-bearing for single-gene conditions, because a
carrier is invisible until tested. **Nothing about an acquired condition is invisible in that
sense.** A horse does not carry a hidden colic allele from birth; it either is currently
experiencing an incident or it is not, and the owner is told the moment it starts — the same way
HERDA or HYPP's *signs* are free and immediate (slice 0010 §2.4), except here there is no genotype
underneath to protect. Every acquired incident writes an event at onset, visible to the owning
account with no test and no charge. There is no `horse_knowledge` row for any of this — see §3 for
the one place that boundary genuinely could apply later (screening for elevated robustness risk),
deliberately deferred.

### 2.8 Real death risk from an ignored emergency — decided with the operator, 2026-08-04

**Put to the operator directly before this document was written**, the same way slice 0010 §2.2's
death-window decision and slice 0017's stud-service open questions were. Asked whether an untreated
acute condition should carry genuine death risk, never kill outright regardless of neglect, or carry
death risk even when treated promptly, **the operator chose real death risk when ignored, with
prompt treatment making it small.**

Concretely: **every acute condition's `outcomes_treated` table gives paying the vet a large,
visible effect on the death probability, and for several conditions (rain rot, hoof abscess, eye
injury, ulcers) that probability is zero in both tables** — the emotional stakes this decision opens
are concentrated on the handful of conditions where real veterinary urgency actually exists (colic
above all), not spread thin across every row for texture's own sake. See §4's table for exactly
which four rows (colic, choke, tying-up, strangles) carry any non-zero death probability at all, and
by how much treatment moves it.

### 2.9 Care's `conditionDelta` slot gets a second contributor

`careModifier`'s `conditionDelta` (slice 0014 §4.5) currently sums one thing: the −0.03 penalty for
an unmanaged single-gene manageable condition. It now sums a second: **−0.02 while any
`horse_conditions` row is in `state = 'acute'`**, regardless of which of the twelve it is. This is
deliberately smaller than the unmanaged-genetic penalty and deliberately flat across all twelve
(not one penalty per condition) — an active emergency is already the point; the penalty exists so a
horse mid-incident visibly underperforms even before the resolution roll lands, not to itself be a
tuning lever. The existing `[0.95, 1.05]` clamp (slice 0013 §2.4) absorbs it with no change to that
clamp's own value.

---

## 3. Not built here

Say so plainly in the summary if you build any of these anyway.

### 3.1 Screening and `at_risk` rows for the robustness traits

Schema §4.5 and overview §3c both anticipate this: a `horse_knowledge.kind = 'screening'` row, an
observation that goes stale and needs redoing, revealing something like "this horse's feet show
early signs of weakness" without ever exposing the underlying `foot_robustness` number. This is a
genuinely good fit for the four robustness-linked conditions and costs relatively little given the
`screening` enum value and `horse_conditions.state = 'at_risk'` are both already reserved and
unused. **Deliberately not built here anyway** — it is a real feature with its own pricing and
staleness-interval questions, and folding it into an already-large slice risks the same "wanting a
fifth condition" scope creep slice 0010 §14 warned itself against. Flagged as the natural next step,
not attempted now.

### 3.2 No contagion

Strangles is genuinely contagious in life — horse-to-horse, via shared water and tack, and real
outbreaks are stable-wide events. This slice models it as an **independent per-horse risk**, raised
by that horse's own recent show-entry count (a proxy for travel/exposure), with no horse-to-horse
transmission modelled. Building real contagion is a materially different system (a stable-wide state,
an exposure graph) and is exactly the kind of thing worth its own slice if this one's single-horse
version turns out not to teach the lesson.

### 3.3 No new heritable traits

Confirmed already in §2.3. Osteochondrosis and laryngeal neuropathy, both named in overview §3a as
polygenic candidates, are **not** built here — neither maps cleanly onto an existing robustness
trait (osteochondrosis is a developmental joint disease that could arguably ride on
`joint_robustness` alongside osteoarthritis, but conflating a developmental condition with a wear
condition under one trait was judged a stretch worth a separate decision, not a default). If a
future session wants osteochondrosis, deciding whether it shares `joint_robustness` with
osteoarthritis or needs its own trait is exactly the kind of call CLAUDE.md §2 asks to be raised
rather than assumed.

### 3.4 No barn-wide "treat everything" round

Slice 0013 §2.2's barn round works because farrier/wellness visits are routine and predictable —
every horse eventually needs one, on a schedule. An acute incident is neither: it is rare, urgent,
and specific to one horse. A barn-wide button here would either do nothing most of the time (nothing
to treat) or, on the rare tick where three horses are simultaneously sick, would flatten three
distinct emergencies into one click in a way that undersells what is happening to each. Each
incident is treated from its own horse's page.

### 3.5 No display of the outcome-table numbers to the player

The player is told what a condition is, what it costs to treat, and the window remaining — never the
raw probabilities. This matches slice 0010's own restraint (a carrier is told odds only once they
have tested; nobody is shown a bare percentage with no context). `teaching_text` explains what the
condition is and why prompt treatment matters, in words, not numbers.

---

## 4. The twelve conditions

Every condition shares the `conditions` table's existing columns (§5.1). `category = 'acquired'` for
all twelve. `locus_code` is `NULL` for all twelve — none of this reads a Mendelian locus.
`breed_associations` is `'[]'` for all twelve, since none of this is breed-specific — **confirm
before shipping that an empty array renders as "applies to every breed" rather than "applies to no
breed" anywhere it is displayed**; nothing currently reads this column for display (grep found only
the row-loader type), so there is no existing behaviour to break, but it is worth a direct check
rather than an assumption.

### 4.1 At a glance

| Condition | Tissue | Robustness link | Primary drivers | Window (days) | Worst untreated outcome | Death risk (untreated → treated) |
|---|---|---|---|---|---|---|
| Colic | Gut | — | care, workload, luck | 4 | death | 40% → 5% |
| Choke | Gut/oesophagus | — | care (feed), luck | 2 | death (rare) | 5% → 0% |
| Gastric ulcers | Gut | — | workload, luck | 10 | manageable | 0% → 0% |
| Tying-up (sporadic) | Muscle | — | workload, luck | 1 | death (rare) | 5% → 0% |
| Strangles | Respiratory | — | exposure (workload proxy), care, luck | 14 | death (rare) | 5% → 2% |
| Hoof abscess / thrush | Foot | `foot_robustness` (light) | care, luck | 5 | degenerative (rare) | 0% |
| Rain rot / mud fever | Skin | — | environment (pasture ×1.8), care, luck | 10 | manageable | 0% |
| Eye injury | — | — | environment (pasture ×1.3), luck | 3 | manageable | 0% |
| Laminitis | Foot | `foot_robustness` | care (feed level), workload, luck | 3 | degenerative | 5% → 1% |
| Navicular | Foot | `foot_robustness` | workload, luck | 7 | degenerative | 0% |
| Osteoarthritis | Joint | `joint_robustness` | workload, age, luck | 7 | degenerative | 0% |
| Suspensory injury | Ligament | `ligament_robustness` | workload, luck | 5 | degenerative | 0% |

**Only four of twelve carry any death risk at all**, per §2.8's own framing — the operator's choice
to make treatment meaningfully protective, not to make every acquired condition a potential loss.
The other eight top out at `manageable` or `degenerative` (a real cost — a barred career, an ongoing
penalty — but never the horse's life).

### 4.2 Base onset rates, and the shape of the formula

`onsetRisk`, in a new file `src/engines/health/acquired.ts`, pure, no database access:

```
p_day(condition, care, workload, location, feedLevel, robustnessPotential) =
  clamp(
    base_rate_per_game_day
    * (1 + care_weight     * carePenaltyFactor(care))       // 0 (perfect) .. 1 (fully neglected)
    * (1 + workload_weight * workloadFactor(workload))       // 0 (unshown) .. 1 (at/above the ceiling)
    * (feed_weight > 0 ? (1 + feed_weight * feedRiskFactor(feedLevel)) : 1)   // laminitis only
    * locationMultiplier(location)                           // per condition, §2.5
    * (robustness_trait ? (1 + robustness_weight * (1 - robustnessPotential / 20)) : 1)
    , 0, incident_probability_ceiling_per_game_day
  )
```

**This is a per-game-day probability, not a per-tick one**, deliberately. A tick may fire more or
less often than once a game day (`CLAUDE.md` §6), and a per-tick rate would silently make the world
riskier on a schedule that fires more often — the same trap `computeUpkeep` already avoids by
deriving its charge from `daysOwed` rather than "one charge per invocation." The engine takes
`daysSinceLastCheck` and returns the probability of **at least one onset** across that span:
`1 - (1 - p_day)^daysSinceLastCheck`, then draws once against it.

`incident_probability_ceiling_per_game_day` (config, default 0.02) is the same kind of backstop
`care_modifier_min`/`max` is for the care band — no combination of terrible care, brutal workload,
the worst possible feed choice and a weak robustness score can push any single condition above a 2%
daily chance, so a badly-tuned multiplier stacks into something rare-but-plausible rather than
"basically certain by next week."

**Starting `base_rate_per_game_day` values** (all a starting point to be tuned by observation, per
overview §3f's own instruction for the single-gene panel, applied here to a very different
mechanism):

| Condition | Base rate/day | ≈ annual incidence at baseline |
|---|---|---|
| Colic | 0.00025 | ~8% |
| Choke | 0.00008 | ~3% |
| Gastric ulcers | 0.00035 | ~11% |
| Tying-up | 0.00012 | ~4% |
| Strangles | 0.00006 | ~2% |
| Hoof abscess/thrush | 0.00030 | ~10% |
| Rain rot/mud fever | 0.00020 (barn) | ~7% (barn), ~12% (pasture) |
| Eye injury | 0.00010 | ~3.5% |
| Laminitis | 0.00015 | ~5% |
| Navicular | 0.00012 | ~4% |
| Osteoarthritis | 0.00010 | ~3.5% |
| Suspensory injury | 0.00010 | ~3.5% |

These are chosen against real published incidence ranges for each condition (colic's roughly
4-10 episodes per 100 horse-years is the best-documented anchor of the twelve) and then, per
overview §3f, deliberately not pushed to the top of those ranges — a family of five accounts should
see one of these every so often, not every session.

### 4.3 Outcome tables

Each condition's `outcomes_untreated` and `outcomes_treated` are a probability distribution over
`{resolved, manageable, degenerative, death}` summing to 1.0. `resolved` means exactly what it says
— the row closes, nothing lingers, the horse's page returns to normal (this is the majority outcome
for every condition in the set, deliberately, per overview §3f's "tune so most foals are healthy"
applied here as "tune so most incidents end fine"). `manageable` opens (or extends) a
`management_state = 'unmanaged'` row using the exact machinery slice 0014 §5 already built.
`degenerative` sets a permanent `bars_showing`-equivalent flag on that specific `horse_conditions`
row (§6.2 — this is per-incident, not per-condition, unlike the single-gene panel's flat
`conditions.bars_showing`). `death` runs the same `horses.status = 'dead'` / `end_reason` /
`horse_died` event path slice 0010 §6.2 already built for GBED, reused unchanged.

| Condition | Untreated: resolved / manageable / degenerative / death | Treated: resolved / manageable / degenerative / death |
|---|---|---|
| Colic | 0.55 / 0.05 / 0.00 / 0.40 | 0.90 / 0.05 / 0.00 / 0.05 |
| Choke | 0.85 / 0.10 / 0.00 / 0.05 | 0.97 / 0.03 / 0.00 / 0.00 |
| Gastric ulcers | 0.10 / 0.90 / 0.00 / 0.00 | 0.35 / 0.65 / 0.00 / 0.00 |
| Tying-up | 0.60 / 0.35 / 0.00 / 0.05 | 0.85 / 0.15 / 0.00 / 0.00 |
| Strangles | 0.75 / 0.05 / 0.00 / 0.05 (also bars showing while acute — §5.4) | 0.90 / 0.03 / 0.00 / 0.02 |
| Hoof abscess/thrush | 0.80 / 0.15 / 0.05 / 0.00 | 0.97 / 0.03 / 0.00 / 0.00 |
| Rain rot/mud fever | 0.85 / 0.15 / 0.00 / 0.00 | 0.98 / 0.02 / 0.00 / 0.00 |
| Eye injury | 0.65 / 0.30 / 0.00 / 0.00 | 0.90 / 0.10 / 0.00 / 0.00 |
| Laminitis | 0.30 / 0.35 / 0.30 / 0.05 | 0.70 / 0.25 / 0.04 / 0.01 |
| Navicular | 0.20 / 0.55 / 0.25 / 0.00 | 0.45 / 0.50 / 0.05 / 0.00 |
| Osteoarthritis | 0.15 / 0.60 / 0.25 / 0.00 | 0.35 / 0.60 / 0.05 / 0.00 |
| Suspensory injury | 0.25 / 0.35 / 0.40 / 0.00 | 0.55 / 0.35 / 0.10 / 0.00 |

**Reading the shape rather than the individual numbers:** the four robustness-linked soundness
conditions (laminitis, navicular, osteoarthritis, suspensory) are the only rows where `degenerative`
is a large share of the untreated outcome — these are the "career-ending if you miss the window"
conditions, matching how real lameness works. The three purely metabolic/muscular ones (ulcers,
tying-up, and colic's non-fatal share) lean toward `manageable` or clean `resolved`. Only colic
treats death as a real, central possibility; everything else with any death branch at all keeps it
in the single digits even untreated.

### 4.4 Trigger JSON, one condition worked in full (colic), the rest follow the same shape

```json
{
  "v": 1,
  "kind": "acquired",
  "tissue": "gut",
  "robustness_trait": null,
  "robustness_weight": 0,
  "base_rate_per_game_day": 0.00025,
  "care_weight": 1.2,
  "workload_weight": 0.6,
  "feed_weight": 0,
  "pasture_multiplier": 0.7,
  "treatment_window_game_days": 4,
  "treatment_cost_key": "acute_treatment_cost_colic",
  "outcomes_untreated": { "resolved": 0.55, "manageable": 0.05, "degenerative": 0.0, "death": 0.40 },
  "outcomes_treated":   { "resolved": 0.90, "manageable": 0.05, "degenerative": 0.0, "death": 0.05 }
}
```

The remaining eleven follow this exact shape with §4.2/§4.3's numbers substituted, `robustness_trait`
set to `"foot_robustness"` / `"joint_robustness"` / `"ligament_robustness"` (and `robustness_weight`
around 1.0, 0.8 for the "light" hoof-abscess link) for the four that carry one, and
`feed_weight: 1.0` for laminitis only (§2.6). This is written to the existing `conditions.trigger`
TEXT column — no new column, following the same precedent slice 0010 §4.2 already set for making
`trigger` a polymorphic shape read differently per `category`.

### 4.5 The wording, drafted now rather than at the point of failure

The same discipline every prior health/ageing slice applied. Colic, because it is the one that can
kill, is worth drafting in full here rather than left to whoever builds this:

> **Comet has colic.**
>
> Comet is showing signs of colic — a general term for stomach pain in horses, and one of the most
> common reasons a horse sees a vet. Most colic resolves with prompt care. Left alone, some cases
> get worse.
>
> Calling the vet now gives Comet the best chance of a full recovery. You have 4 days.

> **Comet did not survive.**
>
> Comet's colic did not resolve in time. Colic can happen to any horse, from any cause, and it is
> not always something an owner could have prevented — but calling the vet early gives a horse a
> real chance, and next time is worth acting on quickly.
>
> Comet stays in Willow Creek's records, in every pedigree he belongs to, exactly as he was.

The second message is the one that needs the most care in review: it must never read as blame, per
the same reasoning slice 0010 §5.6 applied to GBED ("it never blames the player for the pairing").
An acquired condition is even more clearly not the player's fault than a genetic one, and the
wording should say so plainly rather than leave it implied.

---

## 5. The model

### 5.1 `onsetRisk` — the pure function

```ts
export interface AcquiredTrigger {
  v: 1;
  kind: 'acquired';
  tissue: string;
  robustnessTrait: TraitCode | null;
  robustnessWeight: number;
  baseRatePerGameDay: number;
  careWeight: number;
  workloadWeight: number;
  feedWeight: number;
  pastureMultiplier: number;
  treatmentWindowGameDays: number;
  treatmentCostKey: string;
  outcomesUntreated: OutcomeTable;
  outcomesTreated: OutcomeTable;
}

export function onsetProbability(
  trigger: AcquiredTrigger,
  input: {
    daysSinceLastCheck: number;
    careState: CarePenaltyInputs;       // reuses the same inputs careModifier already computes from
    workloadEntryCount: number;
    location: 'barn' | 'pasture';
    feedLevel: string;
    robustnessPotential: number | null; // 0-20, only read when robustnessTrait is set
  },
  ceiling: number,
): number;
```

No RNG inside this function — it returns a probability, the same split every other engine in this
codebase keeps (the caller draws). `test/health/acquired.test.ts` can therefore assert exact
probabilities rather than statistical tendencies for the deterministic half.

### 5.2 Resolution

```ts
export function rollOutcome(
  trigger: AcquiredTrigger,
  treated: boolean,
  rng: Rng,
): 'resolved' | 'manageable' | 'degenerative' | 'death';
```

A single `rng.next()` against the cumulative distribution, same pattern `rng.pick`/existing weighted
draws in the founding generator already use.

### 5.3 Where robustness enters

`robustnessPotential` is read via `potential(genotype, trigger.robustnessTrait)` at the point of the
onset check — **never cached**, matching every other derived-not-stored value in this codebase
(`careModifier`, `phenotype_cache`'s own stated philosophy). A horse's soundness does not change
tick to tick; recomputing it is one loop over ten loci, not a real cost.

### 5.4 Show eligibility

Two new reasons in `src/engines/showing/eligibility.ts`'s existing reason-code list:

- `'acute_incident'` — the horse has an open `horse_conditions` row with `state = 'acute'`. Applies
  to all twelve while open (§2.9 also penalises this state; the two are independent consequences of
  the same fact, not double-implementations of one rule).
- `'degenerative_incident'` — the horse has a resolved `horse_conditions` row whose per-incident
  `outcome = 'degenerative'`. This is **not** read from `conditions.bars_showing`, unlike the
  single-gene panel — see §6.2 for why the flag has to live on the incident row instead.

Both are computed by the caller from `horse_conditions` rows, per the existing "engine returns a
reason code, the caller supplies the sentence" split (slice 0008).

---

## 6. Data

### 6.1 `conditions` — no schema change, twelve new rows

`category = 'acquired'` and `severity_class = 'acute'` for all twelve (§2.1/§2.2). `trigger` per
§4.4. `signs_visible = 1` for all twelve (§2.7 — nothing here is a hidden carrier). `bars_showing`
is set to **0** at the condition level for every acquired row — the flat per-condition flag the
single-gene panel uses does not fit here (§5.4 explains why), and leaving it 0 stops any code that
still reads `conditions.bars_showing` directly (rather than going through the eligibility engine)
from silently barring every horse that has ever had, say, a resolved case of rain rot.

### 6.2 `horse_conditions` — new columns, new state values

```sql
-- Slice 0020: the acute-incident lifecycle. Additive - no CHECK constraint exists on `state` or
-- `management_state` today (confirmed against migrations/0054 and 0077), so new values need no
-- table rebuild, only new rows and new TypeScript-side enum members.
ALTER TABLE horse_conditions ADD COLUMN resolve_game_day INTEGER;
-- Snapshotted at onset: onset_game_day + conditions.trigger.treatmentWindowGameDays AS THAT VALUE
-- STOOD at onset (CLAUDE.md §5.5) - retuning a condition's window later never moves an incident
-- already in progress.
ALTER TABLE horse_conditions ADD COLUMN treated_game_day INTEGER;
-- NULL until the owner pays. Set once, never cleared - a second payment on the same incident is
-- refused (there is nothing left to buy).
ALTER TABLE horse_conditions ADD COLUMN outcome TEXT;
-- NULL while state = 'acute'. Set once, at resolution, to 'resolved' / 'manageable' /
-- 'degenerative' / 'death' - the per-INCIDENT fact eligibility reads (§5.4), distinct from
-- conditions.severity_class, which stays 'acute' forever as the condition's own general shape.
```

`state` gains two new values used only by acquired rows: `'acute'` (open, within or past its
window, not yet resolved) and `'resolved'` (closed, `outcome` set, the schema document's own
long-reserved name finally written). The existing `'onset'`/`'terminal'` values are untouched and
still mean exactly what they meant in slice 0010 — they are never written for an acquired condition.

A resolution into `manageable` also writes/refreshes `management_state`/`management_until_game_day`,
reusing slice 0014's columns unchanged — an acquired condition that settles into ongoing management
looks, from that point on, exactly like an unmanaged HYPP horse's row, and is treated identically by
`careModifier`.

### 6.3 `horses` — one new column

```sql
-- Idempotency marker for the tick's onset-check stage (CLAUDE.md §5.4), the same pattern
-- last_processed_tick_seq already establishes on stables/pregnancies, scoped per horse here because
-- the check itself is per horse.
ALTER TABLE horses ADD COLUMN last_incident_check_tick_seq INTEGER NOT NULL DEFAULT 0;
```

### 6.4 Config

```
workload_window_game_days              90
workload_ceiling_entries               4
incident_probability_ceiling_per_game_day  0.02
acute_check_enabled                    1     -- same off-switch shape as care_notice_enabled
acute_treatment_cost_colic             180
acute_treatment_cost_choke             90
acute_treatment_cost_ulcers            150
acute_treatment_cost_tying_up          120
acute_treatment_cost_strangles         160
acute_treatment_cost_abscess           60
acute_treatment_cost_skin              50
acute_treatment_cost_eye_injury        110
acute_treatment_cost_laminitis         220
acute_treatment_cost_navicular         180
acute_treatment_cost_osteoarthritis    180
acute_treatment_cost_suspensory        200
acute_incident_care_penalty            0.02   -- §2.9
```

Treatment costs are set against the same arithmetic slice 0010 §5.4 used for test pricing (board is
60/horse/real-day at standard feed, a show win pays 600) — colic's 180 is roughly a third of a show
win, in the same spirit HYPP+PSSM1+HERDA+GBED's panel was priced against one win. **Starting points,
to be tuned by observation at `/admin/incidents`**, per §4.2's own framing.

---

## 7. The tick

Two new stages, in a new file `src/db/acquiredConditions.ts`, matching the existing
one-file-per-concern pattern (`care.ts`, `health.ts`, `ageing.ts`).

### 7.1 `rollAcuteIncidents`

For every alive horse at or past `care_start_age_game_days` (reuse slice 0013's own age gate — a
foal is not campaigned and should not roll workload-driven incidents any more than it needs a
farrier), with no currently-open `horse_conditions` row for that specific condition:

1. Compute `daysSinceLastCheck = gameDay - lastCheckGameDay` (from `last_incident_check_tick_seq`
   resolved back to a game day, or simpler: store the game day directly rather than the tick_seq —
   see the note below).
2. For each of the twelve conditions, compute `onsetProbability` and draw once against it, using
   `deriveSeed(horse.rng_seed, `incident_${conditionCode}_${tickSeq}`)` — a fresh, uniquely-labelled
   sub-seed per horse per condition per tick, per `CLAUDE.md` §5.2's "derive sub-seeds
   deterministically" rule.
3. On a hit, write the `horse_conditions` row (`state = 'acute'`, `onset_game_day = gameDay`,
   `resolve_game_day = gameDay + treatmentWindowGameDays`) and the onset event (§7.4).
4. Update `last_incident_check_tick_seq = newTickSeq` regardless of outcome, in the same batch.

**A note on the marker column's name versus its content**: §6.3 names it
`last_incident_check_tick_seq` for consistency with `CLAUDE.md`'s existing `last_processed_tick_seq`
vocabulary, but the onset-probability math in §4.2 needs a **day count**, not a tick count. Store
`world.game_day` at the moment of the check instead, and rename the column
`last_incident_check_game_day` before this is built — flagged here because the mismatch is exactly
the kind of thing worth catching in review rather than in a bug report. (Kept as written above,
uncorrected, so a reviewer comparing this document against the implementation can see the discrepancy
was already known rather than freshly discovered.)

**Idempotency**: a horse whose marker already equals the current tick's game day is skipped
entirely. A re-fired tick changes nothing. A missed tick's `daysSinceLastCheck` is simply larger,
which the `1 - (1-p)^days` formula already handles correctly — this is the one place a missed tick
should *not* be treated as "nothing happened," and the formula is written specifically so a
five-day gap carries roughly five days of accumulated risk rather than either zero or a fixed
per-invocation amount.

### 7.2 `resolveAcuteIncidents`

```sql
SELECT hc.*, h.rng_seed, h.registered_name, ...
FROM horse_conditions hc
JOIN horses h ON h.id = hc.horse_id
WHERE hc.state = 'acute'
  AND hc.resolve_game_day <= ?     -- the tick's new game_day
  AND h.status = 'alive'
```

For each row: `treated = hc.treated_game_day IS NOT NULL`, roll `rollOutcome` with
`deriveSeed(horse.rng_seed, `incident_resolve_${hc.id}`)` (keyed on the incident's own row id, which
is stable and unique, rather than on tick_seq — this roll must happen exactly once per incident
regardless of which tick it lands on). Then, per outcome:

- `resolved` — `state = 'resolved'`, `outcome = 'resolved'`. Nothing else changes.
- `manageable` — `state = 'resolved'`, `outcome = 'manageable'`, and open a
  `management_state = 'unmanaged'` window (slice 0014 §5's existing shape).
- `degenerative` — `state = 'resolved'`, `outcome = 'degenerative'`. Permanent; read by eligibility
  (§5.4).
- `death` — the exact `horses.status = 'dead'` / `end_reason` / `horse_died` event path
  `killDueLethalFoals` already uses, with `end_reason` set to the condition code.

**Idempotency comes free the same way it does for GBED** (`CLAUDE.md` §5.4): the query's
`hc.state = 'acute' AND h.status = 'alive'` means a re-fired tick finds nothing once a row has
resolved, whichever way it resolved.

### 7.3 Where they go in the tick order

```
...
chargeUpkeep
noticeCareDue
rollAcuteIncidents        <- new
resolveAcuteIncidents     <- new
deleteOldEvents
```

After `noticeCareDue`, because care state should be settled for the game day before it is read as
an onset-risk input. Onset before resolution within the same tick, so an incident cannot both start
and finish in the same invocation — every incident gets at least one full tick as `acute` before
its window can even begin closing, which matters for the "the child finds it alive first" concern
slice 0010 §2.2 raised about GBED and which applies identically here.

### 7.4 New event kinds

```
incident_onset    -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"COLIC",
                      "window_game_days":4,"treatment_cost":180}
incident_resolved -> {"v":1,"horse_name":"...","condition_name":"...","condition_code":"COLIC",
                      "outcome":"resolved"|"manageable"|"degenerative","treated":true|false}
horse_died         (reused unchanged, condition_code carries the acquired condition's code)
```

`subject_horse_id` set on all three, per `migrations/0048_events.sql`'s existing convention.

---

## 8. Where else it appears

### 8.1 `/horses/:id/treat` — POST, owner-only

Same shape as `/horses/:id/care` (slice 0013 §6.2): re-derive the open incident from
`horse_conditions` (never trust a submitted condition code), refuse if already treated or already
resolved, refuse via `canTakeOnCost` if the stable is in the red (the debt rule applies here exactly
as it does to a farrier call or a genotype test — this is a discretionary purchase, even if an
urgent one, per slice 0009 §4.6/slice 0010 §7.2's own reasoning), one `env.DB.batch()` for the
ledger row (`kind = 'vet'`, reusing the existing kind, description naming the condition) and the
`treated_game_day` stamp. **No turn spent** — matching every other care-shaped purchase in this
game, per slice 0013 §2.2's reasoning about not punishing attention.

### 8.2 The horse page — an Incidents card

Between Health and Care. An open incident: name, plain-English description
(`conditions.teaching_text`), days remaining in the window, cost, a **Call the vet** button. Once
resolved: nothing shown unless the outcome was `manageable` (in which case it reads exactly like an
unmanaged HYPP row already does) or `degenerative` (a permanent line, phrased calmly: *"Comet
developed chronic laminitis and can no longer be shown."*). A `resolved` outcome with no lasting
state shows nothing at all — the point of a clean recovery is that the horse's page goes back to
looking like it never happened.

A short history list below the card: past incidents, dates, and outcomes — the produce-record
pattern, applied to a horse's own medical history.

### 8.3 The barn list

A badge for any horse with an open acute incident, at **higher visual weight than the care/health
badges** (§1 step 5's urgency) — this is the one badge in the game that should read as "look at this
now" rather than "worth a look eventually."

### 8.4 `/admin/incidents`

New admin subpage, the `/admin/health`/`/admin/care` pattern: per condition, how many are currently
open, and the real outcome distribution across everything resolved so far (resolved / manageable /
degenerative / death percentages) — the instrument this whole document's numbers should be checked
against after real play, the same role `/admin/health` already plays for the single-gene panel. One
testing control, the `/admin/ageing`/`/admin/care` shape: "Force an incident" — pick a horse and a
condition, write the `acute` row immediately, bypassing the roll, so the full lifecycle can be
watched without waiting on real probabilities.

---

## 9. Seeds and reproducibility

Two new RNG stream labels, both derived per `CLAUDE.md` §5.2:

- `incident_<CONDITION_CODE>_<tickSeq>` — the onset draw, from the horse's own `rng_seed`, one per
  horse per condition per tick check. Twelve conditions means twelve independent draws per horse per
  check, which is a real, deliberate cost — see the CPU note below.
- `incident_resolve_<horse_conditions.id>` — the resolution draw, keyed on the incident row's own
  id rather than on a tick counter, so it can only ever be drawn once no matter which tick actually
  performs the resolution.

**A CPU note, not a design decision.** Twelve RNG draws per horse per onset check is twelve times
the cost of, say, `noticeCareDue`'s per-horse work. For a family-scale game (`CLAUDE.md` §1 — "roughly
five accounts") this is not a real concern; if a much larger population is ever run through this
tick, batching the twelve draws into a single derived stream read twelve times, or skipping
conditions whose current multiplier-adjusted probability rounds to zero before drawing at all, are
both available without changing any number in §4. Not built pre-emptively, per `CLAUDE.md` §9's
"don't build ahead."

---

## 10. Tests

**`src/engines/health/acquired.ts` (no database):**

1. `onsetProbability` is monotonic in each input direction independently — worse care never lowers
   risk, more workload never lowers risk, lower robustness never lowers risk (for the four that read
   one) — holding every other input fixed. This is the continuity/monotonicity discipline slice
   0013 §10 applied to its own ramp, applied here to a multiplicative risk formula instead.
2. `onsetProbability` never exceeds `incident_probability_ceiling_per_game_day`, tested with every
   input at its worst simultaneously.
3. The `1 - (1-p)^days` accumulation: two calls with `daysSinceLastCheck = 1` twice do **not** equal
   one call with `daysSinceLastCheck = 2` (they're close but not equal, since the daily draws are
   independent) — but a single `days = 5` call's probability is bounded between the `days = 1` and a
   naive `5 × p_day` linear approximation, catching a sign error in the exponent.
4. `rollOutcome`'s cumulative distribution sums correctly for all twelve conditions' tables (§4.3),
   both treated and untreated — a table that does not sum to 1.0 is a bug in this document, not just
   in code, and this test catches either.
5. A condition with `robustnessTrait: null` produces identical `onsetProbability` regardless of the
   `robustnessPotential` argument passed in — the no-op case, worth its own test the same way slice
   0010 §10 tested "a genotype with the locus key entirely missing reads clear."

**Database-backed (`node:sqlite` harness, per the market slice's own precedent):**

6. `rollAcuteIncidents` run twice against the same tick writes nothing the second time (idempotency).
7. `resolveAcuteIncidents`, given an incident whose `resolve_game_day` has passed and
   `treated_game_day IS NULL`, resolves against `outcomes_untreated`; given the same incident with
   `treated_game_day` set before resolution, resolves against `outcomes_treated`.
8. A `death` outcome runs the exact same horse-death path as `killDueLethalFoals` — same status,
   `end_reason`, and the horse remains in its dam's produce record and every pedigree afterward.
9. Eligibility: a horse with an open `state = 'acute'` row is refused show entry with
   `'acute_incident'`; a horse with a `degenerative` outcome on a *resolved* row is refused with
   `'degenerative_incident'`; a horse with a `resolved` or `manageable` outcome is **not** refused on
   either reason.
10. The knowledge-boundary test this document does *not* need: unlike slice 0010 §10, there is no
    "owner has not tested" case to assert against, since §2.7 established there is nothing hidden
    here. Worth a one-line comment in the test file saying so, so a future reader does not go looking
    for a boundary test that was deliberately never written.

---

## 11. Verifying it by hand

Against `wrangler dev --local`, after applying migrations:

1. `/admin/incidents` → "Force an incident" → pick a horse, pick Colic. The horse's page shows the
   Incidents card with a 4-day window and a 180 cost. The stable's events feed carries the onset
   line.
2. Call the vet. The ledger shows a 180 `vet` row, the card updates to "treated," and advancing ticks
   past the window resolves it — most of the time to "resolved," occasionally to something else,
   consistent with §4.3's treated table.
3. Force a second incident and do **not** pay. Advance ticks past the window. Most of the time it
   resolves fine; watch `/admin/incidents`' running tallies across several forced incidents to
   confirm the untreated death rate is landing somewhere near 40%, not obviously far off.
4. Force a laminitis incident on a horse currently on Premium feed, and the same on Standard. Confirm
   (via `/admin/config`'s live values, or by comparing many forced draws) that Premium's onset
   probability reads higher — the feed trade-off from §2.6.
5. Try to enter a horse with an open acute incident in a show: refused by name and reason. Try the
   same for a horse whose laminitis resolved `degenerative`: refused permanently, unlike the acute
   case which clears once resolved.
6. Take a stable's balance negative, then try to call the vet on an open incident: refused, same
   message shape as every other blocked purchase.

---

## 12. What to raise rather than decide

Per `CLAUDE.md` §2 — stop and ask on these rather than defaulting.

- **The exact numbers in §4.2/§4.3 are the single biggest open question in this whole document.**
  They are reasoned starting points, not measurements, and this is a system where the numbers decide
  whether a beloved horse's death reads as "rare and real" or "a thing that just happened to us
  twice this month." Watch `/admin/incidents` closely for the first real game-months after this
  ships, the same instruction slice 0010 §4.3/§14 gave for the founding disease frequencies, and
  retune before trusting the mechanic to teach what it is meant to teach.
- **Robustness modifies onset only, never outcome severity (§2.3).** This is a real simplification —
  in life, a structurally weaker horse both gets laminitis more often *and* recovers from it worse.
  Adding a second robustness-reads-outcome-table mechanism is a reasonable follow-up, not a mistake
  in this pass, but it is a genuine design gap worth naming rather than quietly living with forever.
- **Whether strangles' quarantine-while-acute should also block *entering a horse into a covering*,
  not just a show.** This document only wires the new eligibility reasons into showing (§5.4),
  matching where `bars_showing` already lives. A contagious respiratory illness arguably should not
  be breeding either, but that is a second gate (`validateBooking`) this document has not touched,
  and extending it is a real scope decision, not an oversight to silently fix.
- **The `last_incident_check_game_day` naming correction in §7.1** should be applied for real, not
  left as the flagged discrepancy this document deliberately preserves — call it out explicitly in
  the build summary so nobody mistakes the flag itself for the fix.

---

## 13. Documents to correct when this is built

- **`CLAUDE.md` §10** — a new row, "Acquired conditions," moving from "specified, not built" to
  built, with what actually landed and any numbers retuned from §4 during real play.
- **`CLAUDE.md` §11 / `docs/build-log.md`** — a dated entry: the `acquired` category and `acute`
  severity class as genuinely new concepts (not just new rows) beyond slice 0010's four; the
  onset/resolution two-phase engine and why it is one pair of functions for twelve conditions; the
  per-day-not-per-tick probability shape and why (§4.2); the per-incident `outcome` column versus
  the per-condition `bars_showing` column and why eligibility had to read the former (§5.4/§6.1); the
  `foot_robustness`/`joint_robustness`/`ligament_robustness` traits finally getting a reader, four
  years (in game-build time) after slice 0014 built them ahead of use.
- **`docs/horse-game-overview.md` §3a** — record that the polygenic predisposition category has
  consequences now, for the four robustness-linked conditions, and that the purely-acquired half of
  this document (colic, ulcers, and the rest) is a genuinely new fourth category the original three-
  category framing did not anticipate — worth a sentence saying so rather than silently stretching
  "polygenic" to cover conditions with no genetic input at all.
- **`docs/slices/0013-care-and-condition.md` §3.4** — note that workload and the die-roll question
  it declined to open are now addressed here, and where.
- **`docs/horse-game-schema.md` §4.5** — the `at_risk`/`managed`/`resolved` values are now partially
  kept (`resolved` lands here; `at_risk` still does not, per §3.1's deferral) — say precisely which.
